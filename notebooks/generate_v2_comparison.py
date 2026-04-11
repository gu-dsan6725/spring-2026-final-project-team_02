"""Generate v1 vs v2 comparison report and plots.

Outputs are written to results/plots/v2.0/ so the comparison package is
kept separate from the original single-run artifacts.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "results" / "plots" / "v2.0"


def load_json(path: str) -> dict | list:
    with open(ROOT / path) as f:
        return json.load(f)


def pct(value: float) -> str:
    return f"{value * 100:.1f}%"


def pp_delta(new: float, old: float) -> str:
    delta = (new - old) * 100
    sign = "+" if delta >= 0 else ""
    return f"{sign}{delta:.1f} pp"


def metric(eval_data: dict, key: str) -> tuple[int, int, float]:
    item = eval_data["accuracy"][key]
    return item["correct"], item["total"], item["acc"]


def rate(eval_data: dict, key: str) -> tuple[int, float]:
    item = eval_data["escalation"].get(key, {"count": 0, "rate": 0.0})
    return item["count"], item["rate"]


def write_markdown(old_eval: dict, new_eval: dict, old_cases: list[dict], new_cases: list[dict], old_results: list[dict], new_results: list[dict]) -> None:
    old_verdicts = Counter(r["final_verdict"] for r in old_results)
    new_verdicts = Counter(r["final_verdict"] for r in new_results)
    old_cps = Counter(c["checkpoint_type"] for c in old_cases)
    new_cps = Counter(c["checkpoint_type"] for c in new_cases)

    overall_old = metric(old_eval, "overall")
    overall_new = metric(new_eval, "overall")

    label_keys = ["label_valid", "label_invalid", "label_ambiguous"]
    cp_keys = ["cp_claim_extraction", "cp_numerical", "cp_synthesis", "cp_causal", "cp_retrieval"]
    tier_keys = ["tier_1", "tier_2", "tier_3", "tier_4"]

    lines = [
        "# HERALD Run Comparison: v1 (Llama) vs v2.0 (Gemma)",
        "",
        "## Scope",
        "",
        "- v1 source of truth: `data/test_sets/trial_cases.json`, `results/trial_run_results.json`, `results/trial_evaluation.json`",
        "- v2 source of truth: `data/test_sets/gov_report_v2_100.json`, `results/runs/run_03_govreport_v2_100/gov_report_v2_100_results.json`, `results/evaluation/gov_report_v2_eval.json`",
        "- Important caveat: this is a comparison of the saved evaluation runs, not a perfectly matched rerun on the exact same case set.",
        "- The v1 evaluation used `438` cases. The v2 evaluation used a standardized `100`-case subset.",
        "- Retrieval appears only in v2, so it has no direct v1 counterpart.",
        "",
        "## Headline Changes",
        "",
        f"- Overall accuracy improved from **{pct(overall_old[2])}** to **{pct(overall_new[2])}** ({pp_delta(overall_new[2], overall_old[2])}).",
        f"- Invalid-case accuracy improved from **{pct(metric(old_eval, 'label_invalid')[2])}** to **{pct(metric(new_eval, 'label_invalid')[2])}** ({pp_delta(metric(new_eval, 'label_invalid')[2], metric(old_eval, 'label_invalid')[2])}).",
        f"- Valid-case accuracy decreased from **{pct(metric(old_eval, 'label_valid')[2])}** to **{pct(metric(new_eval, 'label_valid')[2])}** ({pp_delta(metric(new_eval, 'label_valid')[2], metric(old_eval, 'label_valid')[2])}).",
        f"- Ambiguous-case accuracy stayed at **{pct(metric(old_eval, 'label_ambiguous')[2])}** in both runs.",
        f"- Tier 1 resolution increased from **{pct(rate(old_eval, 'tier_1')[1])}** to **{pct(rate(new_eval, 'tier_1')[1])}**.",
        f"- Tier 2 resolution dropped from **{pct(rate(old_eval, 'tier_2')[1])}** to **{pct(rate(new_eval, 'tier_2')[1])}**.",
        f"- Tier 3 resolution increased from **{pct(rate(old_eval, 'tier_3')[1])}** to **{pct(rate(new_eval, 'tier_3')[1])}**.",
        f"- Human review fell from **{pct(old_eval['human_review_rate'])}** to **{pct(new_eval['human_review_rate'])}**.",
        "",
        "## Overall Metrics",
        "",
        "| Metric | v1 Llama | v2 Gemma | Change |",
        "|---|---:|---:|---:|",
        f"| Cases evaluated | {overall_old[1]} | {overall_new[1]} | n/a |",
        f"| Overall accuracy | {pct(overall_old[2])} | {pct(overall_new[2])} | {pp_delta(overall_new[2], overall_old[2])} |",
        f"| Cost per case | {old_eval['cost_per_case']:.4f} | {new_eval['cost_per_case']:.4f} | {new_eval['cost_per_case'] - old_eval['cost_per_case']:+.4f} |",
        f"| Human review rate | {pct(old_eval['human_review_rate'])} | {pct(new_eval['human_review_rate'])} | {pp_delta(new_eval['human_review_rate'], old_eval['human_review_rate'])} |",
        "",
        "## Per-Label Accuracy",
        "",
        "| Label | v1 Llama | v2 Gemma | Change |",
        "|---|---:|---:|---:|",
    ]

    for key, label in [
        ("label_valid", "valid"),
        ("label_invalid", "invalid"),
        ("label_ambiguous", "ambiguous"),
    ]:
        _, _, old_acc = metric(old_eval, key)
        _, _, new_acc = metric(new_eval, key)
        lines.append(f"| {label} | {pct(old_acc)} | {pct(new_acc)} | {pp_delta(new_acc, old_acc)} |")

    lines.extend([
        "",
        "## Checkpoint Accuracy",
        "",
        "| Checkpoint | v1 Llama | v2 Gemma | Change | Notes |",
        "|---|---:|---:|---:|---|",
    ])

    cp_labels = {
        "cp_claim_extraction": "claim_extraction",
        "cp_numerical": "numerical",
        "cp_synthesis": "synthesis",
        "cp_causal": "causal",
        "cp_retrieval": "retrieval",
    }
    for key in cp_keys:
        label = cp_labels[key]
        if key in old_eval["accuracy"]:
            _, _, old_acc = metric(old_eval, key)
            old_str = pct(old_acc)
        else:
            old_acc = None
            old_str = "n/a"
        if key in new_eval["accuracy"]:
            _, _, new_acc = metric(new_eval, key)
            new_str = pct(new_acc)
        else:
            new_acc = None
            new_str = "n/a"
        change = pp_delta(new_acc, old_acc) if old_acc is not None and new_acc is not None else "n/a"
        note = "New in v2" if key == "cp_retrieval" else ""
        lines.append(f"| {label} | {old_str} | {new_str} | {change} | {note} |")

    lines.extend([
        "",
        "## Tier Accuracy",
        "",
        "| Resolving Tier | v1 Llama | v2 Gemma | Change |",
        "|---|---:|---:|---:|",
    ])

    for key, label in [("tier_1", "Tier 1"), ("tier_2", "Tier 2"), ("tier_3", "Tier 3"), ("tier_4", "Tier 4")]:
        if key in old_eval["accuracy"]:
            _, _, old_acc = metric(old_eval, key)
            old_str = pct(old_acc)
        else:
            old_acc = None
            old_str = "n/a"
        if key in new_eval["accuracy"]:
            _, _, new_acc = metric(new_eval, key)
            new_str = pct(new_acc)
        else:
            new_acc = None
            new_str = "n/a"
        change = pp_delta(new_acc, old_acc) if old_acc is not None and new_acc is not None else "n/a"
        lines.append(f"| {label} | {old_str} | {new_str} | {change} |")

    lines.extend([
        "",
        "## Escalation Rate",
        "",
        "| Tier | v1 Llama | v2 Gemma | Change |",
        "|---|---:|---:|---:|",
    ])
    for key, label in [("tier_1", "Tier 1"), ("tier_2", "Tier 2"), ("tier_3", "Tier 3"), ("tier_4", "Tier 4")]:
        _, old_rate = rate(old_eval, key)
        _, new_rate = rate(new_eval, key)
        lines.append(f"| {label} | {pct(old_rate)} | {pct(new_rate)} | {pp_delta(new_rate, old_rate)} |")

    lines.extend([
        "",
        "## Verdict Distribution",
        "",
        "| Verdict | v1 Llama | v2 Gemma |",
        "|---|---:|---:|",
        f"| valid | {old_verdicts.get('valid', 0)}/{len(old_results)} ({old_verdicts.get('valid', 0) / len(old_results) * 100:.1f}%) | {new_verdicts.get('valid', 0)}/{len(new_results)} ({new_verdicts.get('valid', 0) / len(new_results) * 100:.1f}%) |",
        f"| invalid | {old_verdicts.get('invalid', 0)}/{len(old_results)} ({old_verdicts.get('invalid', 0) / len(old_results) * 100:.1f}%) | {new_verdicts.get('invalid', 0)}/{len(new_results)} ({new_verdicts.get('invalid', 0) / len(new_results) * 100:.1f}%) |",
        f"| uncertain | {old_verdicts.get('uncertain', 0)}/{len(old_results)} ({old_verdicts.get('uncertain', 0) / len(old_results) * 100:.1f}%) | {new_verdicts.get('uncertain', 0)}/{len(new_results)} ({new_verdicts.get('uncertain', 0) / len(new_results) * 100:.1f}%) |",
        "",
        "## Dataset Composition Caveats",
        "",
        "| Dimension | v1 Llama | v2 Gemma |",
        "|---|---:|---:|",
        f"| Total cases | {len(old_cases)} | {len(new_cases)} |",
        f"| claim_extraction | {old_cps.get('claim_extraction', 0)} | {new_cps.get('claim_extraction', 0)} |",
        f"| numerical | {old_cps.get('numerical', 0)} | {new_cps.get('numerical', 0)} |",
        f"| synthesis | {old_cps.get('synthesis', 0)} | {new_cps.get('synthesis', 0)} |",
        f"| causal | {old_cps.get('causal', 0)} | {new_cps.get('causal', 0)} |",
        f"| retrieval | {old_cps.get('retrieval', 0)} | {new_cps.get('retrieval', 0)} |",
        "",
        "## Interpretation",
        "",
        "- The biggest real improvement is invalid-claim detection: Gemma is far less likely to incorrectly validate a bad claim.",
        "- The biggest unresolved issue is still ambiguity: both runs score `0.0%` on ambiguous cases because the system almost never produces `uncertain`.",
        "- Tier 1 remains the strongest resolver in both runs, which means upper-tier escalation is still underperforming its intended role.",
        "- Tier 3 debate remains a major weakness. Its accuracy barely changed and is still too low to justify confidence in debate-driven resolution.",
        "- Because the saved v2 evaluation uses a 100-case standardized subset while v1 used 438 cases, the direction of change is useful, but exact magnitude should be interpreted with that sampling caveat in mind.",
        "",
    ])

    (OUT_DIR / "comparison_report_v1_vs_v2.md").write_text("\n".join(lines))


def style_axes(ax: plt.Axes) -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", alpha=0.25, linewidth=0.8)


def grouped_bar_plot(filename: str, title: str, labels: list[str], old_vals: list[float], new_vals: list[float], ylabel: str = "Percent") -> None:
    x = np.arange(len(labels))
    width = 0.36

    fig, ax = plt.subplots(figsize=(10, 5.5))
    old_color = "#b85c38"
    new_color = "#2f6b5f"
    old_bars = ax.bar(x - width / 2, old_vals, width, label="v1 Llama", color=old_color)
    new_bars = ax.bar(x + width / 2, new_vals, width, label="v2 Gemma", color=new_color)

    ax.set_title(title)
    ax.set_ylabel(ylabel)
    ax.set_xticks(x)
    ax.set_xticklabels(labels)
    ax.set_ylim(0, max(old_vals + new_vals + [5]) * 1.2)
    style_axes(ax)
    ax.legend(frameon=False)

    for bars in [old_bars, new_bars]:
        for bar in bars:
            height = bar.get_height()
            ax.text(bar.get_x() + bar.get_width() / 2, height + 0.8, f"{height:.1f}", ha="center", va="bottom", fontsize=9)

    fig.tight_layout()
    fig.savefig(OUT_DIR / filename, dpi=200, bbox_inches="tight")
    plt.close(fig)


def stacked_verdict_plot(old_results: list[dict], new_results: list[dict]) -> None:
    verdicts = ["valid", "invalid", "uncertain"]
    old_counts = Counter(r["final_verdict"] for r in old_results)
    new_counts = Counter(r["final_verdict"] for r in new_results)
    old_vals = [old_counts.get(v, 0) / len(old_results) * 100 for v in verdicts]
    new_vals = [new_counts.get(v, 0) / len(new_results) * 100 for v in verdicts]

    fig, ax = plt.subplots(figsize=(8, 5.2))
    colors = {"valid": "#4c956c", "invalid": "#d1495b", "uncertain": "#7c7c7c"}
    bottom = np.zeros(2)

    for i, verdict in enumerate(verdicts):
        vals = np.array([old_vals[i], new_vals[i]])
        ax.bar(["v1 Llama", "v2 Gemma"], vals, bottom=bottom, color=colors[verdict], label=verdict)
        for idx, val in enumerate(vals):
            if val > 0:
                ax.text(idx, bottom[idx] + val / 2, f"{val:.1f}%", ha="center", va="center", fontsize=10, color="white")
        bottom += vals

    ax.set_title("Predicted Verdict Distribution")
    ax.set_ylabel("Percent of all predictions")
    ax.set_ylim(0, 100)
    style_axes(ax)
    ax.legend(frameon=False)
    fig.tight_layout()
    fig.savefig(OUT_DIR / "plot_v2_verdict_distribution.png", dpi=200, bbox_inches="tight")
    plt.close(fig)


def checkpoint_accuracy_plot(old_eval: dict, new_eval: dict) -> None:
    labels = ["claim_extraction", "numerical", "synthesis", "causal", "retrieval"]
    old_map = {
        "claim_extraction": old_eval["accuracy"]["cp_claim_extraction"]["acc"] * 100,
        "numerical": old_eval["accuracy"]["cp_numerical"]["acc"] * 100,
        "synthesis": old_eval["accuracy"]["cp_synthesis"]["acc"] * 100,
        "causal": old_eval["accuracy"]["cp_causal"]["acc"] * 100,
        "retrieval": np.nan,
    }
    new_map = {
        "claim_extraction": new_eval["accuracy"]["cp_claim_extraction"]["acc"] * 100,
        "numerical": new_eval["accuracy"]["cp_numerical"]["acc"] * 100,
        "synthesis": new_eval["accuracy"]["cp_synthesis"]["acc"] * 100,
        "causal": new_eval["accuracy"]["cp_causal"]["acc"] * 100,
        "retrieval": new_eval["accuracy"]["cp_retrieval"]["acc"] * 100,
    }

    x = np.arange(len(labels))
    width = 0.36
    fig, ax = plt.subplots(figsize=(10.5, 5.5))
    old_vals = [old_map[label] for label in labels]
    new_vals = [new_map[label] for label in labels]

    old_bars = ax.bar(x - width / 2, [0 if np.isnan(v) else v for v in old_vals], width, label="v1 Llama", color="#b85c38")
    new_bars = ax.bar(x + width / 2, new_vals, width, label="v2 Gemma", color="#2f6b5f")

    ax.set_title("Checkpoint Accuracy by Run")
    ax.set_ylabel("Accuracy (%)")
    ax.set_xticks(x)
    ax.set_xticklabels(labels)
    ax.set_ylim(0, 100)
    style_axes(ax)
    ax.legend(frameon=False)

    for idx, v in enumerate(old_vals):
        if np.isnan(v):
            ax.text(x[idx] - width / 2, 3, "n/a", ha="center", va="bottom", fontsize=9, color="#555555", rotation=90)
        else:
            ax.text(x[idx] - width / 2, v + 1.2, f"{v:.1f}", ha="center", va="bottom", fontsize=9)
    for idx, v in enumerate(new_vals):
        ax.text(x[idx] + width / 2, v + 1.2, f"{v:.1f}", ha="center", va="bottom", fontsize=9)

    fig.tight_layout()
    fig.savefig(OUT_DIR / "plot_v2_checkpoint_accuracy.png", dpi=200, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    old_eval = load_json("results/evaluation/trial_evaluation.json")
    new_eval = load_json("results/evaluation/gov_report_v2_eval.json")
    old_cases = load_json("data/test_sets/trial_cases.json")
    new_cases = load_json("data/test_sets/gov_report_v2_100.json")
    old_results = load_json("results/runs/run_01_trial/trial_run_results.json")
    new_results = load_json("results/runs/run_03_govreport_v2_100/gov_report_v2_100_results.json")

    write_markdown(old_eval, new_eval, old_cases, new_cases, old_results, new_results)

    grouped_bar_plot(
        "plot_v2_overall_summary.png",
        "Overall Accuracy and Human Review Rate",
        ["overall accuracy", "human review rate"],
        [old_eval["accuracy"]["overall"]["acc"] * 100, old_eval["human_review_rate"] * 100],
        [new_eval["accuracy"]["overall"]["acc"] * 100, new_eval["human_review_rate"] * 100],
    )

    grouped_bar_plot(
        "plot_v2_label_accuracy.png",
        "Per-Label Accuracy",
        ["valid", "invalid", "ambiguous"],
        [
            old_eval["accuracy"]["label_valid"]["acc"] * 100,
            old_eval["accuracy"]["label_invalid"]["acc"] * 100,
            old_eval["accuracy"]["label_ambiguous"]["acc"] * 100,
        ],
        [
            new_eval["accuracy"]["label_valid"]["acc"] * 100,
            new_eval["accuracy"]["label_invalid"]["acc"] * 100,
            new_eval["accuracy"]["label_ambiguous"]["acc"] * 100,
        ],
        ylabel="Accuracy (%)",
    )

    checkpoint_accuracy_plot(old_eval, new_eval)

    grouped_bar_plot(
        "plot_v2_escalation_rates.png",
        "Escalation / Resolution Rate by Tier",
        ["Tier 1", "Tier 2", "Tier 3", "Tier 4"],
        [
            old_eval["escalation"]["tier_1"]["rate"] * 100,
            old_eval["escalation"]["tier_2"]["rate"] * 100,
            old_eval["escalation"]["tier_3"]["rate"] * 100,
            old_eval["escalation"]["tier_4"]["rate"] * 100,
        ],
        [
            new_eval["escalation"]["tier_1"]["rate"] * 100,
            new_eval["escalation"]["tier_2"]["rate"] * 100,
            new_eval["escalation"]["tier_3"]["rate"] * 100,
            new_eval["escalation"].get("tier_4", {"rate": 0.0})["rate"] * 100,
        ],
        ylabel="Rate (%)",
    )

    grouped_bar_plot(
        "plot_v2_tier_accuracy.png",
        "Accuracy by Resolving Tier",
        ["Tier 1", "Tier 2", "Tier 3", "Tier 4"],
        [
            old_eval["accuracy"]["tier_1"]["acc"] * 100,
            old_eval["accuracy"]["tier_2"]["acc"] * 100,
            old_eval["accuracy"]["tier_3"]["acc"] * 100,
            old_eval["accuracy"]["tier_4"]["acc"] * 100,
        ],
        [
            new_eval["accuracy"]["tier_1"]["acc"] * 100,
            new_eval["accuracy"]["tier_2"]["acc"] * 100,
            new_eval["accuracy"]["tier_3"]["acc"] * 100,
            0.0,
        ],
        ylabel="Accuracy (%)",
    )

    stacked_verdict_plot(old_results, new_results)


if __name__ == "__main__":
    main()
