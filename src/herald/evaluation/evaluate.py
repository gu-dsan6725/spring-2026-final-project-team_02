"""Evaluation: accuracy, escalation rates, cost, and baselines."""

import argparse
import json
from collections import defaultdict
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Evaluate HERALD results")
    parser.add_argument("--results", required=True)
    parser.add_argument("--ground-truth", required=True)
    parser.add_argument("--output", default="results/evaluation.json")
    args = parser.parse_args()

    with open(args.results) as f:
        results = json.load(f)
    with open(args.ground_truth) as f:
        gt = json.load(f)

    assert len(results) == len(gt), f"Mismatch: {len(results)} results vs {len(gt)} ground truth"

    # Accuracy
    stats = defaultdict(lambda: {"correct": 0, "total": 0})
    for r, g in zip(results, gt, strict=False):
        match = r["final_verdict"] == g["label"]
        for key in [
            "overall",
            f"cp_{r['checkpoint_type']}",
            f"tier_{r['resolved_at_tier']}",
            f"label_{g['label']}",
        ]:
            stats[key]["correct"] += int(match)
            stats[key]["total"] += 1

    # Escalation rates
    tier_counts = defaultdict(int)
    for r in results:
        tier_counts[r["resolved_at_tier"]] += 1

    # Cost (Groq = free, but track API calls for comparison)
    cost_per_tier = {1: 0.00, 2: 0.00, 3: 0.00, 4: 5.00}  # Only human costs money
    total_cost = sum(cost_per_tier.get(r["resolved_at_tier"], 0) for r in results)

    # Print
    n = len(results)
    print(f"\n{'=' * 60}")
    print("HERALD EVALUATION")
    print(f"{'=' * 60}")

    overall = stats["overall"]
    print(
        f"\nOverall: {overall['correct']}/{overall['total']} ({overall['correct'] / overall['total']:.1%})"
    )

    print("\nBy checkpoint type:")
    for k, v in sorted(stats.items()):
        if k.startswith("cp_"):
            print(f"  {k[3:]:20s} {v['correct']}/{v['total']} ({v['correct'] / v['total']:.1%})")

    print("\nBy resolving tier:")
    for k, v in sorted(stats.items()):
        if k.startswith("tier_"):
            print(
                f"  Tier {k[5:]:15s} {v['correct']}/{v['total']} ({v['correct'] / v['total']:.1%})"
            )

    print("\nEscalation rates:")
    for tier in sorted(tier_counts):
        print(f"  Tier {tier}: {tier_counts[tier]}/{n} ({tier_counts[tier] / n:.1%})")

    print("\nCost (Groq = free for Tiers 1-3):")
    print(f"  HERALD:          ${total_cost / n:.4f}/case")
    print("  LLM-judge-all:   $0.00/case (Groq free tier)")
    print("  Human-all:       $5.00/case")
    print(
        f"  HERALD advantage: {sum(1 for r in results if r['resolved_at_tier'] < 4)}/{n} cases avoided human review"
    )

    # Save
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    evaluation = {
        "accuracy": {k: {"acc": v["correct"] / v["total"], **v} for k, v in stats.items()},
        "escalation": {f"tier_{t}": {"count": c, "rate": c / n} for t, c in tier_counts.items()},
        "cost_per_case": total_cost / n,
        "human_review_rate": tier_counts.get(4, 0) / n,
    }
    with open(args.output, "w") as f:
        json.dump(evaluation, f, indent=2)
    print(f"\nSaved to {args.output}")


if __name__ == "__main__":
    main()
