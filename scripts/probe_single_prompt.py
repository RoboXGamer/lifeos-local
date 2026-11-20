"""Run the portable 12-case prompt as one local Ollama request.

Run with uv: uv run --no-project scripts/probe_single_prompt.py --output result.json
"""
import argparse
import json
import time
from pathlib import Path
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="qwen3.5:4b-q4_K_M")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    prompt = Path("docs/LIFEOS-MODEL-TEST-PROMPT.md").read_text(encoding="utf-8").split("\n---\n", 1)[1]
    payload = {"model": args.model, "messages": [{"role": "user", "content": prompt}],
               "stream": False, "think": False, "format": "json",
               "options": {"temperature": 0, "num_ctx": 8192, "num_predict": 4096}}
    req = Request("http://127.0.0.1:11434/api/chat", json.dumps(payload).encode(),
                  {"Content-Type": "application/json"}, method="POST")
    start = time.perf_counter()
    with urlopen(req, timeout=180) as response:
        data = json.load(response)
    seconds = time.perf_counter() - start
    if not data.get("done") or data.get("done_reason") == "length":
        raise RuntimeError(f"Incomplete output: {data.get('done_reason')}")
    result = json.loads(data["message"]["content"])
    print(f"wall_seconds={seconds:.3f}; results={len(result.get('results', []))}; output_tokens={data.get('eval_count')}")
    if args.output:
        args.output.write_text(json.dumps({"model": args.model, "wall_seconds": seconds, "response": result}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"saved={args.output}")


if __name__ == "__main__":
    main()
