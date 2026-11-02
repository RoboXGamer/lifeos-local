"""Run the shared 12-case capture prompt against NVIDIA's hosted API."""
import json
import sys
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from benchmark_lfm3_capture import HOLDOUT_CASES, validate_case


def main():
    key = Path(sys.argv[1]).read_text(encoding="utf-8").strip()
    prompt = Path("docs/LIFEOS-MODEL-TEST-PROMPT.md").read_text(encoding="utf-8").split("---", 1)[1].strip()
    model = sys.argv[2] if len(sys.argv) > 2 else "nvidia/nemotron-3.5-bolt-e4b"
    payload = {"model": model, "messages": [{"role": "user", "content": prompt}],
               "temperature": 1, "top_p": 0.95, "max_tokens": 4096, "seed": 42, "stream": False,
               "chat_template_kwargs": {"enable_thinking": False}}
    if model == "meta/muse-glimmer-30b":
        payload["chat_template_kwargs"] = {"reasoning_strength": "low"}
        payload["max_tokens"] = 8192
    if model == "openai/gpt-oss-20b":
        payload.pop("chat_template_kwargs")
        payload["reasoning_effort"] = "low"
        payload["top_p"] = 1
    budget = int(sys.argv[3]) if len(sys.argv) > 3 else None
    if budget is not None:
        payload["chat_template_kwargs"] = {"enable_thinking": True}
        payload["reasoning_budget"] = budget
        payload["max_tokens"] = 8192
    req = Request("https://integrate.api.nvidia.com/v1/chat/completions", data=json.dumps(payload, ensure_ascii=False).encode(),
                  headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"}, method="POST")
    start = time.perf_counter()
    try:
        with urlopen(req, timeout=180) as response:
            data = json.load(response)
    except HTTPError as exc:
        print("HTTP", exc.code, exc.read().decode("utf-8", "replace"))
        return 1
    elapsed = time.perf_counter() - start
    choice = data["choices"][0]
    content = choice["message"].get("content") or ""
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        parsed = None
    rows = parsed.get("results", []) if isinstance(parsed, dict) else []
    checks = []
    for case in HOLDOUT_CASES:
        matches = [row for row in rows if isinstance(row, dict) and row.get("id") == case["id"]]
        result = validate_case(case, matches[0]) if len(matches) == 1 else {"unique_result": False}
        checks.append({"id": case["id"], "checks": result, "passed": all(result.values())})
    report = {"model": payload["model"], "reasoning_requested": payload.get("reasoning_effort", payload.get("chat_template_kwargs")), "reasoning_budget": budget, "duration_seconds": elapsed,
              "usage": data.get("usage"), "finish_reason": choice.get("finish_reason"),
              "checks": checks, "response": data}
    path = Path("docs/benchmarks") / (model.replace("/", "-") + ("-reasoning-low.json" if model == "meta/muse-glimmer-30b" else "-thinking-off.json"))
    if budget is not None:
        path = Path("docs/benchmarks") / (model.replace("/", "-") + f"-thinking-budget-{budget}.json")
    if model == "openai/gpt-oss-20b":
        path = Path("docs/benchmarks/openai-gpt-oss-20b-reasoning-low.json")
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"seconds": elapsed, "usage": data.get("usage"), "finish_reason": choice.get("finish_reason"),
                      "passed": sum(c["passed"] for c in checks), "checks": checks, "output": str(path)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
