"""Evaluation: accuracy, escalation rates, cost, and baselines."""

import argparse
import json
import os
from collections import defaultdict
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Evaluate HERALD results")
    parser.add_argument("--results", required=True)
    parser.add_argument("--ground-truth", required=True)
    parser.add_argument("--output", default="results/evaluation.json")
    parser.add_argument(
        "--experiment",
        default=None,
        help=(
            "Braintrust experiment name (e.g. 'run_07_govreport_v2'). "
            "If omitted, defaults to the stem of --output. "
            "Requires BRAINTRUST_API_KEY env var."
        ),
    )
    parser.add_argument(
        "--split",
        choices=["train", "test"],
        default=None,
        help=(
            "When --ground-truth is the full dataset and --results was produced "
            "on a split, pass the path to the same split file via --ground-truth "
            "instead.  This flag is informational only — it adds a 'split' key to "
            "the saved JSON so results files are self-documenting."
        ),
    )
    args = parser.parse_args()

    with open(args.results) as f:
        results = json.load(f)
    with open(args.ground_truth) as f:
        gt = json.load(f)

    assert len(results) == len(gt), (
        f"Mismatch: {len(results)} results vs {len(gt)} ground truth entries. "
        "Make sure --ground-truth points to the same split that was used for the run "
        "(e.g. data/test_sets/test.json), not the full dataset."
    )

    # Braintrust experiment logger — no-op if BRAINTRUST_API_KEY is not set
    from herald.core.telemetry import BraintrustLogger

    experiment_name = args.experiment or Path(args.output).stem
    bt = BraintrustLogger(experiment_name=experiment_name)

    # Accuracy + Braintrust logging
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

        # Log each case to Braintrust
        bt.log_case(
            input={
                "checkpoint_type": r.get("checkpoint_type"),
                "output_text": g.get("output_text", "")[:500],
                "source_context": g.get("source_context", "")[:500],
            },
            output=r["final_verdict"],
            expected=g["label"],
            metadata={
                "resolved_at_tier": r.get("resolved_at_tier"),
                "tier1_confidence": r.get("tier1_confidence"),
                "tier2_confidence": r.get("tier2_confidence"),
                "tier3_confidence": r.get("tier3_confidence"),
            },
        )

    # Escalation rates
    tier_counts = defaultdict(int)
    for r in results:
        tier_counts[r["resolved_at_tier"]] += 1

    # Cost (Groq = free, but track API calls for comparison)
    cost_per_tier = {1: 0.00, 2: 0.00, 3: 0.00, 4: 5.00}  # Only human costs money
    total_cost = sum(cost_per_tier.get(r["resolved_at_tier"], 0) for r in results)

    # LLM call and token tracking
    total_llm_calls = sum(r.get("llm_calls", 0) for r in results)
    total_input_tokens = sum(r.get("input_tokens", 0) for r in results)
    total_output_tokens = sum(r.get("output_tokens", 0) for r in results)
    has_token_data = total_input_tokens > 0 or total_output_tokens > 0

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

    t1_count = tier_counts.get(1, 0)
    t2_count = tier_counts.get(2, 0)
    t3_count = tier_counts.get(3, 0)
    t4_count = tier_counts.get(4, 0)

    print("\nEscalation rates:")
    print(f"  Cases resolved at T1 (zero LLM cost): {t1_count:3d}/{n} ({t1_count / n:.1%})")
    print(f"  Cases resolved at T2 (1 LLM call):    {t2_count:3d}/{n} ({t2_count / n:.1%})")
    print(f"  Cases escalated to T3 (3+ LLM calls): {t3_count:3d}/{n} ({t3_count / n:.1%})")
    if t4_count:
        print(f"  Cases sent to T4 (human review):       {t4_count:3d}/{n} ({t4_count / n:.1%})")

    print("\nLLM cost summary:")
    print(f"  Average LLM calls per case:   {total_llm_calls / n:.2f}")
    print(f"  Total LLM calls (HERALD):     {total_llm_calls}")
    print(f"  Baseline — judge-all:         {n} calls  ({n / max(total_llm_calls, 1):.1f}x HERALD)")
    print(f"  Baseline — debate-all:        {n * 3} calls  ({n * 3 / max(total_llm_calls, 1):.1f}x HERALD)")
    if has_token_data:
        total_tokens = total_input_tokens + total_output_tokens
        print(f"  Total tokens used:            {total_tokens:,}  (in={total_input_tokens:,}, out={total_output_tokens:,})")
        print(f"  Average tokens per case:      {total_tokens / n:,.0f}")
    else:
        print("  (Token counts not in this results file — rerun pipeline to collect)")

    print("\nHuman review cost:")
    print(f"  HERALD:          ${total_cost / n:.4f}/case")
    print("  LLM-judge-all:   $0.00/case (free tier)")
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
        "llm_cost": {
            "total_llm_calls": total_llm_calls,
            "avg_llm_calls_per_case": round(total_llm_calls / n, 3),
            "total_input_tokens": total_input_tokens,
            "total_output_tokens": total_output_tokens,
            "total_tokens": total_input_tokens + total_output_tokens,
            "avg_tokens_per_case": round((total_input_tokens + total_output_tokens) / n, 1),
            "baseline_judge_all_calls": n,
            "baseline_debate_all_calls": n * 3,
            "call_reduction_vs_judge_all": round(
                1 - total_llm_calls / max(n, 1), 3
            ),
            "call_reduction_vs_debate_all": round(
                1 - total_llm_calls / max(n * 3, 1), 3
            ),
        },
        "split": args.split,  # "train", "test", or None (full dataset)
    }
    with open(args.output, "w") as f:
        json.dump(evaluation, f, indent=2)
    print(f"\nSaved to {args.output}")

    bt.flush()


if __name__ == "__main__":
    main()
