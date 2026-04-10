"""Phase Gate Checker — explicit GO/NO-GO for each project phase.

The proposal defines three explicit gates:
  Phase 1 gate: "NLI confidence must separate easy from hard cases"
  Phase 2 gate: "Tier 1 accuracy must exceed the NLI-only baseline"
  Phase 3 gate: "System must outperform LLM-as-judge baseline"

Run this after completing each phase to get a clear pass/fail verdict
before investing effort in the next phase.

Usage:
    # After Phase 1 (feasibility check):
    uv run python notebooks/phase_gates.py --phase 1 \
        --feasibility results/feasibility_results.json

    # After Phase 2 (fine-tuning):
    uv run python notebooks/phase_gates.py --phase 2 \
        --evaluation results/evaluation.json \
        --baseline results/baseline_comparison.json

    # After Phase 3 (full pipeline):
    uv run python notebooks/phase_gates.py --phase 3 \
        --evaluation results/evaluation.json \
        --baseline results/baseline_comparison.json
"""

import argparse
import json
from pathlib import Path


def gate_phase1(feasibility_path: str | None) -> tuple[bool, str]:
    """Phase 1: NLI confidence must separate easy from hard cases."""
    if not feasibility_path or not Path(feasibility_path).exists():
        return False, f"MISSING: {feasibility_path or 'no path given'} — run herald-feasibility first"

    with open(feasibility_path) as f:
        data = json.load(f)

    # Expected format from feasibility_check.py output
    # Keys: {"by_label": {"valid": {"mean_entailment": ...}, "invalid": {...}, "ambiguous": {...}}}
    by_label = data.get("by_label", {})
    if not by_label:
        return False, "feasibility_results.json has no 'by_label' key — check file format"

    valid_ent = by_label.get("valid", {}).get("mean_entailment", 0)
    invalid_con = by_label.get("invalid", {}).get("mean_contradiction", 0)
    ambiguous_ent = by_label.get("ambiguous", {}).get("mean_entailment", 0)

    print(f"  Valid   cases: mean entailment   = {valid_ent:.3f}  (target ≥ 0.80)")
    print(f"  Invalid cases: mean contradiction = {invalid_con:.3f}  (target ≥ 0.70)")
    print(f"  Ambiguous:     mean entailment    = {ambiguous_ent:.3f}  (expected ~0.3-0.6)")

    separation_gap = valid_ent - ambiguous_ent
    print(f"  Separation gap (valid - ambiguous entailment): {separation_gap:.3f}")

    if valid_ent >= 0.80 and invalid_con >= 0.70:
        return True, f"PASS — Clean separation (valid_ent={valid_ent:.2f}, invalid_con={invalid_con:.2f}). Proceed to fine-tuning."
    elif valid_ent >= 0.65 and invalid_con >= 0.55:
        return True, (
            f"CONDITIONAL PASS — Moderate separation (valid_ent={valid_ent:.2f}, invalid_con={invalid_con:.2f}). "
            "Fine-tuning will likely improve. Proceed with caution."
        )
    else:
        return False, (
            f"FAIL — Insufficient separation (valid_ent={valid_ent:.2f}, invalid_con={invalid_con:.2f}). "
            "NLI does not map to your validation task. Consider: (1) tightening validity definitions, "
            "(2) shortening input passages (DeBERTa truncates at 512 tokens), "
            "(3) replacing Tier 1 with a prompted small LLM (Llama 8B via Groq)."
        )


def gate_phase2(evaluation_path: str | None, baseline_path: str | None) -> tuple[bool, str]:
    """Phase 2: Tier 1 accuracy must exceed the NLI-only baseline."""
    if not evaluation_path or not Path(evaluation_path).exists():
        return False, f"MISSING: {evaluation_path} — run herald-eval first"
    if not baseline_path or not Path(baseline_path).exists():
        return False, f"MISSING: {baseline_path} — run notebooks/baseline_comparison.py first"

    with open(evaluation_path) as f:
        eval_data = json.load(f)
    with open(baseline_path) as f:
        baseline_data = json.load(f)

    herald_acc = eval_data.get("accuracy", {}).get("overall", {}).get("acc", 0)
    nli_only_acc = baseline_data.get("summary", {}).get("nli_only", {}).get("accuracy", 0)

    print(f"  HERALD overall accuracy:  {herald_acc:.1%}")
    print(f"  NLI-only baseline:        {nli_only_acc:.1%}")

    tier1_acc_data = eval_data.get("accuracy", {}).get("tier_1", {})
    tier1_acc = tier1_acc_data.get("acc", 0) if tier1_acc_data else 0
    print(f"  HERALD Tier 1 accuracy:   {tier1_acc:.1%}")

    if herald_acc > nli_only_acc + 0.05:
        return True, (
            f"PASS — HERALD ({herald_acc:.1%}) significantly outperforms NLI-only ({nli_only_acc:.1%}). "
            "Escalation is adding value. Proceed to full stack."
        )
    elif herald_acc > nli_only_acc:
        return True, (
            f"MARGINAL PASS — HERALD ({herald_acc:.1%}) slightly outperforms NLI-only ({nli_only_acc:.1%}). "
            "Escalation helps, but margin is small. Consider tuning T1 threshold."
        )
    else:
        return False, (
            f"FAIL — HERALD ({herald_acc:.1%}) does not outperform NLI-only ({nli_only_acc:.1%}). "
            "Escalation to Tier 2/3 is not helping. Investigate: "
            "(1) Is the T1 threshold too low (escalating too many easy cases)? "
            "(2) Is the LLM judge making errors on escalated cases? "
            "(3) Try fine-tuning DeBERTa before proceeding."
        )


def gate_phase3(evaluation_path: str | None, baseline_path: str | None) -> tuple[bool, str]:
    """Phase 3: System must outperform the LLM-as-judge baseline."""
    if not evaluation_path or not Path(evaluation_path).exists():
        return False, f"MISSING: {evaluation_path}"
    if not baseline_path or not Path(baseline_path).exists():
        return False, f"MISSING: {baseline_path}"

    with open(evaluation_path) as f:
        eval_data = json.load(f)
    with open(baseline_path) as f:
        baseline_data = json.load(f)

    herald_acc = eval_data.get("accuracy", {}).get("overall", {}).get("acc", 0)
    herald_human_rate = eval_data.get("human_review_rate", 1.0)
    llm_judge_acc = baseline_data.get("summary", {}).get("llm_judge_all", {}).get("accuracy", 0)
    llm_judge_human = baseline_data.get("summary", {}).get("llm_judge_all", {}).get("human_review_rate", 1.0)

    print(f"  HERALD accuracy:        {herald_acc:.1%}  (human review rate: {herald_human_rate:.0%})")
    print(f"  LLM-judge-all accuracy: {llm_judge_acc:.1%}  (human review rate: {llm_judge_human:.0%})")

    # Check debate value (3-tier vs 4-tier)
    three_tier_acc = baseline_data.get("summary", {}).get("three_tier_no_debate", {}).get("accuracy", None)
    if three_tier_acc is not None:
        debate_delta = herald_acc - three_tier_acc
        print(f"  3-tier (no debate):     {three_tier_acc:.1%}  (debate adds {debate_delta:+.1%})")

    cost_benefit = herald_acc - llm_judge_acc
    human_savings = llm_judge_human - herald_human_rate

    if herald_acc >= llm_judge_acc and herald_human_rate <= llm_judge_human:
        return True, (
            f"PASS — HERALD ({herald_acc:.1%}) matches/beats LLM-judge-all ({llm_judge_acc:.1%}) "
            f"while saving {human_savings:.0%} human review. System is working as designed."
        )
    elif herald_acc >= llm_judge_acc - 0.05 and herald_human_rate < 0.3:
        return True, (
            f"CONDITIONAL PASS — HERALD ({herald_acc:.1%}) is within 5% of LLM-judge-all ({llm_judge_acc:.1%}) "
            f"with substantially lower human review rate ({herald_human_rate:.0%}). "
            "Cost-accuracy tradeoff is acceptable for institutional deployment."
        )
    else:
        return False, (
            f"FAIL — HERALD ({herald_acc:.1%}) does not match LLM-judge-all ({llm_judge_acc:.1%}). "
            "The cascade is losing accuracy without saving cost. Investigate: "
            "(1) Check if T1 is making wrong confident calls. "
            "(2) Check if T2/T3 is correcting or degrading T1 errors. "
            "(3) Check confusion matrix for systematic error patterns."
        )


def main():
    parser = argparse.ArgumentParser(description="Check project phase gates")
    parser.add_argument("--phase", type=int, choices=[1, 2, 3], required=True)
    parser.add_argument("--feasibility", default="results/feasibility_results.json")
    parser.add_argument("--evaluation", default="results/evaluation.json")
    parser.add_argument("--baseline", default="results/baseline_comparison.json")
    args = parser.parse_args()

    GATE_TITLES = {
        1: "PHASE 1 GATE: NLI confidence must separate easy from hard cases",
        2: "PHASE 2 GATE: Tier 1 accuracy must exceed NLI-only baseline",
        3: "PHASE 3 GATE: System must outperform LLM-as-judge baseline",
    }

    print(f"\n{'='*70}")
    print(GATE_TITLES[args.phase])
    print(f"{'='*70}\n")

    if args.phase == 1:
        passed, message = gate_phase1(args.feasibility)
    elif args.phase == 2:
        passed, message = gate_phase2(args.evaluation, args.baseline)
    else:
        passed, message = gate_phase3(args.evaluation, args.baseline)

    print()
    status = "✅  GO" if passed else "❌  NO-GO"
    print(f"  {status}: {message}")
    print()

    if passed and args.phase < 3:
        next_phase = args.phase + 1
        print(f"  → Proceed to Phase {next_phase}.")
    elif not passed:
        print("  → Do NOT proceed to the next phase. Address the issues above first.")

    print(f"{'='*70}")
    return 0 if passed else 1


if __name__ == "__main__":
    exit(main())
