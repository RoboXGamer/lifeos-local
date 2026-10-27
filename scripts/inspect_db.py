"""Inspects the LifeOS dev database: applied migrations and row counts."""

import os
import sqlite3
from pathlib import Path

path = Path(os.environ["APPDATA"]) / "dev.a5in.tauri-solid-draft1" / "lifeos.db"
print("db:", path, "exists:", path.exists(), "size:", path.stat().st_size)

conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)

applied = conn.execute(
    "SELECT version, description, checksum, success FROM _sqlx_migrations ORDER BY version"
).fetchall()
print("applied migrations:", applied)

tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
print("tables:", tables)

if "todos" in tables:
    print("todo rows:", conn.execute("SELECT COUNT(*) FROM todos").fetchone()[0])
    print("sample:", conn.execute("SELECT id, title, done FROM todos LIMIT 5").fetchall())
