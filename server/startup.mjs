import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const filename = 'LifeOS Local Service.vbs';
const marker = "' LifeOS managed startup (v1)";

function configuration(options = {}) {
  if ((options.platform ?? process.platform) !== 'win32') return { available: false, reason: 'Automatic startup is available for the Windows desktop build.' };
  const executable = resolve(options.executable ?? process.execPath);
  if (!/^lifeos(?:-[a-z0-9_-]+)?\.exe$/i.test(basename(executable)) || !existsSync(executable)) return { available: false, reason: 'Install or run the compiled LifeOS desktop build to enable startup.' };
  if (/["\r\n%]/.test(executable)) return { available: false, reason: 'This installation path cannot be registered for automatic startup.' };
  const appData = options.appData ?? process.env.APPDATA;
  if (!options.startupDirectory && !appData) return { available: false, reason: 'The Windows user startup folder could not be located.' };
  const directory = resolve(options.startupDirectory ?? join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'));
  const path = join(directory, filename);
  const command = `"${executable}" serve`;
  const contents = `${marker}\r\nOption Explicit\r\nDim shell\r\nSet shell = CreateObject("WScript.Shell")\r\nshell.Run "${command.replaceAll('"', '""')}", 0, False\r\n`;
  return { available: true, executable, directory, path, contents };
}

function readEntry(config) {
  if (!existsSync(config.path)) return { owned: true, contents: null };
  const info = lstatSync(config.path);
  if (!info.isFile() || info.isSymbolicLink()) return { owned: false, contents: null };
  const bytes = readFileSync(config.path);
  const contents = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8');
  return { owned: contents.startsWith(marker + '\r\n') || contents.startsWith(marker + '\n'), contents };
}

/** Options are an internal test seam; never forward client-supplied filesystem paths. */
export function startupStatus(options = {}) {
  const config = configuration(options);
  if (!config.available) return { available: false, enabled: false, reason: config.reason };
  try {
    const entry = readEntry(config);
    if (!entry.owned) return { available: false, enabled: false, reason: 'A different startup entry uses the LifeOS filename. It was left unchanged.' };
    return { available: true, enabled: entry.contents === config.contents, ...(entry.contents !== null && entry.contents !== config.contents ? { reason: 'Startup points to another LifeOS build. Enable it to use this installation.' } : {}) };
  } catch {
    return { available: false, enabled: false, reason: 'The Windows user startup folder could not be read.' };
  }
}

/** Change only LifeOS's own per-user entry. No admin rights or registry changes. */
export function configureStartup(enabled, options = {}) {
  if (typeof enabled !== 'boolean') throw new Error('Choose whether startup should be enabled.');
  const config = configuration(options);
  if (!config.available) throw new Error(config.reason);
  const entry = readEntry(config);
  if (!entry.owned) throw new Error('A different startup entry uses the LifeOS filename. It was left unchanged.');
  if (enabled) {
    mkdirSync(config.directory, { recursive: true });
    const temporary = join(config.directory, `.${filename}.${randomUUID()}.tmp`);
    try {
      // Windows Script Host reliably handles Unicode paths in UTF-16LE scripts.
      writeFileSync(temporary, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(config.contents, 'utf16le')]), { flag: 'wx' });
      renameSync(temporary, config.path);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  } else if (entry.contents !== null) {
    unlinkSync(config.path);
  }
  return startupStatus(options);
}
