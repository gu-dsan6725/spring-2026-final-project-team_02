"""Phase 1 Feasibility Check: Does DeBERTa NLI separate valid from invalid?

THIS IS THE FIRST THING YOU RUN.

Before running:
  1. You need test cases in data/test_sets/feasibility_samples.json
  2. See data/test_sets/sample_cases.json for the format
  3. Aim for 30-50 cases across valid/invalid/ambiguous

Usage:
  uv run python -m herald.notebooks.feasibility_check
"""

import json
import sys
from pathlib import Path

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

SAMPLE_PATH = "data/test_sets/feasibility_samples.json"
# Read from the loaded model's own config instead of a hardcoded constant


def run_nli(model, tokenizer, premise: str, hypothesis: str, device: str, label_map: dict) -> dict:
    inputs = tokenizer(
        premise,
        hypothesis,
        return_tensors="pt",
        truncation=True,
        max_length=512,
        padding=True,
    ).to(device)
    with torch.no_grad():
        probs = torch.softmax(model(**inputs).logits, dim=-1)[0]
    return {label_map[i]: probs[i].item() for i in range(3)}


def main():
    # Load samples
    if not Path(SAMPLE_PATH).exists():
        print(f"ERROR: {SAMPLE_PATH} not found.\n")
        print("Create this file first. You can copy and expand data/test_sets/sample_cases.json")
        print(
            "Make sure each entry has: source_context, output_text, label (valid/invalid/ambiguous)"
        )
        sys.exit(1)

    with open(SAMPLE_PATH) as f:
        samples = json.load(f)

    print(f"Loaded {len(samples)} samples")
    counts = {}
    for s in samples:
        counts[s["label"]] = counts.get(s["label"], 0) + 1
    print(f"Distribution: {counts}\n")

    # Load model — reads name from config so a single source of truth is maintained
    from herald.core.config import load_config

    try:
        cfg = load_config()
        model_name = cfg["tier1"]["model_name"]
    except Exception:
        model_name = "cross-encoder/nli-deberta-v3-large"
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Loading {model_name} on {device}...")
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSequenceClassification.from_pretrained(model_name)
    model.to(device).eval()
    label_map = {int(k): v.lower() for k, v in model.config.id2label.items()}
    print(f"Label map: {label_map}\nReady.\n")

    # Run inference
    results = {"valid": [], "invalid": [], "ambiguous": []}

    for i, s in enumerate(samples):
        scores = run_nli(model, tokenizer, s["source_context"], s["output_text"], device, label_map)
        label = s["label"]
        print(
            f"[{i + 1:3d}/{len(samples)}] {label:10s} | "
            f"ent={scores['entailment']:.3f} con={scores['contradiction']:.3f} "
            f"neu={scores['neutral']:.3f} | {s['output_text'][:55]}..."
        )
        if label in results:
            results[label].append(scores)

    # Analysis
    print(f"\n{'=' * 60}")
    print("FEASIBILITY RESULTS")
    print(f"{'=' * 60}")

    for label in ["valid", "invalid", "ambiguous"]:
        if not results[label]:
            continue
        ent = [s["entailment"] for s in results[label]]
        con = [s["contradiction"] for s in results[label]]
        print(f"\n{label.upper()} (n={len(results[label])})")
        print(
            f"  Entailment:    avg={sum(ent) / len(ent):.3f}  min={min(ent):.3f}  max={max(ent):.3f}"
        )
        print(
            f"  Contradiction: avg={sum(con) / len(con):.3f}  min={min(con):.3f}  max={max(con):.3f}"
        )

    # Key decision metric
    if results["valid"] and results["invalid"]:
        v_ent = [s["entailment"] for s in results["valid"]]
        i_ent = [s["entailment"] for s in results["invalid"]]
        min_valid = min(v_ent)
        max_invalid = max(i_ent)

        print(f"\n{'─' * 60}")
        print("GO / NO-GO DECISION")
        print(f"{'─' * 60}")
        print(f"Min entailment (valid cases):   {min_valid:.3f}")
        print(f"Max entailment (invalid cases):  {max_invalid:.3f}")

        if min_valid > max_invalid:
            print("\n✅ CLEAN SEPARATION — Tier 1 is feasible. Proceed to Phase 2.")
        elif min_valid > max_invalid - 0.2:
            print(
                f"\n⚠️  MODERATE OVERLAP ({max_invalid - min_valid:.3f}) — fine-tuning should fix this."
            )
        else:
            print(
                f"\n❌ SIGNIFICANT OVERLAP ({max_invalid - min_valid:.3f}) — consider alternative Tier 1 approaches."
            )

    # Save — keys match what phase_gates.py --phase 1 expects
    Path("results").mkdir(exist_ok=True)
    with open("results/feasibility_results.json", "w") as f:
        json.dump(
            {
                "samples_count": len(samples),
                "model": model_name,
                "by_label": {
                    k: {
                        "count": len(v),
                        "mean_entailment": sum(s["entailment"] for s in v) / len(v) if v else 0,
                        "mean_contradiction": sum(s["contradiction"] for s in v) / len(v)
                        if v
                        else 0,
                    }
                    for k, v in results.items()
                },
            },
            f,
            indent=2,
        )
    print("\nSaved to results/feasibility_results.json")


if __name__ == "__main__":
    main()
