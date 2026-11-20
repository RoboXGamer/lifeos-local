const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const sdk = b.option([]const u8, "electrobun-sdk", "Electrobun Zig SDK path") orelse
        @panic("Build through Hutch to resolve the Electrobun SDK");
    const electrobun = b.createModule(.{
        .root_source_file = .{ .cwd_relative = sdk },
        .target = target,
        .optimize = optimize,
    });
    const exe = b.addExecutable(.{
        .name = "main",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
            .imports = &.{.{ .name = "electrobun", .module = electrobun }},
        }),
    });
    b.installArtifact(exe);
}
