/** The local service supplies the only SQLite implementation. */
export interface StorageAdapter {
  select<Row>(sql: string, params: unknown[]): Promise<Row[]>;
  run(sql: string, params: unknown[]): Promise<void>;
  transaction<T>(work: () => Promise<T>, refresh: () => Promise<void>): Promise<T>;
}

let storageAdapter: StorageAdapter | undefined;

export function installStorageAdapter(adapter: StorageAdapter): void {
  if (storageAdapter) throw new Error("Storage adapter is already installed");
  storageAdapter = adapter;
}

export function hasStorageAdapter(): boolean {
  return storageAdapter !== undefined;
}

function storage(): StorageAdapter {
  if (!storageAdapter) throw new Error("The local service storage is not initialized");
  return storageAdapter;
}

export function select<Row>(sql: string, params: unknown[] = []): Promise<Row[]> {
  return storage().select<Row>(sql, params);
}

export function run(sql: string, params: unknown[] = []): Promise<void> {
  return storage().run(sql, params);
}

export function transaction<T>(work: () => Promise<T>, refresh: () => Promise<void>): Promise<T> {
  return storage().transaction(work, refresh);
}
