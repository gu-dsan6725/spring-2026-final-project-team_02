# Threshold Sweep

Run a threshold sweep to generate cost-accuracy tradeoff data, then plot the results.

Arguments: $ARGUMENTS (optional: input file path — defaults to gov_report_v2_100_filtered.json)

```bash
uv run python notebooks/threshold_sweep.py \
  --input ${ARGUMENTS:-data/test_sets/gov_report_v2_100_filtered.json} \
  --output results/threshold_sweep.json \
  --t1-values 0.60 0.70 0.80 0.90 \
  --t2-values 0.60 0.70 0.80 0.90
```

After the sweep completes, generate plots:

```bash
uv run python notebooks/generate_plots.py \
  --sweep results/threshold_sweep.json \
  --results results/run_results.json \
  --ground-truth ${ARGUMENTS:-data/test_sets/gov_report_v2_100_filtered.json} \
  --baseline results/baseline_comparison.json \
  --output results/plots/
```

Note: if the sweep is interrupted by a Groq/Gemini rate limit (429), wait for quota to reset and re-run. The pipeline saves results incrementally.
