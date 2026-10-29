import { createListener } from '../dist/server/node.js';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, openSync, closeSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';

const directory = process.env.LIFEOS_DATA_DIR ?? (process.env.APPDATA && join(process.env.APPDATA, 'dev.a5in.lifeos'));
if (!directory) throw new Error('LifeOS data directory could not be determined');
mkdirSync(directory, { recursive: true });
const infoPath = join(directory, 'service.json');
const lockPath = join(directory, 'service.lock');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function serviceInfo() {
  try {
    const info = JSON.parse(readFileSync(infoPath, 'utf8'));
    if (!alive(info.pid) || !Number.isInteger(info.port) || typeof info.token !== 'string') return;
    const res = await fetch(`http://127.0.0.1:${info.port}/api`, { method: 'POST', headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'query', name: 'workspaces', args: {} }), signal: AbortSignal.timeout(1000) });
    if (res.ok) return info;
  } catch {}
}

async function connect() {
  let info = await serviceInfo();
  if (info) return info;
  const entry = process.env.LIFEOS_DEV_ENTRY;
  const executable = process.execPath;
  const child = spawn(executable, entry ? [entry, 'serve'] : ['serve'], { detached: true, windowsHide: true, stdio: 'ignore', env: process.env });
  child.unref();
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    info = await serviceInfo();
    if (info) return info;
  }
  throw new Error('Could not start the LifeOS local service');
}

async function serve() {
  let lock;
  try { lock = openSync(lockPath, 'wx', 0o600); }
  catch {
    try {
      const pid = Number(readFileSync(lockPath, 'utf8'));
      if (pid && !alive(pid)) unlinkSync(lockPath);
      else return;
      lock = openSync(lockPath, 'wx', 0o600);
    } catch { return; }
  }
  writeFileSync(lock, String(process.pid));
  closeSync(lock);
  const token = randomBytes(32).toString('hex');
  process.env.LIFEOS_TOKEN = token;
  const listener = createListener({ static: false });
  const clientDir = resolve(process.env.LIFEOS_CLIENT_DIR ?? join(dirname(process.execPath), 'lifeos-client'));
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.html': 'text/html; charset=utf-8' };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if ((req.method === 'GET' || req.method === 'HEAD') && !url.pathname.startsWith('/_server') && url.pathname !== '/auth' && url.pathname !== '/api') {
      let path;
      try { path = resolve(clientDir, '.' + decodeURIComponent(url.pathname)); } catch { res.writeHead(400).end(); return; }
      if (!path.startsWith(clientDir + '\\') && !path.startsWith(clientDir + '/')) path = join(clientDir, 'index.html');
      if (!existsSync(path) || url.pathname === '/') path = join(clientDir, 'index.html');
      try { const contents = readFileSync(path); res.writeHead(200, { 'content-type': mime[extname(path)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff' }); res.end(req.method === 'HEAD' ? undefined : contents); }
      catch { res.writeHead(404).end(); }
      return;
    }
    void listener(req, res);
  });
  server.listen(0, '127.0.0.1', () => {
    const info = { pid: process.pid, port: server.address().port, token, version: 1 };
    writeFileSync(infoPath, JSON.stringify(info), { mode: 0o600 });
  });
  const cleanup = () => { try { unlinkSync(infoPath); } catch {} try { unlinkSync(lockPath); } catch {} };
  process.on('lifeos-stop', () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
  process.on('exit', cleanup);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { cleanup(); process.exit(0); });
}

const help = `Usage: lifeos [--json] [--workspace ID] COMMAND
  workspaces | areas | list | search TEXT | capture TITLE
  done ITEM_ID | archive ITEM_ID | restore ITEM_ID | help`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === 'serve') return serve();
  if (command === 'stop') {
    const info = await serviceInfo();
    if (!info) { console.log('LifeOS service is not running.'); return; }
    const response = await fetch(`http://127.0.0.1:${info.port}/api`, { method: 'POST', headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'control', name: 'stop' }) });
    if (!response.ok) throw new Error('Unable to stop LifeOS service');
    for (let i = 0; i < 50 && alive(info.pid); i++) await sleep(100);
    if (alive(info.pid)) throw new Error('LifeOS service did not stop');
    console.log('LifeOS service stopped.');
    return;
  }
  if (!command || command === 'help' || command === '--help' || command === '-h') { console.log(help); return; }
  const info = await connect();
  if (command === 'connection') { console.log(JSON.stringify(info)); return; }
  const json = args.includes('--json');
  if (json) args.splice(args.indexOf('--json'), 1);
  const wsIndex = args.indexOf('--workspace');
  let workspaceId;
  if (wsIndex >= 0) { workspaceId = args[wsIndex + 1]; if (!workspaceId) throw new Error('--workspace requires an ID'); args.splice(wsIndex, 2); }
  const [action, ...rest] = args;
  async function api(kind, name, payload = {}) {
    const response = await fetch(`http://127.0.0.1:${info.port}/api`, { method: 'POST', headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ kind, name, args: payload }) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? 'Service request failed');
    return value.result;
  }
  const workspaces = await api('query', 'workspaces');
  workspaceId ??= workspaces.activeWorkspaceId;
  if (!workspaces.workspaces.some(workspace => workspace.id === workspaceId)) throw new Error('Active workspace not found');
  let result;
  if (action === 'workspaces') result = workspaces.workspaces;
  else if (action === 'areas') result = await api('query', 'areas', { workspaceId });
  else if (action === 'list') result = await api('query', 'items', { workspaceId });
  else if (action === 'search' && rest.length === 1) result = await api('query', 'search', { workspaceId, searchTerm: rest[0] });
  else if (action === 'capture' && rest.length === 1) result = (await api('mutation', 'items.quickCapture', { workspaceId, title: rest[0] })).result;
  else if (['done', 'archive', 'restore'].includes(action) && rest.length === 1) {
    const item = await api('query', 'item', { itemId: rest[0] });
    if (!item || item.workspaceId !== workspaceId) throw new Error('Item not found in this workspace');
    result = (await api('mutation', action === 'done' ? 'items.setTaskDone' : 'items.setArchived', action === 'done' ? { itemId: rest[0], done: true } : { itemId: rest[0], archived: action === 'archive' })).result;
  } else throw new Error(`Invalid command. ${help}`);
  console.log(json ? JSON.stringify(result) : Array.isArray(result) ? result.map(item => `${item.id ?? item._id}\t${item.title ?? item.name}`).join('\n') || 'No results.' : typeof result === 'string' ? result : JSON.stringify(result));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
