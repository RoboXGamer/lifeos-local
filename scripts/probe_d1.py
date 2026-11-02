"""Probe a locally loaded Ollama d1 decision model with synthetic LifeOS cases.

Run: uv run --no-project scripts/probe_d1.py
Optional: --model MODEL --url URL --output PATH

This script only sends the synthetic examples below to the specified local
Ollama endpoint. It never opens the LifeOS database or changes app data.
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


DEFAULT_MODEL = "hf.co/LiquidAI/d1-2B-GGUF:Q8_0"
DEFAULT_URL = "http://127.0.0.1:11434/v1/systemone"


def yes_no(instructions: str) -> dict:
    return {"type": "noul", "instructions": instructions}


CAPTURE_QUESTIONS = {
    "action": yes_no(
        "Does the text explicitly describe an action the user intends or needs "
        "to do in the future? Do not count an action already completed."
    ),
    "quote": yes_no(
        "Does the text explicitly mention a quoted or proposed price, "
        "whether or not it was later accepted?"
    ),
    "agreed": yes_no(
        "Does the text explicitly say a price or monetary deal was agreed "
        "or confirmed? A mere quote or negotiation is not an agreement."
    ),
    "payment": yes_no(
        "Does the text explicitly say money has already been paid or received? "
        "Exclude future, planned, expected, or explicitly unmade payments."
    ),
    "waiting": yes_no(
        "Is the user explicitly waiting for another person to respond, "
        "confirm, or take action?"
    ),
}

# Labels are manual interpretations of the synthetic texts, not model outputs.
CAPTURE_CASES = [
    {
        "id": "hinglish_quote_followup",
        "text": "Amit ne wedding sound ke liye 1 lakh ka quote diya. Friday ko use call karna hai.",
        "expected": {"action": True, "quote": True, "agreed": False, "payment": False},
    },
    {
        "id": "hinglish_agreed_advance",
        "text": "Amit 90 hazaar mein maan gaya. Maine usko 30 hazaar advance de diya.",
        "expected": {"quote": False, "agreed": True, "payment": True},
    },
    {
        "id": "planned_not_paid",
        "text": "Kal vendor ko 30 hazaar advance dena hai, abhi payment nahi ki.",
        "expected": {"action": True, "payment": False},
    },
    {
        "id": "incoming_received",
        "text": "Client se 30,000 rupaye aaj receive ho gaye.",
        "expected": {"payment": True, "quote": False},
    },
    {
        "id": "unconfirmed_unpaid_quote",
        "text": "Amit ka 1 lakh ka quote hai, lekin rate final nahi hua aur kuch bhi pay nahi kiya.",
        "expected": {"quote": True, "agreed": False, "payment": False},
    },
    {
        "id": "waiting_on_approval",
        "text": "Maine design bhej diya; client ki approval ka wait kar raha hoon.",
        "expected": {"action": False, "waiting": True, "payment": False},
    },
    {
        "id": "completed_not_future",
        "text": "I called the dentist yesterday and booked an appointment.",
        "expected": {"action": False, "quote": False, "payment": False, "waiting": False},
    },
    {
        "id": "two_sides_one_confirmed",
        "text": "Client se event ka sale 5 lakh mein confirm hai. Vendor ka 2 lakh ka quote abhi final nahi hai. Koi payment nahi hui.",
        "expected": {"quote": True, "agreed": True, "payment": False},
    },
    {
        "id": "simple_personal_task",
        "text": "Car ki service next month karwani hai.",
        "expected": {"action": True, "quote": False, "agreed": False, "payment": False},
    },
    {
        "id": "financial_number_not_payment",
        "text": "The event budget is 5 lakh. We have not made any booking or payment yet.",
        "expected": {"quote": False, "agreed": False, "payment": False},
    },
    {
        "id": "refund_already_received",
        "text": "Vendor ne kal 5000 rupaye refund kar diye.",
        "expected": {"payment": True, "quote": False},
    },
    {
        "id": "neutral_note",
        "text": "Blue flowers look nice for the wedding stage.",
        "expected": {"action": False, "quote": False, "agreed": False, "payment": False},
    },
]

LENS_QUESTION = (
    "Does this note explicitly say that the user promised Amit they would "
    "send him a wedding-related document or proposal?"
)
LENS_CASES = [
    {"id": "promise_hinglish", "text": "Maine Amit ko promise kiya ki wedding ka proposal Friday ko bhejunga.", "expected": True},
    {"id": "promise_english", "text": "I promised Amit I'd send him the wedding contract tomorrow.", "expected": True},
    {"id": "wrong_person", "text": "I promised Riya I'd send her the wedding proposal tomorrow.", "expected": False},
    {"id": "wrong_direction", "text": "Amit promised to send me the wedding proposal tomorrow.", "expected": False},
    {"id": "wrong_subject", "text": "I promised Amit I'd send him the car service invoice tomorrow.", "expected": False},
    {"id": "no_promise", "text": "Amit asked whether I could send the wedding proposal; I haven't replied.", "expected": False},
    {"id": "cancelled_promise", "text": "Amit and I discussed the wedding proposal, but I never promised to send anything.", "expected": False},
]

CHOICE_CASES = [
    {
        "id": "stage_quote",
        "text": "Amit ne wedding sound ke liye 1 lakh ka quote diya; final nahi hua.",
        "question": {
            "type": "choice",
            "instructions": "Which best describes the current status of the sound price?",
            "criteria": {
                "quote": "A proposed or quoted price, not yet agreed.",
                "agreed": "A price accepted or confirmed, but not necessarily paid.",
                "paid": "Money has actually been paid or received.",
                "unknown": "No price status can be determined.",
            },
        },
        "expected": "quote",
    },
    {
        "id": "stage_agreed",
        "text": "Amit 90 hazaar mein maan gaya; abhi tak payment nahi ki.",
        "question": {
            "type": "choice",
            "instructions": "Which best describes the current status of the sound price?",
            "criteria": {
                "quote": "A proposed or quoted price, not yet agreed.",
                "agreed": "A price accepted or confirmed, but not necessarily paid.",
                "paid": "Money has actually been paid or received.",
                "unknown": "No price status can be determined.",
            },
        },
        "expected": "agreed",
    },
    {
        "id": "stage_paid",
        "text": "Amit ko 30,000 rupaye advance de diye.",
        "question": {
            "type": "choice",
            "instructions": "Which best describes the money mentioned in the text?",
            "criteria": {
                "quote": "A proposed or quoted price, not yet agreed.",
                "agreed": "A price accepted or confirmed, but not necessarily paid.",
                "paid": "Money has actually been paid or received.",
                "unknown": "No price status can be determined.",
            },
        },
        "expected": "paid",
    },
    {
        "id": "stage_unknown",
        "text": "We might talk to a sound vendor next week; no price has been mentioned.",
        "question": {
            "type": "choice",
            "instructions": "Which best describes the current status of a sound price?",
            "criteria": {
                "quote": "A proposed or quoted price, not yet agreed.",
                "agreed": "A price accepted or confirmed, but not necessarily paid.",
                "paid": "Money has actually been paid or received.",
                "unknown": "No price status can be determined.",
            },
        },
        "expected": "unknown",
    },
    {
        "id": "actor_user_promised",
        "text": "Maine Amit ko promise kiya ki wedding ka proposal Friday ko bhejunga.",
        "question": {
            "type": "choice",
            "instructions": "Who promised to send the wedding proposal?",
            "criteria": {"user": "The user promised Amit.", "amit": "Amit promised the user.", "neither": "Neither made such a promise."},
        },
        "expected": "user",
    },
    {
        "id": "actor_amit_promised",
        "text": "Amit promised to send me the wedding proposal tomorrow.",
        "question": {
            "type": "choice",
            "instructions": "Who promised to send the wedding proposal?",
            "criteria": {"user": "The user promised Amit.", "amit": "Amit promised the user.", "neither": "Neither made such a promise."},
        },
        "expected": "amit",
    },
    {
        "id": "actor_no_promise",
        "text": "Amit asked whether I could send the wedding proposal; I haven't replied.",
        "question": {
            "type": "choice",
            "instructions": "Who promised to send the wedding proposal?",
            "criteria": {"user": "The user promised Amit.", "amit": "Amit promised the user.", "neither": "Neither made such a promise."},
        },
        "expected": "neither",
    },
]


def request_json(url: str, payload: dict) -> tuple[int, dict, float]:
    request = Request(
        url,
        data=json.dumps(payload, ensure_ascii=True).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.perf_counter()
    try:
        with urlopen(request, timeout=120) as response:
            return response.status, json.load(response), time.perf_counter() - started
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = {"error": body}
        return exc.code, parsed, time.perf_counter() - started


def evaluate_case(url: str, model: str, case: dict, questions: dict, expected: dict) -> dict:
    status, response, seconds = request_json(
        url, {"model": model, "state": case["text"], "questions": questions}
    )
    if status != 200:
        raise RuntimeError(f"{case['id']}: HTTP {status}: {response}")
    answers = response.get("answers", {})
    results = {}
    for name, correct in expected.items():
        answer = answers.get(name, {})
        probability = answer.get("noul")
        if not isinstance(probability, (float, int)) or isinstance(probability, bool):
            raise RuntimeError(f"{case['id']}: unexpected answer for {name}: {answer}")
        prediction = probability >= 0.5
        results[name] = {
            "expected": correct,
            "p_yes": probability,
            "predicted": prediction,
            "matches": prediction == correct,
        }
    return {
        "id": case["id"],
        "input": case["text"],
        "duration_ms": round(seconds * 1000, 1),
        "judgements": results,
        "all_answers": answers,
        "usage": response.get("usage"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--output", type=Path, help="Optional path for a full JSON report")
    args = parser.parse_args()

    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "model": args.model,
        "url": args.url,
        "threshold": 0.5,
        "threshold_note": "Exploratory only; not calibrated for production.",
        "capture_questions": CAPTURE_QUESTIONS,
        "semantic_lens_question": LENS_QUESTION,
        "choice_questions": {case["id"]: case["question"] for case in CHOICE_CASES},
        "capture": [],
        "semantic_lens": [],
        "choice": [],
    }
    try:
        for case in CAPTURE_CASES:
            # Test all five questions in the same request, but only score
            # manually specified labels where the intended answer is clear.
            result = evaluate_case(args.url, args.model, case, CAPTURE_QUESTIONS, case["expected"])
            report["capture"].append(result)
            marks = ", ".join(
                f"{name}={judgement['p_yes']:.3f}"
                f"({'OK' if judgement['matches'] else 'MISS'})"
                for name, judgement in result["judgements"].items()
            )
            print(f"capture {result['id']} [{result['duration_ms']:.0f} ms]: {marks}", flush=True)

        for case in LENS_CASES:
            result = evaluate_case(
                args.url, args.model, case,
                {"match": yes_no(LENS_QUESTION)}, {"match": case["expected"]},
            )
            report["semantic_lens"].append(result)
            match = result["judgements"]["match"]
            print(
                f"lens    {result['id']} [{result['duration_ms']:.0f} ms]: "
                f"match={match['p_yes']:.3f} ({'OK' if match['matches'] else 'MISS'})",
                flush=True,
            )

        for case in CHOICE_CASES:
            status, response, seconds = request_json(args.url, {
                "model": args.model, "state": case["text"], "questions": {"decision": case["question"]},
            })
            if status != 200:
                raise RuntimeError(f"{case['id']}: HTTP {status}: {response}")
            answer = response.get("answers", {}).get("decision", {})
            selected = answer.get("choice")
            if not isinstance(selected, str):
                raise RuntimeError(f"{case['id']}: unexpected choice answer: {answer}")
            result = {
                "id": case["id"], "input": case["text"], "expected": case["expected"],
                "selected": selected, "matches": selected == case["expected"],
                "duration_ms": round(seconds * 1000, 1), "answer": answer,
            }
            report["choice"].append(result)
            print(f"choice  {result['id']} [{result['duration_ms']:.0f} ms]: "
                  f"{selected} ({'OK' if result['matches'] else 'MISS'})", flush=True)

        status, response, seconds = request_json(args.url, {
            "model": args.model,
            "state": "Amit quoted 100000 rupees.",
            "questions": {"amount": {"type": "number", "instructions": "What amount was quoted?"}},
        })
        report["number_extraction_probe"] = {
            "http_status": status, "response": response, "duration_ms": round(seconds * 1000, 1)
        }
        print(f"number extraction capability: HTTP {status}, {response}", flush=True)
    except (URLError, OSError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"Probe failed: {exc}", file=sys.stderr)
        return 1

    for section in ("capture", "semantic_lens"):
        rows = report[section]
        judgements = [j for row in rows for j in row["judgements"].values()]
        matched = sum(j["matches"] for j in judgements)
        report[f"{section}_summary"] = {
            "cases": len(rows), "correct": matched, "judgements": len(judgements),
            "median_request_ms": round(statistics.median(row["duration_ms"] for row in rows), 1),
        }
        print(f"{section}: {matched}/{len(judgements)} labelled decisions matched; "
              f"median {report[f'{section}_summary']['median_request_ms']:.1f} ms/request")

    choice_correct = sum(row["matches"] for row in report["choice"])
    report["choice_summary"] = {"cases": len(report["choice"]), "correct": choice_correct}
    print(f"choice: {choice_correct}/{len(report['choice'])} labelled decisions matched")

    if args.output:
        args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Full results: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
