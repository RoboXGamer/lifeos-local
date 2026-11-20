# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "gliner2[local]==2.1.0",
#   "torch",
# ]
#
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
#
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""Explore a small, local CPU extractor on synthetic LifeOS captures.

Run: uv run scripts/probe_small_extractor.py
Optional: --output PATH

First run downloads the model and its dependencies. This script does not
read or write a LifeOS database; outputs are unverified model suggestions.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import torch
from gliner2 import AutoExtractor


MODEL = "fastino/gliner2.5-multi-v1"
LABELS = {
    "person": "Names of individual people",
    "money": "Monetary amounts and currency, including prices and payments",
    "date": "Dates and relative days such as Friday or tomorrow",
    "action": "Actions to perform, appointments, or follow-up requests",
    "event": "Named events or occasions",
}
CASES = [
    ("quote_and_task", "Amit ne wedding sound ke liye 1 lakh ka quote diya. Friday ko use call karna hai."),
    ("agreed_and_paid", "Amit 90 hazaar mein maan gaya. Maine usko 30 hazaar advance de diya."),
    ("planned_not_paid", "Kal vendor ko 30 hazaar advance dena hai, abhi payment nahi ki."),
    ("two_parties", "Client Neha ne wedding ke liye 5 lakh confirm kiye. Vendor Amit ne sound ka 1 lakh quote diya."),
    ("negation", "Amit ka 1 lakh ka quote hai, lekin rate final nahi hua aur kuch bhi pay nahi kiya."),
    ("english_control", "Call Amit on Friday about his quoted sound price of 100,000 rupees for the wedding."),
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Optional path for the JSON report")
    args = parser.parse_args()

    torch.set_num_threads(min(4, os.cpu_count() or 1))
    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "model": MODEL,
        "device": "cpu",
        "torch_version": torch.__version__,
        "labels": LABELS,
        "cases": [],
    }
    started = time.perf_counter()
    print(f"Loading {MODEL} on CPU; first run downloads model weights.", flush=True)
    model = AutoExtractor.from_pretrained(MODEL, map_location="cpu")
    report["load_ms"] = round((time.perf_counter() - started) * 1000, 1)
    print(f"Model loaded in {report['load_ms']:.0f} ms.", flush=True)

    for case_id, text in CASES:
        started = time.perf_counter()
        result = model.extract_entities(text, LABELS, include_spans=True, include_confidence=True)
        elapsed = round((time.perf_counter() - started) * 1000, 1)
        report["cases"].append({"id": case_id, "text": text, "duration_ms": elapsed, "result": result})
        print(f"{case_id} [{elapsed:.0f} ms] {json.dumps(result, ensure_ascii=True)}", flush=True)

    # This schema is an exploratory proposal, not an assertion about the text.
    # It also checks whether the model can keep different people/amounts apart.
    structured_text = CASES[3][1]
    started = time.perf_counter()
    structured = model.extract_json(structured_text, {
        "financial_record": [
            "person::str::Person mentioned in the financial arrangement",
            "amount::str::Amount of money in the arrangement",
            "description::str::What the amount relates to",
        ]
    })
    report["structured_example"] = {
        "text": structured_text,
        "duration_ms": round((time.perf_counter() - started) * 1000, 1),
        "result": structured,
    }
    print(f"structured {json.dumps(structured, ensure_ascii=True)}", flush=True)

    if args.output:
        args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Full results: {args.output}")


if __name__ == "__main__":
    main()
