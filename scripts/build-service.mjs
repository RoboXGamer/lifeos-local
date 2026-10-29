import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

execFileSync('pnpm', ['build'], { stdio: 'inherit', shell: process.platform === 'win32' });
const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)?.[1].trim();
if (!host) throw new Error('Could not determine Rust host target');
mkdirSync('src-tauri/binaries', { recursive: true });
const suffix = process.platform === 'win32' ? '.exe' : '';
execFileSync('bun', ['build', '--compile', 'server/launcher.mjs', '--outfile', `src-tauri/binaries/lifeos-${host}${suffix}`], { stdio: 'inherit', shell: process.platform === 'win32' });
