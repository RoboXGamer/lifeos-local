"""Runs the Tauri SQL migration against an in-memory SQLite DB to validate syntax."""

import sqlite3
from pathlib import Path

sql = Path("src-tauri/migrations/0001_init.sql").read_text(encoding="utf-8")

conn = sqlite3.connect(":memory:")
conn.executescript(sql)

conn.execute("INSERT INTO todos (title) VALUES (?)", ("first task",))
conn.execute("UPDATE todos SET done = 1 WHERE id = 1")
rows = conn.execute("SELECT id, title, done, created_at FROM todos").fetchall()
print("migration OK:", rows)

cols = [r[1] for r in conn.execute("PRAGMA table_info(todos)")]
print("columns:", cols)

conn.execute("DELETE FROM todos WHERE id = 1")
print("remaining:", conn.execute("SELECT COUNT(*) FROM todos").fetchone()[0])
