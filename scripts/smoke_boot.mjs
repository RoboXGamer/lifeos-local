/**
 * Boots the desktop app once and verifies the real render:
 *  1. the SQL plugin applies migrations and ensureProfile() writes a profile +
 *     "My Life" workspace,
 *  2. the WebView renders the app shell (nav present, #root not empty),
 *     inspected over the WebView2 CDP port.
 *
 * Usage: node scripts/smoke_boot.mjs
 * Exits 0 on success, 1 on timeout. The app window is closed again.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dbPath = join(process.env.APPDATA, "dev.a5in.lifeos", "lifeos.db");
const cdpPort = 9333;
const timeoutMs = 150_000;
const pollMs = 2_000;

const child = spawn("pnpm", ["tauri", "dev"], {
  cwd: process.cwd(),
  shell: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
  },
});
child.stdout.on("data", (chunk) => process.stdout.write(chunk));
child.stderr.on("data", (chunk) => process.stderr.write(chunk));

function readBootstrap() {
  if (!existsSync(dbPath)) return undefined;
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const profile = db
      .prepare("SELECT activeWorkspaceId FROM profiles LIMIT 1")
      .get();
    const workspace = db.prepare("SELECT name FROM workspaces LIMIT 1").get();
    return { profile, workspace };
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

async function pageTarget() {
  try {
    const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    const targets = await response.json();
    return targets.find(
      (target) => target.type === "page" && String(target.url).includes("1420"),
    );
  } catch {
    return undefined;
  }
}

async function inspectDom(wsUrl) {
  return new Promise((resolve) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      socket.close();
      resolve(undefined);
    }, 5_000);

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            returnByValue: true,
            expression: `(() => {
              const root = document.getElementById('root');
              return JSON.stringify({
                href: location.href,
                children: root ? root.children.length : 0,
                nav: [...document.querySelectorAll('a.nav-button')]
                  .map((a) => a.getAttribute('aria-label')),
                text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 240),
              });
            })()`,
          },
        }),
      );
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      try {
        resolve(JSON.parse(message.result.result.value));
      } catch {
        resolve(undefined);
      }
    });

    socket.addEventListener("error", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}

const started = Date.now();
let bootstrap;
let dom;
while (Date.now() - started < timeoutMs) {
  await new Promise((resolve) => setTimeout(resolve, pollMs));
  bootstrap = readBootstrap();
  if (!bootstrap?.profile || !bootstrap?.workspace) continue;

  const target = await pageTarget();
  if (!target?.webSocketDebuggerUrl) continue;

  dom = await inspectDom(target.webSocketDebuggerUrl);
  if (dom && dom.children > 0 && dom.nav?.length === 5) break;
  dom = undefined;
}

const bootOk = Boolean(bootstrap?.profile && bootstrap?.workspace);
const renderOk = Boolean(dom && dom.children > 0 && dom.nav?.length === 5);

if (bootOk) {
  console.log(
    `BOOT OK: workspace="${bootstrap.workspace.name}" active=${bootstrap.profile.activeWorkspaceId}`,
  );
} else {
  console.log("BOOT FAILED: profile/workspace rows not created in time");
}
if (renderOk) {
  console.log(`RENDER OK: ${dom.href} nav=${dom.nav.join(",")}`);
  console.log(`TEXT: ${dom.text}`);
} else {
  console.log("RENDER FAILED: app shell did not mount in the WebView");
}

spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: true });
process.exit(bootOk && renderOk ? 0 : 1);
