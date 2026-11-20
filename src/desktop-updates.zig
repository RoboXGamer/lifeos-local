const std = @import("std");
const electrobun = @import("electrobun");

const Action = enum(u8) { none, status, check, download, install };
const Status = enum { disabled, idle, checking, current, available, downloading, ready, installing, failed };
const Report = struct {
    status: Status,
    version: []const u8 = "",
    message: []const u8 = "",
};

var active: ?*Controller = null;

pub fn receive(webview: u32, message: [*:0]const u8) callconv(.c) void {
    const controller = active orelse return;
    if (webview == 0 or webview != controller.webview.load(.acquire)) return;
    const Envelope = struct {
        id: []const u8,
        payload: struct { eventName: []const u8, detail: []const u8 },
    };
    const text = std.mem.span(message);
    if (text.len > 512) return;
    const parsed = std.json.parseFromSlice(Envelope, std.heap.c_allocator, text, .{ .ignore_unknown_fields = true }) catch return;
    defer parsed.deinit();
    if (!std.mem.eql(u8, parsed.value.id, "webviewEvent") or
        !std.mem.eql(u8, parsed.value.payload.eventName, "host-message")) return;
    const detail = parsed.value.payload.detail;
    const prefix = "\"lifeos:updates:";
    if (!std.mem.startsWith(u8, detail, prefix) or !std.mem.endsWith(u8, detail, "\"")) return;
    const action = std.meta.stringToEnum(Action, detail[prefix.len .. detail.len - 1]) orelse return;
    if (action != .none) _ = controller.action.cmpxchgStrong(.none, action, .release, .monotonic);
}

pub const Controller = struct {
    core: *electrobun.Core,
    service: []const u8,
    webview: std.atomic.Value(u32) = .init(0),
    action: std.atomic.Value(Action) = .init(.none),
    stopping: std.atomic.Value(bool) = .init(false),
    operation: ?[]u8 = null,
    install: bool = false,
    approved: bool = false,

    pub fn start(self: *Controller) !std.Thread {
        active = self;
        return std.Thread.spawn(.{}, run, .{self});
    }

    pub fn stop(self: *Controller, worker: std.Thread) void {
        self.stopping.store(true, .release);
        worker.join();
        active = null;
        self.clearOperation();
    }

    fn clearOperation(self: *Controller) void {
        if (self.operation) |id| self.core.allocator.free(id);
        self.operation = null;
        self.install = false;
        self.approved = false;
    }

    fn report(self: *Controller, status: Report) !void {
        const allocator = self.core.allocator;
        const value = try std.json.Stringify.valueAlloc(allocator, status, .{});
        defer allocator.free(value);
        const js = try std.fmt.allocPrint(allocator, "window.dispatchEvent(new CustomEvent('lifeos-update', {{detail: {s}}}))", .{value});
        defer allocator.free(js);
        try self.core.evaluateJavaScriptWithNoCompletion(self.webview.load(.acquire), js);
    }

    fn run(self: *Controller) void {
        while (!self.stopping.load(.acquire)) {
            self.tick() catch |err| {
                std.log.err("LifeOS update failed: {s}", .{@errorName(err)});
                self.report(.{ .status = .failed, .message = "LifeOS could not complete the update." }) catch {};
                self.clearOperation();
            };
            electrobun.defaultIo().sleep(.fromMilliseconds(200), .awake) catch return;
        }
    }

    fn tick(self: *Controller) !void {
        const action = self.action.swap(.none, .acquire);
        if (action == .none and self.operation == null) return;
        var parsed = try self.core.updaterGetState();
        defer parsed.deinit();
        const state = parsed.value;
        if (self.operation) |id| return self.observe(state, id);

        if (state.localInfo.channel.len == 0 or std.mem.eql(u8, state.localInfo.channel, "dev") or
            state.localInfo.baseUrl.len == 0 or
            (state.localInfo.updateAuthority != null and !std.mem.eql(u8, state.localInfo.updateAuthority.?, "direct")))
        {
            return self.report(.{ .status = .disabled });
        }

        if (action == .status) return self.report(.{
            .status = if (state.updateInfo.updateReady) .ready else if (state.updateInfo.updateAvailable) .available else .idle,
            .version = state.updateInfo.version,
        });

        var request = switch (action) {
            .check => try self.core.updaterCheck(),
            .download => try self.core.updaterDownload(),
            .install => try self.core.updaterRequestApply(),
            .none, .status => unreachable,
        };
        defer request.deinit();
        if (!request.value.accepted) return self.report(.{
            .status = .failed,
            .message = request.value.@"error" orelse "The updater rejected the request.",
        });
        self.operation = try self.core.allocator.dupe(u8, request.value.operationId orelse return error.MissingUpdateOperation);
        self.install = action == .install;
        try self.report(.{ .status = switch (action) {
            .check => .checking,
            .download => .downloading,
            .install => .installing,
            else => unreachable,
        } });
    }

    fn observe(self: *Controller, state: electrobun.UpdaterState, id: []const u8) !void {
        if (self.install and std.mem.eql(u8, state.operationId orelse "", id)) {
            if (state.quitReady) {
                try self.stopService();
                self.clearOperation();
                return self.core.stopEventLoop();
            }
            if (!self.approved and state.operationState == .awaitingApproval) {
                const approval = state.approval orelse return error.MissingUpdateApproval;
                var response = try self.core.updaterApproveApply(id, approval.id, true);
                defer response.deinit();
                if (!response.value.accepted) return error.UpdateApprovalRejected;
                self.approved = true;
            }
        }

        for (state.operations) |operation| {
            if (!std.mem.eql(u8, operation.operationId, id)) continue;
            switch (operation.state) {
                .failed, .cancelled => {
                    self.clearOperation();
                    return self.report(.{
                        .status = .failed,
                        .message = operation.@"error" orelse "The update did not complete.",
                    });
                },
                .completed => {
                    if (self.install) return;
                    self.clearOperation();
                    const info = operation.updateInfo orelse return error.MissingUpdateResult;
                    if (info.@"error".len != 0) return self.report(.{ .status = .failed, .message = info.@"error" });
                    return self.report(.{
                        .status = if (info.updateReady) .ready else if (info.updateAvailable) .available else .current,
                        .version = info.version,
                    });
                },
                else => return,
            }
        }
        return error.MissingUpdateOperation;
    }

    fn stopService(self: *Controller) !void {
        const allocator = self.core.allocator;
        const result = try std.process.run(allocator, electrobun.defaultIo(), .{
            .argv = &.{ self.service, "stop" },
        });
        defer allocator.free(result.stdout);
        defer allocator.free(result.stderr);
        if (result.term != .exited or result.term.exited != 0) return error.LocalServiceDidNotStop;
    }
};
