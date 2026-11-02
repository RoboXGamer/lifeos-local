"""Compare two one-call LFM3 prompts on held-out synthetic LifeOS captures.

Run: uv run --no-project scripts/benchmark_lfm3_capture.py --output results.json
All examples are synthetic. Calls only local Ollama; never accesses LifeOS data.
The evaluation is deliberately small and is not a production accuracy estimate.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.dont_write_bytecode = True
from probe_lfm3_structured import EXAMPLES, SCHEMA, SYSTEM


TUNED_SYSTEM = """You convert a personal capture into the provided LifeOS JSON schema.
Reference time: 2026-11-02, Monday, Asia/Kolkata. Do not use any other date.
Extract only things explicitly stated in the current input. An example is not the input.
The user must do a task; another person's promise goes in waiting, never in tasks.
Use one entry per distinct monetary fact. A quote is not agreed; planned is not paid.
If input says not final or not paid, do not add an agreement or a payment.
If a payment is a refund, state must be refund. Do not duplicate an amount.
1 lakh = 100000, 1 hazaar = 1000. Example: 2 lakh = 200000.
Currency: use INR only if this input explicitly says ₹, Rs, rupees or rupaye; otherwise null.
The ₹ symbol explicitly means INR even for a future payment that has not happened.
If money is due in the future and not paid, record its state as planned, not paid.
Friday relative to reference date is 2026-11-06. A missing date is null, not today.
Use null for missing facts. Do not insert people, amounts, tasks, dates, or records not stated.
For an unrelated idea with no action or money, tasks, money and waiting are empty arrays.
Do not fill uncertainties with irrelevant or invented details.
The schema is: """ + json.dumps(SCHEMA, ensure_ascii=False)


def t(action: str, person: str | None, date: str | None = None) -> dict:
    return {"action": action, "person": person, "scheduled_date": date}


def m(person: str | None, amount: int, currency: str | None, state: str, description: str | None = None) -> dict:
    return {"person": person, "description": description, "amount": amount, "currency": currency, "state": state}


def result(tasks: list[dict] | None = None, money: list[dict] | None = None,
           waiting: list[dict] | None = None) -> dict:
    return {"tasks": tasks or [], "money": money or [], "waiting": waiting or [], "uncertainties": []}


TUNED_EXAMPLES = [
    ("Priya ne decoration ka ₹25,000 quote diya. Friday ko Priya ko call karna hai.",
     result([t("call", "Priya", "2026-11-06")], [m("Priya", 25000, "INR", "quote", "decoration")])),
    ("Deepa 60 hazaar par maan gayi. Maine usko 10 hazaar advance de diya.",
     result(money=[m("Deepa", 60000, None, "agreed"), m("Deepa", 10000, None, "paid", "advance")])),
    ("Tara ne mujhe promise kiya ki woh Friday ko report bhejegi.",
     result(waiting=[t("send report", "Tara", "2026-11-06")])),
    ("Kabir ne ₹40,000 quote diya; rate final nahi hua, aur payment abhi nahi hui.",
     result(money=[m("Kabir", 40000, "INR", "quote")])),
    ("Vikram ne ₹3,000 refund kar diye.", result(money=[m("Vikram", 3000, "INR", "refund")])),
    ("Garden mein white flowers achhe lagenge. Koi kaam nahi karna.", result()),
    ("Priya se ₹2 lakh ki sale confirm hai; Arjun ne ₹30,000 ka quote diya.",
     result(money=[m("Priya", 200000, "INR", "agreed", "sale"), m("Arjun", 30000, "INR", "quote")])),
    ("Divya ko call karna hai.", result([t("call", "Divya")])),
    ("Agale mahine supplier ko ₹7,000 dene hain, abhi payment nahi ki.",
     result(money=[m(None, 7000, "INR", "planned")])),
]

# Manually labelled before the test. These inputs never appear in either
# prompt's demonstrations. Only a subset of fields is checked, as specified.
CASES = [
    {"id": "quote_plus_task", "text": "Rohan ne photo ke liye ₹2 lakh quote diya. Friday ko Rohan ko call karna hai.",
     "money": [{"person": "Rohan", "amount": 200000, "currency": "INR", "state": "quote"}],
     "tasks": [{"person": "Rohan", "scheduled_date": "2026-11-06"}], "waiting": []},
    {"id": "agreed_paid_no_currency", "text": "Meera 75 hazaar mein maan gayi. Maine use 15 hazaar advance de diya.",
     "money": [{"person": "Meera", "amount": 75000, "currency": None, "state": "agreed"},
               {"person": "Meera", "amount": 15000, "currency": None, "state": "paid"}], "tasks": [], "waiting": []},
    {"id": "two_parties", "text": "Nisha se event ka ₹4 lakh sale confirm hua. Imran ne sound ke liye ₹50 hazaar quote diya.",
     "money": [{"person": "Nisha", "amount": 400000, "currency": "INR", "state": "agreed"},
               {"person": "Imran", "amount": 50000, "currency": "INR", "state": "quote"}], "tasks": [], "waiting": []},
    {"id": "quote_negation", "text": "Meera ka ₹80,000 quote hai, deal final nahi hui aur koi payment nahi hui.",
     "money": [{"person": "Meera", "amount": 80000, "currency": "INR", "state": "quote"}], "tasks": [], "waiting": []},
    {"id": "planned_unpaid", "text": "Agale hafte vendor ko ₹12,000 dena hai, abhi tak payment nahi ki.",
     "money": [{"amount": 12000, "currency": "INR", "state": "planned"}], "forbid_paid": True},
    {"id": "refund", "text": "Riya ne mujhe ₹2500 refund kiye.",
     "money": [{"person": "Riya", "amount": 2500, "currency": "INR", "state": "refund"}], "tasks": [], "waiting": []},
    {"id": "other_person_promise", "text": "Sana ne mujhe promise kiya ki woh Friday ko report bhejegi.",
     "money": [], "tasks": [], "waiting": [{"person": "Sana", "scheduled_date": "2026-11-06"}]},
    {"id": "neutral_note", "text": "Green curtains room mein achhe lagenge, par abhi kuch nahi karna.",
     "money": [], "tasks": [], "waiting": []},
    {"id": "undated_task", "text": "Rohan ko call karna hai.",
     "money": [], "tasks": [{"person": "Rohan", "scheduled_date": None}], "waiting": []},
    {"id": "received_unknown_terms", "text": "Client se ₹20,000 mil gaye; agreement ki total amount nahi pata.",
     "money": [{"amount": 20000, "currency": "INR", "state": "paid"}], "tasks": [], "waiting": []},
    {"id": "devanagari_quote", "text": "मीना ने ₹7000 के काम का कोट दिया, अभी भुगतान नहीं हुआ।",
     "money": [{"amount": 7000, "currency": "INR", "state": "quote"}], "tasks": [], "waiting": []},
    {"id": "partial_payment_explicit", "text": "Maine event ke liye Kabir ko ₹25,000 advance bhej diya.",
     "money": [{"person": "Kabir", "amount": 25000, "currency": "INR", "state": "paid"}], "tasks": [], "waiting": []},
]

# Fresh cases written after the earlier benchmark and never included in prompts.
HOLDOUT_CASES = [
    {"id": "new_quote_task", "text": "Zoya ne lighting ke liye ₹3 lakh quote diya; Friday ko Zoya ko call karunga.",
     "money": [{"person": "Zoya", "amount": 300000, "currency": "INR", "state": "quote"}],
     "tasks": [{"person": "Zoya", "scheduled_date": "2026-11-06"}], "waiting": []},
    {"id": "new_paid_no_currency", "text": "Arjun ko maine pachaas hazaar de diye.",
     "money": [{"person": "Arjun", "amount": 50000, "currency": None, "state": "paid"}], "tasks": [], "waiting": []},
    {"id": "new_quote_not_paid", "text": "Simran ka ₹35,000 quote hai, payment abhi nahi hui aur deal confirm nahi hai.",
     "money": [{"person": "Simran", "amount": 35000, "currency": "INR", "state": "quote"}], "tasks": [], "waiting": []},
    {"id": "new_two_people", "text": "Pooja se ₹6 lakh ki sale confirm hai. Karan ne venue ke liye ₹2 lakh ka quote diya.",
     "money": [{"person": "Pooja", "amount": 600000, "currency": "INR", "state": "agreed"},
               {"person": "Karan", "amount": 200000, "currency": "INR", "state": "quote"}], "tasks": [], "waiting": []},
    {"id": "new_future_unpaid", "text": "Agle mahine plumber ko ₹8,000 dene hain; abhi tak paise nahi diye.",
     "money": [{"amount": 8000, "currency": "INR", "state": "planned"}], "forbid_paid": True},
    {"id": "new_refund", "text": "Decorator Anil ne mujhe ₹4,000 refund kar diye.",
     "money": [{"person": "Anil", "amount": 4000, "currency": "INR", "state": "refund"}], "tasks": [], "waiting": []},
    {"id": "new_other_waiting", "text": "Leena ne kaha woh Friday ko mujhe contract bhejegi; main uska wait kar raha hoon.",
     "money": [], "tasks": [], "waiting": [{"person": "Leena", "scheduled_date": "2026-11-06"}]},
    {"id": "new_neutral", "text": "Mujhe lagta hai samundar ki hawa bahut achhi hoti hai.",
     "money": [], "tasks": [], "waiting": []},
    {"id": "new_task_no_date", "text": "Mujhe Farah se meeting ke baare mein baat karni hai.",
     "money": [], "tasks": [{"person": "Farah", "scheduled_date": None}], "waiting": []},
    {"id": "new_received_unknown_total", "text": "Customer se ₹45,000 mil gaye; final agreed price mujhe pata nahi hai.",
     "money": [{"amount": 45000, "currency": "INR", "state": "paid"}], "tasks": [], "waiting": []},
    {"id": "new_hindi_payment", "text": "मैंने रवि को ₹9000 का अग्रिम भुगतान कर दिया।",
     "money": [{"amount": 9000, "currency": "INR", "state": "paid"}], "tasks": [], "waiting": []},
    {"id": "new_no_amount", "text": "Nikhil ne price confirm kiya hai par amount abhi mujhe nahi bataya.",
     "money": [{"person": "Nikhil", "amount": None, "currency": None, "state": "agreed"}], "tasks": [], "waiting": []},
]


def money_matches(actual: dict, expected: dict) -> bool:
    for key, wanted in expected.items():
        value = actual.get(key)
        if key == "person" and isinstance(value, str) and isinstance(wanted, str):
            if value.casefold() != wanted.casefold():
                return False
        elif value != wanted:
            return False
    return True


def matching_records(actual: object, expected: list[dict]) -> bool:
    if not isinstance(actual, list) or len(actual) != len(expected):
        return False
    unused = list(actual)
    for candidate in expected:
        match_index = next((i for i, entry in enumerate(unused)
                            if isinstance(entry, dict) and money_matches(entry, candidate)), None)
        if match_index is None:
            return False
        unused.pop(match_index)
    return True


def validate_case(case: dict, output: object) -> dict[str, bool]:
    if not isinstance(output, dict):
        return {"object": False}
    checks = {}
    for field in ("tasks", "money", "waiting"):
        if field in case:
            checks[field] = matching_records(output.get(field), case[field])
    if case.get("forbid_paid"):
        entries = output.get("money")
        checks["no_false_payment"] = isinstance(entries, list) and all(
            isinstance(entry, dict) and entry.get("state") != "paid" for entry in entries
        )
    return checks


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="lfm3:1.7b")
    parser.add_argument("--url", default="http://127.0.0.1:11434/api/chat")
    parser.add_argument("--variant", choices=["baseline", "tuned", "both"], default="both")
    parser.add_argument("--holdout", action="store_true", help="Use the separate 12-case holdout")
    parser.add_argument("--think", action="store_true", help="Enable model thinking")
    parser.add_argument("--num-predict", type=int, default=768, help="Maximum generated tokens")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    cases = HOLDOUT_CASES if args.holdout else CASES
    report = {"created_utc": datetime.now(timezone.utc).isoformat(), "model": args.model, "thinking": args.think, "num_predict": args.num_predict,
              "url": args.url, "cases": cases, "schema": SCHEMA, "variants": {}}

    for variant in (["baseline", "tuned"] if args.variant == "both" else [args.variant]):
        system, examples = (SYSTEM, EXAMPLES) if variant == "baseline" else (TUNED_SYSTEM, TUNED_EXAMPLES)
        rows = []
        report["variants"][variant] = {"system_prompt": system, "examples": examples, "results": rows}
        for case in cases:
            messages = [{"role": "system", "content": system}]
            for text, answer in examples:
                messages.extend([{"role": "user", "content": text},
                                 {"role": "assistant", "content": json.dumps(answer, ensure_ascii=False)}])
            messages.append({"role": "user", "content": case["text"]})
            payload = {"model": args.model, "stream": False, "think": args.think, "format": SCHEMA,
                       "options": {"temperature": 0, "num_ctx": 8192, "num_predict": args.num_predict}, "messages": messages}
            request = Request(args.url, data=json.dumps(payload, ensure_ascii=True).encode(),
                              headers={"Content-Type": "application/json"}, method="POST")
            started = time.perf_counter()
            try:
                with urlopen(request, timeout=180) as response:
                    data = json.load(response)
                if not data.get("done") or data.get("done_reason") == "length":
                    raise ValueError(f"Incomplete generation: {data.get('done_reason')}")
                output = json.loads(data.get("message", {}).get("content", ""))
                checks = validate_case(case, output)
                row = {"id": case["id"], "output": output, "checks": checks,
                       "passed": all(checks.values()), "duration_ms": round((time.perf_counter()-started)*1000, 1),
                       "tokens": data.get("eval_count")}
                rows.append(row)
                failures = ",".join(k for k, passed in checks.items() if not passed) or "none"
                print(f"{variant:8} {case['id']:24} {'PASS' if row['passed'] else 'FAIL'} "
                      f"checks={failures} {row['duration_ms']:.0f}ms", flush=True)
            except (HTTPError, URLError, OSError, ValueError, json.JSONDecodeError) as exc:
                if isinstance(exc, HTTPError):
                    detail = exc.read().decode("utf-8", "replace")
                else:
                    detail = str(exc)
                rows.append({"id": case["id"], "passed": False, "error": detail})
                print(f"{variant:8} {case['id']:24} ERROR {detail}", file=sys.stderr, flush=True)
        passed = sum(row["passed"] for row in rows)
        durations = [row["duration_ms"] for row in rows if "duration_ms" in row]
        report["variants"][variant]["summary"] = {"passed_cases": passed, "cases": len(rows),
                                                    "median_ms": round(statistics.median(durations), 1) if durations else None}
        print(f"{variant}: {passed}/{len(rows)} cases; median {report['variants'][variant]['summary']['median_ms']}ms", flush=True)

    if args.output:
        args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Full results: {args.output}")
    return 0 if all("error" not in row for v in report["variants"].values() for row in v["results"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
