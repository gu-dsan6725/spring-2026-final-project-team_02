"""
analyze_experiment.py — Compute metrics from a run_experiment.py output file.

Produces:
  - Confusion matrices per system (overall + per claim type)
  - Accuracy, Precision, Recall, F1 per system
  - False-invalid rate and false-valid rate per system
  - Cost & latency summary per system
  - Tier distribution for Systems A and C
  - Per-claim disagreement table (where A ≠ B)
  - Markdown report written to results/analysis-YYYY-MM-DD.md

Usage (from repo root):
  cd backend
  uv run python ../experiment-scripts/analyze_experiment.py [OPTIONS]

Options:
  --results PATH    Path to experiment JSON    [required or auto-detected]
  --output PATH     Output markdown file       [default: ../results/analysis-YYYY-MM-DD.md]
  --sonnet-input-price  Price per 1k input tokens  [default: 0.003]
  --sonnet-output-price Price per 1k output tokens [default: 0.015]
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Sonnet pricing (claude-sonnet-4-6 as of experiment date; update if needed)
# ---------------------------------------------------------------------------

DEFAULT_INPUT_PRICE_PER_1K = 0.003   # USD per 1k input tokens
DEFAULT_OUTPUT_PRICE_PER_1K = 0.015  # USD per 1k output tokens


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


def load_results(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payload = json.loads(path.read_text())
    return payload["meta"], payload["results"]


# ---------------------------------------------------------------------------
# Metric helpers
# ---------------------------------------------------------------------------


def _binary_verdict(verdict: str | None) -> str | None:
    """Collapse verdicts to 'valid' or 'invalid'. Returns None for errors/uncertain."""
    if verdict in ("valid",):
        return "valid"
    if verdict in ("invalid", "plausible_but_unsupported"):
        return "invalid"
    return None  # uncertain, error — excluded from precision/recall/F1


def _confusion(records: list[dict[str, Any]], system_key: str) -> dict[str, int]:
    """Return TP, FP, TN, FN where positive=invalid."""
    tp = fp = tn = fn = 0
    for r in records:
        sr = r.get(system_key)
        if sr is None:
            continue
        pred = _binary_verdict(sr.get("verdict"))
        truth = _binary_verdict(r.get("ground_truth"))
        if pred is None or truth is None:
            continue
        if pred == "invalid" and truth == "invalid":
            tp += 1
        elif pred == "invalid" and truth == "valid":
            fp += 1
        elif pred == "valid" and truth == "valid":
            tn += 1
        elif pred == "valid" and truth == "invalid":
            fn += 1
    return {"tp": tp, "fp": fp, "tn": tn, "fn": fn}


def _metrics(cm: dict[str, int]) -> dict[str, float]:
    tp, fp, tn, fn = cm["tp"], cm["fp"], cm["tn"], cm["fn"]
    total = tp + fp + tn + fn
    accuracy = (tp + tn) / total if total else 0.0
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    false_invalid_rate = fp / (fp + tn) if (fp + tn) else 0.0  # valid → marked invalid
    false_valid_rate = fn / (fn + tp) if (fn + tp) else 0.0    # invalid → marked valid
    return {
        "accuracy": round(accuracy, 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "false_invalid_rate": round(false_invalid_rate, 4),
        "false_valid_rate": round(false_valid_rate, 4),
        "total_evaluated": total,
        "excluded": sum(1 for _ in range(0)) + (
            sum(1 for r in [None] if r is None)
        ),
    }


def _cost(records: list[dict[str, Any]], system_key: str,
          input_price: float, output_price: float) -> dict[str, Any]:
    total_in = total_out = total_calls = total_ms = count = 0
    for r in records:
        sr = r.get(system_key)
        if sr is None or sr.get("verdict") == "error":
            continue
        total_in += sr.get("input_tokens", 0)
        total_out += sr.get("output_tokens", 0)
        total_calls += sr.get("api_calls", 0)
        total_ms += sr.get("latency_ms", 0)
        count += 1
    if count == 0:
        return {}
    avg_in = total_in / count
    avg_out = total_out / count
    cost_per_claim = (avg_in / 1000 * input_price) + (avg_out / 1000 * output_price)
    return {
        "avg_input_tokens": round(avg_in, 1),
        "avg_output_tokens": round(avg_out, 1),
        "avg_api_calls": round(total_calls / count, 2),
        "avg_latency_ms": round(total_ms / count),
        "cost_per_claim_usd": round(cost_per_claim, 5),
        "projected_cost_100_claims_usd": round(cost_per_claim * 100, 3),
        "total_claims": count,
    }


def _tier_distribution(records: list[dict[str, Any]], system_key: str) -> dict[str, Any]:
    tier_counts: dict[int, int] = defaultdict(int)
    for r in records:
        sr = r.get(system_key)
        if sr is None or sr.get("verdict") == "error":
            continue
        tier_counts[sr.get("tier_reached", 0)] += 1
    total = sum(tier_counts.values())
    return {
        str(t): {"count": c, "pct": round(100 * c / total, 1) if total else 0.0}
        for t, c in sorted(tier_counts.items())
    }


def _per_type_metrics(
    records: list[dict[str, Any]], system_key: str
) -> dict[str, dict[str, float]]:
    by_type: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in records:
        by_type[r["claim_type"]].append(r)
    return {ct: _metrics(_confusion(recs, system_key)) for ct, recs in sorted(by_type.items())}


def _disagreements(records: list[dict[str, Any]], sys1: str, sys2: str) -> list[dict[str, Any]]:
    """Claims where sys1 and sys2 give different binary verdicts."""
    out = []
    for r in records:
        s1 = r.get(sys1)
        s2 = r.get(sys2)
        if s1 is None or s2 is None:
            continue
        v1 = _binary_verdict(s1.get("verdict"))
        v2 = _binary_verdict(s2.get("verdict"))
        if v1 is None or v2 is None:
            continue
        if v1 != v2:
            out.append({
                "claim_id": r["claim_id"],
                "claim_type": r["claim_type"],
                "ground_truth": r["ground_truth"],
                sys1: v1,
                sys2: v2,
                "correct": sys1 if v1 == _binary_verdict(r["ground_truth"]) else (
                    sys2 if v2 == _binary_verdict(r["ground_truth"]) else "neither"
                ),
            })
    return out


# ---------------------------------------------------------------------------
# Markdown report builder
# ---------------------------------------------------------------------------


def _pct(v: float) -> str:
    return f"{v * 100:.1f}%"


def _fmt_metrics_table(m: dict[str, float]) -> str:
    return (
        f"| Accuracy | Precision | Recall | F1 | False-Invalid | False-Valid | n |\n"
        f"|----------|-----------|--------|----|---------------|-------------|---|\n"
        f"| {_pct(m['accuracy'])} | {_pct(m['precision'])} | {_pct(m['recall'])} "
        f"| {_pct(m['f1'])} | {_pct(m['false_invalid_rate'])} "
        f"| {_pct(m['false_valid_rate'])} | {m['total_evaluated']} |"
    )


def _fmt_cost_table(c: dict[str, Any]) -> str:
    if not c:
        return "_No data_"
    return (
        f"| Avg Input Tokens | Avg Output Tokens | Avg API Calls | Avg Latency | "
        f"Cost/Claim | Cost/100 Claims |\n"
        f"|-----------------|-------------------|---------------|-------------|"
        f"-----------|----------------|\n"
        f"| {c['avg_input_tokens']} | {c['avg_output_tokens']} | {c['avg_api_calls']} "
        f"| {c['avg_latency_ms']} ms | ${c['cost_per_claim_usd']:.5f} "
        f"| ${c['projected_cost_100_claims_usd']:.3f} |"
    )


def _fmt_tier_table(dist: dict[str, Any]) -> str:
    if not dist:
        return "_No data_"
    rows = ["| Tier | Count | % of Claims |", "|------|-------|-------------|"]
    for tier, info in dist.items():
        rows.append(f"| {tier} | {info['count']} | {info['pct']}% |")
    return "\n".join(rows)


def _fmt_per_type_table(ptm: dict[str, dict[str, float]]) -> str:
    rows = [
        "| Claim Type | Accuracy | Precision | Recall | F1 | FIR | FVR | n |",
        "|------------|----------|-----------|--------|----|-----|-----|---|",
    ]
    for ct, m in ptm.items():
        rows.append(
            f"| {ct} | {_pct(m['accuracy'])} | {_pct(m['precision'])} "
            f"| {_pct(m['recall'])} | {_pct(m['f1'])} "
            f"| {_pct(m['false_invalid_rate'])} | {_pct(m['false_valid_rate'])} "
            f"| {m['total_evaluated']} |"
        )
    return "\n".join(rows)


def _fmt_disagreement_table(rows: list[dict[str, Any]], sys1: str, sys2: str) -> str:
    if not rows:
        return "_No disagreements found._"
    header = f"| Claim ID | Type | Ground Truth | {sys1} | {sys2} | Correct |"
    sep = "|----------|------|--------------|" + "----|" * 3
    lines = [header, sep]
    for r in rows:
        lines.append(
            f"| {r['claim_id']} | {r['claim_type']} | {r['ground_truth']} "
            f"| {r[sys1]} | {r[sys2]} | {r['correct']} |"
        )
    return "\n".join(lines)


def build_report(
    meta: dict[str, Any],
    records: list[dict[str, Any]],
    input_price: float,
    output_price: float,
) -> str:
    systems = meta.get("systems", ["A", "B", "C"])
    system_labels = {
        "system_a": "System A — Full HERALD",
        "system_b": "System B — LLM-as-Judge",
        "system_c": "System C — HERALD (no Tier 1)",
    }
    sys_keys = {s: f"system_{s.lower()}" for s in systems}

    sections: list[str] = []

    sections.append(f"# HERALD Experiment Analysis\n\n**Date**: {meta.get('date', date.today())}")
    sections.append(
        f"**Eval set**: `{meta.get('eval_set', 'N/A')}`  \n"
        f"**Systems**: {', '.join(systems)}  \n"
        f"**Total claims**: {meta.get('total_claims', len(records))}  \n"
        f"**Claim type filter**: {meta.get('claim_type_filter') or 'all'}  \n"
        f"**Dry run**: {meta.get('dry_run', False)}"
    )

    # ── Overall quality metrics ──
    sections.append("## 1. Overall Quality Metrics\n\n_Positive = invalid (the class we want to catch)._")
    for s in systems:
        key = sys_keys[s]
        label = system_labels.get(key, f"System {s}")
        cm = _confusion(records, key)
        m = _metrics(cm)
        sections.append(f"### {label}\n\n{_fmt_metrics_table(m)}")

    # ── Quality comparison summary ──
    if "A" in systems and "B" in systems:
        cm_a = _confusion(records, "system_a")
        cm_b = _confusion(records, "system_b")
        m_a = _metrics(cm_a)
        m_b = _metrics(cm_b)
        f1_delta = (m_a["f1"] - m_b["f1"]) * 100
        sections.append(
            f"### A vs. B Summary\n\n"
            f"F1 delta (A − B): **{f1_delta:+.1f} pp**  \n"
            f"{'HERALD outperforms' if f1_delta > 0 else 'LLM-as-Judge matches or outperforms HERALD'} "
            f"({'meaningful' if abs(f1_delta) >= 3 else 'marginal'} difference using ≥3 pp threshold)"
        )

    # ── Per claim type quality ──
    sections.append("## 2. Quality Metrics by Claim Type\n\n_FIR = False-Invalid Rate, FVR = False-Valid Rate._")
    for s in systems:
        key = sys_keys[s]
        label = system_labels.get(key, f"System {s}")
        ptm = _per_type_metrics(records, key)
        sections.append(f"### {label}\n\n{_fmt_per_type_table(ptm)}")

    # ── Cost & latency ──
    sections.append("## 3. Cost & Latency\n\n"
                    f"_Pricing: ${input_price}/1k input tokens, ${output_price}/1k output tokens "
                    f"(claude-sonnet-4-6)._")
    for s in systems:
        key = sys_keys[s]
        label = system_labels.get(key, f"System {s}")
        c = _cost(records, key, input_price, output_price)
        sections.append(f"### {label}\n\n{_fmt_cost_table(c)}")

    # ── Tier distribution ──
    sections.append("## 4. Tier Distribution (HERALD Systems)")
    for s in [x for x in systems if x in ("A", "C")]:
        key = sys_keys[s]
        label = system_labels.get(key, f"System {s}")
        dist = _tier_distribution(records, key)
        sections.append(f"### {label}\n\n{_fmt_tier_table(dist)}")

    # ── Cost-adjusted F1 ──
    if "A" in systems and "B" in systems:
        sections.append("## 5. Cost-Adjusted F1\n\n"
                        "_F1 / (cost per claim in USD). Higher = more quality per dollar._")
        rows = ["| System | F1 | Cost/Claim | Cost-Adjusted F1 |",
                "|--------|----|------------|-----------------|"]
        for s in systems:
            key = sys_keys[s]
            label = system_labels.get(key, f"System {s}")
            m = _metrics(_confusion(records, key))
            c = _cost(records, key, input_price, output_price)
            if c and c["cost_per_claim_usd"] > 0:
                ca_f1 = m["f1"] / c["cost_per_claim_usd"]
                rows.append(
                    f"| {label} | {_pct(m['f1'])} | ${c['cost_per_claim_usd']:.5f} "
                    f"| {ca_f1:.1f} |"
                )
            else:
                rows.append(f"| {label} | {_pct(m['f1'])} | N/A | N/A |")
        sections.append("\n".join(rows))

    # ── Disagreements ──
    if "A" in systems and "B" in systems:
        disag = _disagreements(records, "system_a", "system_b")
        sections.append(
            f"## 6. A vs. B Disagreements ({len(disag)} claims)\n\n"
            f"{_fmt_disagreement_table(disag, 'system_a', 'system_b')}"
        )

    # ── Decision criteria evaluation ──
    if "A" in systems and "B" in systems:
        m_a = _metrics(_confusion(records, "system_a"))
        m_b = _metrics(_confusion(records, "system_b"))
        c_a = _cost(records, "system_a", input_price, output_price)
        c_b = _cost(records, "system_b", input_price, output_price)
        f1_delta = (m_a["f1"] - m_b["f1"]) * 100

        ca_a = m_a["f1"] / c_a["cost_per_claim_usd"] if c_a and c_a.get("cost_per_claim_usd", 0) > 0 else 0
        ca_b = m_b["f1"] / c_b["cost_per_claim_usd"] if c_b and c_b.get("cost_per_claim_usd", 0) > 0 else 0

        if f1_delta >= 3 and ca_a >= ca_b:
            decision = "**HERALD is justified**: F1 improvement ≥ 3pp AND cost-adjusted F1 ≥ LLM-as-Judge."
        elif f1_delta >= 3 and ca_a < ca_b:
            decision = "**HERALD is marginal**: F1 improvement ≥ 3pp but cost-adjusted F1 is lower."
        elif 0 < f1_delta < 3 and ca_a >= ca_b:
            decision = "**HERALD is marginal**: Positive but sub-3pp F1 gain with favourable cost efficiency."
        else:
            decision = "**HERALD is not justified**: No meaningful F1 improvement and/or higher cost."

        sections.append(f"## 7. Decision Criteria\n\n{decision}")

    return "\n\n---\n\n".join(sections)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _auto_detect_results() -> Path | None:
    results_dir = Path(__file__).parent.parent / "results"
    if not results_dir.exists():
        return None
    candidates = sorted(results_dir.glob("experiment-*.json"), reverse=True)
    return candidates[0] if candidates else None


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", type=Path, default=None)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parent.parent / "results" / f"analysis-{date.today()}.md",
    )
    parser.add_argument("--sonnet-input-price", type=float, default=DEFAULT_INPUT_PRICE_PER_1K)
    parser.add_argument("--sonnet-output-price", type=float, default=DEFAULT_OUTPUT_PRICE_PER_1K)
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()

    results_path = args.results or _auto_detect_results()
    if results_path is None:
        print("No results file found. Run run_experiment.py first, or pass --results PATH.")
        sys.exit(1)

    print(f"Loading results from {results_path} ...")
    meta, records = load_results(results_path)

    report = build_report(meta, records, args.sonnet_input_price, args.sonnet_output_price)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(report)
    print(f"Analysis written to {args.output}")
