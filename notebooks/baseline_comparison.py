"""Phase 4, Step 12: Compare HERALD against four baselines.

Baselines (from walkthrough Step 12):
  1. LLM-as-judge:      Send every case directly to Groq, skip Tier 1 entirely
  2. NLI-only:          Use only Tier 1 (DeBERTa), no escalation
  3. 3-tier (no debate): Skip Tier 3, go Tier 2 → Tier 4 directly
  4. Random escalation: Randomly escalate the same % of cases HERALD escalates

Usage:
    uv run python notebooks/baseline_comparison.py \
        --input data/test_sets/sample_cases.json \
        --results results/run_results.json \
        --output results/baseline_comparison.json

NOTE: --results must be a previously saved HERALD full-pipeline run
      (used to compute HERALD's escalation rate for the random baseline).
"""

import argparse
import json
import os
import random
import time
from pathlib import Path

from dotenv import load_dotenv
from groq import Groq

from herald.core.config import load_config
from herald.core.types import CheckpointOutput, CheckpointType, TierResult, Verdict
from herald.tier1.classifier import NLIClassifier
from herald.tier2.judge import LLMJudge
from herald.pipeline.escalation import HeraldPipeline, build_pipeline

load_dotenv()

LLM_JUDGE_PROMPT = """You are an economics claim validator. Given a source passage and an extracted claim, determine:
- VALID: The claim is fully and directly supported by the source
- INVALID: The claim contains errors, fabrications, or unsupported assertions
- UNCERTAIN: The claim is ambiguous — reasonable but not directly entailed

Respond with ONLY JSON:
{{"verdict": "valid" | "invalid" | "uncertain", "confidence": 0.0-1.0, "reasoning": "one sentence"}}

SOURCE: {source}
CLAIM: {claim}"""


def accuracy(results: list[dict], ground_truth: list[dict]) -> float:
    correct = 0
    for r, gt in zip(results, ground_truth):
        verdict = r.get("final_verdict", "uncertain")
        label = gt["label"]
        if verdict == label or (label == "ambiguous" and verdict == "uncertain"):
            correct += 1
    return correct / len(results)


def run_llm_judge_baseline(cases: list[dict], client: Groq, model: str, sleep: float) -> list[dict]:
    """Baseline 1: LLM-as-judge for every case, no Tier 1."""
    results = []
    for i, case in enumerate(cases):
        print(f"  [{i+1}/{len(cases)}] LLM-judge ...", end=" ", flush=True)
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": LLM_JUDGE_PROMPT.format(
                    source=case["source_context"],
                    claim=case["output_text"],
                )}],
                temperature=0.1,
                response_format={"type": "json_object"},
            )
            data = json.loads(resp.choices[0].message.content)
            results.append({
                "final_verdict": data.get("verdict", "uncertain"),
                "confidence": data.get("confidence", 0.5),
                "resolved_at_tier": 2,
            })
            print(data.get("verdict", "?"))
        except Exception as e:
            print(f"ERROR: {e}")
            results.append({"final_verdict": "uncertain", "confidence": 0.5, "resolved_at_tier": 2})
        time.sleep(sleep)
    return results


def run_nli_only_baseline(cases: list[dict], classifier: NLIClassifier) -> list[dict]:
    """Baseline 2: NLI-only, no escalation. Uncertain = stays uncertain."""
    results = []
    for i, case in enumerate(cases):
        print(f"  [{i+1}/{len(cases)}] NLI-only ...", end=" ", flush=True)
        cp = CheckpointOutput(
            checkpoint_type=CheckpointType(case["checkpoint_type"]),
            output_text=case["output_text"],
            source_context=case["source_context"],
        )
        t1 = classifier.classify(cp, threshold=0.70)
        verdict = t1.verdict.value
        results.append({"final_verdict": verdict, "confidence": t1.confidence, "resolved_at_tier": 1})
        print(verdict)
    return results


def run_three_tier_baseline(cases: list[dict], pipeline: HeraldPipeline) -> list[dict]:
    """Baseline 3: 3-tier (skip Tier 3 debate, go Tier 2 → Tier 4 directly).
    We simulate by running the normal pipeline but treating Tier 3 outcomes
    that would have been uncertain as Tier 4.
    """
    results = []
    for i, case in enumerate(cases):
        print(f"  [{i+1}/{len(cases)}] 3-tier ...", end=" ", flush=True)
        cp = CheckpointOutput(
            checkpoint_type=CheckpointType(case["checkpoint_type"]),
            output_text=case["output_text"],
            source_context=case["source_context"],
        )
        packet = pipeline.validate(cp)
        # Remap: if resolved at Tier 3, count as Tier 2 (no debate step)
        # If it went to Tier 4 (already uncertain at T2), keep as T4
        tier = packet.resolved_at_tier
        if tier == 3:
            # Debate resolved it; without debate, T2 would have escalated directly to T4
            tier = 4
        results.append({
            "final_verdict": packet.final_verdict.value if packet.final_verdict else "uncertain",
            "confidence": None,
            "resolved_at_tier": tier,
        })
        print(packet.final_verdict.value if packet.final_verdict else "uncertain")
    return results


def run_random_escalation_baseline(
    cases: list[dict],
    classifier: NLIClassifier,
    herald_escalation_rate: float,
    seed: int = 42,
) -> list[dict]:
    """Baseline 4: Randomly escalate the same fraction of cases as HERALD escalates.
    Escalated cases default to uncertain (as if human-reviewed without resolution).
    """
    rng = random.Random(seed)
    results = []
    for i, case in enumerate(cases):
        print(f"  [{i+1}/{len(cases)}] random escalation ...", end=" ", flush=True)
        cp = CheckpointOutput(
            checkpoint_type=CheckpointType(case["checkpoint_type"]),
            output_text=case["output_text"],
            source_context=case["source_context"],
        )
        if rng.random() < herald_escalation_rate:
            # Randomly escalated — mark as uncertain
            results.append({"final_verdict": "uncertain", "confidence": 0.5, "resolved_at_tier": 4})
            print("escalated (uncertain)")
        else:
            t1 = classifier.classify(cp, threshold=0.70)
            results.append({"final_verdict": t1.verdict.value, "confidence": t1.confidence, "resolved_at_tier": 1})
            print(t1.verdict.value)
    return results


def print_comparison(label: str, results: list[dict], ground_truth: list[dict]) -> dict:
    acc = accuracy(results, ground_truth)
    t4_rate = sum(1 for r in results if r["resolved_at_tier"] == 4) / len(results)
    print(f"  {label:35s} accuracy={acc:.1%}  human_review={t4_rate:.0%}")
    return {"accuracy": acc, "human_review_rate": t4_rate}


def main():
    parser = argparse.ArgumentParser(description="Compare HERALD against baselines")
    parser.add_argument("--input", default="data/test_sets/sample_cases.json")
    parser.add_argument("--results", default="results/run_results.json", help="Prior HERALD run results")
    parser.add_argument("--config", default="configs/default.yaml")
    parser.add_argument("--output", default="results/baseline_comparison.json")
    parser.add_argument("--model", default="llama-3.3-70b-versatile")
    parser.add_argument("--sleep", type=float, default=1.0)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY not set. Add it to .env.")

    config = load_config(args.config)

    with open(args.input) as f:
        ground_truth = json.load(f)

    # Load prior HERALD results for escalation rate reference
    herald_results = None
    if Path(args.results).exists():
        with open(args.results) as f:
            herald_results = json.load(f)
    else:
        print(f"WARNING: {args.results} not found. Run the full pipeline first.")
        print("         Using escalation_rate=0.3 as default for random baseline.")

    herald_escalation_rate = 0.3
    if herald_results:
        n_escalated = sum(1 for r in herald_results if r["resolved_at_tier"] > 1)
        herald_escalation_rate = n_escalated / len(herald_results)

    print(f"\n{'='*70}")
    print("HERALD Baseline Comparison")
    print(f"Cases: {len(ground_truth)} | HERALD escalation rate: {herald_escalation_rate:.0%}")
    print(f"{'='*70}\n")

    client = Groq(api_key=api_key)
    classifier = NLIClassifier(
        model_name=config["tier1"]["model_name"],
        device=config["tier1"].get("device", "cpu"),
    )
    pipeline = build_pipeline(config)

    all_results = {}

    # Baseline 1: LLM-as-judge
    print("Running Baseline 1: LLM-as-judge (all cases direct to Groq)...")
    b1 = run_llm_judge_baseline(ground_truth, client, args.model, args.sleep)
    all_results["llm_judge_all"] = b1

    # Baseline 2: NLI-only
    print("\nRunning Baseline 2: NLI-only (no escalation)...")
    b2 = run_nli_only_baseline(ground_truth, classifier)
    all_results["nli_only"] = b2

    # Baseline 3: 3-tier (no debate)
    print("\nRunning Baseline 3: 3-tier (skip Tier 3 debate)...")
    b3 = run_three_tier_baseline(ground_truth, pipeline)
    all_results["three_tier_no_debate"] = b3

    # Baseline 4: Random escalation
    print("\nRunning Baseline 4: Random escalation...")
    b4 = run_random_escalation_baseline(ground_truth, classifier, herald_escalation_rate, args.seed)
    all_results["random_escalation"] = b4

    # Print comparison table
    print(f"\n{'='*70}")
    print("RESULTS SUMMARY")
    print(f"{'='*70}")
    comparison = {}
    for name, results in all_results.items():
        comparison[name] = print_comparison(name, results, ground_truth)

    # HERALD from saved results
    if herald_results:
        herald_acc = accuracy(herald_results, ground_truth)
        herald_t4 = sum(1 for r in herald_results if r["resolved_at_tier"] == 4) / len(herald_results)
        print(f"  {'HERALD (full pipeline)':35s} accuracy={herald_acc:.1%}  human_review={herald_t4:.0%}")
        comparison["herald"] = {"accuracy": herald_acc, "human_review_rate": herald_t4}

    # Save
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    output = {
        "summary": comparison,
        "raw_results": {k: v for k, v in all_results.items()},
        "ground_truth_labels": [c["label"] for c in ground_truth],
    }
    with open(args.output, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nSaved to {args.output}")
    print("\nNEXT STEP: Run notebooks/generate_plots.py to visualize the comparison.")


if __name__ == "__main__":
    main()
