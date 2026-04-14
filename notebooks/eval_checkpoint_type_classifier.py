"""Evaluate RuleBasedClassifier vs LLMClassifier on the labeled test set.

Usage:
    uv run python notebooks/eval_checkpoint_type_classifier.py
    uv run python notebooks/eval_checkpoint_type_classifier.py --input data/test_sets/gov_report_v2_filtered.json
    uv run python notebooks/eval_checkpoint_type_classifier.py --methods rule_based llm
    uv run python notebooks/eval_checkpoint_type_classifier.py --output results/misc/classifier_eval.json

The script:
  1. Loads a labeled test set (each case has a ground-truth checkpoint_type)
  2. Runs both classifiers on every case
  3. Prints a per-type and overall accuracy table
  4. Optionally saves results JSON for downstream analysis
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import time
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def load_cases(path: str) -> list[dict]:
    with open(path) as f:
        cases = json.load(f)
    # Keep only cases with a known, non-ambiguous checkpoint_type
    valid_types = {"retrieval", "claim_extraction", "synthesis", "numerical", "causal", "epistemic"}
    return [c for c in cases if c.get("checkpoint_type") in valid_types]


def run_classifier(classifier, cases: list[dict]) -> list[dict]:
    """Run a classifier over all cases, return list of per-case dicts."""
    results = []
    for c in cases:
        start = time.perf_counter()
        cr = classifier.classify(
            output_text=c["output_text"],
            query=c.get("query", ""),
        )
        elapsed = time.perf_counter() - start
        results.append(
            {
                "ground_truth": c["checkpoint_type"],
                "predicted": cr.checkpoint_type.value,
                "correct": cr.checkpoint_type.value == c["checkpoint_type"],
                "confidence": round(cr.confidence, 3),
                "rationale": cr.rationale,
                "method": cr.method,
                "latency_s": round(elapsed, 3),
                "output_text": c["output_text"][:120],
                "query": c.get("query", "")[:80],
            }
        )
    return results


def compute_metrics(results: list[dict]) -> dict:
    """Overall accuracy + per-type precision/recall/support."""
    total = len(results)
    correct = sum(1 for r in results if r["correct"])

    # Per-type counts
    tp: dict[str, int] = defaultdict(int)  # predicted == truth == type
    fp: dict[str, int] = defaultdict(int)  # predicted == type, truth != type
    fn: dict[str, int] = defaultdict(int)  # truth == type, predicted != type

    all_types = sorted({r["ground_truth"] for r in results})

    for r in results:
        gt = r["ground_truth"]
        pred = r["predicted"]
        if pred == gt:
            tp[gt] += 1
        else:
            fp[pred] += 1
            fn[gt] += 1

    per_type = {}
    for t in all_types:
        support = tp[t] + fn[t]
        precision = tp[t] / (tp[t] + fp[t]) if (tp[t] + fp[t]) > 0 else 0.0
        recall = tp[t] / support if support > 0 else 0.0
        per_type[t] = {
            "support": support,
            "tp": tp[t],
            "fp": fp[t],
            "fn": fn[t],
            "precision": round(precision, 3),
            "recall": round(recall, 3),
        }

    avg_latency = sum(r["latency_s"] for r in results) / total if total else 0

    return {
        "overall_accuracy": round(correct / total, 4) if total else 0,
        "n_correct": correct,
        "n_total": total,
        "avg_latency_s": round(avg_latency, 3),
        "per_type": per_type,
    }


def print_report(method: str, metrics: dict, results: list[dict]) -> None:
    print(f"\n{'=' * 65}")
    print(f"  {method.upper().replace('_', ' ')} CLASSIFIER")
    print(f"{'=' * 65}")
    print(
        f"  Overall accuracy : {metrics['overall_accuracy']:.1%}  "
        f"({metrics['n_correct']}/{metrics['n_total']})"
    )
    print(f"  Avg latency      : {metrics['avg_latency_s']:.3f}s per case")

    print(f"\n  {'Type':<22} {'Support':>7} {'Precision':>10} {'Recall':>8}")
    print(f"  {'-' * 50}")
    for t, m in sorted(metrics["per_type"].items()):
        print(f"  {t:<22} {m['support']:>7}    {m['precision']:>7.1%}   {m['recall']:>7.1%}")

    # Show misclassified cases
    errors = [r for r in results if not r["correct"]]
    if errors:
        print(f"\n  Misclassifications ({len(errors)}):")
        for r in errors[:15]:  # cap at 15 for readability
            print(
                f"    GT={r['ground_truth']:<20} PRED={r['predicted']:<20} "
                f"conf={r['confidence']:.2f}"
            )
            print(f"      Q: {r['query'][:70]}")
            print(f"      O: {r['output_text'][:70]}")
        if len(errors) > 15:
            print(f"    ... and {len(errors) - 15} more")


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate checkpoint type classifiers")
    parser.add_argument(
        "--input",
        default="data/test_sets/gov_report_v2_filtered.json",
        help="Labeled test set JSON",
    )
    parser.add_argument(
        "--methods",
        nargs="+",
        choices=["rule_based", "llm"],
        default=["rule_based", "llm"],
        help="Which classifiers to run (default: both)",
    )
    parser.add_argument(
        "--llm-model",
        default=None,
        help="Override LLM model for the LLM classifier (e.g. gemini-2.0-flash)",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Optional path to save results JSON",
    )
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.WARNING)

    cases = load_cases(args.input)
    print(f"Loaded {len(cases)} labeled cases from {args.input}")

    from herald.routing.checkpoint_type_classifier import get_classifier

    # Load config only if LLM classifier is needed
    config = None
    if "llm" in args.methods:
        import yaml

        config_path = os.environ.get("HERALD_CONFIG", "configs/default.yaml")
        with open(config_path) as f:
            config = yaml.safe_load(f)

    all_metrics: dict[str, dict] = {}
    all_results: dict[str, list] = {}

    for method in args.methods:
        print(f"\nRunning {method} classifier on {len(cases)} cases...")
        kwargs = {}
        if method == "llm":
            kwargs["config"] = config
            if args.llm_model:
                kwargs["model"] = args.llm_model
        clf = get_classifier(method=method, **kwargs)

        results = run_classifier(clf, cases)
        metrics = compute_metrics(results)
        print_report(method, metrics, results)
        all_metrics[method] = metrics
        all_results[method] = results

    # Side-by-side summary
    if len(args.methods) > 1:
        print(f"\n{'=' * 65}")
        print("  COMPARISON SUMMARY")
        print(f"{'=' * 65}")
        print(f"  {'Method':<20} {'Accuracy':>10} {'Avg Latency':>13}")
        print(f"  {'-' * 45}")
        for method in args.methods:
            m = all_metrics[method]
            print(f"  {method:<20} {m['overall_accuracy']:>9.1%}   {m['avg_latency_s']:>10.3f}s")

    if args.output:
        out = {
            "input": args.input,
            "n_cases": len(cases),
            "metrics": all_metrics,
        }
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        with open(args.output, "w") as f:
            json.dump(out, f, indent=2)
        print(f"\nResults saved to {args.output}")


if __name__ == "__main__":
    main()
