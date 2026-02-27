"""CLI: Run HERALD pipeline on a test set."""

import argparse
import json
import logging
from pathlib import Path
from herald.core.config import load_config
from herald.core.types import CheckpointOutput, CheckpointType
from herald.pipeline.escalation import build_pipeline


def main():
    parser = argparse.ArgumentParser(description="Run HERALD validation pipeline")
    parser.add_argument("--input", required=True, help="Test cases JSON file")
    parser.add_argument("--config", default="configs/default.yaml")
    parser.add_argument("--output", default="results/run_results.json")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [herald] %(message)s",
    )

    config = load_config(args.config)
    pipeline = build_pipeline(config)

    with open(args.input) as f:
        raw_cases = json.load(f)

    cases = [
        CheckpointOutput(
            checkpoint_type=CheckpointType(c["checkpoint_type"]),
            output_text=c["output_text"],
            source_context=c["source_context"],
            query=c.get("query", ""),
        )
        for c in raw_cases
    ]

    print(f"\n{'='*60}")
    print(f"HERALD — Processing {len(cases)} cases")
    print(f"{'='*60}\n")

    results = []
    for i, case in enumerate(cases):
        print(f"Case {i+1}/{len(cases)}: {case.checkpoint_type.value}")
        packet = pipeline.validate(case)

        results.append({
            "case_index": i,
            "checkpoint_type": case.checkpoint_type.value,
            "output_text": case.output_text[:80] + "...",
            "resolved_at_tier": packet.resolved_at_tier,
            "final_verdict": packet.final_verdict.value,
            "tier1_confidence": round(packet.tier1_result.confidence, 3) if packet.tier1_result else None,
            "tier2_confidence": round(packet.tier2_result.confidence, 3) if packet.tier2_result else None,
            "tier3_confidence": round(packet.tier3_result.judge_confidence, 3) if packet.tier3_result else None,
        })
        print(f"  → Tier {packet.resolved_at_tier}: {packet.final_verdict.value}\n")

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w") as f:
        json.dump(results, f, indent=2)

    # Summary
    print(f"{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    for tier in [1, 2, 3, 4]:
        count = sum(1 for r in results if r["resolved_at_tier"] == tier)
        print(f"  Tier {tier}: {count}/{len(results)} cases ({count/len(results)*100:.0f}%)")
    print(f"\nResults saved to {args.output}")


if __name__ == "__main__":
    main()
