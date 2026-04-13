"""Stratified 80/20 train/test split for HERALD evaluation datasets.

Splits by checkpoint_type to preserve label/type distribution.
Uses a fixed seed (42) for reproducibility.

Usage:
    uv run herald-split --input data/test_sets/gov_report_v2_filtered.json \\
                        --train data/test_sets/train.json \\
                        --test  data/test_sets/test.json

    # Or override the split ratio:
    uv run herald-split --input data/test_sets/gov_report_v2_filtered.json --test-size 0.25
"""

import argparse
import json
import random
from collections import defaultdict
from pathlib import Path


def stratified_split(
    cases: list[dict],
    test_size: float = 0.20,
    seed: int = 42,
) -> tuple[list[dict], list[dict]]:
    """Split *cases* into train/test stratified by checkpoint_type.

    Within each stratum the cases are shuffled with *seed* before splitting,
    so both halves are random but reproducible.
    """
    rng = random.Random(seed)

    # Group by checkpoint_type
    buckets: dict[str, list[dict]] = defaultdict(list)
    for case in cases:
        buckets[case["checkpoint_type"]].append(case)

    train_cases: list[dict] = []
    test_cases: list[dict] = []

    for cp_type, group in sorted(buckets.items()):  # sorted for determinism
        shuffled = list(group)
        rng.shuffle(shuffled)
        n_test = max(1, round(len(shuffled) * test_size))
        test_cases.extend(shuffled[:n_test])
        train_cases.extend(shuffled[n_test:])

    return train_cases, test_cases


def write_json(path: Path, data: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def print_split_summary(train: list[dict], test: list[dict]) -> None:
    from collections import Counter

    total = len(train) + len(test)
    print(f"\n{'='*55}")
    print(f"HERALD Train/Test Split  (seed=42, stratified by type)")
    print(f"{'='*55}")
    print(f"  Total : {total}")
    print(f"  Train : {len(train)} ({len(train)/total:.0%})")
    print(f"  Test  : {len(test)}  ({len(test)/total:.0%})")

    all_types = sorted({c["checkpoint_type"] for c in train + test})
    print(f"\n  {'Type':<22} {'Train':>6}  {'Test':>5}")
    print(f"  {'-'*35}")
    train_types = Counter(c["checkpoint_type"] for c in train)
    test_types = Counter(c["checkpoint_type"] for c in test)
    for t in all_types:
        print(f"  {t:<22} {train_types[t]:>6}  {test_types[t]:>5}")

    print()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Stratified 80/20 train/test split for HERALD datasets"
    )
    parser.add_argument(
        "--input",
        default="data/test_sets/gov_report_v2_filtered.json",
        help="Source dataset (default: gov_report_v2_filtered.json)",
    )
    parser.add_argument(
        "--train",
        default="data/test_sets/train.json",
        help="Output path for train split",
    )
    parser.add_argument(
        "--test",
        default="data/test_sets/test.json",
        help="Output path for test split",
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=0.20,
        help="Fraction of cases to hold out for test (default: 0.20)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed (default: 42)",
    )
    args = parser.parse_args()

    with open(args.input) as f:
        cases = json.load(f)

    train, test = stratified_split(cases, test_size=args.test_size, seed=args.seed)
    print_split_summary(train, test)

    write_json(Path(args.train), train)
    write_json(Path(args.test), test)

    print(f"  Train → {args.train}")
    print(f"  Test  → {args.test}")
    print()


if __name__ == "__main__":
    main()
