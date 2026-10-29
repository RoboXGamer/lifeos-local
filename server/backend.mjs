import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openStorage } from './storage.mjs';
import { installStorageAdapter } from '../src/local/db.ts';
import { api, ensureProfile } from '../src/local/api.ts';
import { data } from '../src/local/store.ts';
import migration1 from '../src-tauri/migrations/0001_init.sql?raw';
import migration2 from '../src-tauri/migrations/0002_lifeos.sql?raw';
import { randomUUID } from 'node:crypto';

let initialized;
const epoch = randomUUID();
let revision = 0;
const subscribers = new Set();
const operations = {
  'items.quickCapture': api.items.quickCapture, 'items.create': api.items.create,
  'items.update': api.items.update, 'items.setTaskDone': api.items.setTaskDone,
  'items.setArchived': api.items.setArchived, 'items.remove': api.items.remove,
  'areas.create': api.areas.create, 'areas.update': api.areas.update,
  'areas.setArchived': api.areas.setArchived, 'areas.remove': api.areas.remove,
  'tags.rename': api.tags.rename, 'tags.remove': api.tags.remove,
  'workspaces.create': api.workspaces.create, 'workspaces.rename': api.workspaces.rename,
  'workspaces.select': api.workspaces.select, 'workspaces.setArchived': api.workspaces.setArchived,
  'workspaces.remove': api.workspaces.remove,
};

export async function initialize() {
  initialized ??= (async () => {
    const directory = process.env.LIFEOS_DATA_DIR ?? join(process.env.APPDATA ?? '', 'dev.a5in.lifeos');
    if (!directory || (!process.env.LIFEOS_DATA_DIR && !process.env.APPDATA)) throw new Error('Cannot locate LifeOS data directory');
    mkdirSync(directory, { recursive: true });
    const storage = openStorage(join(directory, 'lifeos.db'), [[1, 'create_todos', migration1], [2, 'lifeos_domain', migration2]]);
    installStorageAdapter(storage);
    await ensureProfile();
  })();
  return initialized;
}

export async function snapshot() {
  await initialize();
  return JSON.parse(JSON.stringify(data));
}

export async function query(name, args) {
  await initialize();
  const queries = {
    'workspaces': () => api.workspaces.list(),
    'areas': () => api.areas.list(args),
    'items': () => api.items.list(args),
    'search': () => api.items.search(args),
    'item': () => api.items.get(args),
  };
  if (!Object.hasOwn(queries, name)) throw new Error('Unknown query');
  return JSON.parse(JSON.stringify(queries[name]() ?? null));
}

export async function mutate(name, args) {
  await initialize();
  if (!Object.hasOwn(operations, name)) throw new Error('Unknown operation');
  const result = await operations[name](args);
  const update = { epoch, revision: ++revision, state: await snapshot() };
  for (const listener of subscribers) listener(update);
  return { result, ...update };
}

export async function* watch(signal) {
  await initialize();
  let pending;
  let wake;
  const notify = value => { pending = value; wake?.(); };
  const abort = () => wake?.();
  subscribers.add(notify);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const initial = { epoch, revision, state: await snapshot() };
    if (!pending || pending.revision < initial.revision) pending = initial;
    while (!signal?.aborted) {
      if (!pending) await new Promise(resolve => { wake = resolve; });
      wake = undefined;
      if (signal?.aborted) break;
      if (pending) { const value = pending; pending = undefined; yield value; }
    }
  } finally {
    subscribers.delete(notify);
    signal?.removeEventListener('abort', abort);
  }
}
