# Run HERALD Pipeline

Run the full HERALD pipeline on a test set. If no input file is specified, default to `data/test_sets/gov_report_v2_100_filtered.json`.

Arguments: $ARGUMENTS (optional: path to input JSON file)

```bash
uv run herald-run \
  --input ${ARGUMENTS:-data/test_sets/gov_report_v2_100_filtered.json} \
  --config configs/default.yaml \
  --output results/run_results.json \
  --verbose
```

After running, remind the user they can resume with `--resume` if it was interrupted, and suggest running `/eval-results` next.
