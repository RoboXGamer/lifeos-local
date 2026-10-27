"""Applies the Tauri SQL migrations to an in-memory SQLite DB.

Catches syntax errors, constraint mistakes and column drift without booting the
app. Usage: uv run --no-project scripts/check_migration.py
"""

import sqlite3
from pathlib import Path


def main() -> None:
    conn = sqlite3.connect(":memory:")
    for path in sorted(Path("src-tauri/migrations").glob("*.sql")):
        conn.executescript(path.read_text(encoding="utf-8"))
        print("applied:", path.name)

    tables = [
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
    ]
    print("tables:", tables)

    now = 1_700_000_000_000
    conn.execute(
        """INSERT INTO profiles
           (_id, _creationTime, authUserId, isAnonymous, role, suspended, createdAt, updatedAt)
           VALUES ('p', ?, 'local', 0, 'user', 0, ?, ?)""",
        (now, now, now),
    )
    conn.execute(
        """INSERT INTO workspaces
           (_id, _creationTime, ownerId, name, archived, createdAt, updatedAt)
           VALUES ('w', ?, 'p', 'My Life', 0, ?, ?)""",
        (now, now, now),
    )
    conn.execute(
        """INSERT INTO areas
           (_id, _creationTime, workspaceId, name, icon, color, archived, createdAt, updatedAt)
           VALUES ('a', ?, 'w', 'Health', 'heart', '#13a06a', 0, ?, ?)""",
        (now, now, now),
    )
    conn.execute(
        """INSERT INTO items
           (_id, _creationTime, workspaceId, title, areaId, parentId, archived, createdAt, updatedAt)
           VALUES ('i', ?, 'w', 'Run 5k', 'a', NULL, 0, ?, ?)""",
        (now, now, now),
    )
    conn.execute(
        """INSERT INTO tags
           (_id, _creationTime, workspaceId, name, normalizedName, createdAt)
           VALUES ('t', ?, 'w', 'urgent', 'urgent', ?)""",
        (now, now),
    )
    conn.execute(
        """INSERT INTO itemTags
           (_id, _creationTime, workspaceId, itemId, tagId, createdAt)
           VALUES ('it', ?, 'w', 'i', 't', ?)""",
        (now, now),
    )
    conn.execute(
        "UPDATE items SET status = 'Done', updatedAt = ? WHERE _id = 'i'", (now + 1,)
    )

    item = conn.execute(
        "SELECT title, status, archived FROM items WHERE _id = 'i'"
    ).fetchone()
    links = conn.execute("SELECT COUNT(*) FROM itemTags").fetchone()[0]
    print("item:", item, "tag links:", links)
    print("migrations OK")


if __name__ == "__main__":
    main()
