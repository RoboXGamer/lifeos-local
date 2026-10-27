import Database from "@tauri-apps/plugin-sql";

let connection: Promise<Database> | null = null;

/** One connection per session; the plugin opens the SQLite file lazily. */
export function db(): Promise<Database> {
  connection ??= Database.load("sqlite:lifeos.db");
  return connection;
}

export async function select<Row>(
  sql: string,
  params: unknown[] = [],
): Promise<Row[]> {
  return (await db()).select<Row[]>(sql, params);
}

export async function run(sql: string, params: unknown[] = []): Promise<void> {
  await (await db()).execute(sql, params);
}
