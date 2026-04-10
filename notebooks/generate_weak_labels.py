"""Generate weak labels using a configurable LLM provider.

Usage:
    uv run python notebooks/generate_weak_labels.py \
        --input data/weak_labels/unlabeled_pairs.json \
        --output data/weak_labels/weak_labeled.json

Spot-check: randomly compare ~50 generated labels against your own judgment.
If fewer than 80% match, revise the LABELER_PROMPT below.
"""

import argparse
import json
import time
from pathlib import Path

from dotenv import load_dotenv
from herald.core.cli import add_llm_override_args
from herald.core.config import load_config
from herald.core.llm import get_llm_client

load_dotenv()

LABELER_PROMPT = """You are an economics claim validation labeler.

Given a SOURCE PASSAGE and an EXTRACTED CLAIM, determine whether the claim is:
- VALID: The claim is fully and directly supported by the source. Every fact, number, and assertion in the claim is present in the source or is a trivially correct paraphrase.
- INVALID: The claim contains at least one factual error, wrong number, fabricated detail, or assertion the source does not make.
- AMBIGUOUS: The claim is a reasonable inference from the source but goes slightly beyond what is explicitly stated. The claim could be defensible but is not directly entailed.

Rules:
1. Numbers must match the source within standard rounding (±0.1 percentage points for rates). A wrong number is always INVALID.
2. Causal language ("caused", "directly caused") that exceeds the source's language ("contributed to", "associated with") makes a claim INVALID.
3. A claim that adds any fact not in the source is at minimum AMBIGUOUS, and INVALID if the added fact is stated assertively as certain truth.
4. Respond with ONLY valid JSON. No markdown, no explanation outside the JSON.

SOURCE: {source}

CLAIM: {claim}

Respond with:
{{"label": "valid" | "invalid" | "ambiguous", "reasoning": "one sentence explaining the decision"}}"""


def label_pair(client, source: str, claim: str) -> dict:
    response = client.complete(
        prompt=LABELER_PROMPT.format(source=source, claim=claim),
        temperature=0.1,
        json_mode=True,
    )
    return json.loads(response.content)


def main():
    parser = argparse.ArgumentParser(description="Generate weak labels via a configurable LLM provider")
    parser.add_argument("--input", default="data/weak_labels/unlabeled_pairs.json")
    parser.add_argument("--output", default="data/weak_labels/weak_labeled.json")
    parser.add_argument("--config", default="configs/default.yaml")
    parser.add_argument("--sleep", type=float, default=0.5, help="Seconds between requests (rate limiting)")
    add_llm_override_args(
        parser,
        include_single_model=True,
        single_model_help="Override the model used for weak-label generation.",
    )
    args = parser.parse_args()

    config = load_config(
        args.config,
        provider=args.provider,
        tier2_model=args.model,
    )
    client = get_llm_client(config)

    with open(args.input) as f:
        pairs = json.load(f)

    print(f"Labeling {len(pairs)} pairs with {config['provider']} / {config['tier2']['model']}...")

    results = []
    errors = 0
    for i, pair in enumerate(pairs):
        try:
            result = label_pair(client, pair["source"], pair["claim"])
            entry = {**pair, "label": result["label"].lower(), "reasoning": result.get("reasoning", "")}
            results.append(entry)
            print(f"[{i+1:3d}/{len(pairs)}] {result['label']:9s} — {pair['claim'][:70]}...")
        except Exception as e:
            print(f"[{i+1:3d}/{len(pairs)}] ERROR: {e}")
            errors += 1
        time.sleep(args.sleep)

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w") as f:
        json.dump(results, f, indent=2)

    label_counts = {}
    for r in results:
        label_counts[r["label"]] = label_counts.get(r["label"], 0) + 1

    print(f"\n{'='*60}")
    print(f"Labeled {len(results)} pairs ({errors} errors) → {args.output}")
    print(f"Distribution: {label_counts}")
    print(f"\nNEXT STEP: Spot-check ~50 labels against your own judgment.")
    print(f"If <80% agree, revise LABELER_PROMPT in this file.")


if __name__ == "__main__":
    main()
