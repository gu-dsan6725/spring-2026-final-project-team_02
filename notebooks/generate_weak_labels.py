"""Generate weak labels using Groq (Llama 3.3 70B).

Usage:
    uv run python notebooks/generate_weak_labels.py \
        --input data/weak_labels/unlabeled_pairs.json \
        --output data/weak_labels/weak_labeled.json

Spot-check: randomly compare ~50 generated labels against your own judgment.
If fewer than 80% match, revise the LABELER_PROMPT below.
"""

import argparse
import json
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from groq import Groq

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


def label_pair(client: Groq, source: str, claim: str, model: str) -> dict:
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": LABELER_PROMPT.format(source=source, claim=claim)}],
        temperature=0.1,
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)


def main():
    parser = argparse.ArgumentParser(description="Generate weak labels via Groq")
    parser.add_argument("--input", default="data/weak_labels/unlabeled_pairs.json")
    parser.add_argument("--output", default="data/weak_labels/weak_labeled.json")
    parser.add_argument("--model", default="llama-3.3-70b-versatile")
    parser.add_argument("--sleep", type=float, default=0.5, help="Seconds between requests (rate limiting)")
    args = parser.parse_args()

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY not set. Add it to your .env file.")

    client = Groq(api_key=api_key)

    with open(args.input) as f:
        pairs = json.load(f)

    print(f"Labeling {len(pairs)} pairs with {args.model}...")

    results = []
    errors = 0
    for i, pair in enumerate(pairs):
        try:
            result = label_pair(client, pair["source"], pair["claim"], args.model)
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
