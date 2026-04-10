"""Phase 3, Step 7: Test Tier 2 (LLM Judge) in isolation.

Runs the LLM judge on all cases in the test set and reports verdict + reasoning
without going through the full escalation pipeline.

Usage:
    uv run python notebooks/test_tier2.py \
        --input data/test_sets/sample_cases.json \
        --threshold 0.80
"""

import argparse
import json
import os

from dotenv import load_dotenv

from herald.core.types import CheckpointOutput, CheckpointType, TierResult, Verdict
from herald.tier2.judge import LLMJudge

load_dotenv()


def fake_uncertain_t1(confidence: float = 0.45) -> TierResult:
    """Simulate a Tier 1 result that was uncertain, triggering Tier 2."""
    return TierResult(
        tier=1,
        verdict=Verdict.UNCERTAIN,
        confidence=confidence,
        raw_scores={"entailment": confidence * 0.6, "contradiction": confidence * 0.4, "neutral": 1 - confidence},
    )


def main():
    parser = argparse.ArgumentParser(description="Test Tier 2 LLM Judge in isolation")
    parser.add_argument("--input", default="data/test_sets/sample_cases.json")
    parser.add_argument("--threshold", type=float, default=0.80)
    parser.add_argument("--model", default="llama-3.3-70b-versatile")
    args = parser.parse_args()

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY not set. Add it to .env.")

    judge = LLMJudge(api_key=api_key, model=args.model)

    with open(args.input) as f:
        raw_cases = json.load(f)

    print(f"\n{'='*70}")
    print(f"HERALD Tier 2 (LLM Judge) — Isolated Test")
    print(f"Model: {args.model} | Threshold: {args.threshold}")
    print(f"Cases: {len(raw_cases)}")
    print(f"{'='*70}\n")

    correct = 0
    total = 0
    uncertain_count = 0

    for i, case in enumerate(raw_cases):
        cp = CheckpointOutput(
            checkpoint_type=CheckpointType(case["checkpoint_type"]),
            output_text=case["output_text"],
            source_context=case["source_context"],
            query=case.get("query", ""),
        )
        t1 = fake_uncertain_t1()

        try:
            result = judge.judge(cp, t1, threshold=args.threshold)
        except Exception as e:
            print(f"Case {i+1}: ERROR — {e}")
            continue

        gt_label = case["label"]
        # For evaluation: ambiguous ground truth → uncertain is acceptable
        if gt_label == "ambiguous":
            match = result.verdict in (Verdict.UNCERTAIN, Verdict.VALID)
        else:
            match = result.verdict.value == gt_label

        marker = "✓" if match else "✗"
        uncertain_count += int(result.verdict == Verdict.UNCERTAIN)
        correct += int(match)
        total += 1

        print(f"Case {i+1:2d} [{case['checkpoint_type']:20s}] {marker}")
        print(f"  Predicted: {result.verdict.value:10s} (conf={result.confidence:.2f})  Actual: {gt_label}")
        print(f"  Reasoning: {result.reasoning[:100]}...")
        print()

    print(f"{'='*70}")
    print(f"Accuracy:  {correct}/{total} ({correct/total:.1%})")
    print(f"Uncertain: {uncertain_count}/{total} ({uncertain_count/total:.1%}) — would escalate to Tier 3")
    print(f"{'='*70}")

    print("\nNOTE: Tier 2 is designed for cases Tier 1 found ambiguous.")
    print("      Running it on ALL cases (including easy ones) will show artificially low")
    print("      uncertain rates since easy cases will resolve confidently here.")


if __name__ == "__main__":
    main()
