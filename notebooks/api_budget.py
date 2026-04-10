"""Phase 1 Deliverable: Estimate API budget for Tiers 2 and 3.

The proposal requires: "Estimate API budget for Tiers 2-3."

This script calculates projected costs given:
  - Test set size
  - Expected escalation rates (from feasibility check or prior runs)
  - Model pricing (Groq free, but tracks call volume for comparison)

Usage:
    # Estimate from scratch (before running anything):
    uv run python notebooks/api_budget.py --n-cases 75

    # Estimate from actual sweep results (after running threshold_sweep.py):
    uv run python notebooks/api_budget.py \
        --sweep results/threshold_sweep.json \
        --n-cases 75
"""

import argparse
import json
from pathlib import Path


# ── Model pricing table ───────────────────────────────────────────────────────
# Groq: currently free tier (as of 2024-2025). Paid pricing listed for comparison.
# GPT-4o pricing listed for proposal's "GPT-4 or equivalent" reference.
PRICING = {
    "groq_llama_3.3_70b_free": {
        "label": "Groq Llama-3.3-70B (free tier)",
        "input_per_1k": 0.0,
        "output_per_1k": 0.0,
        "rate_limit_rpm": 30,
        "note": "Free. Rate limit: ~30 req/min. Approx 1,000 tokens input + 300 tokens output per call.",
    },
    "groq_llama_3.3_70b_paid": {
        "label": "Groq Llama-3.3-70B (paid)",
        "input_per_1k": 0.00059,
        "output_per_1k": 0.00079,
        "note": "Paid tier pricing (USD per 1k tokens).",
    },
    "gpt4o": {
        "label": "GPT-4o (OpenAI, proposal reference)",
        "input_per_1k": 0.0025,
        "output_per_1k": 0.010,
        "note": "GPT-4o pricing as of early 2025.",
    },
    "gpt4o_mini": {
        "label": "GPT-4o-mini (cheap alternative)",
        "input_per_1k": 0.00015,
        "output_per_1k": 0.0006,
    },
}

# Average tokens per call (estimated)
TIER2_INPUT_TOKENS = 1100   # source + claim + T1 scores + prompt
TIER2_OUTPUT_TOKENS = 300   # reasoning + verdict JSON
TIER3_INPUT_TOKENS = 1500   # debate context is longer
TIER3_OUTPUT_TOKENS = 500   # longer arguments


def estimate_cost(
    n_cases: int,
    t1_escalation_rate: float,   # fraction escalating to T2
    t2_escalation_rate: float,   # fraction escalating to T3 (of those already in T2)
    t3_escalation_rate: float,   # fraction escalating to T4 (human)
    model_key: str = "groq_llama_3.3_70b_free",
) -> dict:
    pricing = PRICING[model_key]

    n_t2 = n_cases * t1_escalation_rate
    n_t3 = n_t2 * t2_escalation_rate
    n_t4 = n_t3 * t3_escalation_rate

    # T2: 1 call per case
    t2_calls = n_t2
    t2_input_tokens = t2_calls * TIER2_INPUT_TOKENS
    t2_output_tokens = t2_calls * TIER2_OUTPUT_TOKENS

    # T3: 3 calls per case (advocate, critic, judge)
    t3_calls = n_t3 * 3
    t3_input_tokens = t3_calls * TIER3_INPUT_TOKENS
    t3_output_tokens = t3_calls * TIER3_OUTPUT_TOKENS

    total_calls = t2_calls + t3_calls
    total_input = t2_input_tokens + t3_input_tokens
    total_output = t2_output_tokens + t3_output_tokens

    cost_input = (total_input / 1000) * pricing["input_per_1k"]
    cost_output = (total_output / 1000) * pricing["output_per_1k"]
    total_cost = cost_input + cost_output

    human_cost_per_case = 5.0  # from evaluation.py assumption
    human_cost = n_t4 * human_cost_per_case
    llm_judge_all_cost = (
        (n_cases * TIER2_INPUT_TOKENS / 1000) * pricing["input_per_1k"] +
        (n_cases * TIER2_OUTPUT_TOKENS / 1000) * pricing["output_per_1k"]
    )

    # Rate limit time estimate (Groq free: 30 rpm)
    rate_limit_rpm = pricing.get("rate_limit_rpm", 60)
    time_minutes = total_calls / rate_limit_rpm if rate_limit_rpm > 0 else 0

    return {
        "model": pricing["label"],
        "n_cases": n_cases,
        "n_t2": n_t2,
        "n_t3": n_t3,
        "n_t4_human": n_t4,
        "t2_calls": t2_calls,
        "t3_calls": t3_calls,
        "total_api_calls": total_calls,
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
        "api_cost_usd": total_cost,
        "human_cost_usd": human_cost,
        "total_cost_usd": total_cost + human_cost,
        "llm_judge_all_cost_usd": llm_judge_all_cost,
        "cost_per_case_usd": (total_cost + human_cost) / n_cases,
        "time_estimate_minutes": time_minutes,
    }


def print_budget_table(estimates: list[dict]) -> None:
    print(f"\n{'='*70}")
    print("API BUDGET ESTIMATE")
    print(f"{'='*70}")

    e = estimates[0]  # Primary estimate
    print(f"\nTest set size:          {e['n_cases']} cases")
    print(f"\nEscalation breakdown:")
    print(f"  Tier 1 (DeBERTa):     {e['n_cases'] - e['n_t2']:.0f} cases resolved ({(e['n_cases'] - e['n_t2'])/e['n_cases']:.0%})")
    print(f"  Tier 2 (LLM Judge):   {e['n_t2']:.0f} cases → {e['t2_calls']:.0f} API calls")
    print(f"  Tier 3 (Debate):      {e['n_t3']:.0f} cases → {e['t3_calls']:.0f} API calls (3 calls each)")
    print(f"  Tier 4 (Human):       {e['n_t4_human']:.0f} cases")
    print(f"\n  Total API calls:      {e['total_api_calls']:.0f}")
    print(f"  Total input tokens:   ~{e['total_input_tokens']:,.0f}")
    print(f"  Total output tokens:  ~{e['total_output_tokens']:,.0f}")

    print(f"\n{'Model':35s} {'API Cost':12s} {'Human Cost':12s} {'Total':12s} {'Per Case':10s}")
    print("-" * 85)
    for est in estimates:
        print(
            f"  {est['model'][:33]:33s} "
            f"${est['api_cost_usd']:8.4f}   "
            f"${est['human_cost_usd']:8.2f}   "
            f"${est['total_cost_usd']:8.2f}   "
            f"${est['cost_per_case_usd']:7.4f}"
        )

    print(f"\nComparison — LLM-judge-all baseline (all cases → Tier 2):")
    for est in estimates:
        print(f"  {est['model'][:33]:33s} ${est['llm_judge_all_cost_usd']:8.4f}  (vs HERALD: ${est['api_cost_usd']:8.4f})")

    e = estimates[0]
    if e["time_estimate_minutes"] > 0:
        print(f"\nRate limit estimate (Groq free, 30 rpm): ~{e['time_estimate_minutes']:.0f} minutes")
        print("  TIP: Add time.sleep(2) between Groq calls to avoid 429 errors.")


def main():
    parser = argparse.ArgumentParser(description="Estimate HERALD API budget")
    parser.add_argument("--n-cases", type=int, default=75, help="Number of test cases")
    parser.add_argument("--t1-escalation", type=float, default=0.40, help="Fraction escalating to T2")
    parser.add_argument("--t2-escalation", type=float, default=0.50, help="Fraction of T2 cases escalating to T3")
    parser.add_argument("--t3-escalation", type=float, default=0.30, help="Fraction of T3 cases escalating to T4")
    parser.add_argument("--sweep", default=None, help="Optional: path to threshold_sweep.json to use actual rates")
    parser.add_argument("--output", default="results/api_budget.json")
    args = parser.parse_args()

    # Override with actual sweep data if available
    if args.sweep and Path(args.sweep).exists():
        with open(args.sweep) as f:
            sweep = json.load(f)
        # Use the configuration with best accuracy
        best = max(sweep, key=lambda r: r["accuracy"])
        args.t1_escalation = 1.0 - best["tier1_rate"]
        args.t2_escalation = best["tier2_rate"] / max(1.0 - best["tier1_rate"], 0.001)
        args.t3_escalation = best["tier3_rate"] / max(best["tier2_rate"], 0.001)
        print(f"Using actual rates from sweep (best config: T1={best['T1']}, T2={best['T2']}):")
        print(f"  T1 escalation: {args.t1_escalation:.0%}, T2 escalation: {args.t2_escalation:.0%}, T3 escalation: {args.t3_escalation:.0%}")

    models = ["groq_llama_3.3_70b_free", "groq_llama_3.3_70b_paid", "gpt4o"]
    estimates = [
        estimate_cost(args.n_cases, args.t1_escalation, args.t2_escalation, args.t3_escalation, m)
        for m in models
    ]

    print_budget_table(estimates)

    # Sensitivity analysis: vary T1 escalation rate
    print(f"\n{'='*70}")
    print("Sensitivity: Cost vs. T1 Escalation Rate (Groq free)")
    print(f"{'T1 Esc Rate':15s} {'API Calls':12s} {'API Cost':12s} {'Total Cost':12s}")
    print("-" * 55)
    for t1_rate in [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]:
        e = estimate_cost(args.n_cases, t1_rate, args.t2_escalation, args.t3_escalation, "groq_llama_3.3_70b_free")
        print(f"  {t1_rate:.0%}{'':10s} {e['total_api_calls']:8.0f}     ${e['api_cost_usd']:8.4f}     ${e['total_cost_usd']:8.2f}")

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w") as f:
        json.dump({"parameters": vars(args), "estimates": estimates}, f, indent=2)
    print(f"\nSaved to {args.output}")


if __name__ == "__main__":
    main()
