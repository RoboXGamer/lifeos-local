import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { strict as assert } from 'node:assert';

const id = randomUUID().replaceAll('-', '');
const identifier = `dev.a5in.lifeos.test${id}`;
const config = join(tmpdir(), `lifeos-gui-${id}.json`);
writeFileSync(config, JSON.stringify({ identifier }));
const dataDir = join(process.env.APPDATA, identifier);
const infoPath = join(dataDir, 'service.json');
const child = spawn('pnpm', ['tauri', 'dev', '--config', config], { shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LIFEOS_TEST_HIDDEN: '1', WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9336' } });
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
async function target() {
  try { return (await (await fetch('http://127.0.0.1:9336/json/list', { signal: AbortSignal.timeout(2000) })).json()).find(x => x.type === 'page' && x.url.startsWith('http://127.0.0.1:') && !x.url.includes(':1420')); } catch { return undefined; }
}
async function evaluate(url, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => { socket.close(); reject(new Error('WebView timeout')); }, 5000);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    socket.onmessage = e => { const result = JSON.parse(String(e.data)); if (result.id !== 1) return; clearTimeout(timer); socket.close(); resolve(result.result?.result?.value); };
    socket.onerror = () => { clearTimeout(timer); reject(new Error('WebView unavailable')); };
  });
}
try {
  let page;
  for (let i = 0; i < Number(process.env.LIFEOS_DESKTOP_WAIT_SECONDS ?? 180); i++) {
    if (child.exitCode !== null) throw new Error(`Desktop process exited with code ${child.exitCode}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    page = await target();
    if (page && await evaluate(page.webSocketDebuggerUrl, "document.querySelectorAll('a.nav-button').length").catch(() => 0) >= 5) break;
    page = undefined;
  }
  assert(page, 'Desktop shell did not load');
  const exe = join(process.cwd(), 'src-tauri/binaries/lifeos-x86_64-pc-windows-msvc.exe');
  const cli = spawnSync(exe, ['--json', 'capture', 'CLI live desktop test'], { encoding: 'utf8', env: { ...process.env, LIFEOS_DATA_DIR: dataDir, LIFEOS_CLIENT_DIR: join(process.cwd(), 'dist/client') } });
  assert.equal(cli.status, 0, cli.stderr);
  const search = spawnSync(exe, ['--json', 'search', 'CLI live desktop test'], { encoding: 'utf8', env: { ...process.env, LIFEOS_DATA_DIR: dataDir, LIFEOS_CLIENT_DIR: join(process.cwd(), 'dist/client') } });
  assert.equal(search.status, 0, search.stderr);
  assert(JSON.parse(search.stdout).some(item => item.title === 'CLI live desktop test'));
  let text = '';
  for (let i = 0; i < 30; i++) {
    text = await evaluate(page.webSocketDebuggerUrl, 'document.body.innerText');
    if (text.includes('CLI live desktop test')) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(text.includes('CLI live desktop test'), 'CLI change did not appear in the open desktop');
  await evaluate(page.webSocketDebuggerUrl, `(() => { const input = document.querySelector('#quick-capture'); input.value = 'Desktop to CLI test'; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await new Promise(resolve => setTimeout(resolve, 200));
  await evaluate(page.webSocketDebuggerUrl, `document.querySelector('form.inbox-capture').requestSubmit()`);
  let found = false;
  for (let i = 0; i < 30; i++) {
    const check = spawnSync(exe, ['--json', 'search', 'Desktop to CLI test'], { encoding: 'utf8', env: { ...process.env, LIFEOS_DATA_DIR: dataDir, LIFEOS_CLIENT_DIR: join(process.cwd(), 'dist/client') } });
    if (check.status === 0 && JSON.parse(check.stdout).some(item => item.title === 'Desktop to CLI test')) { found = true; break; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!found) console.log('Desktop after capture:', (await evaluate(page.webSocketDebuggerUrl, 'document.body.innerText')).slice(0, 500));
  assert(found, 'Desktop capture did not appear in the CLI');
  await evaluate(page.webSocketDebuggerUrl, "window.__lifeosSmokeErrors = []; window.addEventListener('error', event => window.__lifeosSmokeErrors.push(event.message)); window.addEventListener('unhandledrejection', event => window.__lifeosSmokeErrors.push(String(event.reason)))");
  for (const [route, heading] of [['templates', 'Templates'], ['recurring', 'Recurring'], ['automations', 'Automations'], ['projects', 'Projects'], ['obligations', 'Promise to payment'], ['habits', 'Habits & progress'], ['today', 'Today']]) {
    await evaluate(page.webSocketDebuggerUrl, `document.querySelector('a.nav-button[href="/app/${route}"]').click()`);
    let loaded = false;
    for (let i = 0; i < 30; i++) { if (await evaluate(page.webSocketDebuggerUrl, `document.querySelector('main h2')?.textContent === ${JSON.stringify(heading)}`)) { loaded = true; break; } await new Promise(resolve => setTimeout(resolve, 100)); }
    assert(loaded, `${route} page did not render`);
    assert.equal((await evaluate(page.webSocketDebuggerUrl, 'window.__lifeosSmokeErrors')).length, 0, `${route} raised a browser error`);
  }
  assert((await evaluate(page.webSocketDebuggerUrl, 'document.body.innerText')).includes('Worth your attention'));
  console.log('Desktop shell, both CLI/UI capture directions, six productivity pages and Today rendering passed');
} finally {
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  if (existsSync(infoPath)) { try { const info = JSON.parse(readFileSync(infoPath, 'utf8')); process.kill(info.pid); } catch {} }
  try { unlinkSync(config); } catch {}
}
