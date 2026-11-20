import { execFileSync, execSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';

execSync('pnpm build', { stdio: 'inherit' });
const output = 'dist/desktop-service';
mkdirSync(output, { recursive: true });
const suffix = process.platform === 'win32' ? '.exe' : '';
execFileSync('bun', ['build', '--compile', 'server/launcher.mjs', '--outfile', `${output}/lifeos${suffix}`], { stdio: 'inherit' });
cpSync('dist/client', `${output}/lifeos-client`, { recursive: true });
