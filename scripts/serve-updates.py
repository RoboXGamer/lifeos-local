"""Serves a folder over HTTP so the updater can fetch test releases.

Usage:
  uv run --no-project scripts/serve-updates.py [folder] [port]
"""

import functools
import http.server
import sys
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else "src-tauri/target/release/bundle").resolve()
port = int(sys.argv[2]) if len(sys.argv) > 2 else 8000

if not root.is_dir():
    raise SystemExit(f"not a folder: {root}")

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
print(f"serving {root}")
print(f"  http://127.0.0.1:{port}/latest.json")
http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
