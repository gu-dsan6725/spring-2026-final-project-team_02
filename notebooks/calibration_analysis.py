"""Calibration Analysis: Does HERALD's uncertainty correlate with human disagreement?

The proposal specifically requires: "Calibration analysis: Does HERALD's uncertainty
correlate with human disagreement?"

This script:
  1. Computes Expected Calibration Error (ECE) — how well confidence tracks accuracy
  2. Plots reliability diagrams (calibration curves) per tier
  3. Correlates HERALD uncertainty with case difficulty labels
  4. Generates a calibration summary table

Usage:
    uv run python notebooks/calibration_analysis.py \
        --results results/run_results.json \
        --ground-truth data/test_sets/sample_cases.json \
        --output results/calibration/
"""

import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

plt.style.use("seaborn-v0_8-whitegrid")


def expected_calibration_error(confidences: list[float], correct: list[int], n_bins: int = 10) -> float:
    """Compute ECE: weighted average of |accuracy - confidence| across bins."""
    bins = np.linspace(0, 1, n_bins + 1)
    ece = 0.0
    n = len(confidences)
    for lo, hi in zip(bins[:-1], bins[1:]):
        mask = [(lo <= c < hi) for c in confidences]
        if not any(mask):
            continue
        bin_confs = [c for c, m in zip(confidences, mask) if m]
        bin_acc = [a for a, m in zip(correct, mask) if m]
        ece += (len(bin_confs) / n) * abs(np.mean(bin_confs) - np.mean(bin_acc))
    return ece


def reliability_diagram(
    ax,
    confidences: list[float],
    correct: list[int],
    n_bins: int = 10,
    title: str = "",
    color: str = "#2563eb",
):
    """Plot reliability diagram on given axis."""
    bins = np.linspace(0, 1, n_bins + 1)
    bin_centers, bin_accs, bin_confs, bin_counts = [], [], [], []

    for lo, hi in zip(bins[:-1], bins[1:]):
        mask = [(lo <= c < hi) for c in confidences]
        if not any(mask):
            continue
        bin_c = [c for c, m in zip(confidences, mask) if m]
        bin_a = [a for a, m in zip(correct, mask) if m]
        bin_centers.append((lo + hi) / 2)
        bin_accs.append(np.mean(bin_a))
        bin_confs.append(np.mean(bin_c))
        bin_counts.append(len(bin_c))

    # Perfect calibration line
    ax.plot([0, 1], [0, 1], "k--", linewidth=1.5, label="Perfect calibration", alpha=0.6)

    # Calibration gap (shaded)
    if bin_centers:
        ax.bar(
            bin_centers, bin_accs, width=0.08, alpha=0.5, color=color,
            label="Actual accuracy", align="center"
        )
        ax.bar(
            bin_centers, bin_confs, width=0.08, alpha=0.3, color="red",
            label="Average confidence", align="center"
        )

        ece = expected_calibration_error(confidences, correct, n_bins)
        ax.set_title(f"{title}\nECE = {ece:.4f}", fontsize=11, fontweight="bold")
    else:
        ax.set_title(f"{title}\n(no data)", fontsize=11)

    ax.set_xlabel("Confidence", fontsize=10)
    ax.set_ylabel("Accuracy", fontsize=10)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.legend(fontsize=8, loc="upper left")

    # Count histogram (inset)
    ax2 = ax.inset_axes([0.6, 0.05, 0.38, 0.3])
    if bin_centers:
        ax2.bar(bin_centers, bin_counts, width=0.08, color=color, alpha=0.7)
    ax2.set_ylabel("n", fontsize=7)
    ax2.tick_params(labelsize=7)


def difficulty_calibration(results: list[dict], ground_truth: list[dict]) -> dict:
    """Check if harder cases have lower confidence (correct calibration behavior)."""
    difficulty_conf = {"easy": [], "medium": [], "hard": []}
    for r, gt in zip(results, ground_truth):
        diff = gt.get("difficulty", "medium")
        conf = r.get("tier1_confidence") or 0.5
        if diff in difficulty_conf:
            difficulty_conf[diff].append(conf)
    return {k: np.mean(v) if v else None for k, v in difficulty_conf.items()}


def main():
    parser = argparse.ArgumentParser(description="Calibration analysis for HERALD")
    parser.add_argument("--results", default="results/run_results.json")
    parser.add_argument("--ground-truth", default="data/test_sets/sample_cases.json")
    parser.add_argument("--output", default="results/calibration/")
    parser.add_argument("--bins", type=int, default=10)
    args = parser.parse_args()

    with open(args.results) as f:
        results = json.load(f)
    with open(args.ground_truth) as f:
        ground_truth = json.load(f)

    assert len(results) == len(ground_truth), "Results and ground truth must be same length"

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Build correctness labels
    def is_correct(r, gt):
        pred = r.get("final_verdict", "uncertain")
        label = gt["label"]
        return pred == label or (label == "ambiguous" and pred == "uncertain")

    correct_flags = [int(is_correct(r, gt)) for r, gt in zip(results, ground_truth)]

    print(f"\n{'='*60}")
    print("HERALD Calibration Analysis")
    print(f"Cases: {len(results)} | Overall accuracy: {sum(correct_flags)/len(correct_flags):.1%}")
    print(f"{'='*60}\n")

    # ── Per-tier calibration data ──────────────────────────────────────────
    tier_data = {
        "Tier 1": {"confs": [], "correct": []},
        "Tier 2": {"confs": [], "correct": []},
        "Tier 3": {"confs": [], "correct": []},
    }

    for r, gt, c in zip(results, ground_truth, correct_flags):
        tier = r.get("resolved_at_tier", 1)
        if tier == 1 and r.get("tier1_confidence") is not None:
            tier_data["Tier 1"]["confs"].append(r["tier1_confidence"])
            tier_data["Tier 1"]["correct"].append(c)
        elif tier == 2 and r.get("tier2_confidence") is not None:
            tier_data["Tier 2"]["confs"].append(r["tier2_confidence"])
            tier_data["Tier 2"]["correct"].append(c)
        elif tier == 3 and r.get("tier3_confidence") is not None:
            tier_data["Tier 3"]["confs"].append(r["tier3_confidence"])
            tier_data["Tier 3"]["correct"].append(c)

    # ── Reliability diagrams ───────────────────────────────────────────────
    fig, axes = plt.subplots(1, 3, figsize=(16, 5))
    colors = {"Tier 1": "#2563eb", "Tier 2": "#16a34a", "Tier 3": "#d97706"}

    for ax, (tier, data) in zip(axes, tier_data.items()):
        reliability_diagram(
            ax,
            data["confs"],
            data["correct"],
            n_bins=args.bins,
            title=f"{tier} Calibration (n={len(data['confs'])})",
            color=colors[tier],
        )

    plt.suptitle("HERALD Calibration — Reliability Diagrams by Tier", fontsize=14, fontweight="bold")
    plt.tight_layout()
    out = output_dir / "calibration_reliability.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Saved: {out}")

    # ── Difficulty vs confidence ───────────────────────────────────────────
    diff_confs = difficulty_calibration(results, ground_truth)

    fig, ax = plt.subplots(figsize=(8, 5))
    diffs = [k for k, v in diff_confs.items() if v is not None]
    confs = [diff_confs[k] for k in diffs]
    bar_colors = ["#16a34a", "#d97706", "#dc2626"]
    ax.bar(diffs, confs, color=bar_colors[:len(diffs)], alpha=0.85, width=0.5)
    for d, c in zip(diffs, confs):
        ax.text(d, c + 0.01, f"{c:.3f}", ha="center", fontsize=11, fontweight="bold")
    ax.set_ylabel("Mean Tier 1 Confidence", fontsize=12)
    ax.set_title(
        "Confidence vs. Case Difficulty\n(well-calibrated: easy > medium > hard)",
        fontsize=12, fontweight="bold"
    )
    ax.set_ylim(0, 1.1)
    ax.axhline(0.7, color="gray", linestyle="--", linewidth=1, label="T1 threshold (0.70)")
    ax.legend()

    out = output_dir / "calibration_by_difficulty.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Saved: {out}")

    # ── Uncertainty vs. correctness scatter ───────────────────────────────
    all_confs = []
    for r in results:
        conf = (
            r.get("tier3_confidence")
            or r.get("tier2_confidence")
            or r.get("tier1_confidence")
            or 0.5
        )
        all_confs.append(conf)

    fig, ax = plt.subplots(figsize=(8, 5))
    jitter = np.random.default_rng(42).uniform(-0.02, 0.02, len(correct_flags))
    ax.scatter(
        all_confs,
        [c + j for c, j in zip(correct_flags, jitter)],
        alpha=0.7, s=60,
        c=["#16a34a" if c else "#dc2626" for c in correct_flags]
    )
    ax.set_xlabel("Final Tier Confidence", fontsize=12)
    ax.set_ylabel("Correct (1) / Wrong (0)", fontsize=12)
    ax.set_title("Confidence vs. Correctness\n(well-calibrated: high conf = more correct)", fontsize=12, fontweight="bold")
    ax.set_xlim(0, 1)
    ax.set_ylim(-0.2, 1.2)

    from matplotlib.patches import Patch
    ax.legend(handles=[Patch(color="#16a34a", label="Correct"), Patch(color="#dc2626", label="Wrong")], fontsize=10)
    out = output_dir / "calibration_scatter.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Saved: {out}")

    # ── Summary table ─────────────────────────────────────────────────────
    print("\nCalibration Summary:")
    print(f"{'Tier':10s} {'n':5s} {'Mean Conf':12s} {'Accuracy':10s} {'ECE':8s}")
    print("-" * 50)
    summary = {}
    for tier, data in tier_data.items():
        if not data["confs"]:
            continue
        n = len(data["confs"])
        mean_conf = np.mean(data["confs"])
        acc = np.mean(data["correct"])
        ece = expected_calibration_error(data["confs"], data["correct"])
        print(f"{tier:10s} {n:5d} {mean_conf:12.3f} {acc:10.1%} {ece:8.4f}")
        summary[tier] = {"n": n, "mean_confidence": mean_conf, "accuracy": acc, "ece": ece}

    print("\nDifficulty → Mean T1 Confidence:")
    for d, c in diff_confs.items():
        print(f"  {d:8s}: {c:.3f}" if c is not None else f"  {d:8s}: (no data)")

    # Save JSON summary
    with open(output_dir / "calibration_summary.json", "w") as f:
        json.dump({"tier_calibration": summary, "difficulty_confidence": diff_confs}, f, indent=2)

    ece_interp = "GOOD: model is well-calibrated" if (summary and min(v["ece"] for v in summary.values()) < 0.1) else "POOR: model is miscalibrated — confidence does not track accuracy"
    print(f"\nInterpretation: {ece_interp}")
    print(f"Plots saved to {output_dir}/")


if __name__ == "__main__":
    main()
