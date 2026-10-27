"""Inspects a LifeOS dev database: applied migrations and row counts.

Usage:
  uv run --no-project scripts/inspect_db.py            # current app identifier
  uv run --no-project scripts/inspect_db.py path/to.db
"""

import os
import sqlite3
import sys
from pathlib import Path

if len(sys.argv) > 1:
    path = Path(sys.argv[1])
else:
    path = Path(os.environ["APPDATA"]) / "dev.a5in.lifeos" / "lifeos.db"

print("db:", path, "exists:", path.exists())
if not path.exists():
    sys.exit(0)

conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)

applied = conn.execute(
    "SELECT version, description, success FROM _sqlx_migrations ORDER BY version"
).fetchall()
print("applied migrations:", applied)

tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
print("tables:", tables)

if "todos" in tables:
    print("todo rows:", conn.execute("SELECT COUNT(*) FROM todos").fetchone()[0])
    print("sample:", conn.execute("SELECT id, title, done FROM todos LIMIT 10").fetchall())
