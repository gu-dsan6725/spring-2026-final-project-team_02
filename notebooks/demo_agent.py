"""End-to-end HERALD demo: 5-checkpoint economics research agent.

The proposal describes HERALD "attaching to an economics research agent that answers
questions like: 'What is the relationship between interest rates and housing starts
in the United States, 2010-2020?'"

This script simulates that agent running all 5 checkpoints sequentially:
  CP1 → Document Retrieval
  CP2 → Claim Extraction
  CP3 → Narrative Synthesis
  CP4 → Numerical Reporting
  CP5 → Causal Conclusion

HERALD validates each checkpoint. If a checkpoint fails (INVALID verdict),
the pipeline halts — preventing downstream compounding.

Usage:
    uv run python notebooks/demo_agent.py
    uv run python notebooks/demo_agent.py --inject-error cp2
    uv run python notebooks/demo_agent.py --inject-error cp5 --verbose
"""

import argparse
import json
import os
from pathlib import Path

from dotenv import load_dotenv

from herald.core.cli import add_llm_override_args
from herald.core.config import load_config
from herald.core.types import CheckpointOutput, CheckpointType, Verdict
from herald.pipeline.escalation import build_pipeline

load_dotenv()

# ── Simulated agent outputs for each checkpoint ───────────────────────────────
# These represent what the economics agent produces at each step.
# "error" variants introduce the exact mistakes the proposal's illustrative
# examples describe (CP2: 40% decline; CP5: "directly caused").

SCENARIO = {
    "query": "What is the relationship between interest rates and housing starts in the United States, 2010-2020?",

    "cp1": {
        "label": "Document Retrieval",
        "source_context": "What is the relationship between interest rates and housing starts in the United States, 2010-2020?",
        "valid_output": (
            "Retrieved: 'Federal Reserve Monetary Policy Report, 2018' — discusses the federal funds rate "
            "increases and their documented impact on mortgage applications and housing sector activity."
        ),
        "error_output": (
            "Retrieved: 'Analysis of Agricultural Commodity Prices in Sub-Saharan Africa, 2015-2020' "
            "— examines maize and sorghum price volatility in Kenya and Tanzania."
        ),
    },

    "cp2": {
        "label": "Claim Extraction",
        "source_context": (
            "The Federal Reserve raised rates four times in 2018, contributing to a slowdown in "
            "mortgage applications. According to the Mortgage Bankers Association, the Market "
            "Composite Index declined steadily throughout the year."
        ),
        "valid_output": "The Federal Reserve raised interest rates four times in 2018.",
        "error_output": (
            # Proposal's exact CP2 invalid example
            "The Federal Reserve raised rates four times in 2018, causing a 40% decline in mortgage applications."
        ),
    },

    "cp3": {
        "label": "Narrative Synthesis",
        "source_context": (
            "Claim 1: The Fed raised rates four times in 2018. "
            "Claim 2: Housing starts fell 3.2% in Q4 2018. "
            "Claim 3: Multiple factors influenced the housing market including labor shortages and material costs."
        ),
        "valid_output": (
            "In 2018, the Federal Reserve implemented four rate hikes. Housing construction slowed, "
            "with starts declining 3.2% in the final quarter. While monetary tightening played a role, "
            "the slowdown reflected multiple factors including labor constraints and rising input costs."
        ),
        "error_output": (
            "In 2018, interest rate increases by the Federal Reserve caused housing starts to collapse "
            "by over 15%, triggering a nationwide construction slowdown driven entirely by tighter credit conditions."
        ),
    },

    "cp4": {
        "label": "Numerical Reporting",
        "source_context": (
            "Housing starts fell 3.2% in the fourth quarter of 2018 according to Census Bureau data, "
            "reaching a seasonally adjusted annual rate of 1.078 million units."
        ),
        "valid_output": (
            "Housing starts declined in late 2018, falling to approximately 1.08 million units "
            "on an annualized basis."
        ),
        "error_output": (
            "Housing starts fell approximately 5% in Q4 2018, dropping below 1.0 million units annually."
        ),
    },

    "cp5": {
        "label": "Causal Conclusion",
        "source_context": (
            "The Federal Reserve raised the federal funds rate four times in 2018. "
            "During the same period, housing starts declined from 1.21 million (Q1) to 1.08 million (Q4) "
            "on a seasonally adjusted annual basis. Multiple factors influenced the housing market "
            "including labor shortages, rising material costs, and regulatory changes."
        ),
        "valid_output": (
            "Rate increases in 2018 were one of several factors contributing to the decline in housing starts."
        ),
        "error_output": (
            # Proposal's exact CP5 invalid example
            "Rising interest rates directly caused the decline in housing starts during 2018."
        ),
    },
}

CHECKPOINT_ORDER = ["cp1", "cp2", "cp3", "cp4", "cp5"]
CHECKPOINT_TYPES = {
    "cp1": CheckpointType.RETRIEVAL,
    "cp2": CheckpointType.CLAIM_EXTRACTION,
    "cp3": CheckpointType.SYNTHESIS,
    "cp4": CheckpointType.NUMERICAL,
    "cp5": CheckpointType.CAUSAL,
}


def print_divider(char="─", width=70):
    print(char * width)


def run_agent(pipeline, inject_error: str | None, verbose: bool, output_dir: Path) -> dict:
    query = SCENARIO["query"]
    print(f"\n{'='*70}")
    print("HERALD DEMO — Economics Research Agent")
    print(f"{'='*70}")
    print(f"Query: {query}")
    print(f"Error injection: {inject_error or 'None (all valid outputs)'}")
    print()

    agent_log = []
    halted_at = None

    for cp_key in CHECKPOINT_ORDER:
        cp_data = SCENARIO[cp_key]
        cp_type = CHECKPOINT_TYPES[cp_key]
        cp_label = cp_data["label"]

        # Select output: inject error at requested checkpoint
        if inject_error and cp_key == inject_error:
            agent_output = cp_data["error_output"]
            injected = True
        else:
            agent_output = cp_data["valid_output"]
            injected = False

        print_divider()
        print(f"  {cp_key.upper()}: {cp_label}")
        if injected:
            print("  *** ERROR INJECTED ***")
        print(f"  Agent output: {agent_output[:100]}...")
        print()

        checkpoint = CheckpointOutput(
            checkpoint_type=cp_type,
            output_text=agent_output,
            source_context=cp_data["source_context"],
            query=query,
        )

        packet = pipeline.validate(checkpoint)
        verdict = packet.final_verdict
        tier = packet.resolved_at_tier

        status = {
            Verdict.VALID: "✓ VALID",
            Verdict.INVALID: "✗ INVALID",
            Verdict.UNCERTAIN: "? UNCERTAIN",
        }.get(verdict, "? UNKNOWN")

        print(f"  HERALD verdict: {status} (resolved at Tier {tier})")

        if verbose and packet.tier1_result:
            scores = packet.tier1_result.raw_scores
            print(f"  T1 NLI: ent={scores.get('entailment', 0):.3f}  "
                  f"con={scores.get('contradiction', 0):.3f}  "
                  f"neu={scores.get('neutral', 0):.3f}")
        if verbose and packet.tier2_result:
            print(f"  T2 reasoning: {packet.tier2_result.reasoning[:100]}...")
        if verbose and packet.tier3_result:
            print(f"  T3 judge: {packet.tier3_result.judge_reasoning[:100]}...")

        log_entry = {
            "checkpoint": cp_key,
            "checkpoint_type": cp_type.value,
            "label": cp_label,
            "injected_error": injected,
            "agent_output": agent_output,
            "verdict": verdict.value,
            "resolved_at_tier": tier,
            "tier1_confidence": round(packet.tier1_result.confidence, 3) if packet.tier1_result else None,
        }
        agent_log.append(log_entry)

        if verdict == Verdict.INVALID:
            print()
            print(f"  !! PIPELINE HALTED at {cp_key.upper()} — INVALID output detected.")
            print(f"     This prevents the error from compounding into downstream checkpoints.")
            halted_at = cp_key
            break
        elif verdict == Verdict.UNCERTAIN:
            print(f"  (!) Uncertain — continuing but flagged for review.")

        print()

    print_divider("═")
    if halted_at:
        remaining = CHECKPOINT_ORDER[CHECKPOINT_ORDER.index(halted_at) + 1:]
        print(f"\n  RESULT: Pipeline halted at {halted_at.upper()}.")
        print(f"  Skipped checkpoints: {', '.join(c.upper() for c in remaining)}")
        print(f"  This demonstrates HERALD's core value: catching errors before they compound.")
    else:
        print(f"\n  RESULT: All 5 checkpoints passed successfully.")
    print()

    return {"query": query, "inject_error": inject_error, "halted_at": halted_at, "checkpoints": agent_log}


def main():
    parser = argparse.ArgumentParser(description="HERALD 5-checkpoint agent demo")
    parser.add_argument(
        "--inject-error", default=None,
        choices=["cp1", "cp2", "cp3", "cp4", "cp5"],
        help="Inject an error at this checkpoint (default: all valid)",
    )
    parser.add_argument("--config", default="configs/default.yaml")
    parser.add_argument("--output", default="results/demo_agent.json")
    parser.add_argument("-v", "--verbose", action="store_true")
    add_llm_override_args(parser, include_tier2=True, include_tier3=True)
    args = parser.parse_args()

    config = load_config(
        args.config,
        provider=args.provider,
        tier2_model=args.tier2_model,
        tier3_model=args.tier3_model,
    )
    pipeline = build_pipeline(config)

    result = run_agent(pipeline, args.inject_error, args.verbose, Path(args.output).parent)

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w") as f:
        json.dump(result, f, indent=2)
    print(f"Run log saved to {args.output}")

    print("\nTRY THESE VARIANTS:")
    print("  All valid:       uv run python notebooks/demo_agent.py")
    print("  CP2 fabrication: uv run python notebooks/demo_agent.py --inject-error cp2")
    print("  CP5 causal:      uv run python notebooks/demo_agent.py --inject-error cp5")
    print("  With details:    uv run python notebooks/demo_agent.py --inject-error cp5 -v")


if __name__ == "__main__":
    main()
