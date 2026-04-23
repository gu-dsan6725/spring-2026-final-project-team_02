"""
analyze-comprehensive-eval.py — Post-run analysis and visualization for the
HERALD comprehensive evaluation.

Usage:
    python3 scripts/analyze-comprehensive-eval.py results/comprehensive-eval-YYYY-MM-DD.json

Produces:
    results/comprehensive-eval-report/
        summary.md            — human-readable markdown report
        fig1_accuracy.png     — accuracy + F2 bar chart across all conditions
        fig2_type_breakdown.png — per-claim-type accuracy heatmap
        fig3_calibration.png  — confidence calibration curves
        fig4_cost_tier.png    — cost + tier distribution
        fig5_error_patterns.png — error taxonomy
        fig6_derivation.png   — per-derivation breakdown
"""

import json
import sys
import os
from pathlib import Path
from collections import defaultdict

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

# ─── Colour palette ────────────────────────────────────────────────────────

HERALD_COLOR = "#2563EB"   # blue
LLM_COLOR = "#DC2626"      # red
ACCENT = "#16A34A"         # green for "better"
NEUTRAL = "#6B7280"

SET_COLORS = {
    "1": "#3B82F6",
    "2": "#F59E0B",
    "3": "#10B981",
    "human": "#8B5CF6",
}
SET_LABELS = {
    "1": "eval-set-1\n(primary, tuned)",
    "2": "eval-set-2\n(tuned on this)",
    "3": "eval-set-3\n(holdout)",
    "human": "human-eval-2\n(independent)",
}
CLAIM_TYPE_ORDER = ["statistical", "causal", "comparative", "predictive", "normative", "synthesis"]
DERIV_ORDER = ["direct_extraction", "paraphrase", "cross_source", "agent_inference"]

# ─── Load report ───────────────────────────────────────────────────────────

def load(path: str) -> dict:
    with open(path) as f:
        return json.load(f)

# ─── Fig 1: Accuracy + F2 bar chart ───────────────────────────────────────

def fig1_accuracy(report: dict, outdir: Path) -> None:
    comps = report["baseline_comparisons"]
    if not comps:
        print("  [skip] fig1: no baseline comparisons")
        return

    set_keys = [c["eval_set_key"] for c in comps]
    herald_acc = [c["herald_accuracy"] * 100 for c in comps]
    llm_acc = [c["llm_only_accuracy"] * 100 for c in comps]
    herald_f2 = [c["herald_f2"] * 100 for c in comps]
    llm_f2 = [c["llm_only_f2"] * 100 for c in comps]

    x = np.arange(len(set_keys))
    width = 0.2
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))

    for ax, (h_vals, l_vals, title, ylabel) in zip(
        axes,
        [
            (herald_acc, llm_acc, "Accuracy (% correct)", "Accuracy (%)"),
            (herald_f2, llm_f2, "F2 Score (recall-weighted)", "F2 (%)"),
        ],
    ):
        bars_h = ax.bar(x - width / 2, h_vals, width, label="HERALD", color=HERALD_COLOR, alpha=0.85)
        bars_l = ax.bar(x + width / 2, l_vals, width, label="LLM-only", color=LLM_COLOR, alpha=0.85)

        for bar in bars_h:
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.5,
                    f"{bar.get_height():.1f}%", ha="center", va="bottom", fontsize=8, color=HERALD_COLOR, fontweight="bold")
        for bar in bars_l:
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.5,
                    f"{bar.get_height():.1f}%", ha="center", va="bottom", fontsize=8, color=LLM_COLOR, fontweight="bold")

        ax.set_xticks(x)
        ax.set_xticklabels([SET_LABELS.get(k, k) for k in set_keys], fontsize=9)
        ax.set_ylabel(ylabel)
        ax.set_title(title, fontweight="bold")
        ax.set_ylim(0, 115)
        ax.legend()
        ax.axhline(50, color="gray", linestyle=":", linewidth=0.8, alpha=0.5)
        ax.grid(axis="y", alpha=0.3)

    # Annotate contamination
    if "2" in set_keys and "3" in set_keys:
        idx2 = set_keys.index("2")
        idx3 = set_keys.index("3")
        axes[0].annotate("", xy=(x[idx2] - width / 2, herald_acc[idx2]),
                         xytext=(x[idx3] - width / 2, herald_acc[idx3]),
                         arrowprops=dict(arrowstyle="<->", color="orange", lw=1.5))
        gap = herald_acc[idx2] - herald_acc[idx3]
        axes[0].text((x[idx2] + x[idx3]) / 2 - width / 2, max(herald_acc[idx2], herald_acc[idx3]) + 3,
                     f"Tuning\ninflation\n+{gap:.1f}pp", ha="center", fontsize=8, color="darkorange")

    plt.suptitle("HERALD vs LLM-Only: Accuracy and F2 Across All Eval Sets", fontsize=13, fontweight="bold")
    plt.tight_layout()
    plt.savefig(outdir / "fig1_accuracy.png", dpi=150, bbox_inches="tight")
    plt.close()
    print("  ✓ fig1_accuracy.png")

# ─── Fig 2: Per-claim-type breakdown heatmap ──────────────────────────────

def fig2_type_breakdown(report: dict, outdir: Path) -> None:
    results = report["eval_results"]
    if not results:
        return

    # Build matrix: rows = claim type, cols = (set, system)
    col_labels = []
    data_acc = {}    # (type, col_idx) -> accuracy

    for r in results:
        col_label = f"{r['eval_set_key']}\n{r['system']}"
        col_labels.append(col_label)
        col_idx = len(col_labels) - 1
        for ct, m in r["metrics"]["by_claim_type"].items():
            data_acc[(ct, col_idx)] = m["accuracy"]

    types = [t for t in CLAIM_TYPE_ORDER if any((t, i) in data_acc for i in range(len(col_labels)))]
    if not types:
        print("  [skip] fig2: no per-type data")
        return

    matrix = np.full((len(types), len(col_labels)), np.nan)
    for i, t in enumerate(types):
        for j in range(len(col_labels)):
            if (t, j) in data_acc:
                matrix[i, j] = data_acc[(t, j)] * 100

    fig, ax = plt.subplots(figsize=(max(8, len(col_labels) * 1.4), max(4, len(types) * 0.7 + 1)))
    im = ax.imshow(matrix, aspect="auto", cmap="RdYlGn", vmin=40, vmax=100)

    ax.set_xticks(range(len(col_labels)))
    ax.set_xticklabels(col_labels, fontsize=8)
    ax.set_yticks(range(len(types)))
    ax.set_yticklabels([t.replace("_", " ").title() for t in types])

    for i in range(len(types)):
        for j in range(len(col_labels)):
            val = matrix[i, j]
            if not np.isnan(val):
                ax.text(j, i, f"{val:.0f}%", ha="center", va="center",
                        fontsize=8, color="black", fontweight="bold")

    plt.colorbar(im, ax=ax, label="Accuracy (%)")
    ax.set_title("Per-Claim-Type Accuracy by System and Eval Set", fontweight="bold", pad=12)
    plt.tight_layout()
    plt.savefig(outdir / "fig2_type_breakdown.png", dpi=150, bbox_inches="tight")
    plt.close()
    print("  ✓ fig2_type_breakdown.png")

# ─── Fig 3: Confidence calibration ────────────────────────────────────────

def fig3_calibration(report: dict, outdir: Path) -> None:
    results = report["eval_results"]
    fig, axes = plt.subplots(1, max(1, len(results)), figsize=(5 * max(1, len(results)), 4), squeeze=False)
    axes = axes[0]

    for ax, r in zip(axes, results):
        bins = r["metrics"]["confidence_bins"]
        if not bins:
            ax.text(0.5, 0.5, "No calibration data", transform=ax.transAxes, ha="center")
            continue

        x = [b["avg_confidence"] for b in bins]
        y = [b["accuracy"] for b in bins]
        sizes = [b["n_claims"] * 15 for b in bins]

        ax.plot([0, 1], [0, 1], "k--", alpha=0.4, label="Perfect calibration")
        ax.scatter(x, y, s=sizes, alpha=0.8,
                   color=HERALD_COLOR if r["system"] == "herald" else LLM_COLOR, zorder=5)
        ax.plot(x, y, "-o", color=HERALD_COLOR if r["system"] == "herald" else LLM_COLOR,
                alpha=0.6, linewidth=1.5)

        for b, xi, yi in zip(bins, x, y):
            ax.annotate(f"n={b['n_claims']}", (xi, yi), textcoords="offset points",
                        xytext=(5, 5), fontsize=7, alpha=0.8)

        cal_err = r["metrics"]["calibration_error"]
        label = f"{r['label']}\n{r['system'].upper()}"
        ax.set_title(f"{label}\nCalib. Error={cal_err:.3f}", fontsize=9, fontweight="bold")
        ax.set_xlabel("Avg confidence in bin")
        ax.set_ylabel("Actual accuracy")
        ax.set_xlim(0.45, 1.05)
        ax.set_ylim(0, 1.05)
        ax.legend(fontsize=7)
        ax.grid(alpha=0.3)

    plt.suptitle("Confidence Calibration: Stated vs Actual Accuracy", fontweight="bold")
    plt.tight_layout()
    plt.savefig(outdir / "fig3_calibration.png", dpi=150, bbox_inches="tight")
    plt.close()
    print("  ✓ fig3_calibration.png")

# ─── Fig 4: Cost + tier distribution ─────────────────────────────────────

def fig4_cost_tier(report: dict, outdir: Path) -> None:
    comps = report["baseline_comparisons"]
    if not comps:
        print("  [skip] fig4: no comparisons")
        return

    fig, axes = plt.subplots(1, 2, figsize=(13, 5))

    # Left: cost per claim
    set_keys = [c["eval_set_key"] for c in comps]
    x = np.arange(len(set_keys))
    width = 0.35
    herald_cost = [c["herald_avg_cost_usd"] * 100 for c in comps]  # convert to cents
    llm_cost = [c["llm_only_avg_cost_usd"] * 100 for c in comps]

    axes[0].bar(x - width / 2, herald_cost, width, label="HERALD", color=HERALD_COLOR, alpha=0.85)
    axes[0].bar(x + width / 2, llm_cost, width, label="LLM-only", color=LLM_COLOR, alpha=0.85)
    axes[0].set_xticks(x)
    axes[0].set_xticklabels([SET_LABELS.get(k, k) for k in set_keys], fontsize=8)
    axes[0].set_ylabel("Cost per claim (¢)")
    axes[0].set_title("Estimated Cost Per Claim (¢)\nGPT-4o pricing: $2.50/1M input, $10/1M output", fontweight="bold")
    axes[0].legend()
    axes[0].grid(axis="y", alpha=0.3)

    # Right: tier distribution for HERALD (stacked bar per eval set)
    herald_results = [r for r in report["eval_results"] if r["system"] == "herald"]
    if herald_results:
        set_keys_h = [r["eval_set_key"] for r in herald_results]
        x_h = np.arange(len(set_keys_h))
        tier_colors = {"tier_1": "#86EFAC", "tier_2": HERALD_COLOR, "tier_3": "#7C3AED", "tier_4": "#DC2626"}
        bottoms = np.zeros(len(herald_results))

        for tier_key, color in tier_colors.items():
            vals = []
            for r in herald_results:
                td = r["metrics"]["tier_distribution"]
                n = r["n_claims"]
                vals.append(td.get(tier_key, 0) / n * 100 if n else 0)
            vals_arr = np.array(vals)
            bars = axes[1].bar(x_h, vals_arr, bottom=bottoms,
                               label=tier_key.replace("_", " ").title(), color=color, alpha=0.85)
            for bar, v in zip(bars, vals_arr):
                if v > 3:
                    axes[1].text(bar.get_x() + bar.get_width() / 2,
                                 bar.get_y() + bar.get_height() / 2,
                                 f"{v:.0f}%", ha="center", va="center", fontsize=8, color="white", fontweight="bold")
            bottoms += vals_arr

        axes[1].set_xticks(x_h)
        axes[1].set_xticklabels([SET_LABELS.get(k, k) for k in set_keys_h], fontsize=8)
        axes[1].set_ylabel("% of claims resolved at tier")
        axes[1].set_title("HERALD Tier Distribution\n(where claims are resolved)", fontweight="bold")
        axes[1].legend(loc="lower right", fontsize=8)
        axes[1].set_ylim(0, 115)
        axes[1].grid(axis="y", alpha=0.3)
    else:
        axes[1].text(0.5, 0.5, "No HERALD results to plot", transform=axes[1].transAxes, ha="center")

    plt.tight_layout()
    plt.savefig(outdir / "fig4_cost_tier.png", dpi=150, bbox_inches="tight")
    plt.close()
    print("  ✓ fig4_cost_tier.png")

# ─── Fig 5: Error patterns ─────────────────────────────────────────────────

def fig5_error_patterns(report: dict, outdir: Path) -> None:
    results = report["eval_results"]
    if not results:
        return

    # Collect all wrong claims across all runs with full context
    wrong_by_system: dict[str, list] = defaultdict(list)
    for r in results:
        for c in r["per_claim"]:
            if not c["correct"]:
                key = f"{r['system']}:{r['eval_set_key']}"
                wrong_by_system[key].append(c)

    if not any(wrong_by_system.values()):
        print("  [skip] fig5: no errors to plot")
        return

    fig, axes = plt.subplots(1, 2, figsize=(14, 5))

    # Left: FP vs FN rates by claim type, HERALD vs LLM
    herald_results = [r for r in results if r["system"] == "herald"]
    llm_results = [r for r in results if r["system"] == "llm_only"]

    def avg_type_metric(res_list, metric_key):
        vals = defaultdict(list)
        for r in res_list:
            for ct, m in r["metrics"]["by_claim_type"].items():
                vals[ct].append(m[metric_key])
        return {k: np.mean(v) * 100 for k, v in vals.items()}

    types_present = [t for t in CLAIM_TYPE_ORDER
                     if any(t in r["metrics"]["by_claim_type"] for r in results)]
    x = np.arange(len(types_present))
    width = 0.2

    herald_fpr = avg_type_metric(herald_results, "false_positive_rate")
    llm_fpr = avg_type_metric(llm_results, "false_positive_rate")
    herald_fnr = avg_type_metric(herald_results, "false_negative_rate")
    llm_fnr = avg_type_metric(llm_results, "false_negative_rate")

    ax = axes[0]
    ax.bar(x - 1.5 * width, [herald_fpr.get(t, 0) for t in types_present], width,
           label="HERALD FPR", color=HERALD_COLOR, alpha=0.8, hatch="//")
    ax.bar(x - 0.5 * width, [llm_fpr.get(t, 0) for t in types_present], width,
           label="LLM-only FPR", color=LLM_COLOR, alpha=0.8, hatch="//")
    ax.bar(x + 0.5 * width, [herald_fnr.get(t, 0) for t in types_present], width,
           label="HERALD FNR", color=HERALD_COLOR, alpha=0.8)
    ax.bar(x + 1.5 * width, [llm_fnr.get(t, 0) for t in types_present], width,
           label="LLM-only FNR", color=LLM_COLOR, alpha=0.8)

    ax.set_xticks(x)
    ax.set_xticklabels([t.replace("_", "\n") for t in types_present], fontsize=8)
    ax.set_ylabel("Rate (%)")
    ax.set_title("False Positive Rate vs False Negative Rate\nby Claim Type (avg across eval sets)", fontweight="bold")
    ax.legend(fontsize=7, ncol=2)
    ax.grid(axis="y", alpha=0.3)

    # Right: error pattern taxonomy
    all_errors: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for r in results:
        sys = r["system"]
        for c in r["per_claim"]:
            if not c["correct"]:
                pattern = f"{c['claim_type']}\n→{c['ground_truth']}→{c['predicted']}"
                all_errors[sys][pattern] += 1

    ax2 = axes[1]
    herald_errs = dict(sorted(all_errors.get("herald", {}).items(), key=lambda x: -x[1])[:10])
    llm_errs = dict(sorted(all_errors.get("llm_only", {}).items(), key=lambda x: -x[1])[:10])

    all_patterns = list(dict.fromkeys(list(herald_errs.keys()) + list(llm_errs.keys())))[:12]
    y = np.arange(len(all_patterns))
    width2 = 0.35

    ax2.barh(y - width2 / 2, [herald_errs.get(p, 0) for p in all_patterns],
             width2, label="HERALD", color=HERALD_COLOR, alpha=0.85)
    ax2.barh(y + width2 / 2, [llm_errs.get(p, 0) for p in all_patterns],
             width2, label="LLM-only", color=LLM_COLOR, alpha=0.85)

    ax2.set_yticks(y)
    ax2.set_yticklabels(all_patterns, fontsize=7)
    ax2.set_xlabel("Count (across all eval sets)")
    ax2.set_title("Error Taxonomy: Most Common Failure Patterns\n(type:gt_label→predicted_label)", fontweight="bold")
    ax2.legend(fontsize=8)
    ax2.grid(axis="x", alpha=0.3)

    plt.tight_layout()
    plt.savefig(outdir / "fig5_error_patterns.png", dpi=150, bbox_inches="tight")
    plt.close()
    print("  ✓ fig5_error_patterns.png")

# ─── Fig 6: Derivation breakdown ──────────────────────────────────────────

def fig6_derivation(report: dict, outdir: Path) -> None:
    results = report["eval_results"]
    if not results:
        return

    herald_results = [r for r in results if r["system"] == "herald"]
    llm_results = [r for r in results if r["system"] == "llm_only"]

    def avg_deriv_acc(res_list):
        vals = defaultdict(list)
        for r in res_list:
            for d, m in r["metrics"]["by_derivation"].items():
                vals[d].append(m["accuracy"])
        return {k: np.mean(v) * 100 for k, v in vals.items()}

    herald_accs = avg_deriv_acc(herald_results)
    llm_accs = avg_deriv_acc(llm_results)

    derivs = [d for d in DERIV_ORDER if d in herald_accs or d in llm_accs]
    x = np.arange(len(derivs))
    width = 0.35

    fig, ax = plt.subplots(figsize=(9, 5))
    bars_h = ax.bar(x - width / 2, [herald_accs.get(d, 0) for d in derivs],
                    width, label="HERALD", color=HERALD_COLOR, alpha=0.85)
    bars_l = ax.bar(x + width / 2, [llm_accs.get(d, 0) for d in derivs],
                    width, label="LLM-only", color=LLM_COLOR, alpha=0.85)

    for bar in list(bars_h) + list(bars_l):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.5,
                f"{bar.get_height():.1f}%", ha="center", va="bottom", fontsize=8, fontweight="bold")

    ax.set_xticks(x)
    ax.set_xticklabels([d.replace("_", "\n") for d in derivs], fontsize=9)
    ax.set_ylabel("Accuracy (%)")
    ax.set_ylim(0, 115)
    ax.set_title("Accuracy by Derivation Method (avg across eval sets)\nRisk: direct_extraction < paraphrase < cross_source < agent_inference",
                 fontweight="bold")
    ax.legend()
    ax.grid(axis="y", alpha=0.3)
    ax.axhline(50, color="gray", linestyle=":", linewidth=0.8, alpha=0.5)

    # Risk labels
    risk_map = {"direct_extraction": "LOW", "paraphrase": "LOW", "cross_source": "MED", "agent_inference": "HIGH"}
    for i, d in enumerate(derivs):
        ax.text(i, 2, f"risk: {risk_map.get(d, '?')}", ha="center", fontsize=7, color="gray")

    plt.tight_layout()
    plt.savefig(outdir / "fig6_derivation.png", dpi=150, bbox_inches="tight")
    plt.close()
    print("  ✓ fig6_derivation.png")

# ─── Fig 7: Variance ──────────────────────────────────────────────────────

def fig7_variance(report: dict, outdir: Path) -> None:
    vr = report.get("variance_results", [])
    if not vr:
        print("  [skip] fig7: no variance data")
        return

    fig, axes = plt.subplots(1, len(vr), figsize=(5 * len(vr), 4), squeeze=False)
    axes = axes[0]

    for ax, v in zip(axes, vr):
        reps = list(range(1, v["n_reps"] + 1))
        accs = [a * 100 for a in v["per_rep_accuracy"]]
        color = HERALD_COLOR if v["system"] == "herald" else LLM_COLOR
        ax.plot(reps, accs, "-o", color=color, markersize=8, linewidth=2)
        ax.axhline(v["mean_accuracy"] * 100, color=color, linestyle="--", alpha=0.5,
                   label=f"Mean={v['mean_accuracy']*100:.1f}%")
        ax.fill_between(reps,
                        [(v["mean_accuracy"] - v["std_accuracy"]) * 100] * len(reps),
                        [(v["mean_accuracy"] + v["std_accuracy"]) * 100] * len(reps),
                        alpha=0.15, color=color)

        ax.set_xlabel("Run #")
        ax.set_ylabel("Accuracy (%)")
        ax.set_title(f"{v['system'].upper()} on eval-set-{v['eval_set_key']}\nstd=±{v['std_accuracy']*100:.1f}pp  flip_rate={v['flip_rate']*100:.1f}%",
                     fontweight="bold")
        ax.legend(fontsize=8)
        ax.set_ylim(max(0, v["mean_accuracy"] * 100 - 15), min(100, v["mean_accuracy"] * 100 + 15))
        ax.grid(alpha=0.3)

    plt.suptitle("Variance Test: Repeated Runs on Same Eval Set (no code changes)", fontweight="bold")
    plt.tight_layout()
    plt.savefig(outdir / "fig7_variance.png", dpi=150, bbox_inches="tight")
    plt.close()
    print("  ✓ fig7_variance.png")

# ─── Markdown summary ─────────────────────────────────────────────────────

def write_summary_md(report: dict, outdir: Path) -> None:
    lines = []
    a = lines.append

    a("# HERALD Comprehensive Evaluation Report")
    a(f"\n**Generated:** {report['run_timestamp']}")
    a(f"**NLI backend available:** {report['nli_backend_available']}")
    a(f"**Eval sets run:** {', '.join(report['config']['eval_sets_run'])}")
    a(f"**Variance reps:** {report['config']['variance_reps']}")

    a("\n---\n")
    a("## 1. Accuracy Summary\n")
    a("| Eval Set | Notes | HERALD Acc | LLM-only Acc | Δ (pp) | HERALD F2 | LLM F2 |")
    a("|---|---|---|---|---|---|---|")
    for c in report["baseline_comparisons"]:
        set_info = {"1": "primary, tuned", "2": "contaminated (tuned on)", "3": "honest holdout", "human": "independent labels"}
        delta = f"+{c['delta_pp']:.1f}" if c["delta_pp"] >= 0 else f"{c['delta_pp']:.1f}"
        h_acc = f"{c['herald_accuracy']*100:.1f}%" if c["herald_accuracy"] > 0 else "N/A"
        l_acc = f"{c['llm_only_accuracy']*100:.1f}%" if c["llm_only_accuracy"] > 0 else "N/A"
        h_f2 = f"{c['herald_f2']*100:.1f}%" if c["herald_f2"] > 0 else "N/A"
        l_f2 = f"{c['llm_only_f2']*100:.1f}%" if c["llm_only_f2"] > 0 else "N/A"
        a(f"| {c['eval_set_key']} | {set_info.get(c['eval_set_key'], '')} | {h_acc} | {l_acc} | {delta}pp | {h_f2} | {l_f2} |")

    a("\n> **F2 = recall-weighted harmonic mean.** In policy context, missing an invalid claim (FN) is worse than over-flagging a valid one (FP). F2 weights recall 2× vs precision.")

    a("\n---\n")
    a("## 2. Contamination / Generalization\n")
    css = report["cross_set_summary"]
    if css["honest_holdout_accuracy"] is not None and css["contaminated_accuracy"] is not None:
        gap = css["accuracy_gap_pp"] or 0
        a(f"- **eval-set-2 (prompts tuned on this):** {css['contaminated_accuracy']*100:.1f}%")
        a(f"- **eval-set-3 (honest holdout):** {css['honest_holdout_accuracy']*100:.1f}%")
        a(f"- **Inflation from overfitting:** +{gap:.1f}pp  {'⚠️ MEANINGFUL' if gap > 3 else '✓ within noise'}")
        a(f"\n> The {gap:.1f}pp gap between the contaminated and holdout sets {'suggests the system is overfit to the specific failure modes observed during prompt tuning' if gap > 3 else 'is small enough to be within run-to-run noise'}.")

    a("\n---\n")
    a("## 3. Per-Claim-Type Analysis\n")
    # Aggregate across all HERALD results
    herald_results = [r for r in report["eval_results"] if r["system"] == "herald"]
    llm_results = [r for r in report["eval_results"] if r["system"] == "llm_only"]

    def avg_type(res_list, key):
        vals = defaultdict(list)
        for r in res_list:
            for ct, m in r["metrics"]["by_claim_type"].items():
                vals[ct].append(m[key])
        return {k: np.mean(v) for k, v in vals.items()}

    h_type_acc = avg_type(herald_results, "accuracy")
    l_type_acc = avg_type(llm_results, "accuracy")
    h_type_fnr = avg_type(herald_results, "false_negative_rate")
    h_type_fpr = avg_type(herald_results, "false_positive_rate")

    a("| Claim Type | HERALD Acc | LLM Acc | HERALD FPR | HERALD FNR |")
    a("|---|---|---|---|---|")
    for ct in CLAIM_TYPE_ORDER:
        h = f"{h_type_acc.get(ct, 0)*100:.1f}%" if ct in h_type_acc else "—"
        l = f"{l_type_acc.get(ct, 0)*100:.1f}%" if ct in l_type_acc else "—"
        fpr = f"{h_type_fpr.get(ct, 0)*100:.1f}%" if ct in h_type_fpr else "—"
        fnr = f"{h_type_fnr.get(ct, 0)*100:.1f}%" if ct in h_type_fnr else "—"
        a(f"| {ct} | {h} | {l} | {fpr} | {fnr} |")

    a("\n> FPR = valid claims marked invalid (over-flagging). FNR = invalid claims marked valid (under-flagging = higher risk).")

    a("\n---\n")
    a("## 4. Derivation Method Analysis\n")

    def avg_deriv(res_list, key):
        vals = defaultdict(list)
        for r in res_list:
            for d, m in r["metrics"]["by_derivation"].items():
                vals[d].append(m[key])
        return {k: np.mean(v) for k, v in vals.items()}

    h_der_acc = avg_deriv(herald_results, "accuracy")
    l_der_acc = avg_deriv(llm_results, "accuracy")

    a("| Derivation | Risk Level | HERALD Acc | LLM Acc |")
    a("|---|---|---|---|")
    risk = {"direct_extraction": "Low", "paraphrase": "Low", "cross_source": "Medium", "agent_inference": "High"}
    for d in DERIV_ORDER:
        h = f"{h_der_acc.get(d, 0)*100:.1f}%" if d in h_der_acc else "—"
        l = f"{l_der_acc.get(d, 0)*100:.1f}%" if d in l_der_acc else "—"
        a(f"| {d} | {risk.get(d, '?')} | {h} | {l} |")

    a("\n---\n")
    a("## 5. Cost Analysis\n")
    a("| Eval Set | HERALD $/claim | LLM-only $/claim | Multiplier |")
    a("|---|---|---|---|")
    for c in report["baseline_comparisons"]:
        mult = f"{c['herald_avg_cost_usd']/c['llm_only_avg_cost_usd']:.1f}x" if c["llm_only_avg_cost_usd"] > 0 else "N/A"
        a(f"| {c['eval_set_key']} | ${c['herald_avg_cost_usd']:.4f} | ${c['llm_only_avg_cost_usd']:.4f} | {mult} |")
    a("\n> HERALD costs include estimated Tier 2 (GPT-4o) + Tier 3 (4× GPT-4o) for escalated claims. Token counts for HERALD are estimated from context length; baseline uses actual API token counts.")

    a("\n---\n")
    a("## 6. Tier Distribution (HERALD)\n")
    a("| Eval Set | T1 (NLI) | T2 (LLM Judge) | T3 (Debate) | T4 (Human) |")
    a("|---|---|---|---|---|")
    for r in herald_results:
        td = r["metrics"]["tier_distribution"]
        n = r["n_claims"]
        pct = lambda k: f"{td.get(k, 0)/n*100:.0f}% ({td.get(k, 0)})" if n else "—"
        a(f"| {r['eval_set_key']} | {pct('tier_1')} | {pct('tier_2')} | {pct('tier_3')} | {pct('tier_4')} |")

    a("\n---\n")
    a("## 7. Confidence Calibration\n")
    a("| System | Eval Set | Calibration Error | Assessment |")
    a("|---|---|---|---|")
    for r in report["eval_results"]:
        ce = r["metrics"]["calibration_error"]
        assessment = "✓ Good" if ce < 0.05 else "⚠️ Moderate" if ce < 0.10 else "✗ Poor"
        a(f"| {r['system']} | {r['eval_set_key']} | {ce:.3f} | {assessment} |")
    a("\n> Calibration error = mean |confidence - accuracy| weighted by bin size. < 0.05 is good; > 0.10 is poor.")

    if report.get("variance_results"):
        a("\n---\n")
        a("## 8. Variance / Stochasticity\n")
        a("| System | Eval Set | Reps | Accuracies | Mean | Std (pp) | Flip Rate |")
        a("|---|---|---|---|---|---|---|")
        for v in report["variance_results"]:
            accs = ", ".join(f"{a*100:.1f}%" for a in v["per_rep_accuracy"])
            a(f"| {v['system']} | {v['eval_set_key']} | {v['n_reps']} | {accs} | {v['mean_accuracy']*100:.1f}% | ±{v['std_accuracy']*100:.1f}pp | {v['flip_rate']*100:.1f}% |")
        a("\n> Flip rate = fraction of claims that changed verdict between consecutive runs with no code change. High flip rate (>10%) means results are noise-dominated.")

    a("\n---\n")
    a("## 9. Wrong Claims (HERALD, most recent run)\n")
    # Collect wrong claims from the last HERALD run per eval set
    seen_sets = set()
    for r in reversed(report["eval_results"]):
        if r["system"] == "herald" and r["eval_set_key"] not in seen_sets:
            seen_sets.add(r["eval_set_key"])
            wrong = [c for c in r["per_claim"] if not c["correct"]]
            if not wrong:
                a(f"\n**{r['label']}:** No wrong claims ✓")
                continue
            a(f"\n**{r['label']}** ({len(wrong)} wrong / {r['n_claims']} total):\n")
            a("| Claim ID | Type | Derivation | GT | Predicted | Confidence |")
            a("|---|---|---|---|---|---|")
            for c in wrong:
                a(f"| {c['claim_id']} | {c['claim_type']} | {c['derivation']} | {c['ground_truth']} | {c['predicted']} | {c['confidence']:.2f} |")

    a("\n---\n")
    a("## 10. Verdict\n")
    # Auto-generate a verdict based on the numbers
    if report["baseline_comparisons"]:
        holdout_comp = next((c for c in report["baseline_comparisons"] if c["eval_set_key"] == "3"), None)
        all_herald = [c["herald_accuracy"] for c in report["baseline_comparisons"] if c["herald_accuracy"] > 0]
        all_llm = [c["llm_only_accuracy"] for c in report["baseline_comparisons"] if c["llm_only_accuracy"] > 0]

        if holdout_comp:
            h = holdout_comp["herald_accuracy"]
            l = holdout_comp["llm_only_accuracy"]
            delta = holdout_comp["delta_pp"]
            a(f"**On the honest holdout (eval-set-3):** HERALD achieves {h*100:.1f}% vs LLM-only {l*100:.1f}% — a {delta:+.1f}pp {'improvement' if delta >= 0 else 'deficit'}.")
            if delta > 3:
                a("The multi-tier architecture provides a meaningful improvement over a single LLM call.")
            elif abs(delta) <= 3:
                a("The improvement is within noise — HERALD's multi-tier architecture does not provide a statistically clear advantage over a single LLM call at this scale.")
            else:
                a("⚠️ HERALD underperforms the single LLM call on the holdout — the multi-tier pipeline is adding noise, not signal.")

        css = report["cross_set_summary"]
        if css["accuracy_gap_pp"] is not None:
            gap = css["accuracy_gap_pp"]
            a(f"\n**Contamination effect:** {gap:.1f}pp gap between eval-set-2 (tuned on) and eval-set-3 (holdout). {'This is a meaningful overfitting signal.' if gap > 3 else 'This is within acceptable noise bounds.'}")

    (outdir / "summary.md").write_text("\n".join(lines))
    print("  ✓ summary.md")

# ─── Main ──────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/analyze-comprehensive-eval.py <results-json>")
        sys.exit(1)

    report_path = sys.argv[1]
    if not os.path.exists(report_path):
        print(f"File not found: {report_path}")
        sys.exit(1)

    report = load(report_path)

    outdir = Path(report_path).with_suffix("")
    # e.g. results/comprehensive-eval-2026-04-23 (dir)
    outdir = Path(str(outdir) + "-report")
    outdir.mkdir(parents=True, exist_ok=True)
    print(f"\nWriting analysis to: {outdir}/\n")

    fig1_accuracy(report, outdir)
    fig2_type_breakdown(report, outdir)
    fig3_calibration(report, outdir)
    fig4_cost_tier(report, outdir)
    fig5_error_patterns(report, outdir)
    fig6_derivation(report, outdir)
    fig7_variance(report, outdir)
    write_summary_md(report, outdir)

    print(f"\n✓ All outputs written to {outdir}/")
    print(f"  Open summary.md for the written report.")

if __name__ == "__main__":
    main()
