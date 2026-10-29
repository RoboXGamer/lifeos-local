import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { createServerReference, live, configureServerFunctionsClient } from '@solidjs/web/server-functions/client';

const data = mkdtempSync(join(tmpdir(), 'lifeos-live-test-'));
const token = randomUUID();
const port = 18479;
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['dist/server/node.js'], { env: { ...process.env, LIFEOS_DATA_DIR: data, LIFEOS_TOKEN: token, HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
const request = (path, init = {}) => fetch(base + path, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } });
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { await fetch(base); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert(ready, 'Server did not start');
  assert.equal((await fetch(`${base}/api`, { method: 'POST' })).status, 401);
  const code = readFileSync('dist/server/server.js', 'utf8');
  const id = code.match(/registerServerReference\("(watchState-[^"]+)"/)?.[1];
  assert(id, 'Live server function was not registered');
  configureServerFunctionsClient({ endpoint: `${base}/_server`, fetch: (url, init) => fetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), authorization: `Bearer ${token}` } }) });
  const stream = live(createServerReference(id))();
  const iterator = stream[Symbol.asyncIterator]();
  const initial = (await iterator.next()).value;
  assert(initial.state.profile.activeWorkspaceId, 'Initial snapshot missing workspace');
  const workspaceId = initial.state.profile.activeWorkspaceId;
  const response = await request('/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'mutation', name: 'items.quickCapture', args: { workspaceId, title: 'Live test' } }) });
  assert.equal(response.status, 200, await response.clone().text());
  const next = (await Promise.race([iterator.next(), new Promise((_, reject) => setTimeout(() => reject(new Error('Live update timed out')), 10000))])).value;
  assert(next.state.items.some(item => item.title === 'Live test'));
  await iterator.return();
  console.log('Authenticated service, CLI-style mutation, and Solid live update passed');
} finally { child.kill(); }
