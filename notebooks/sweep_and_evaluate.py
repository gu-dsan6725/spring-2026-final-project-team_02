"""Train/test threshold sweep with clean methodology.

Optimizes T1 and T2 thresholds on *train.json* only, then reports the
winning configuration's accuracy on the held-out *test.json*.  This avoids
the overfitting problem of sweeping on the same set used for final evaluation.

Steps
-----
1. Run the pipeline on train split for each (T1, T2) pair.
2. Pick the pair with the highest train accuracy (tie-break: lowest human-review rate).
3. Run the pipeline once more on the test split with the winning thresholds.
4. Print and save the final report.

Usage
-----
    # First generate the split (one-time):
    uv run herald-split

    # Then run the sweep (hits Tier 2/3 LLM APIs on train set — can be slow):
    uv run python notebooks/sweep_and_evaluate.py

    # Narrower grid for a quick sanity check:
    uv run python notebooks/sweep_and_evaluate.py \\
        --t1-values 0.65 0.70 0.75 \\
        --t2-values 0.75 0.80 0.85

    # Resume if interrupted:
    uv run python notebooks/sweep_and_evaluate.py --resume
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


# ---------------------------------------------------------------------------
# Helpers (shared with threshold_sweep.py)
# ---------------------------------------------------------------------------


def write_json_atomic(path: Path, data: object) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    tmp.replace(path)


def load_cases(path: str) -> tuple[list[CheckpointOutput], list[dict]]:
    with open(path) as f:
        raw = json.load(f)
    cases = [
        CheckpointOutput(
            checkpoint_type=CheckpointType(c["checkpoint_type"]),
            output_text=c["output_text"],
            source_context=c["source_context"],
            query=c.get("query", ""),
        )
        for c in raw
    ]
    return cases, raw


def build_pipeline(
    config: dict,
    tier1: NLIClassifier,
    t1: float,
    t2: float,
) -> HeraldPipeline:
    return HeraldPipeline(
        tier1=tier1,
        tier2=LLMJudge(config=config),
        tier3=MultiAgentDebate(config=config),
        t1_threshold=t1,
        t2_threshold=t2,
    )


def run_split(
    pipeline: HeraldPipeline,
    cases: list[CheckpointOutput],
    raw: list[dict],
    *,
    label: str = "",
    sleep: float = 0.0,
    checkpoint_path: Path | None = None,
    t1: float | None = None,
    t2: float | None = None,
    resume_results: list[dict] | None = None,
) -> dict:
    """Run pipeline over *cases* and return accuracy metrics."""
    results: list[dict] = list(resume_results or [])
    start = len(results)
    n_total = len(cases)

    for i, (cp, gt) in enumerate(zip(cases[start:], raw[start:]), start=start):
        packet = pipeline.validate(cp)
        results.append({
            "checkpoint_type": gt["checkpoint_type"],
            "resolved_at_tier": packet.resolved_at_tier,
            "final_verdict": packet.final_verdict.value if packet.final_verdict else "uncertain",
            "ground_truth": gt["label"],
        })
        if checkpoint_path and t1 is not None and t2 is not None:
            write_json_atomic(checkpoint_path, {"T1": t1, "T2": t2, "results": results})
        if sleep and i < n_total - 1:
            time.sleep(sleep)

    n = len(results)
    correct = sum(1 for r in results if r["final_verdict"] == r["ground_truth"])
    tier_counts: dict[int, int] = {}
    for r in results:
        tier_counts[r["resolved_at_tier"]] = tier_counts.get(r["resolved_at_tier"], 0) + 1

    return {
        "label": label,
        "accuracy": correct / n,
        "correct": correct,
        "total": n,
        "tier1_rate": tier_counts.get(1, 0) / n,
        "tier2_rate": tier_counts.get(2, 0) / n,
        "tier3_rate": tier_counts.get(3, 0) / n,
        "tier4_rate": tier_counts.get(4, 0) / n,
        "tier_counts": tier_counts,
        "case_results": results,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Optimize thresholds on train.json, evaluate on test.json"
    )
    parser.add_argument("--train", default="data/test_sets/train.json")
    parser.add_argument("--test", default="data/test_sets/test.json")
    parser.add_argument("--config", default="configs/default.yaml")
    parser.add_argument("--output", default="results/sweeps/train_test_sweep.json")
    parser.add_argument(
        "--t1-values", nargs="+", type=float, default=[0.60, 0.65, 0.70, 0.75, 0.80, 0.85]
    )
    parser.add_argument(
        "--t2-values", nargs="+", type=float, default=[0.70, 0.75, 0.80, 0.85, 0.90]
    )
    parser.add_argument("--sleep", type=float, default=1.0, help="Seconds between API calls")
    parser.add_argument(
        "--resume", action="store_true", help="Skip already-completed train configs"
    )
    add_llm_override_args(parser, include_tier2=True, include_tier3=True)
    args = parser.parse_args()

    config = load_config(
        args.config,
        provider=args.provider,
        tier2_model=args.tier2_model,
        tier3_model=args.tier3_model,
    )

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    checkpoint_path = output_path.with_suffix(".checkpoint.json")

    train_cases, train_raw = load_cases(args.train)
    test_cases, test_raw = load_cases(args.test)

    # Load any previously completed sweep rows
    sweep_rows: list[dict] = []
    completed: set[tuple[float, float]] = set()
    if args.resume and output_path.exists():
        with open(output_path) as f:
            saved = json.load(f)
        sweep_rows = saved.get("train_sweep", [])
        completed = {(r["T1"], r["T2"]) for r in sweep_rows}
        print(f"Resuming — {len(completed)} configs already done.")

    # Load partial checkpoint for the in-progress config
    partial: dict | None = None
    if args.resume and checkpoint_path.exists():
        with open(checkpoint_path) as f:
            partial = json.load(f)
        if partial and (partial["T1"], partial["T2"]) in completed:
            checkpoint_path.unlink(missing_ok=True)
            partial = None

    total_configs = len(args.t1_values) * len(args.t2_values)
    remaining = total_configs - len(completed)

    print(f"\n{'='*65}")
    print("HERALD Threshold Sweep  (train→test methodology)")
    print(f"{'='*65}")
    print(f"  Train : {args.train}  ({len(train_cases)} cases)")
    print(f"  Test  : {args.test}  ({len(test_cases)} cases)")
    print(f"  Grid  : {len(args.t1_values)} × {len(args.t2_values)} = {total_configs} configs ({remaining} remaining)")
    print(f"  T1    : {args.t1_values}")
    print(f"  T2    : {args.t2_values}")
    print(f"{'='*65}\n")

    # Load DeBERTa once for the whole sweep
    print("Loading Tier 1 (DeBERTa) — done once for all configs ...")
    tier1 = NLIClassifier(
        model_name=config["tier1"]["model_name"],
        device=config["tier1"].get("device", "cpu"),
    )
    print()

    run_idx = 0
    for t1_val in args.t1_values:
        for t2_val in args.t2_values:
            run_idx += 1
            if (t1_val, t2_val) in completed:
                print(
                    f"[{run_idx:3d}/{total_configs}] T1={t1_val:.2f}  T2={t2_val:.2f}  SKIPPED"
                )
                continue

            print(
                f"[{run_idx:3d}/{total_configs}] T1={t1_val:.2f}  T2={t2_val:.2f}  running train ...",
                end="",
                flush=True,
            )

            resume_results = None
            start_index = 0
            if partial and partial["T1"] == t1_val and partial["T2"] == t2_val:
                resume_results = partial.get("results", [])
                start_index = len(resume_results)
                print(f" resuming from case {start_index} ...", end="", flush=True)

            pipeline = build_pipeline(config, tier1, t1_val, t2_val)
            metrics = run_split(
                pipeline,
                train_cases,
                train_raw,
                label="train",
                sleep=args.sleep,
                checkpoint_path=checkpoint_path,
                t1=t1_val,
                t2=t2_val,
                resume_results=resume_results,
            )

            row = {
                "T1": t1_val,
                "T2": t2_val,
                "train_accuracy": metrics["accuracy"],
                "train_correct": metrics["correct"],
                "train_total": metrics["total"],
                "train_tier1_rate": metrics["tier1_rate"],
                "train_tier2_rate": metrics["tier2_rate"],
                "train_tier3_rate": metrics["tier3_rate"],
                "train_tier4_rate": metrics["tier4_rate"],
            }
            sweep_rows.append(row)
            print(
                f"  acc={metrics['accuracy']:.1%}  "
                f"T1%={metrics['tier1_rate']:.0%}  "
                f"T2%={metrics['tier2_rate']:.0%}  "
                f"T3%={metrics['tier3_rate']:.0%}"
            )

            # Persist after every config so --resume can pick up from here
            write_json_atomic(output_path, {"train_sweep": sweep_rows, "test_result": None})
            checkpoint_path.unlink(missing_ok=True)
            partial = None

    # ------------------------------------------------------------------
    # Pick the best config on train
    # ------------------------------------------------------------------
    best_row = max(
        sweep_rows,
        key=lambda r: (r["train_accuracy"], -r["train_tier4_rate"]),
    )
    best_t1 = best_row["T1"]
    best_t2 = best_row["T2"]

    print(f"\n{'='*65}")
    print("TRAIN SWEEP COMPLETE")
    print(f"  Best config: T1={best_t1:.2f}  T2={best_t2:.2f}  "
          f"train_acc={best_row['train_accuracy']:.1%}")

    # Show top-5 on train
    top5 = sorted(sweep_rows, key=lambda r: r["train_accuracy"], reverse=True)[:5]
    print("\n  Top-5 on train:")
    print(f"  {'T1':>5}  {'T2':>5}  {'acc':>7}  {'T1%':>5}  {'T2%':>5}  {'T3%':>5}")
    for r in top5:
        marker = " <-- best" if r is best_row else ""
        print(
            f"  {r['T1']:5.2f}  {r['T2']:5.2f}  "
            f"{r['train_accuracy']:7.1%}  "
            f"{r['train_tier1_rate']:5.0%}  "
            f"{r['train_tier2_rate']:5.0%}  "
            f"{r['train_tier3_rate']:5.0%}"
            f"{marker}"
        )

    # ------------------------------------------------------------------
    # Evaluate the best config on the held-out test set
    # ------------------------------------------------------------------
    print(f"\n{'='*65}")
    print(f"EVALUATING BEST CONFIG ON TEST SET  (T1={best_t1:.2f}, T2={best_t2:.2f})")
    print(f"{'='*65}")

    test_pipeline = build_pipeline(config, tier1, best_t1, best_t2)
    test_metrics = run_split(
        test_pipeline,
        test_cases,
        test_raw,
        label="test",
        sleep=args.sleep,
    )

    print(f"\n  Test accuracy : {test_metrics['accuracy']:.1%}  "
          f"({test_metrics['correct']}/{test_metrics['total']})")
    print(f"  Resolved @T1  : {test_metrics['tier1_rate']:.0%}")
    print(f"  Resolved @T2  : {test_metrics['tier2_rate']:.0%}")
    print(f"  Resolved @T3  : {test_metrics['tier3_rate']:.0%}")
    print(f"  Human review  : {test_metrics['tier4_rate']:.0%}")

    # Per-type accuracy on test
    from collections import defaultdict
    type_stats: dict[str, dict[str, int]] = defaultdict(lambda: {"correct": 0, "total": 0})
    for r in test_metrics["case_results"]:
        cp = r["checkpoint_type"]
        type_stats[cp]["total"] += 1
        if r["final_verdict"] == r["ground_truth"]:
            type_stats[cp]["correct"] += 1
    print("\n  Test accuracy by type:")
    for cp, s in sorted(type_stats.items()):
        print(f"    {cp:<22} {s['correct']}/{s['total']}  ({s['correct']/s['total']:.0%})")

    # ------------------------------------------------------------------
    # Save full report
    # ------------------------------------------------------------------
    report = {
        "methodology": (
            "Thresholds optimized on train split; test split held out for final reporting. "
            "Stratified 80/20 split by checkpoint_type, seed=42."
        ),
        "best_thresholds": {"T1": best_t1, "T2": best_t2},
        "train_sweep": sweep_rows,
        "test_result": {
            "T1": best_t1,
            "T2": best_t2,
            "accuracy": test_metrics["accuracy"],
            "correct": test_metrics["correct"],
            "total": test_metrics["total"],
            "tier1_rate": test_metrics["tier1_rate"],
            "tier2_rate": test_metrics["tier2_rate"],
            "tier3_rate": test_metrics["tier3_rate"],
            "tier4_rate": test_metrics["tier4_rate"],
            "by_type": {
                cp: {"acc": s["correct"] / s["total"], **s}
                for cp, s in type_stats.items()
            },
        },
    }
    write_json_atomic(output_path, report)
    print(f"\n  Full report saved to {output_path}")
    print(f"\n{'='*65}")
    print(f"RECOMMENDED THRESHOLDS FOR configs/default.yaml:")
    print(f"  T1: {best_t1}")
    print(f"  T2: {best_t2}")
    print(f"{'='*65}\n")


if __name__ == "__main__":
    main()
