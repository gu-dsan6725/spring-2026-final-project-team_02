"""Utility: Validate input data files for format and required fields."""
import json
import sys
from pathlib import Path

def validate_json_file(path, required_fields):
    with open(path) as f:
        data = json.load(f)
    assert isinstance(data, list), f"{path}: Not a list"
    for i, entry in enumerate(data):
        for field in required_fields:
            assert field in entry, f"{path}: Entry {i} missing field '{field}'"
    print(f"{path}: OK ({len(data)} entries)")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/validate_inputs.py <file1.json> [file2.json ...]")
        sys.exit(1)
    for file in sys.argv[1:]:
        if "feasibility" in file or "sample_cases" in file:
            validate_json_file(file, ["checkpoint_type", "source_context", "output_text", "label"])
        elif "weak_labeled" in file:
            validate_json_file(file, ["source", "claim", "label"])
        elif "unlabeled_pairs" in file:
            validate_json_file(file, ["source", "claim"])
        else:
            print(f"Unknown file type: {file}")
