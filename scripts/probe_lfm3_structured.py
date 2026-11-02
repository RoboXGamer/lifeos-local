"""Test one local LFM3 model doing direct structured LifeOS extraction.

Run: uv run --no-project scripts/probe_lfm3_structured.py
Optional: --model MODEL --think --few-shot --limit N --num-predict N --output PATH

Only synthetic inputs are sent to local Ollama; no LifeOS database is touched.
The JSON schema constrains response format, not factual correctness.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


NULLABLE_TEXT = {"type": ["string", "null"]}
SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "tasks": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "properties": {
                    "action": {"type": "string"},
                    "person": NULLABLE_TEXT,
                    "scheduled_date": NULLABLE_TEXT,
                },
                "required": ["action", "person", "scheduled_date"],
            },
        },
        "money": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "properties": {
                    "person": NULLABLE_TEXT,
                    "description": NULLABLE_TEXT,
                    "amount": {"type": ["number", "null"]},
                    "currency": {"type": ["string", "null"]},
                    "state": {"type": "string", "enum": ["quote", "agreed", "planned", "paid", "refund", "unknown"]},
                },
                "required": ["person", "description", "amount", "currency", "state"],
            },
        },
        "waiting": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "properties": {
                    "person": NULLABLE_TEXT,
                    "action": {"type": "string"},
                    "scheduled_date": NULLABLE_TEXT,
                },
                "required": ["person", "action", "scheduled_date"],
            },
        },
        "uncertainties": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["tasks", "money", "waiting", "uncertainties"],
}

SYSTEM = """Extract structured suggestions from a LifeOS capture in English, Hindi or Hinglish.
Today's date is 2026-11-02, Monday, in Asia/Kolkata. Interpret Friday as the coming Friday.
Tasks are actions the user intends to do; things another person promises belong under waiting, not user tasks.
Money: represent quotes, agreements and actual transfers as separate facts. A quote is not an agreement or payment.
Negation matters: never say paid if the text says not yet paid. Do not invent facts.
Convert lakh and hazaar into numeric amounts (1 lakh = 100000; 1 hazaar = 1000).
Currency must be INR only when the text explicitly indicates rupees, Rs or the rupee symbol; otherwise use null.
If the user has not specified an amount/date/person, use null. Ambiguous kal can mean yesterday or tomorrow: use null unless context resolves it.
Dates use YYYY-MM-DD. Return empty arrays if there are no facts of that kind.
Only use information from the input, and record important ambiguity in uncertainties.
"""

CASES = [
    ("quote_and_task", "Amit ne wedding sound ke liye ₹1 lakh ka quote diya. Friday ko use call karna hai."),
    ("agreed_and_paid", "Amit 90 hazaar mein maan gaya. Maine usko 30 hazaar advance de diya."),
    ("planned_not_paid", "Kal vendor ko ₹30,000 advance dena hai, abhi payment nahi ki."),
    ("two_parties", "Neha se event ka ₹5 lakh sale confirm hua, Amit ne sound ke liye ₹1 lakh quote diya."),
    ("quote_negated_payment", "Amit ka ₹1 lakh quote hai, rate final nahi hua aur kuch bhi pay nahi kiya."),
    ("refund", "Amit ne ₹5000 refund kar diya."),
    ("other_person_promised", "Amit ne mujhe promise kiya ki woh wedding proposal Friday ko bhejega."),
    ("neutral_idea", "Blue flowers wedding stage par achhe lagenge; abhi koi task ya deadline nahi hai."),
]

EXAMPLES = [
    (
        "Priya ne catering ke liye ₹25,000 ka quote diya. Kal payment nahi karni.",
        {"tasks": [], "money": [{"person": "Priya", "description": "catering", "amount": 25000, "currency": "INR", "state": "quote"}], "waiting": [], "uncertainties": []},
    ),
    (
        "Riya 40 hazaar ke design par agree hui. Maine abhi payment nahi ki.",
        {"tasks": [], "money": [{"person": "Riya", "description": "design", "amount": 40000, "currency": None, "state": "agreed"}], "waiting": [], "uncertainties": []},
    ),
    (
        "Garden ki flowers sundar lag rahi hain; ismein koi task ya payment nahi hai.",
        {"tasks": [], "money": [], "waiting": [], "uncertainties": []},
    ),
    (
        "Rahul ko Friday call karna hai.",
        {"tasks": [{"action": "call", "person": "Rahul", "scheduled_date": "2026-11-06"}], "money": [], "waiting": [], "uncertainties": []},
    ),
    (
        "Riya ne ₹20,000 ka design final kiya. Kabir ne ₹5,000 ka quote diya.",
        {"tasks": [], "money": [{"person": "Riya", "description": "design", "amount": 20000, "currency": "INR", "state": "agreed"}, {"person": "Kabir", "description": None, "amount": 5000, "currency": "INR", "state": "quote"}], "waiting": [], "uncertainties": []},
    ),
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="lfm3:1.7b")
    parser.add_argument("--url", default="http://127.0.0.1:11434/api/chat")
    parser.add_argument("--think", action="store_true", help="Enable model thinking for comparison")
    parser.add_argument("--few-shot", action="store_true", help="Add grounded demonstrations")
    parser.add_argument("--limit", type=int, help="Run only the first N cases")
    parser.add_argument("--num-predict", type=int, default=768, help="Maximum output tokens per case")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "model": args.model, "url": args.url, "thinking": args.think,
        "few_shot": args.few_shot, "examples": EXAMPLES if args.few_shot else [],
        "system_prompt": SYSTEM, "schema": SCHEMA, "results": [],
    }
    for case_id, text in CASES[:args.limit]:
        messages = [{"role": "system", "content": SYSTEM}]
        if args.few_shot:
            for example_text, example_result in EXAMPLES:
                messages.append({"role": "user", "content": example_text})
                messages.append({"role": "assistant", "content": json.dumps(example_result, ensure_ascii=False)})
        messages.append({"role": "user", "content": text})
        payload = {
            "model": args.model, "stream": False, "think": args.think,
            "format": SCHEMA, "options": {"temperature": 0, "num_ctx": 4096, "num_predict": args.num_predict},
            "messages": messages,
        }
        request = Request(args.url, data=json.dumps(payload, ensure_ascii=True).encode(),
                          headers={"Content-Type": "application/json"}, method="POST")
        started = time.perf_counter()
        try:
            with urlopen(request, timeout=180) as response:
                result = json.load(response)
            content = result.get("message", {}).get("content", "")
            if not result.get("done", False) or result.get("done_reason") == "length":
                raise ValueError(f"Incomplete generation: {result.get('done_reason')}")
            extracted = json.loads(content)
            elapsed = round((time.perf_counter() - started) * 1000, 1)
            row = {"id": case_id, "input": text, "output": extracted, "duration_ms": elapsed,
                   "eval_count": result.get("eval_count"), "done_reason": result.get("done_reason")}
            report["results"].append(row)
            print(f"{case_id} [{elapsed:.0f} ms] {json.dumps(extracted, ensure_ascii=True)}", flush=True)
        except HTTPError as exc:
            print(f"{case_id}: HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')}", file=sys.stderr)
            return 1
        except (URLError, OSError, ValueError, json.JSONDecodeError) as exc:
            print(f"{case_id}: {exc}", file=sys.stderr)
            return 1

    if args.output:
        args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Full results: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
