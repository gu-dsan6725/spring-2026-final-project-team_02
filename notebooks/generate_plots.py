"""Phase 4, Step 13: Generate all analysis plots.

Produces the four key deliverable plots from the walkthrough:
  1. Cost-accuracy tradeoff curve (from threshold sweep results)
  2. Escalation profile by checkpoint type (from pipeline run results)
  3. 3-tier vs 4-tier comparison (from baseline comparison results)
  4. Confusion analysis — where HERALD disagrees with humans

Usage:
    uv run python notebooks/generate_plots.py \
        --sweep results/threshold_sweep.json \
        --results results/run_results.json \
        --ground-truth data/test_sets/sample_cases.json \
        --baseline results/baseline_comparison.json \
        --output results/plots/

All plots are saved as PNG files in the output directory.
"""

import argparse
import json
from collections import defaultdict
from pathlib import Path

import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import numpy as np

# Use a clean non-interactive backend
plt.style.use("seaborn-v0_8-whitegrid")
COLORS = {
    "tier1": "#2563eb",
    "tier2": "#16a34a",
    "tier3": "#d97706",
    "tier4": "#dc2626",
    "herald": "#7c3aed",
    "baseline": "#6b7280",
}


# ─── Plot 1: Cost-Accuracy Tradeoff Curve ────────────────────────────────────


def plot_tradeoff_curve(sweep_data: list[dict], output_dir: Path) -> None:
    """Accuracy vs. human review rate across all T1/T2 configurations."""
    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    # Panel A: accuracy vs human review rate, colored by T1
    ax = axes[0]
    t1_values = sorted({r["T1"] for r in sweep_data})
    cmap = plt.cm.get_cmap("viridis", len(t1_values))

    for idx, t1 in enumerate(t1_values):
        subset = [r for r in sweep_data if r["T1"] == t1]
        subset = sorted(subset, key=lambda r: r["T2"])
        x = [r["human_review_rate"] for r in subset]
        y = [r["accuracy"] for r in subset]
        ax.plot(x, y, "o-", color=cmap(idx), label=f"T1={t1:.2f}", linewidth=2, markersize=6)

    ax.set_xlabel("Human Review Rate (Tier 4)", fontsize=12)
    ax.set_ylabel("Accuracy", fontsize=12)
    ax.set_title("Cost-Accuracy Tradeoff by T1 Threshold", fontsize=13, fontweight="bold")
    ax.legend(title="T1 Threshold", fontsize=9)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda y, _: f"{y:.0%}"))
    ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f"{x:.0%}"))

    # Panel B: accuracy vs tier1 resolution rate (automation rate)
    ax = axes[1]
    t2_values = sorted({r["T2"] for r in sweep_data})
    cmap2 = plt.cm.get_cmap("plasma", len(t2_values))

    for idx, t2 in enumerate(t2_values):
        subset = [r for r in sweep_data if r["T2"] == t2]
        subset = sorted(subset, key=lambda r: r["T1"])
        x = [r["tier1_rate"] for r in subset]
        y = [r["accuracy"] for r in subset]
        ax.plot(x, y, "s-", color=cmap2(idx), label=f"T2={t2:.2f}", linewidth=2, markersize=6)

    ax.set_xlabel("Tier 1 Resolution Rate (Automation Rate)", fontsize=12)
    ax.set_ylabel("Accuracy", fontsize=12)
    ax.set_title("Automation vs. Accuracy by T2 Threshold", fontsize=13, fontweight="bold")
    ax.legend(title="T2 Threshold", fontsize=9)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda y, _: f"{y:.0%}"))
    ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f"{x:.0%}"))

    plt.tight_layout()
    out = output_dir / "plot1_tradeoff_curve.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Saved: {out}")


# ─── Plot 2: Escalation Profile by Checkpoint Type ───────────────────────────


def plot_escalation_profile(results: list[dict], output_dir: Path) -> None:
    """Stacked bar: what % of each CP type resolves at each tier."""
    cp_types = sorted({r["checkpoint_type"] for r in results})
    tiers = [1, 2, 3, 4]

    # Count resolutions per (cp_type, tier)
    counts = defaultdict(lambda: defaultdict(int))
    totals = defaultdict(int)
    for r in results:
        counts[r["checkpoint_type"]][r["resolved_at_tier"]] += 1
        totals[r["checkpoint_type"]] += 1

    # Convert to percentages
    data = {tier: [] for tier in tiers}
    for cp in cp_types:
        n = totals[cp]
        for tier in tiers:
            data[tier].append(counts[cp][tier] / n if n > 0 else 0)

    x = np.arange(len(cp_types))
    width = 0.6
    bottom = np.zeros(len(cp_types))

    fig, ax = plt.subplots(figsize=(12, 6))
    tier_colors = [COLORS["tier1"], COLORS["tier2"], COLORS["tier3"], COLORS["tier4"]]
    tier_labels = ["Tier 1 (NLI)", "Tier 2 (LLM Judge)", "Tier 3 (Debate)", "Tier 4 (Human)"]

    for tier, color, label in zip(tiers, tier_colors, tier_labels, strict=False):
        vals = np.array(data[tier])
        bars = ax.bar(x, vals, width, bottom=bottom, color=color, label=label, alpha=0.85)
        for bar, val in zip(bars, vals, strict=False):
            if val > 0.05:
                ax.text(
                    bar.get_x() + bar.get_width() / 2,
                    bar.get_y() + bar.get_height() / 2,
                    f"{val:.0%}",
                    ha="center",
                    va="center",
                    fontsize=9,
                    fontweight="bold",
                    color="white",
                )
        bottom += vals

    ax.set_xticks(x)
    ax.set_xticklabels([cp.replace("_", "\n") for cp in cp_types], fontsize=10)
    ax.set_ylabel("Fraction of Cases", fontsize=12)
    ax.set_title("Escalation Profile by Checkpoint Type", fontsize=13, fontweight="bold")
    ax.legend(loc="upper right", fontsize=10)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda y, _: f"{y:.0%}"))
    ax.set_ylim(0, 1.05)

    plt.tight_layout()
    out = output_dir / "plot2_escalation_profile.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Saved: {out}")


# ─── Plot 3: HERALD vs Baselines ─────────────────────────────────────────────


def _build_summary_from_raw(baseline_data: dict) -> dict:
    """Derive a summary dict from raw_results + ground_truth_labels if no summary key exists."""
    raw = baseline_data.get("raw_results", {})
    gt_labels = baseline_data.get("ground_truth_labels", [])
    if not raw or not gt_labels:
        return {}
    summary = {}
    for system, results in raw.items():
        correct = sum(
            1
            for r, label in zip(results, gt_labels, strict=False)
            if r.get("final_verdict") == label and label in ("valid", "invalid")
        )
        total = sum(1 for label in gt_labels if label in ("valid", "invalid"))
        human_review = (
            sum(1 for r in results if r.get("final_verdict") == "uncertain") / len(results)
            if results
            else 0
        )
        summary[system] = {
            "accuracy": correct / total if total else 0,
            "human_review_rate": human_review,
        }
    return summary


def plot_baseline_comparison(
    baseline_data: dict,
    herald_results: list[dict] | None,
    ground_truth: list[dict] | None,
    output_dir: Path,
) -> None:
    """Bar chart comparing accuracy and human review rate across systems."""
    summary = baseline_data.get("summary", {})
    if not summary:
        summary = _build_summary_from_raw(baseline_data)
    if not summary:
        print("No baseline summary data — skipping Plot 3.")
        return

    # Inject HERALD stats computed from actual run results
    if herald_results and ground_truth:
        gt_labels = [gt["label"] for gt in ground_truth]
        correct = sum(
            1
            for r, label in zip(herald_results, gt_labels, strict=False)
            if r.get("final_verdict") == label and label in ("valid", "invalid")
        )
        total = sum(1 for label in gt_labels if label in ("valid", "invalid"))
        human_rate = (
            sum(1 for r in herald_results if r.get("resolved_at_tier", 0) >= 4)
            / len(herald_results)
            if herald_results
            else 0
        )
        summary["herald"] = {
            "accuracy": correct / total if total else 0,
            "human_review_rate": human_rate,
        }

    system_labels = {
        "herald": "HERALD\n(4-tier)",
        "llm_judge_all": "LLM Judge\n(no NLI)",
        "nli_only": "NLI Only\n(no escalation)",
        "three_tier_no_debate": "3-Tier\n(no debate)",
        "random_escalation": "Random\nEscalation",
    }
    systems = [k for k in system_labels if k in summary]
    labels = [system_labels[s] for s in systems]
    accuracies = [summary[s]["accuracy"] for s in systems]
    human_rates = [summary[s]["human_review_rate"] for s in systems]

    # Compute per-class recall from raw_results or herald_results
    raw = baseline_data.get("raw_results", {})
    gt_labels_list = baseline_data.get("ground_truth_labels", [])
    valid_recalls: list[float] = []
    invalid_recalls: list[float] = []
    for s in systems:
        if s == "herald" and herald_results and ground_truth:
            preds = [r.get("final_verdict") for r in herald_results]
            true = [gt["label"] for gt in ground_truth]
        elif s in raw and gt_labels_list:
            preds = [r.get("final_verdict") for r in raw[s]]
            true = gt_labels_list
        else:
            valid_recalls.append(0)
            invalid_recalls.append(0)
            continue
        n_valid = sum(1 for t in true if t == "valid")
        n_invalid = sum(1 for t in true if t == "invalid")
        tp_valid = sum(
            1 for p, t in zip(preds, true, strict=False) if t == "valid" and p == "valid"
        )
        tp_invalid = sum(
            1 for p, t in zip(preds, true, strict=False) if t == "invalid" and p == "invalid"
        )
        valid_recalls.append(tp_valid / n_valid if n_valid else 0)
        invalid_recalls.append(tp_invalid / n_invalid if n_invalid else 0)

    x = np.arange(len(systems))
    width = 0.35

    fig, axes = plt.subplots(1, 3, figsize=(18, 6))

    bar_colors = [COLORS["herald"] if s == "herald" else COLORS["baseline"] for s in systems]

    # Panel A: Accuracy
    ax = axes[0]
    bars = ax.bar(x, accuracies, width * 1.5, color=bar_colors, alpha=0.85)
    for bar, val in zip(bars, accuracies, strict=False):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 0.01,
            f"{val:.1%}",
            ha="center",
            fontsize=10,
            fontweight="bold",
        )
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=10)
    ax.set_ylabel("Accuracy", fontsize=12)
    ax.set_ylim(0, 1.15)
    ax.set_title("Overall Accuracy by System", fontsize=13, fontweight="bold")
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda y, _: f"{y:.0%}"))

    # Panel B: Per-class recall (grouped bars)
    ax = axes[1]
    xv = x - width / 2
    xi = x + width / 2
    bars_v = ax.bar(xv, valid_recalls, width, color="#2563eb", alpha=0.85, label="Valid recall")
    bars_i = ax.bar(xi, invalid_recalls, width, color="#dc2626", alpha=0.85, label="Invalid recall")
    for bar, val in zip(bars_v, valid_recalls, strict=False):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 0.01,
            f"{val:.0%}",
            ha="center",
            fontsize=8,
            fontweight="bold",
        )
    for bar, val in zip(bars_i, invalid_recalls, strict=False):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 0.01,
            f"{val:.0%}",
            ha="center",
            fontsize=8,
            fontweight="bold",
        )
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=10)
    ax.set_ylabel("Recall", fontsize=12)
    ax.set_ylim(0, 1.15)
    ax.set_title("Per-Class Recall by System", fontsize=13, fontweight="bold")
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda y, _: f"{y:.0%}"))
    ax.legend(fontsize=10)

    # Panel C: Human review rate
    ax = axes[2]
    bars = ax.bar(x, human_rates, width * 1.5, color=bar_colors, alpha=0.85)
    for bar, val in zip(bars, human_rates, strict=False):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 0.005,
            f"{val:.0%}",
            ha="center",
            fontsize=10,
            fontweight="bold",
        )
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=10)
    ax.set_ylabel("Human Review Rate", fontsize=12)
    ax.set_ylim(0, 1.15)
    ax.set_title("Human Review Rate by System", fontsize=13, fontweight="bold")
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda y, _: f"{y:.0%}"))

    herald_patch = mpatches.Patch(color=COLORS["herald"], label="HERALD")
    baseline_patch = mpatches.Patch(color=COLORS["baseline"], label="Baseline")
    fig.legend(handles=[herald_patch, baseline_patch], loc="upper center", ncol=2, fontsize=10)

    plt.tight_layout(rect=[0, 0, 1, 0.93])
    out = output_dir / "plot3_baseline_comparison.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Saved: {out}")


# ─── Plot 4: Confusion Analysis ──────────────────────────────────────────────


def plot_confusion_analysis(
    results: list[dict], ground_truth: list[dict], output_dir: Path
) -> None:
    """Where does HERALD disagree with human labels?"""
    label_to_idx = {"valid": 0, "invalid": 1, "uncertain": 2, "ambiguous": 2}

    # Build confusion matrix
    cm = np.zeros((3, 3), dtype=int)
    for r, gt in zip(results, ground_truth, strict=False):
        pred = r.get("final_verdict", "uncertain")
        true = gt["label"]
        pred_idx = label_to_idx.get(pred, 2)
        true_idx = label_to_idx.get(true, 2)
        cm[true_idx][pred_idx] += 1

    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    # Panel A: Normalized confusion matrix
    ax = axes[0]
    with np.errstate(invalid="ignore"):
        cm_norm = cm.astype(float) / cm.sum(axis=1, keepdims=True)
        cm_norm = np.nan_to_num(cm_norm)

    im = ax.imshow(cm_norm, cmap="Blues", vmin=0, vmax=1)
    plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    ax.set_xticks(range(3))
    ax.set_yticks(range(3))
    ax.set_xticklabels(["Pred: valid", "Pred: invalid", "Pred: uncertain"], fontsize=10)
    ax.set_yticklabels(["GT: valid", "GT: invalid", "GT: ambiguous"], fontsize=10)
    ax.set_title(
        "Normalized Confusion Matrix\n(HERALD vs. Human Labels)", fontsize=12, fontweight="bold"
    )
    for i in range(3):
        for j in range(3):
            val = cm_norm[i, j]
            color = "white" if val > 0.5 else "black"
            ax.text(
                j,
                i,
                f"{val:.0%}\n(n={cm[i, j]})",
                ha="center",
                va="center",
                fontsize=10,
                color=color,
                fontweight="bold",
            )

    # Panel B: Error breakdown by checkpoint type
    ax = axes[1]
    cp_types = sorted({gt["checkpoint_type"] for gt in ground_truth})
    error_rates = []
    for cp in cp_types:
        cp_results = [
            (r, gt)
            for r, gt in zip(results, ground_truth, strict=False)
            if gt["checkpoint_type"] == cp
        ]
        if not cp_results:
            error_rates.append(0)
            continue
        errors = sum(
            1
            for r, gt in cp_results
            if r.get("final_verdict") != gt["label"]
            and not (gt["label"] == "ambiguous" and r.get("final_verdict") == "uncertain")
        )
        error_rates.append(errors / len(cp_results))

    bar_colors = plt.cm.RdYlGn_r(np.array(error_rates))
    bars = ax.barh(
        [cp.replace("_", " ") for cp in cp_types], error_rates, color=bar_colors, alpha=0.85
    )
    for bar, rate in zip(bars, error_rates, strict=False):
        ax.text(
            bar.get_width() + 0.01,
            bar.get_y() + bar.get_height() / 2,
            f"{rate:.0%}",
            va="center",
            fontsize=10,
            fontweight="bold",
        )
    ax.set_xlabel("Error Rate", fontsize=12)
    ax.set_title("Error Rate by Checkpoint Type", fontsize=12, fontweight="bold")
    ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f"{x:.0%}"))
    ax.set_xlim(0, 1.1)

    plt.tight_layout()
    out = output_dir / "plot4_confusion_analysis.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Saved: {out}")


# ─── Main ─────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="Generate HERALD analysis plots")
    parser.add_argument(
        "--sweep", default="results/threshold_sweep.json", help="Threshold sweep results"
    )
    parser.add_argument(
        "--results", default="results/run_results.json", help="Pipeline run results"
    )
    parser.add_argument("--ground-truth", default="data/test_sets/sample_cases.json")
    parser.add_argument("--baseline", default="results/baseline_comparison.json")
    parser.add_argument("--output", default="results/plots/")
    args = parser.parse_args()

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'=' * 60}")
    print("HERALD — Generating Analysis Plots")
    print(f"Output: {output_dir}")
    print(f"{'=' * 60}\n")

    # Plot 1: Tradeoff curve
    sweep_path = Path(args.sweep)
    if sweep_path.exists():
        with open(sweep_path) as f:
            sweep_data = json.load(f)
        print("Plot 1: Cost-Accuracy Tradeoff Curve")
        plot_tradeoff_curve(sweep_data, output_dir)
    else:
        print(f"SKIP Plot 1: {args.sweep} not found. Run notebooks/threshold_sweep.py first.")

    # Load run results + ground truth for plots 2 and 4
    results_path = Path(args.results)
    gt_path = Path(args.ground_truth)
    results, ground_truth = None, None

    if results_path.exists() and gt_path.exists():
        with open(results_path) as f:
            results = json.load(f)
        with open(gt_path) as f:
            ground_truth = json.load(f)

        print("Plot 2: Escalation Profile by Checkpoint Type")
        plot_escalation_profile(results, output_dir)

        print("Plot 4: Confusion Analysis")
        plot_confusion_analysis(results, ground_truth, output_dir)
    else:
        print(f"SKIP Plots 2 & 4: {args.results} or {args.ground_truth} not found.")
        print(
            "  Run: uv run python -m herald.pipeline.run --input data/test_sets/sample_cases.json"
        )

    # Plot 3: Baseline comparison
    baseline_path = Path(args.baseline)
    if baseline_path.exists():
        with open(baseline_path) as f:
            baseline_data = json.load(f)
        print("Plot 3: HERALD vs Baselines")
        plot_baseline_comparison(baseline_data, results, ground_truth, output_dir)
    else:
        print(
            f"SKIP Plot 3: {args.baseline} not found. Run notebooks/baseline_comparison.py first."
        )

    print(f"\n{'=' * 60}")
    print(f"Plots saved to {output_dir}/")
    print("Files:")
    for f in sorted(output_dir.glob("*.png")):
        print(f"  {f.name}")


if __name__ == "__main__":
    main()
