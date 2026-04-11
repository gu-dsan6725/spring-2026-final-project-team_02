"""Sweep T1 and T2 thresholds to generate cost-accuracy tradeoff data.

Improvements over v1:
  - R8: Saves after every config — resume with --resume if rate-limited mid-run
  - R9: Loads DeBERTa once and reuses across all T1/T2 configs (5x faster)

Usage:
    uv run python notebooks/threshold_sweep.py \
        --input data/test_sets/gov_report_v1.json \
        --output results/threshold_sweep.json \
        --t1-values 0.60 0.70 0.80 \
        --t2-values 0.70 0.80 0.90
"""

import argparse
import json
import time
from pathlib import Path

from dotenv import load_dotenv

from herald.core.cli import add_llm_override_args
from herald.core.config import load_config
from herald.core.types import CheckpointOutput, CheckpointType
from herald.pipeline.escalation import HeraldPipeline
from herald.tier1.classifier import NLIClassifier
from herald.tier2.judge import LLMJudge
from herald.tier3.debate import MultiAgentDebate

load_dotenv()


def write_json_atomic(path: Path, data: object) -> None:
    """Write JSON atomically to avoid corrupting resume files on interruption."""
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with open(tmp_path, "w") as f:
        json.dump(data, f, indent=2)
    tmp_path.replace(path)


def save_partial_checkpoint(
    checkpoint_path: Path,
    t1: float,
    t2: float,
    case_results: list[dict],
) -> None:
    """Persist in-progress work for the current threshold pair."""
    write_json_atomic(
        checkpoint_path,
        {
            "T1": t1,
            "T2": t2,
            "case_results": case_results,
        },
    )


def load_partial_checkpoint(checkpoint_path: Path) -> dict | None:
    """Load the in-progress threshold pair checkpoint if it exists."""
    if not checkpoint_path.exists():
        return None
    with open(checkpoint_path) as f:
        return json.load(f)


def build_pipeline_reuse_tier1(
    config: dict,
    tier1: NLIClassifier,
    t1: float,
    t2: float,
) -> HeraldPipeline:
    """Build pipeline reusing a pre-loaded Tier 1 classifier (R9)."""
    tier2 = LLMJudge(config=config)
    tier3 = MultiAgentDebate(config=config)
    return HeraldPipeline(tier1=tier1, tier2=tier2, tier3=tier3, t1_threshold=t1, t2_threshold=t2)


def run_pipeline_on_cases(
    pipeline: HeraldPipeline,
    cases: list[CheckpointOutput],
    ground_truth: list[dict],
    *,
    start_index: int = 0,
    prior_results: list[dict] | None = None,
    checkpoint_path: Path | None = None,
    t1: float | None = None,
    t2: float | None = None,
) -> dict:
    results = list(prior_results or [])
    for cp, gt in zip(cases[start_index:], ground_truth[start_index:]):
        packet = pipeline.validate(cp)
        results.append({
            "resolved_at_tier": packet.resolved_at_tier,
            "final_verdict": packet.final_verdict.value if packet.final_verdict else "uncertain",
            "ground_truth": gt["label"],
        })
        if checkpoint_path is not None and t1 is not None and t2 is not None:
            save_partial_checkpoint(checkpoint_path, t1, t2, results)

    n = len(results)
    correct = sum(
        1 for r in results
        if r["final_verdict"] == r["ground_truth"]
        or (r["ground_truth"] == "ambiguous" and r["final_verdict"] == "uncertain")
    )
    tier_counts = {1: 0, 2: 0, 3: 0, 4: 0}
    for r in results:
        tier_counts[r["resolved_at_tier"]] = tier_counts.get(r["resolved_at_tier"], 0) + 1

    return {
        "accuracy": correct / n,
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
    parser.add_argument("--t1-values", nargs="+", type=float, default=[0.50, 0.60, 0.70, 0.80, 0.90])
    parser.add_argument("--t2-values", nargs="+", type=float, default=[0.50, 0.60, 0.70, 0.80, 0.90])
    parser.add_argument("--sleep", type=float, default=1.0)
    parser.add_argument("--resume", action="store_true", help="Skip already-completed configs (R8)")
    add_llm_override_args(parser, include_tier2=True, include_tier3=True)
    args = parser.parse_args()

    config = load_config(
        args.config,
        provider=args.provider,
        tier2_model=args.tier2_model,
        tier3_model=args.tier3_model,
    )
    output_path = Path(args.output)
    checkpoint_path = output_path.with_suffix(output_path.suffix + ".checkpoint.json")
    output_path.parent.mkdir(parents=True, exist_ok=True)

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

    # R8: Load existing results for resume
    sweep_results = []
    completed = set()
    if args.resume and output_path.exists():
        with open(output_path) as f:
            sweep_results = json.load(f)
        completed = {(r["T1"], r["T2"]) for r in sweep_results}
        print(f"Resuming: {len(completed)} configs already done, skipping them.")

    partial = load_partial_checkpoint(checkpoint_path) if args.resume else None
    if partial and (partial["T1"], partial["T2"]) in completed:
        checkpoint_path.unlink(missing_ok=True)
        partial = None

    total_configs = len(args.t1_values) * len(args.t2_values)
    remaining = total_configs - len(completed)

    print(f"\n{'='*70}")
    print(f"HERALD Threshold Sweep")
    print(f"Cases: {len(cases)} | Configurations: {total_configs} ({remaining} remaining)")
    print(f"T1 values: {args.t1_values}")
    print(f"T2 values: {args.t2_values}")
    print(f"DeBERTa loaded ONCE and reused across all configs (R9)")
    print(f"{'='*70}\n")

    # R9: Load DeBERTa once for all configs
    print("Loading Tier 1 classifier (once for all configs)...")
    tier1 = NLIClassifier(
        model_name=config["tier1"]["model_name"],
        device=config["tier1"].get("device", "cpu"),
    )
    print()

    run_idx = 0
    for t1 in args.t1_values:
        for t2 in args.t2_values:
            run_idx += 1

            if (t1, t2) in completed:
                print(f"[{run_idx:3d}/{total_configs}] T1={t1:.2f}, T2={t2:.2f} ... SKIPPED (already done)")
                continue

            print(f"[{run_idx:3d}/{total_configs}] T1={t1:.2f}, T2={t2:.2f} ... ", end="", flush=True)

            pipeline = build_pipeline_reuse_tier1(config, tier1, t1, t2)
            start_index = 0
            prior_results = None
            if partial and partial["T1"] == t1 and partial["T2"] == t2:
                prior_results = partial.get("case_results", [])
                start_index = len(prior_results)
                print(f"RESUMING case {start_index + 1}/{len(cases)} ... ", end="", flush=True)

            metrics = run_pipeline_on_cases(
                pipeline,
                cases,
                raw_cases,
                start_index=start_index,
                prior_results=prior_results,
                checkpoint_path=checkpoint_path,
                t1=t1,
                t2=t2,
            )
            row = {"T1": t1, "T2": t2, **metrics}
            sweep_results.append(row)

            print(
                f"acc={metrics['accuracy']:.1%}  "
                f"T1%={metrics['tier1_rate']:.0%}  "
                f"T2%={metrics['tier2_rate']:.0%}  "
                f"T3%={metrics['tier3_rate']:.0%}  "
                f"T4%={metrics['tier4_rate']:.0%}"
            )

            # R8: Save after every config
            write_json_atomic(output_path, sweep_results)
            checkpoint_path.unlink(missing_ok=True)
            partial = None

            time.sleep(args.sleep)

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
    print(f"\nResults saved to {output_path}")
    print(f"\nNEXT STEP: Run notebooks/generate_plots.py to visualize the tradeoff curves.")


if __name__ == "__main__":
    main()
