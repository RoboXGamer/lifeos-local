import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

// These are the exact SQLx migration files already used by Tauri. Existing
// checksums are verified before any change is made to the database.
export function openStorage(path, migrations) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout=10000');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS _sqlx_migrations (
      version BIGINT PRIMARY KEY, description TEXT NOT NULL,
      installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL
    )`);
    const applied = db.prepare('SELECT version, success, checksum FROM _sqlx_migrations').all();
    for (const row of applied) {
      const migration = migrations.find(entry => entry[0] === row.version);
      if (!row.success || !migration) throw new Error(`Unsupported or failed migration ${row.version}`);
      const bytes = Buffer.from(migration[2], 'utf8');
      if (!Buffer.from(row.checksum).equals(createHash('sha384').update(bytes).digest())) throw new Error(`Migration ${row.version} checksum mismatch`);
    }
    for (const [version, description, sql] of migrations) {
      if (applied.some(row => row.version === version)) continue;
      const bytes = Buffer.from(sql, 'utf8');
      db.exec(bytes.toString('utf8'));
      db.prepare('INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (?, ?, 1, ?, -1)').run(version, description, createHash('sha384').update(bytes).digest());
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  let queue = Promise.resolve();
  return {
    db,
    async select(sql, params) { return db.prepare(sql).all(...params); },
    async run(sql, params) { db.prepare(sql).run(...params); },
    transaction(work, refresh) {
      const task = queue.then(async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          await refresh();
          const result = await work();
          db.exec('COMMIT');
          try { await refresh(); } catch (error) { console.error('Committed; refresh failed:', error); }
          return result;
        } catch (error) {
          if (db.isTransaction) db.exec('ROLLBACK');
          throw error;
        }
      });
      queue = task.catch(() => {});
      return task;
    },
  };
}
