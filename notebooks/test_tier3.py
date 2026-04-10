"""Phase 3, Step 8: Test Tier 3 (Multi-Agent Debate) in isolation.

Runs the full Advocate / Critic / Judge debate on a specified case.
Useful for understanding debate quality on hard cases before running the full pipeline.

Usage:
    uv run python notebooks/test_tier3.py
    uv run python notebooks/test_tier3.py --input data/test_sets/sample_cases.json --case 5
"""

import argparse
import json
import os

from dotenv import load_dotenv

from herald.core.types import CheckpointOutput, CheckpointType, TierResult, Verdict
from herald.tier3.debate import MultiAgentDebate

load_dotenv()

# Built-in hard cases for quick demo (causal / ambiguous)
DEMO_CASES = [
    {
        "description": "Causal overclaim — interest rates and housing",
        "checkpoint_type": "causal",
        "output_text": "Rising interest rates directly caused the decline in housing starts during 2018.",
        "source_context": (
            "The Federal Reserve raised the federal funds rate four times in 2018. "
            "During the same period, housing starts declined from 1.21 million (Q1) to 1.08 million (Q4) "
            "on a seasonally adjusted annual basis. Multiple factors influenced the housing market "
            "including labor shortages, rising material costs, and regulatory changes."
        ),
        "label": "invalid",
    },
    {
        "description": "Ambiguous inflation inference — Fed credibility",
        "checkpoint_type": "claim_extraction",
        "output_text": "Inflation in the United States reached multi-decade highs in 2021, raising concerns about the Federal Reserve's inflation-fighting credibility.",
        "source_context": "The Consumer Price Index for All Urban Consumers (CPI-U) rose 7.0 percent over the 12 months ending December 2021, the largest 12-month increase since the period ending June 1982.",
        "label": "ambiguous",
    },
]


def fake_t1(conf: float = 0.40) -> TierResult:
    return TierResult(
        tier=1,
        verdict=Verdict.UNCERTAIN,
        confidence=conf,
        raw_scores={"entailment": 0.3, "contradiction": 0.3, "neutral": 0.4},
    )


def fake_t2(conf: float = 0.55, reasoning: str = "Case is genuinely ambiguous; further scrutiny warranted.") -> TierResult:
    return TierResult(
        tier=2,
        verdict=Verdict.UNCERTAIN,
        confidence=conf,
        reasoning=reasoning,
    )


def run_debate(debate: MultiAgentDebate, case: dict) -> None:
    cp = CheckpointOutput(
        checkpoint_type=CheckpointType(case["checkpoint_type"]),
        output_text=case["output_text"],
        source_context=case["source_context"],
    )
    t1 = fake_t1()
    t2 = fake_t2()

    print(f"\n{'='*70}")
    print(f"CASE: {case.get('description', case['checkpoint_type'])}")
    print(f"  Output text: {case['output_text'][:100]}...")
    print(f"  Ground truth: {case['label']}")
    print(f"{'='*70}")

    result = debate.debate(cp, t1, t2)

    print(f"\nADVOCATE (for validity):")
    print(f"  {result.advocate_argument[:300]}...")
    print(f"\nCRITIC (against validity):")
    print(f"  {result.critic_argument[:300]}...")
    print(f"\nJUDGE VERDICT: {result.judge_verdict.value.upper()} (confidence={result.judge_confidence:.2f})")
    print(f"JUDGE REASONING:")
    print(f"  {result.judge_reasoning}")


def main():
    parser = argparse.ArgumentParser(description="Test Tier 3 Multi-Agent Debate in isolation")
    parser.add_argument("--input", default=None, help="Optional JSON test file")
    parser.add_argument("--case", type=int, default=None, help="0-indexed case number from --input")
    parser.add_argument("--model", default="llama-3.3-70b-versatile")
    args = parser.parse_args()

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY not set. Add it to .env.")

    debate = MultiAgentDebate(api_key=api_key, model=args.model)

    print(f"\n{'='*70}")
    print("HERALD Tier 3 — Multi-Agent Debate (Isolated Test)")
    print(f"Model: {args.model}")
    print(f"{'='*70}")

    if args.input and args.case is not None:
        with open(args.input) as f:
            cases = json.load(f)
        if args.case >= len(cases):
            raise ValueError(f"--case {args.case} out of range (0-{len(cases)-1})")
        run_debate(debate, cases[args.case])
    else:
        print(f"\nRunning {len(DEMO_CASES)} built-in demo cases...")
        for case in DEMO_CASES:
            run_debate(debate, case)

    print(f"\n{'='*70}")
    print("Tier 3 test complete.")
    print("NOTE: Tier 3 uses 3 API calls per case (advocate, critic, judge).")
    print("      Budget ~6 Groq calls per full-pipeline case that reaches Tier 3.")


if __name__ == "__main__":
    main()
