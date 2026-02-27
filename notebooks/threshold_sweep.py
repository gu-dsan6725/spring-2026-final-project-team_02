"""Phase 4, Step 11: Sweep T1 and T2 thresholds to generate cost-accuracy tradeoff data.

For each (T1, T2) threshold combination, runs the HERALD pipeline on the full
test set and records accuracy + escalation rates. Saves a results table to
results/threshold_sweep.json and prints a summary.

Usage:
    uv run python notebooks/threshold_sweep.py \
        --input data/test_sets/sample_cases.json \
        --output results/threshold_sweep.json

NOTE: This makes Groq API calls. With 25 threshold pairs and 10 test cases,
      expect up to 250 × (up to 6 calls each) = ~1,500 total API calls.
      Use --t1-values and --t2-values to reduce scope during development.
"""

import argparse
import json
import os
import time
from pathlib import Path

from dotenv import load_dotenv

from herald.core.config import load_config
from herald.core.types import CheckpointOutput, CheckpointType
from herald.pipeline.escalation import HeraldPipeline, build_pipeline

load_dotenv()


def run_pipeline_on_cases(
    pipeline: HeraldPipeline,
    cases: list[CheckpointOutput],
    ground_truth: list[dict],
) -> dict:
    """Run pipeline on all cases and return metrics."""
    results = []
    for cp, gt in zip(cases, ground_truth):
        packet = pipeline.validate(cp)
        results.append({
            "resolved_at_tier": packet.resolved_at_tier,
            "final_verdict": packet.final_verdict.value if packet.final_verdict else "uncertain",
            "ground_truth": gt["label"],
        })

    n = len(results)
    # Accuracy: ambiguous ground truth → any verdict counts as correct for accuracy
    correct = sum(
        1 for r in results
        if r["final_verdict"] == r["ground_truth"]
        or (r["ground_truth"] == "ambiguous" and r["final_verdict"] == "uncertain")
    )
    accuracy = correct / n

    tier_counts = {1: 0, 2: 0, 3: 0, 4: 0}
    for r in results:
        tier_counts[r["resolved_at_tier"]] = tier_counts.get(r["resolved_at_tier"], 0) + 1

    return {
        "accuracy": accuracy,
        "correct": correct,
        "total": n,
        "tier1_rate": tier_counts[1] / n,
        "tier2_rate": tier_counts[2] / n,
        "tier3_rate": tier_counts[3] / n,
        "tier4_rate": tier_counts[4] / n,
        "human_review_rate": tier_counts[4] / n,
        "tier_counts": tier_counts,
    }


def main():
    parser = argparse.ArgumentParser(description="Sweep T1/T2 thresholds for tradeoff analysis")
    parser.add_argument("--input", default="data/test_sets/sample_cases.json")
    parser.add_argument("--config", default="configs/default.yaml")
    parser.add_argument("--output", default="results/threshold_sweep.json")
    parser.add_argument(
        "--t1-values",
        nargs="+",
        type=float,
        default=[0.50, 0.60, 0.70, 0.80, 0.90],
        help="T1 threshold values to sweep",
    )
    parser.add_argument(
        "--t2-values",
        nargs="+",
        type=float,
        default=[0.50, 0.60, 0.70, 0.80, 0.90],
        help="T2 threshold values to sweep",
    )
    parser.add_argument("--sleep", type=float, default=1.0, help="Seconds between configurations")
    args = parser.parse_args()

    config = load_config(args.config)

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

    total_configs = len(args.t1_values) * len(args.t2_values)
    print(f"\n{'='*70}")
    print(f"HERALD Threshold Sweep")
    print(f"Cases: {len(cases)} | Configurations: {total_configs}")
    print(f"T1 values: {args.t1_values}")
    print(f"T2 values: {args.t2_values}")
    print(f"{'='*70}\n")

    sweep_results = []
    run_idx = 0

    for t1 in args.t1_values:
        for t2 in args.t2_values:
            run_idx += 1
            print(f"[{run_idx:3d}/{total_configs}] T1={t1:.2f}, T2={t2:.2f} ... ", end="", flush=True)

            # Rebuild pipeline with new thresholds
            config["thresholds"]["T1"] = t1
            config["thresholds"]["T2"] = t2
            pipeline = build_pipeline(config)

            metrics = run_pipeline_on_cases(pipeline, cases, raw_cases)

            row = {"T1": t1, "T2": t2, **metrics}
            sweep_results.append(row)

            print(
                f"acc={metrics['accuracy']:.1%}  "
                f"T1%={metrics['tier1_rate']:.0%}  "
                f"T2%={metrics['tier2_rate']:.0%}  "
                f"T3%={metrics['tier3_rate']:.0%}  "
                f"T4%={metrics['tier4_rate']:.0%}"
            )

            time.sleep(args.sleep)

    # Save results
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w") as f:
        json.dump(sweep_results, f, indent=2)

    # Print best configuration
    best = max(sweep_results, key=lambda r: r["accuracy"])
    cheapest_accurate = min(
        [r for r in sweep_results if r["accuracy"] >= 0.8],
        key=lambda r: r["tier4_rate"],
        default=best,
    )

    print(f"\n{'='*70}")
    print(f"SWEEP COMPLETE — {len(sweep_results)} configurations")
    print(f"\nBest accuracy:  T1={best['T1']:.2f}, T2={best['T2']:.2f} → {best['accuracy']:.1%}")
    print(f"Most efficient (≥80% acc, min human review):")
    print(f"  T1={cheapest_accurate['T1']:.2f}, T2={cheapest_accurate['T2']:.2f}")
    print(f"  Accuracy={cheapest_accurate['accuracy']:.1%}, Human review={cheapest_accurate['human_review_rate']:.0%}")
    print(f"\nResults saved to {args.output}")
    print(f"\nNEXT STEP: Run notebooks/generate_plots.py to visualize the tradeoff curves.")


if __name__ == "__main__":
    main()
