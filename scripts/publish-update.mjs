#!/usr/bin/env node
/**
 * Builds a signed Windows release and publishes it to a local update folder.
 *
 *   node scripts/publish-update.mjs --version 0.1.1 --notes "What changed"
 *   pnpm update:serve
 *
 * The app checks http://127.0.0.1:8123/latest.json at startup. Everything the
 * updater needs (NSIS zip, signature, manifest) lands in
 * src-tauri/target/release/bundle/updates, which is already gitignored.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);

function readArg(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const version = readArg("version");
const notes = readArg("notes", "");
const port = readArg("port", "8123");
const skipBuild = args.includes("--skip-build");

if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(
    'usage: node scripts/publish-update.mjs --version 0.1.1 [--notes "..."] [--port 8123] [--skip-build]',
  );
  process.exit(1);
}

const root = process.cwd();
const keyPath =
  process.env.TAURI_SIGNING_PRIVATE_KEY ??
  path.join(os.homedir(), ".tauri", "lifeos.key");
const nsisDir = path.join(root, "src-tauri", "target", "release", "bundle", "nsis");
const outDir = path.join(root, "src-tauri", "target", "release", "bundle", "updates");
const confPath = path.join(root, "src-tauri", "tauri.conf.json");

if (!fs.existsSync(keyPath)) {
  console.error(`signing key not found: ${keyPath}`);
  console.error("set TAURI_SIGNING_PRIVATE_KEY to a key file or its contents");
  process.exit(1);
}

function build() {
  if (skipBuild) {
    console.log("skipping build (--skip-build)");
    return true;
  }

  const confText = fs.readFileSync(confPath, "utf8");
  const conf = JSON.parse(confText);
  const previousVersion = conf.version;
  conf.version = version;

  console.log(`building LifeOS ${version} (nsis + updater artifacts)…`);
  try {
    fs.writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`);
    const result = spawnSync("pnpm tauri build --bundles nsis", {
      cwd: root,
      shell: true,
      stdio: "inherit",
      env: {
        ...process.env,
        TAURI_SIGNING_PRIVATE_KEY: fs.readFileSync(keyPath, "utf8"),
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD:
          process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
      },
    });
    return result.status === 0;
  } finally {
    fs.writeFileSync(confPath, confText);
    console.log(`restored app version ${previousVersion}`);
  }
}

if (!build()) {
  console.error("build failed");
  process.exit(1);
}

function newestArtifact() {
  if (!fs.existsSync(nsisDir)) return undefined;
  const artifacts = fs
    .readdirSync(nsisDir)
    // Tauri v2 ships the NSIS installer itself (plus .sig); older bundlers
    // wrapped it in a .nsis.zip. Accept both.
    .filter((name) => name.endsWith(".nsis.zip") || name.endsWith("-setup.exe"))
    .map((name) => {
      const full = path.join(nsisDir, name);
      return { full, name, time: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.time - a.time);
  return artifacts[0];
}

const artifact = newestArtifact();
if (!artifact) {
  console.error(`no NSIS installer (.exe or .nsis.zip) in ${nsisDir}`);
  process.exit(1);
}

const sigPath = `${artifact.full}.sig`;
if (!fs.existsSync(sigPath)) {
  console.error(`no signature next to ${artifact.name}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
for (const file of fs.readdirSync(outDir)) {
  fs.rmSync(path.join(outDir, file), { force: true });
}
fs.copyFileSync(artifact.full, path.join(outDir, artifact.name));

const signature = fs.readFileSync(sigPath, "utf8").trim();
const manifest = {
  version,
  notes: notes || `LifeOS ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `http://127.0.0.1:${port}/${artifact.name}`,
    },
  },
};
fs.writeFileSync(
  path.join(outDir, "latest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log("");
console.log(`published ${version}`);
console.log(`  installer: ${artifact.name}`);
console.log(`  folder:    ${path.relative(root, outDir)}`);
console.log(`  manifest:  http://127.0.0.1:${port}/latest.json`);
console.log("");
console.log("next:");
console.log("  pnpm update:serve");
console.log("  then start the currently installed (older) app");
