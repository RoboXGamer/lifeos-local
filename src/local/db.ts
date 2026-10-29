import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { nanoid } from "nanoid";

let connection: Promise<Database> | null = null;
let transactionId: string | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function refreshSnapshot(refresh: () => Promise<void>): Promise<void> {
  const id = nanoid();
  await invoke("begin", { id });
  transactionId = id;
  try {
    await refresh();
    await invoke("finish", { id, commit: true });
  } catch (error) {
    await invoke("finish", { id, commit: false }).catch(() => {});
    throw error;
  } finally {
    transactionId = null;
  }
}

/** One connection per session; the plugin opens the SQLite file lazily. */
export function db(): Promise<Database> {
  connection ??= Database.load("sqlite:lifeos.db");
  return connection;
}

export async function select<Row>(
  sql: string,
  params: unknown[] = [],
): Promise<Row[]> {
  if (transactionId) {
    return invoke<Row[]>("select", { id: transactionId, sql, params });
  }
  return (await db()).select<Row[]>(sql, params);
}

export async function run(sql: string, params: unknown[] = []): Promise<void> {
  if (transactionId) {
    return invoke("execute", { id: transactionId, sql, params });
  }
  await (await db()).execute(sql, params);
}

/** Serialize mutation callbacks and use one Rust-held connection per mutation. */
export function transaction<T>(work: () => Promise<T>, refresh: () => Promise<void>): Promise<T> {
  const task = queue.then(async () => {
    await db(); // Applies migrations before the Rust connection opens the file.
    const id = nanoid();
    await invoke("begin", { id });
    transactionId = id;
    let result: T;
    try {
      // Validations use a fresh snapshot while the SQLite write lock is held.
      await refresh();
      result = await work();
      await invoke("finish", { id, commit: true });
    } catch (error) {
      await invoke("finish", { id, commit: false }).catch(() => {});
      throw error;
    } finally {
      transactionId = null;
    }
    try {
      await refreshSnapshot(refresh);
    } catch (error) {
      // The commit succeeded. Do not report a failed write or retry it.
      console.error("Saved, but refreshing local data failed", error);
      setTimeout(() => void transaction(async () => {}, refresh).catch(console.error), 1000);
    }
    return result;
  });
  queue = task.catch(() => {});
  return task;
}
