const std = @import("std");
const builtin = @import("builtin");
const electrobun = @import("electrobun");
const updates = @import("desktop-updates.zig");

const width = 900;
const height = 700;
var allowed_origin: []const u8 = "";

fn allowServicePage(_: u32, url: [*:0]const u8) callconv(.c) u32 {
    return @intFromBool(std.mem.startsWith(u8, std.mem.span(url), allowed_origin));
}

fn connect(allocator: std.mem.Allocator, service: []const u8, live_reload: bool) ![]const u8 {
    const result = try std.process.run(allocator, electrobun.defaultIo(), .{
        .argv = &.{ service, "connection" },
    });
    if (result.term != .exited or result.term.exited != 0) {
        std.log.err("Local service connection failed: {s}", .{std.mem.trim(u8, result.stderr, "\r\n")});
        return error.ServiceConnectionFailed;
    }
    const Connection = struct { port: u16, token: []const u8 };
    const connection = try std.json.parseFromSliceLeaky(Connection, allocator, result.stdout, .{ .ignore_unknown_fields = true });
    if (connection.port == 0 or connection.token.len != 64) return error.InvalidServiceConnection;
    for (connection.token) |byte| {
        if (!std.ascii.isHex(byte)) return error.InvalidServiceConnection;
    }
    const port = if (live_reload) 1420 else connection.port;
    allowed_origin = try std.fmt.allocPrint(allocator, "http://127.0.0.1:{d}/", .{port});
    return std.fmt.allocPrint(allocator, "{s}auth?token={s}", .{ allowed_origin, connection.token });
}

fn createUi(allocator: std.mem.Allocator, core: *electrobun.Core, paths: *const electrobun.BundlePaths, updater: *updates.Controller, live_reload: bool) !void {
    const page = try connect(allocator, updater.service, live_reload);
    // Give the platform event loop time to accept marshalled window calls.
    try electrobun.defaultIo().sleep(.fromMilliseconds(150), .awake);
    try core.configureWebviewRuntimeFromExecutableDir(paths, 0);
    const id = try core.createWindow(.{
        .title = "LifeOS",
        .frame = .{ .x = 120, .y = 80, .width = width, .height = height },
        .centered = true,
    });
    errdefer core.closeWindow(id) catch {};

    // Core requires a comma-separated 32-byte key even for a sandboxed view.
    var key: [32]u8 = undefined;
    electrobun.defaultIo().random(&key);
    var encoded: [127]u8 = undefined;
    var length: usize = 0;
    for (key, 0..) |byte, index| {
        if (index != 0) {
            encoded[length] = ',';
            length += 1;
        }
        length += (try std.fmt.bufPrint(encoded[length..], "{d}", .{byte})).len;
    }
    const webview = try core.createWebview(.{
        .window_id = id,
        .url = page,
        .frame = .{ .width = width, .height = height },
        .secret_key = encoded[0..length],
        .callbacks = .{ .decide_navigation = allowServicePage, .event_bridge = updates.receive },
        .allowed_protocols = .{ .views = false },
    });
    updater.webview.store(webview, .release);
    try core.maximizeWindow(id);
}

fn startUi(allocator: std.mem.Allocator, core: *electrobun.Core, paths: *const electrobun.BundlePaths, updater: *updates.Controller, live_reload: bool) void {
    createUi(allocator, core, paths, updater, live_reload) catch |err| {
        std.log.err("Failed to open LifeOS: {s}", .{@errorName(err)});
        core.quitGracefully(1);
    };
}

pub fn main(init: std.process.Init) !void {
    const allocator = std.heap.c_allocator;
    var core = try electrobun.Core.load(allocator);
    defer core.close();
    var paths = try electrobun.resolveBundlePaths(allocator);
    defer paths.deinit(allocator);
    var info = try electrobun.resolveAppInfoFromBundle(allocator, &paths);
    defer info.deinit(allocator);

    var ui_storage = std.heap.ArenaAllocator.init(allocator);
    defer ui_storage.deinit();
    const binary = if (builtin.os.tag == .windows) "lifeos.exe" else "lifeos";
    const service = try std.fs.path.join(ui_storage.allocator(), &.{ paths.resources_dir, "app", "lifeos-service", binary });
    var updater: updates.Controller = .{ .core = &core, .service = service };
    const update_worker = try updater.start();
    defer updater.stop(update_worker);
    const live_reload = std.mem.eql(u8, init.environ_map.get("LIFEOS_ELECTROBUN_DEV") orelse "", "1");
    const ui = try std.Thread.spawn(.{}, startUi, .{ ui_storage.allocator(), &core, &paths, &updater, live_reload });
    defer ui.join();
    try core.runMainThread(info.borrowed());
}
