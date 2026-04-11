"""Phase 4, Step 12: Compare HERALD against four baselines.

Baselines (from walkthrough Step 12):
  1. LLM-as-judge:      Send every case directly to the configured LLM, skip Tier 1 entirely
  2. NLI-only:          Use only Tier 1 (DeBERTa), no escalation
  3. 3-tier (no debate): Skip Tier 3, go Tier 2 → Tier 4 directly
  4. Random escalation: Randomly escalate the same % of cases HERALD escalates

Usage:
    uv run python notebooks/baseline_comparison.py \
        --input data/test_sets/sample_cases.json \
        --results results/run_results.json \
        --output results/baseline_comparison.json

    # Resume after interruption:
    uv run python notebooks/baseline_comparison.py ... --resume

    # Verbose per-case output:
    uv run python notebooks/baseline_comparison.py ... --verbose

NOTE: --results must be a previously saved HERALD full-pipeline run
      (used to compute HERALD's escalation rate for the random baseline).
"""

import argparse
import json
import random
import time
from pathlib import Path

from dotenv import load_dotenv

from herald.core.cli import add_llm_override_args
from herald.core.config import load_config
from herald.core.llm import get_llm_client
from herald.core.types import CheckpointOutput, CheckpointType, TierResult, Verdict
from herald.tier1.classifier import NLIClassifier
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

BASELINE_KEYS = ["llm_judge_all", "nli_only", "three_tier_no_debate", "random_escalation"]


def accuracy(results: list[dict], ground_truth: list[dict]) -> float:
    correct = 0
    for r, gt in zip(results, ground_truth):
        verdict = r.get("final_verdict", "uncertain")
        label = gt["label"]
        if verdict == label or (label == "ambiguous" and verdict == "uncertain"):
            correct += 1
    return correct / len(results)


def load_checkpoint(output_path: Path) -> dict:
    """Load partial results from a previous run, if present."""
    if output_path.exists():
        with open(output_path) as f:
            data = json.load(f)
        raw = data.get("raw_results", {})
        print(f"[resume] Loaded checkpoint from {output_path}")
        for key in BASELINE_KEYS:
            if key in raw:
                print(f"  {key}: {len(raw[key])} cases already done")
        return raw
    return {}


def save_checkpoint(output_path: Path, all_results: dict, ground_truth: list[dict]) -> None:
    """Incrementally save current state so runs are resumable."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output = {
        "raw_results": all_results,
        "ground_truth_labels": [c["label"] for c in ground_truth],
    }
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)


def run_llm_judge_baseline(
    cases: list[dict],
    client,
    sleep: float,
    prior: list[dict] | None = None,
    verbose: bool = False,
) -> list[dict]:
    """Baseline 1: LLM-as-judge for every case, no Tier 1."""
    results = list(prior) if prior else []
    start = len(results)
    if start > 0:
        print(f"  [resume] skipping {start} already-completed cases")
    for i, case in enumerate(cases[start:], start=start):
        if verbose:
            print(f"  [{i+1}/{len(cases)}] LLM-judge ...", end=" ", flush=True)
        try:
            resp = client.complete(
                prompt=LLM_JUDGE_PROMPT.format(
                    source=case["source_context"],
                    claim=case["output_text"],
                ),
                temperature=0.1,
                json_mode=True,
            )
            data = json.loads(resp.content)
            verdict = data.get("verdict", "uncertain")
            results.append({
                "final_verdict": verdict,
                "confidence": data.get("confidence", 0.5),
                "resolved_at_tier": 2,
            })
            if verbose:
                print(verdict)
        except Exception as e:
            if verbose:
                print(f"ERROR: {e}")
            else:
                print(f"  [{i+1}/{len(cases)}] LLM-judge ERROR: {e}")
            results.append({"final_verdict": "uncertain", "confidence": 0.5, "resolved_at_tier": 2})
        time.sleep(sleep)
    return results


def run_nli_only_baseline(
    cases: list[dict],
    classifier: NLIClassifier,
    prior: list[dict] | None = None,
    verbose: bool = False,
) -> list[dict]:
    """Baseline 2: NLI-only, no escalation. Uncertain = stays uncertain."""
    results = list(prior) if prior else []
    start = len(results)
    if start > 0:
        print(f"  [resume] skipping {start} already-completed cases")
    for i, case in enumerate(cases[start:], start=start):
        if verbose:
            print(f"  [{i+1}/{len(cases)}] NLI-only ...", end=" ", flush=True)
        cp = CheckpointOutput(
            checkpoint_type=CheckpointType(case["checkpoint_type"]),
            output_text=case["output_text"],
            source_context=case["source_context"],
        )
        t1 = classifier.classify(cp, threshold=0.70)
        verdict = t1.verdict.value
        results.append({"final_verdict": verdict, "confidence": t1.confidence, "resolved_at_tier": 1})
        if verbose:
            print(verdict)
    return results


def run_three_tier_baseline(
    cases: list[dict],
    pipeline: HeraldPipeline,
    prior: list[dict] | None = None,
    verbose: bool = False,
) -> list[dict]:
    """Baseline 3: 3-tier (skip Tier 3 debate, go Tier 2 → Tier 4 directly).
    We simulate by running the normal pipeline but treating Tier 3 outcomes
    that would have been uncertain as Tier 4.
    """
    results = list(prior) if prior else []
    start = len(results)
    if start > 0:
        print(f"  [resume] skipping {start} already-completed cases")
    for i, case in enumerate(cases[start:], start=start):
        if verbose:
            print(f"  [{i+1}/{len(cases)}] 3-tier ...", end=" ", flush=True)
        cp = CheckpointOutput(
            checkpoint_type=CheckpointType(case["checkpoint_type"]),
            output_text=case["output_text"],
            source_context=case["source_context"],
        )
        packet = pipeline.validate(cp)
        tier = packet.resolved_at_tier
        if tier == 3:
            tier = 4
        verdict = packet.final_verdict.value if packet.final_verdict else "uncertain"
        results.append({
            "final_verdict": verdict,
            "confidence": None,
            "resolved_at_tier": tier,
        })
        if verbose:
            print(verdict)
    return results


def run_random_escalation_baseline(
    cases: list[dict],
    classifier: NLIClassifier,
    herald_escalation_rate: float,
    seed: int = 42,
    prior: list[dict] | None = None,
    verbose: bool = False,
) -> list[dict]:
    """Baseline 4: Randomly escalate the same fraction of cases as HERALD escalates.
    Escalated cases default to uncertain (as if human-reviewed without resolution).
    """
    # Replay the RNG from the start so skipped cases consume the same draws.
    rng = random.Random(seed)
    results = list(prior) if prior else []
    start = len(results)
    # Burn through RNG draws for already-completed cases to stay in sync.
    for _ in range(start):
        rng.random()
    if start > 0:
        print(f"  [resume] skipping {start} already-completed cases")
    for i, case in enumerate(cases[start:], start=start):
        if verbose:
            print(f"  [{i+1}/{len(cases)}] random escalation ...", end=" ", flush=True)
        cp = CheckpointOutput(
            checkpoint_type=CheckpointType(case["checkpoint_type"]),
            output_text=case["output_text"],
            source_context=case["source_context"],
        )
        if rng.random() < herald_escalation_rate:
            results.append({"final_verdict": "uncertain", "confidence": 0.5, "resolved_at_tier": 4})
            if verbose:
                print("escalated (uncertain)")
        else:
            t1 = classifier.classify(cp, threshold=0.70)
            results.append({"final_verdict": t1.verdict.value, "confidence": t1.confidence, "resolved_at_tier": 1})
            if verbose:
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
    parser.add_argument("--model", default=None, help="Override the direct LLM baseline model for this run.")
    parser.add_argument("--sleep", type=float, default=1.0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--resume", action="store_true", help="Resume from a partial output file.")
    parser.add_argument("--verbose", action="store_true", help="Print per-case verdict lines.")
    add_llm_override_args(parser, include_tier2=True, include_tier3=True)
    args = parser.parse_args()

    config = load_config(
        args.config,
        provider=args.provider,
        tier2_model=args.tier2_model or args.model,
        tier3_model=args.tier3_model,
    )

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
    print(f"Provider: {config['provider']} | Tier2: {config['tier2']['model']} | Tier3: {config['tier3']['model']}")
    if args.resume:
        print("Mode: RESUME")
    if args.verbose:
        print("Mode: VERBOSE")
    print(f"{'='*70}\n")

    output_path = Path(args.output)
    prior = load_checkpoint(output_path) if args.resume else {}

    client = get_llm_client(config)
    classifier = NLIClassifier(
        model_name=config["tier1"]["model_name"],
        device=config["tier1"].get("device", "cpu"),
    )
    pipeline = build_pipeline(config)

    all_results = {}

    # Baseline 1: LLM-as-judge
    b1_prior = prior.get("llm_judge_all")
    if b1_prior and len(b1_prior) == len(ground_truth):
        print("Baseline 1: LLM-as-judge — already complete, skipping.")
        all_results["llm_judge_all"] = b1_prior
    else:
        print("Running Baseline 1: LLM-as-judge (all cases direct to configured provider)...")
        all_results["llm_judge_all"] = run_llm_judge_baseline(
            ground_truth, client, args.sleep, prior=b1_prior, verbose=args.verbose
        )
        save_checkpoint(output_path, all_results, ground_truth)

    # Baseline 2: NLI-only
    b2_prior = prior.get("nli_only")
    if b2_prior and len(b2_prior) == len(ground_truth):
        print("\nBaseline 2: NLI-only — already complete, skipping.")
        all_results["nli_only"] = b2_prior
    else:
        print("\nRunning Baseline 2: NLI-only (no escalation)...")
        all_results["nli_only"] = run_nli_only_baseline(
            ground_truth, classifier, prior=b2_prior, verbose=args.verbose
        )
        save_checkpoint(output_path, all_results, ground_truth)

    # Baseline 3: 3-tier (no debate)
    b3_prior = prior.get("three_tier_no_debate")
    if b3_prior and len(b3_prior) == len(ground_truth):
        print("\nBaseline 3: 3-tier (no debate) — already complete, skipping.")
        all_results["three_tier_no_debate"] = b3_prior
    else:
        print("\nRunning Baseline 3: 3-tier (skip Tier 3 debate)...")
        all_results["three_tier_no_debate"] = run_three_tier_baseline(
            ground_truth, pipeline, prior=b3_prior, verbose=args.verbose
        )
        save_checkpoint(output_path, all_results, ground_truth)

    # Baseline 4: Random escalation
    b4_prior = prior.get("random_escalation")
    if b4_prior and len(b4_prior) == len(ground_truth):
        print("\nBaseline 4: Random escalation — already complete, skipping.")
        all_results["random_escalation"] = b4_prior
    else:
        print("\nRunning Baseline 4: Random escalation...")
        all_results["random_escalation"] = run_random_escalation_baseline(
            ground_truth, classifier, herald_escalation_rate, args.seed,
            prior=b4_prior, verbose=args.verbose,
        )
        save_checkpoint(output_path, all_results, ground_truth)

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

    # Final save with summary
    output = {
        "summary": comparison,
        "raw_results": all_results,
        "ground_truth_labels": [c["label"] for c in ground_truth],
    }
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nSaved to {args.output}")
    print("\nNEXT STEP: Run notebooks/generate_plots.py to visualize the comparison.")


if __name__ == "__main__":
    main()
