"""CLI: Run HERALD pipeline on a test set."""

import argparse
import json
import logging
from pathlib import Path
from herald.core.cli import add_llm_override_args
from herald.core.config import load_config
from herald.core.types import CheckpointOutput, CheckpointType
from herald.pipeline.escalation import build_pipeline


def main():
    parser = argparse.ArgumentParser(description="Run HERALD validation pipeline")
    parser.add_argument("--input", required=True, help="Test cases JSON file")
    parser.add_argument("--config", default="configs/default.yaml")
    parser.add_argument("--output", default="results/run_results.json")
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("--resume", action="store_true", help="Resume from existing output file (skip already-processed cases)")
    add_llm_override_args(parser, include_tier2=True, include_tier3=True)
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(asctime)s [herald] %(message)s",
    )

    config = load_config(
        args.config,
        provider=args.provider,
        tier2_model=args.tier2_model,
        tier3_model=args.tier3_model,
    )
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

    # Resume: load already-completed results and skip those indices
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    results = []
    start_index = 0
    if args.resume and output_path.exists():
        with open(output_path) as f:
            results = json.load(f)
        start_index = len(results)
        print(f"Resuming from case {start_index + 1}/{len(cases)} ({start_index} already done)")

    print(f"\n{'='*60}")
    print(f"HERALD — Processing {len(cases)} cases (starting at {start_index + 1})")
    print(f"T1={config['thresholds']['T1']}  T2={config['thresholds']['T2']}")
    print(f"{'='*60}\n")

    for i, case in enumerate(cases[start_index:], start=start_index):
        print(f"Case {i+1}/{len(cases)}: [{case.checkpoint_type.value}]")
        packet = pipeline.validate(case)

        result = {
            "case_index": i,
            "checkpoint_type": case.checkpoint_type.value,
            "output_text": case.output_text[:80] + "...",
            "resolved_at_tier": packet.resolved_at_tier,
            "final_verdict": packet.final_verdict.value,
            "tier1_confidence": round(packet.tier1_result.confidence, 3) if packet.tier1_result else None,
            "tier2_confidence": round(packet.tier2_result.confidence, 3) if packet.tier2_result else None,
            "tier3_confidence": round(packet.tier3_result.judge_confidence, 3) if packet.tier3_result else None,
        }
        results.append(result)

        tier_label = f"Tier {packet.resolved_at_tier}"
        conf = (
            packet.tier1_result.confidence if packet.resolved_at_tier == 1
            else packet.tier2_result.confidence if packet.resolved_at_tier == 2 and packet.tier2_result
            else packet.tier3_result.judge_confidence if packet.resolved_at_tier == 3 and packet.tier3_result
            else None
        )
        conf_str = f" ({conf:.3f})" if conf is not None else ""
        print(f"  → {tier_label}: {packet.final_verdict.value}{conf_str}\n")

        # Save after every case so we can resume on crash / rate limit
        with open(output_path, "w") as f:
            json.dump(results, f, indent=2)

    # Summary
    print(f"{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")

    tier_counts = {1: 0, 2: 0, 3: 0, 4: 0}
    verdict_counts = {}
    for r in results:
        tier_counts[r["resolved_at_tier"]] = tier_counts.get(r["resolved_at_tier"], 0) + 1
        verdict_counts[r["final_verdict"]] = verdict_counts.get(r["final_verdict"], 0) + 1

    n = len(results)
    for tier in [1, 2, 3, 4]:
        count = tier_counts.get(tier, 0)
        print(f"  Tier {tier}: {count:3d}/{n} ({count/n*100:5.1f}%)")

    print(f"\nVerdicts: {verdict_counts}")
    print(f"\nResults saved to {output_path}  ({n} cases)")


if __name__ == "__main__":
    main()
