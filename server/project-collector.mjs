import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath, stat, readdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute, basename } from 'node:path';

const execute = promisify(execFile);
const MAX_FILE_BYTES = 65536;
const blocked = /(?:^|[\\/])(?:\.env(?:\..*)?|\.git|node_modules|target|dist|build|coverage|secrets?|credentials?)(?:[\\/]|$)|(?:\.pem|\.key|\.p12|\.pfx)$/i;
const redact = text => text.replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{15,}|github_pat_[A-Za-z0-9_]{15,})\b/g, '[REDACTED]')
  .replace(/((?:api[_-]?key|access[_-]?token|password|secret|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
  .replace(/Bearer\s+[A-Za-z0-9._~+\/-]{10,}/gi, 'Bearer [REDACTED]');

function allowed(path, exclusions) {
  return !blocked.test(path) && !exclusions.some(pattern => path.toLowerCase().includes(pattern.toLowerCase()));
}
async function git(root, args) {
  const { stdout } = await execute('git', ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=', '-c', 'log.showSignature=false', '-C', root, ...args], { windowsHide: true, timeout: 4000, maxBuffer: 512000, encoding: 'utf8' });
  return redact(stdout.trim()).slice(0, 30000);
}
async function safeRead(root, path) {
  const full = await realpath(resolve(root, path));
  const child = relative(root, full);
  if (child.startsWith('..') || isAbsolute(child)) throw new Error('File points outside the selected repository.');
  const info = await stat(full);
  if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('File exceeds the 64 KB capture limit or is not a regular file.');
  return redact(await readFile(full, 'utf8')).slice(0, 30000);
}

/** Read-only, bounded snapshot of explicitly configured repository roots.
 * No repository scripts, builds, tests, git hooks, shell strings, or remote fetches.
 */
export async function collectProject(settings) {
  const sources = [];
  for (const selectedRoot of settings.repositories.slice(0, 8)) {
    let root;
    try { root = await realpath(selectedRoot); if (!(await stat(root)).isDirectory()) throw new Error('Not a directory.'); }
    catch { sources.push({ kind: 'git', locator: selectedRoot, label: `${basename(selectedRoot)} unavailable`, content: 'The selected repository directory is missing or inaccessible.', metadata: { repository: selectedRoot, category: 'repository' }, missing: 1 }); continue; }
    const repoName = basename(root);
    const gitResults = await Promise.allSettled([
      git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
      git(root, ['rev-parse', '--verify', 'HEAD']),
      git(root, ['status', '--short', '--untracked-files=no', '--']),
      git(root, ['log', '-8', '--format=%h %cI %s', '--']),
      git(root, ['ls-files', '--cached', '--']),
      git(root, ['diff', '--no-ext-diff', '--no-textconv', '--stat', '--']),
    ]);
    const value = index => gitResults[index].status === 'fulfilled' ? gitResults[index].value : '';
    const branch = value(0); const head = value(1);
    sources.push({ kind: 'git', locator: `${root}#git`, label: `${repoName}: Git checkpoint`, content: branch || head ? `Branch: ${branch}\nHEAD: ${head}\n\nTracked working-tree changes:\n${value(2) || 'No tracked changes reported.'}\n\nUnstaged diff summary:\n${value(5) || 'No unstaged changes reported.'}\n\nRecent commits:\n${value(3) || 'No commit history available.'}` : 'Git metadata unavailable. This may be a non-Git folder, an empty repository, or an inaccessible checkout.', metadata: { repository: root, category: 'git', branch, head, dirty: Boolean(value(2)), gitAvailable: Boolean(branch || head), verification: 'static snapshot; project scripts were not executed' }, missing: branch || head ? 0 : 1 });
    let files = value(4).split(/\r?\n/).filter(Boolean).filter(p => allowed(p, settings.exclusions)).slice(0, 2000);
    if (!files.length) {
      try { files = (await readdir(root, { withFileTypes: true })).filter(f => f.isFile() && allowed(f.name, settings.exclusions)).map(f => f.name).slice(0, 100); } catch {}
    }
    const codeFiles = files.filter(p => /^(?:src|app|lib|server|tests?|scripts)[\\/]/i.test(p) || /(?:test|spec)\.[^.]+$/i.test(p));
    const testFiles = codeFiles.filter(p => /(?:^|[\\/_.-])(?:tests?|spec)(?:[\\/_.-]|$)/i.test(p));
    sources.push({ kind: 'file', locator: `${root}#inventory`, label: `${repoName}: source and test inventory`, content: `Captured file inventory (up to 2,000 tracked names, filtered; source content is not read wholesale):\n\n${files.slice(0, 200).join('\n')}\n\nTest candidates:\n${testFiles.slice(0, 50).join('\n') || 'No test filenames identified.'}`, metadata: { repository: root, category: 'inventory', fileCount: files.length, testCount: testFiles.length, truncated: files.length >= 2000 || files.length > 200 }, missing: 0 });
    const candidates = files.filter(p => /(?:^|[\\/])(?:readme(?:\.[^.]+)?|package\.json|cargo\.toml|pyproject\.toml|go\.mod|requirements\.txt|bun\.lockb?|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|todo(?:\.[^.]+)?)$/i.test(p)).sort((a,b) => a.split(/[\\/]/).length - b.split(/[\\/]/).length).slice(0,20);
    // Always check root README/manifests so disappearance of a prior source is explicit.
    const expected = [...new Set([...candidates, 'README.md', 'package.json'])].filter(p => allowed(p, settings.exclusions));
    for (const path of expected) {
      const locator = resolve(root, path); const category = /readme/i.test(basename(path)) ? 'readme' : /lock/i.test(basename(path)) ? 'lockfile' : 'manifest';
      try {
        const content = await safeRead(root, path);
        const metadata = { repository: root, category, path };
        if (basename(path).toLowerCase() === 'package.json') {
          try { const pkg = JSON.parse(content); metadata.scripts = Object.keys(pkg.scripts ?? {}); metadata.dependencies = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).slice(0, 100); } catch {}
        }
        sources.push({ kind: 'file', locator, label: `${repoName}: ${path}`, content, metadata, missing: 0 });
      } catch {
        if (candidates.includes(path)) sources.push({ kind: 'file', locator, label: `${repoName}: ${path}`, content: 'Source is missing, excluded by a size/symlink limit, or inaccessible.', metadata: { repository: root, category, path }, missing: 1 });
      }
    }
    const todos = [];
    for (const path of codeFiles.filter(p => /\.(?:tsx?|jsx?|rs|py|go|md)$/i.test(p)).slice(0, 20)) {
      try { const lines = (await safeRead(root, path)).split(/\r?\n/); lines.forEach((line,index) => { if (/\b(?:TODO|FIXME|HACK)\b/.test(line) && todos.length < 30) todos.push(`${path}:${index+1}: ${line.trim().slice(0,300)}`); }); } catch {}
    }
    if (todos.length) sources.push({ kind:'file',locator:`${root}#todos`,label:`${repoName}: TODO excerpts`,content:todos.join('\n'),metadata:{repository:root,category:'todos',sampledFiles:Math.min(codeFiles.length,20)},missing:0 });
  }
  return sources;
}
