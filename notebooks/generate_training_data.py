"""Generate fine-tuning training data for Tier 1 DeBERTa from existing run results.

Three data sources are combined:
  1. Labeled test set (306 cases from gov_report_v2_filtered.json)
  2. Hard negatives from run results — cases where T1 was confidently wrong and a
     higher tier overrode it. These are the most valuable training examples because
     they are exactly the failure mode we want to fix.
  3. Synthetic numeric perturbations — valid cases with one number mutated to a
     plausible-but-wrong value, labeled invalid. Teaches numeric discrimination
     without manual annotation.

Output format (one JSON object per line, or as a JSON array):
  {"premise": <source_context>, "hypothesis": <output_text>, "label": 0|1|2}

Label encoding (matches microsoft/deberta-v3-large-mnli):
  0 = contradiction  →  invalid
  1 = neutral        →  ambiguous / uncertain
  2 = entailment     →  valid

Usage:
  uv run python notebooks/generate_training_data.py \\
    --test-set data/test_sets/gov_report_v2_filtered.json \\
    --results results/runs/run_05_govreport_v2/results.json \\
    --output data/training/tier1_training_data.json \\
    --synthetic-augment

  # Then fine-tune:
  uv run python notebooks/finetune_tier1.py \\
    --data data/training/tier1_training_data.json \\
    --output models/deberta-finetuned-herald
"""

import argparse
import json
import random
import re
from pathlib import Path

# ── Label mapping ─────────────────────────────────────────────────────────────

LABEL_TO_ID = {"valid": 2, "invalid": 0, "ambiguous": 1, "uncertain": 1}


# ── Source 1: labeled test set ────────────────────────────────────────────────


def load_test_set(path: str) -> list[dict]:
    """Convert test set cases to training format."""
    with open(path) as f:
        cases = json.load(f)

    records = []
    for case in cases:
        label_str = case.get("label", "")
        if label_str not in LABEL_TO_ID:
            continue
        records.append(
            {
                "premise": case["source_context"],
                "hypothesis": case["output_text"],
                "label": LABEL_TO_ID[label_str],
                "checkpoint_type": case.get("checkpoint_type", ""),
                "source": "test_set",
            }
        )
    return records


# ── Source 2: hard negatives from run results ─────────────────────────────────


def load_hard_negatives(
    results_path: str,
    test_set_path: str,
    t1_confidence_min: float = 0.85,
) -> list[dict]:
    """Extract cases where T1 was confidently wrong.

    A hard negative is a case where:
    - T1 resolved with confidence >= t1_confidence_min (very sure)
    - The final verdict (from T2/T3 or ground truth) disagrees with T1

    These are the most valuable examples: they teach the model to be less
    confident on claims that look textually similar but are factually wrong.
    """
    with open(results_path) as f:
        results = json.load(f)
    with open(test_set_path) as f:
        test_cases = json.load(f)

    assert len(results) == len(test_cases), "Results and test set length mismatch"

    hard_negatives = []
    for result, case in zip(results, test_cases, strict=False):
        t1_conf = result.get("tier1_confidence")
        final_verdict = result.get("final_verdict", "")
        true_label = case.get("label", "")

        # Only use cases resolved at T1 where T1 disagreed with ground truth
        if result.get("resolved_at_tier") != 1:
            continue
        if t1_conf is None or t1_conf < t1_confidence_min:
            continue
        if final_verdict == true_label:
            continue  # T1 was correct — not a hard negative
        if true_label not in LABEL_TO_ID:
            continue

        hard_negatives.append(
            {
                "premise": case["source_context"],
                "hypothesis": case["output_text"],
                "label": LABEL_TO_ID[true_label],  # Use ground truth, not T1 verdict
                "checkpoint_type": case.get("checkpoint_type", ""),
                "source": "hard_negative",
                "t1_confidence": t1_conf,
                "t1_was_wrong": final_verdict,
            }
        )

    return hard_negatives


# ── Source 3: synthetic numeric perturbations ─────────────────────────────────


def _extract_numbers(text: str) -> list[tuple[str, int]]:
    """Return (token, start_pos) pairs for all numeric tokens in text."""
    pattern = re.compile(
        r"""
        \$?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?   # comma-grouped numbers
        | \d+\.\d+%?                           # decimals
        | \d{4}                                # years
        | \d+%?                                # plain integers
        """,
        re.VERBOSE,
    )
    return [(m.group(), m.start()) for m in pattern.finditer(text)]


def _perturb_number(token: str) -> str:
    """Return a plausible-but-wrong numeric value for a given token."""
    # Strip formatting
    clean = token.replace(",", "").replace("$", "").replace("%", "")
    suffix = "%" if token.endswith("%") else ""
    prefix = "$" if token.startswith("$") else ""

    try:
        val = float(clean)
    except ValueError:
        return token  # Can't perturb — return unchanged

    # Perturb by a small delta that creates a believable wrong value
    if val == 0:
        perturbed = 1.0
    elif val < 10:
        perturbed = val + random.choice([-1, 1, 2, -2])
    elif val < 100:
        perturbed = val + random.choice([-5, 5, 10, -10, 15])
    elif val < 1000:
        perturbed = val + random.choice([-50, 50, 100, -100])
    elif val < 10000:
        # Years — shift by 1-5 years
        perturbed = val + random.choice([-1, 1, 2, -2, 3, -3, 5])
    else:
        perturbed = val * random.choice([0.9, 1.1, 0.8, 1.2])

    # Format back similarly to original
    if "." in clean:
        result = f"{perturbed:.1f}"
    else:
        result = str(int(perturbed))

    return f"{prefix}{result}{suffix}"


def generate_synthetic_negatives(
    records: list[dict],
    n_per_case: int = 1,
    seed: int = 42,
) -> list[dict]:
    """For each valid case with numbers, generate a perturbed invalid version.

    Randomly replaces one numeric token in the hypothesis with a wrong value.
    Only generates negatives for 'valid' cases that contain numbers — perturbing
    an invalid case further is not useful.
    """
    random.seed(seed)
    synthetic = []

    valid_with_numbers = [
        r
        for r in records
        if r["label"] == 2  # valid
        and _extract_numbers(r["hypothesis"])
        and r["checkpoint_type"] in {"numerical", "synthesis", "causal"}
    ]

    for record in valid_with_numbers:
        hypothesis = record["hypothesis"]
        numbers = _extract_numbers(hypothesis)
        if not numbers:
            continue

        for _ in range(n_per_case):
            # Pick a random number to perturb
            token, pos = random.choice(numbers)
            perturbed_token = _perturb_number(token)
            if perturbed_token == token:
                continue  # Perturbation failed — skip

            perturbed_hypothesis = (
                hypothesis[:pos] + perturbed_token + hypothesis[pos + len(token) :]
            )

            synthetic.append(
                {
                    "premise": record["premise"],
                    "hypothesis": perturbed_hypothesis,
                    "label": 0,  # invalid
                    "checkpoint_type": record["checkpoint_type"],
                    "source": "synthetic_perturbation",
                    "original_token": token,
                    "perturbed_token": perturbed_token,
                }
            )

    return synthetic


# ── Deduplication ─────────────────────────────────────────────────────────────


def deduplicate(records: list[dict]) -> list[dict]:
    """Remove exact duplicate (premise, hypothesis) pairs, keeping first occurrence."""
    seen = set()
    unique = []
    for r in records:
        key = (r["premise"][:200], r["hypothesis"][:200])
        if key not in seen:
            seen.add(key)
            unique.append(r)
    return unique


# ── Main ──────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="Generate DeBERTa fine-tuning data")
    parser.add_argument(
        "--test-set",
        default="data/test_sets/gov_report_v2_filtered.json",
        help="Path to labeled test set JSON",
    )
    parser.add_argument(
        "--results",
        default=None,
        help="Path to a run results JSON for hard negative extraction (optional)",
    )
    parser.add_argument(
        "--output",
        default="data/training/tier1_training_data.json",
        help="Output path for training data JSON",
    )
    parser.add_argument(
        "--synthetic-augment",
        action="store_true",
        help="Add synthetic numeric perturbation negatives",
    )
    parser.add_argument(
        "--t1-confidence-min",
        type=float,
        default=0.85,
        help="Minimum T1 confidence to qualify as a hard negative (default: 0.85)",
    )
    args = parser.parse_args()

    all_records: list[dict] = []

    # Source 1: labeled test set
    test_records = load_test_set(args.test_set)
    all_records.extend(test_records)
    print(f"Test set:          {len(test_records):4d} records")

    # Source 2: hard negatives from run results
    if args.results:
        hard_negatives = load_hard_negatives(
            args.results, args.test_set, t1_confidence_min=args.t1_confidence_min
        )
        all_records.extend(hard_negatives)
        print(
            f"Hard negatives:    {len(hard_negatives):4d} records  (T1 conf >= {args.t1_confidence_min})"
        )
    else:
        print("Hard negatives:       0 records  (no --results path provided)")

    # Source 3: synthetic perturbations
    if args.synthetic_augment:
        synthetics = generate_synthetic_negatives(test_records)
        all_records.extend(synthetics)
        print(f"Synthetic negatives: {len(synthetics):3d} records")

    # Deduplicate
    before = len(all_records)
    all_records = deduplicate(all_records)
    print(
        f"After dedup:       {len(all_records):4d} records  (removed {before - len(all_records)} duplicates)"
    )

    # Label distribution
    dist = {0: 0, 1: 0, 2: 0}
    for r in all_records:
        dist[r["label"]] += 1
    print(f"Label distribution: invalid={dist[0]}  ambiguous={dist[1]}  valid={dist[2]}")

    # Save — strip internal bookkeeping fields before writing
    output_records = [
        {"premise": r["premise"], "hypothesis": r["hypothesis"], "label": r["label"]}
        for r in all_records
    ]
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(output_records, f, indent=2)
    print(f"\nSaved {len(output_records)} training records to {out_path}")
    print("\nNext step:")
    print(
        f"  uv run python notebooks/finetune_tier1.py --data {out_path} --output models/deberta-finetuned-herald"
    )


if __name__ == "__main__":
    main()
