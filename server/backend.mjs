import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openStorage } from './storage.mjs';
import { installStorageAdapter } from '../src/local/db.ts';
import { api, ensureProfile, runProductivityTasks } from '../src/local/api.ts';
import { setProjectCollector } from '../src/local/projects.ts';
import { collectProject } from './project-collector.mjs';
import { setObligationPdfExtractor } from '../src/local/obligations.ts';
import { extractObligationPdf } from './obligation-pdf.mjs';
import { data } from '../src/local/store.ts';
import migration1 from '../src-tauri/migrations/0001_init.sql?raw';
import migration2 from '../src-tauri/migrations/0002_lifeos.sql?raw';
import migration3 from '../src-tauri/migrations/0003_templates.sql?raw';
import migration4 from '../src-tauri/migrations/0004_recurrence.sql?raw';
import migration5 from '../src-tauri/migrations/0005_automations.sql?raw';
import migration6 from '../src-tauri/migrations/0006_projects.sql?raw';
import migration7 from '../src-tauri/migrations/0007_obligations.sql?raw';
import migration8 from '../src-tauri/migrations/0008_attention.sql?raw';
import { randomUUID } from 'node:crypto';

let initialized;
const epoch = randomUUID();
let revision = 0;
const subscribers = new Set();
const operations = {
  'attention.feedback': api.attention.feedback, 'attention.estimate': api.attention.estimate,
  ...Object.fromEntries(['save', 'setEnabled', 'remove', 'retry', 'checkpoint'].map(key => [`automations.${key}`, api.automations[key]])),
  ...Object.fromEntries(['create', 'update', 'checkpoint', 'addSource', 'scan', 'acceptPlan', 'removeSource', 'remove'].map(key => [`projects.${key}`, api.projects[key]])),
  ...Object.fromEntries(['create', 'addDocument', 'extract', 'review', 'addInvoice', 'recordPayment', 'allocate', 'createFollowup'].map(key => [`obligations.${key}`, api.obligations[key]])),
  'recurrence.save': api.recurrence.save, 'recurrence.control': api.recurrence.control,
  'templates.save': api.templates.save, 'templates.saveFamily': api.templates.saveFamily,
  'templates.apply': api.templates.apply, 'templates.remove': api.templates.remove,
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
    const storage = openStorage(join(directory, 'lifeos.db'), [[1, 'create_todos', migration1], [2, 'lifeos_domain', migration2], [3, 'templates', migration3], [4, 'recurrence', migration4], [5, 'automations', migration5], [6, 'projects', migration6], [7, 'obligations', migration7], [8, 'attention', migration8]]);
    installStorageAdapter(storage);
    setProjectCollector(collectProject);
    setObligationPdfExtractor(extractObligationPdf);
    await ensureProfile();
    // A service timer, not a window timer: resumes missed work after sleep/restart.
    if (process.env.LIFEOS_DISABLE_SCHEDULER !== '1') {
      const interval = Math.max(1000, Math.min(300000, Number(process.env.LIFEOS_SCHEDULER_INTERVAL_MS) || 30000));
      const timer = setInterval(() => void runScheduler().catch(error => console.error('Scheduler:', error.message)), interval);
      timer.unref();
      setTimeout(() => void runScheduler().catch(error => console.error('Scheduler:', error.message)), 0).unref();
    }
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
    'templates': () => api.templates.list(args),
    'templates.preview': () => api.templates.preview(args),
    'recurrence': () => api.recurrence.list(args),
    'recurrence.history': () => api.recurrence.history(args),
    'automations': () => api.automations.list(args), 'automations.runs': () => api.automations.runs(args),
    'automations.recipes': () => api.automations.recipes(args), 'automations.preview': () => api.automations.preview(args),
    'projects': () => api.projects.list(args), 'projects.sources': () => api.projects.sources(args),
    'projects.checkpoints': () => api.projects.checkpoints(args), 'projects.resume': () => api.projects.resume(args), 'projects.report': () => api.projects.report(args),
    'obligations': () => api.obligations.list(args), 'obligations.details': () => api.obligations.details(args),
    'attention': () => api.attention.build(args),
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

let schedulerRunning = false;
async function runScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const changes = await runProductivityTasks();
    if (!changes) return;
    const update = { epoch, revision: ++revision, state: await snapshot() };
    for (const listener of subscribers) listener(update);
  } finally { schedulerRunning = false; }
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
