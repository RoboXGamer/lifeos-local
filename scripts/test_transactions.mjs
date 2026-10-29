/** Desktop integration checks against a fresh, separately identified app database. */
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const id = randomUUID().replaceAll("-", "");
const config = join(tmpdir(), `lifeos-test-${id}.json`);
const pageName = `lifeos-test-${id}.html`;
const pagePath = join(process.cwd(), pageName);
writeFileSync(pagePath, '<!doctype html><title>LifeOS isolated transaction test</title>');
writeFileSync(config, JSON.stringify({
  identifier: `dev.a5in.lifeos.test${id}`,
  app: { windows: [{ label: "main", title: "LifeOS test", visible: false }] },
  build: { devUrl: `http://127.0.0.1:1420/${pageName}` },
}));
const port = 9334;
const child = spawn("pnpm", ["tauri", "dev", "--config", config], {
  shell: true,
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

async function getTarget() {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })).json();
    return targets.find((target) => target.type === "page" && target.url.includes(":1420"));
  } catch { return undefined; }
}

async function evaluate(url, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => { socket.close(); reject(new Error("WebView evaluation timed out")); }, 30000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } })));
    socket.addEventListener("message", (event) => {
      const response = JSON.parse(String(event.data));
      if (response.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (response.result?.exceptionDetails) reject(new Error(response.result.exceptionDetails.text));
      else resolve(response.result.result.value);
    });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("WebView connection failed")); });
  });
}

try {
  let target;
  for (let i = 0; i < 120; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    target = await getTarget();
    if (!target) continue;
    const ready = await evaluate(target.webSocketDebuggerUrl, "document.readyState === 'complete'").catch(() => false);
    if (ready) break;
    target = undefined;
  }
  if (!target) throw new Error("The isolated desktop app did not start");
  const expression = `(async () => {
    try {
      const { api } = await import('/src/local/api.ts');
      const { data } = await import('/src/local/store.ts');
      const { run, select } = await import('/src/local/db.ts');
      await api.profiles.bootstrap();
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      const input = (title, parentId = null, tags = []) => ({title, parentId, tags, areaId:null, type:'Task', status:'Todo', priority:null, dueDate:null, amount:null, financialState:null, description:null});
      const ws = data.profile.activeWorkspaceId;
      const parent = await api.items.create({workspaceId:ws, ...input('parent', null, ['waiting'])});
      const child = await api.items.create({workspaceId:ws, ...input('child', parent)});
      await run("CREATE TRIGGER fail_tag BEFORE INSERT ON itemTags BEGIN SELECT RAISE(ABORT, 'injected tag failure'); END");
      let failed = false;
      try { await api.items.update({itemId:parent, ...input('changed', null, ['urgent'])}); } catch { failed = true; }
      assert(failed, 'tag failure was not surfaced');
      let rows = await select('SELECT title FROM items WHERE _id = ?', [parent]);
      assert(rows[0].title === 'parent', 'item update was partially committed');
      rows = await select('SELECT COUNT(*) AS count FROM itemTags WHERE itemId = ?', [parent]);
      assert(rows[0].count === 1, 'tag links were partially committed');
      await run('DROP TRIGGER fail_tag');
      await run("CREATE TRIGGER fail_child BEFORE UPDATE ON items WHEN OLD.title = 'child' BEGIN SELECT RAISE(ABORT, 'injected child failure'); END");
      failed = false;
      try { await api.items.setArchived({itemId:parent, archived:true}); } catch { failed = true; }
      assert(failed, 'family failure was not surfaced');
      rows = await select('SELECT archived FROM items WHERE _id IN (?, ?)', [parent, child]);
      assert(rows.length === 2 && rows.every(row => row.archived === 0), 'family archive was partially committed');
      await run('DROP TRIGGER fail_child');
      await api.items.setArchived({itemId:parent, archived:true});
      await run("CREATE TRIGGER fail_delete BEFORE DELETE ON items WHEN OLD.title = 'parent' BEGIN SELECT RAISE(ABORT, 'injected delete failure'); END");
      failed = false;
      try { await api.items.remove({itemId:parent, confirmation:'parent'}); } catch { failed = true; }
      assert(failed, 'delete failure was not surfaced');
      rows = await select('SELECT COUNT(*) AS count FROM itemTags WHERE itemId = ?', [parent]);
      assert(rows[0].count === 1, 'delete lost tag links');
      rows = await select('SELECT COUNT(*) AS count FROM items WHERE _id IN (?, ?)', [parent, child]);
      assert(rows[0].count === 2, 'delete was partially committed');
      await run('DROP TRIGGER fail_delete');
      await Promise.all(Array.from({length:8}, (_, i) => api.items.quickCapture({workspaceId:ws, title:'parallel ' + i})));
      rows = await select("SELECT COUNT(*) AS count FROM items WHERE title LIKE 'parallel %'");
      assert(rows[0].count === 8 && data.items.filter(item => item.title.startsWith('parallel ')).length === 8, 'concurrent writes did not converge');
      return {ok:true, message:'tag, family and deletion rollback; concurrent commits and store refresh passed'};
    } catch (error) { return {ok:false, message:String(error?.stack ?? error)}; }
  })()`;
  const result = await evaluate(target.webSocketDebuggerUrl, expression);
  console.log(result);
  if (!result?.ok) process.exitCode = 1;
} finally {
  try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
  unlinkSync(config);
  unlinkSync(pagePath);
}
