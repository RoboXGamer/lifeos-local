"""Score saved Muse output after removing its Markdown code fence."""
import json
from pathlib import Path
from benchmark_lfm3_capture import HOLDOUT_CASES, validate_case

path = Path("docs/benchmarks/meta-muse-glimmer-30b-reasoning-low.json")
report = json.loads(path.read_text(encoding="utf-8"))
content = report["response"]["choices"][0]["message"]["content"].strip()
report["strict_json_valid"] = False
try:
    parsed = json.loads(content)
    report["strict_json_valid"] = True
except json.JSONDecodeError:
    parsed = json.loads(content.split("\n", 1)[1].rsplit("```", 1)[0])
report["checks_after_removing_code_fence"] = []
for case in HOLDOUT_CASES:
    matches = [r for r in parsed.get("results", []) if r.get("id") == case["id"]]
    checks = validate_case(case, matches[0]) if len(matches) == 1 else {"unique_result": False}
    report["checks_after_removing_code_fence"].append({"id": case["id"], "checks": checks, "passed": all(checks.values())})
path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Strict JSON:", report["strict_json_valid"])
print("After removing code fence:", sum(r["passed"] for r in report["checks_after_removing_code_fence"]), "/", len(HOLDOUT_CASES))
