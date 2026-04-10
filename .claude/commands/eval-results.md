# Evaluate HERALD Results

Run evaluation against ground-truth labels and print accuracy, escalation rates, and cost metrics.

Arguments: $ARGUMENTS (optional: path to results JSON — defaults to results/run_results.json)

The ground truth labels are embedded in the test set file itself (`"label"` field). Pass the test set as both `--results` and `--ground-truth` if the results file contains case indices that map back to it.

```bash
uv run herald-eval \
  --results ${ARGUMENTS:-results/run_results.json} \
  --ground-truth data/test_sets/gov_report_v2_100_filtered.json \
  --output results/evaluation.json
```

After running, summarize: overall accuracy, per-checkpoint accuracy, escalation rates by tier, and estimated cost per case.
