"""Score a saved single-prompt response against the existing selected checks."""
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
from benchmark_lfm3_capture import HOLDOUT_CASES, validate_case

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
results = data["response"]["results"]
by_id = {row["id"]: row for row in results}
passed = 0
for case in HOLDOUT_CASES:
    checks = validate_case(case, by_id.get(case["id"]))
    ok = all(checks.values())
    passed += ok
    print(case["id"], "PASS" if ok else "FAIL", ",".join(k for k, v in checks.items() if not v))
print(f"selected_checks={passed}/{len(HOLDOUT_CASES)}")
