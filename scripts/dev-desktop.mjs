import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const configRoot = process.platform === 'win32'
  ? process.env.APPDATA
  : process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support')
    : process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
const dataDir = resolve(process.env.LIFEOS_DEV_DATA_DIR || join(configRoot, 'dev.a5in.lifeos'));
const entry = join(root, 'server', 'launcher.mjs');
const env = { ...process.env, LIFEOS_DATA_DIR: dataDir, LIFEOS_DEV_ENTRY: entry, LIFEOS_CLIENT_DIR: join(root, 'dist', 'client') };

// Do not stop a service that may also be serving the installed application.
let existingService = false;
try {
  const info = JSON.parse(await readFile(join(dataDir, 'service.json'), 'utf8'));
  const response = await fetch(`http://127.0.0.1:${info.port}/api`, {
    method: 'POST',
    headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'query', name: 'workspaces', args: {} }),
    signal: AbortSignal.timeout(1000),
  });
  existingService = response.ok;
} catch {}

console.log('Building the local service for desktop development...');
const build = spawnSync('pnpm', ['build'], { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const connection = spawnSync(process.execPath, [entry, 'connection'], { cwd: root, env, encoding: 'utf8' });
if (connection.error) throw connection.error;
if (connection.status !== 0) {
  process.stderr.write(connection.stderr || 'Could not start the LifeOS local service.\n');
  process.exit(connection.status ?? 1);
}
const { port } = JSON.parse(connection.stdout);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid LifeOS service port.');
if (existingService) {
  console.warn('Using the existing LifeOS service. Backend changes require stopping that service and restarting dev:desktop.');
}
console.log('Starting the desktop with Vite live reload...');
const child = spawn('pnpm', ['tauri', 'dev'], {
  cwd: root,
  env: { ...env, LIFEOS_DEV_DATA_DIR: dataDir, LIFEOS_DEV_SERVICE_URL: `http://127.0.0.1:${port}` },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
