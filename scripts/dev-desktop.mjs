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
const build = spawnSync(process.execPath, ['scripts/build-service.mjs'], { cwd: root, env, stdio: 'inherit' });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
const shellBuild = spawnSync('hutch electrobun build --env=dev', { cwd: root, env, stdio: 'inherit', shell: true });
if (shellBuild.error) throw shellBuild.error;
if (shellBuild.status !== 0) process.exit(shellBuild.status ?? 1);

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
process.env.LIFEOS_DEV_SERVICE_URL = `http://127.0.0.1:${port}`;
const { createServer } = await import('vite');
const vite = await createServer({ root });
try {
  await vite.listen();
  vite.printUrls();
  const bin = join(root, 'build', `dev-win-${process.arch}`, 'LifeOS-dev', 'bin');
  const desktop = spawn(join(bin, 'launcher.exe'), [], {
    cwd: bin,
    env: { ...env, LIFEOS_ELECTROBUN_DEV: '1' },
    stdio: 'inherit',
  });
  await new Promise((resolveExit, reject) => {
    desktop.on('error', reject);
    desktop.on('exit', code => code === 0 ? resolveExit() : reject(new Error(`LifeOS exited with code ${code}.`)));
  });
} finally {
  await vite.close();
}
