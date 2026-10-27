"""Resets the local LifeOS dev database.

Run this after changing an already-applied migration in dev. Never edit a
migration that shipped: add a new one instead.

Usage: uv run --no-project scripts/reset-db.py
"""

import os
import sys
import time
from pathlib import Path

app_dir = Path(os.environ["APPDATA"]) / "dev.a5in.lifeos"
targets = [app_dir / name for name in ("lifeos.db", "lifeos.db-wal", "lifeos.db-shm")]

found = [p for p in targets if p.exists()]
if not found:
    print("nothing to reset:", app_dir)
    sys.exit(0)

stamp = time.strftime("%Y%m%d-%H%M%S")
for path in found:
    if path.suffix == ".db":
        backup = path.with_name(f"{path.name}.bak-{stamp}")
        try:
            path.replace(backup)
            print(f"moved  {path.name} -> {backup.name}")
        except PermissionError:
            print(f"locked {path.name}: stop `pnpm tauri dev` and run again")
            sys.exit(1)
    else:
        path.unlink(missing_ok=True)
        print(f"deleted {path.name}")

print("done: next app start recreates the schema from migrations")
