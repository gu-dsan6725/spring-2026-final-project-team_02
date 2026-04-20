# Experiment Scripts

Scripts for running the HERALD vs. LLM-as-Judge experiment defined in `experiment-design.md`.

## Scripts

| Script | Purpose |
|--------|---------|
| `run_experiment.py` | Evaluate all 3 systems on the ground-truth eval set, write a raw results JSON |
| `analyze_experiment.py` | Read the results JSON, compute all metrics, write a Markdown analysis report |

## Systems Under Test

| System | Description |
|--------|-------------|
| **A** | Full HERALD pipeline — Tier 1 (NLI) → Tier 2 (LLM Judge) → Tier 3 (Debate) |
| **B** | LLM-as-Judge baseline — Tier 2 direct call for every claim, no NLI or debate |
| **C** | HERALD without Tier 1 — Tier 2 → Tier 3, NLI skipped for all claim types (ablation) |

---

## Prerequisites

### 1. Python environment

All scripts run inside the `backend/` uv environment. Install dependencies once:

```bash
cd backend
uv sync --group dev
```

### 2. Environment variables

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export BRAINTRUST_API_KEY=...        # optional — for tracing in Braintrust dashboard
```

The `ANTHROPIC_API_KEY` is required for any live run. Use `--dry-run` to skip it during setup.

### 3. NLI model (System A only)

System A uses DeBERTa-v3-large-mnli via Hugging Face Transformers. The model is downloaded automatically the first time `NLIService.load()` is called (~1.5 GB). To pre-download it:

```bash
cd backend
uv run python -c "
from transformers import pipeline
pipeline('zero-shot-classification', model='cross-encoder/nli-deberta-v3-large')
print('NLI model ready')
"
```

To use the ONNX backend instead (faster CPU inference), set:

```bash
export NLI_ONNX_MODEL_PATH=./models/deberta-v3-large-mnli.onnx
```

---

## Step 1 — Verify setup with a dry run

Run with mock verdicts (no API calls, no NLI model needed):

```bash
cd backend
uv run python ../experiment-scripts/run_experiment.py --dry-run
```

Expected output: a results file at `results/experiment-YYYY-MM-DD.json` with randomised verdicts.

Then run the analyser:

```bash
uv run python ../experiment-scripts/analyze_experiment.py
```

Expected output: a report at `results/analysis-YYYY-MM-DD.md`.

---

## Step 2 — Run the full experiment

```bash
cd backend
uv run python ../experiment-scripts/run_experiment.py \
  --systems A B C \
  --concurrency 3 \
  --output ../results/experiment-$(date +%Y-%m-%d).json
```

`--concurrency 3` means 3 claims processed in parallel. Each System A claim at Tier 3 makes 4 Anthropic API calls simultaneously, so effective peak QPS is 3 × 4 = 12. Lower `--concurrency` if you hit rate limits.

Progress is logged to stdout as each claim completes:

```
2026-04-20 12:01:03  INFO  experiment  [1/104] GT-001  A=valid B=valid C=valid
2026-04-20 12:01:08  INFO  experiment  [2/104] GT-003  A=invalid B=valid C=invalid
...
```

---

## Step 3 — Analyse results

```bash
cd backend
uv run python ../experiment-scripts/analyze_experiment.py \
  --results ../results/experiment-YYYY-MM-DD.json \
  --output ../results/analysis-YYYY-MM-DD.md
```

The analyser auto-detects the most recent `results/experiment-*.json` if `--results` is omitted.

---

## Common options

### Run only specific claim types

```bash
uv run python ../experiment-scripts/run_experiment.py \
  --claim-types causal synthesis \
  --systems A B
```

Useful for iterating on high-risk claim types without re-running the full eval set.

### Run only one system

```bash
# Just baseline for a quick cost estimate
uv run python ../experiment-scripts/run_experiment.py --systems B
```

### Adjust token pricing

Default pricing is for `claude-sonnet-4-6` as of experiment date. Update if pricing has changed:

```bash
uv run python ../experiment-scripts/analyze_experiment.py \
  --sonnet-input-price 0.003 \
  --sonnet-output-price 0.015
```

---

## Output files

All outputs land in `results/` (created automatically):

```
results/
├── experiment-YYYY-MM-DD.json   # Raw per-claim results for all systems
└── analysis-YYYY-MM-DD.md      # Computed metrics report
```

### Raw results format

```json
{
  "meta": { "date": "...", "systems": ["A","B","C"], "total_claims": 104, ... },
  "results": [
    {
      "claim_id": "GT-003",
      "claim_type": "causal",
      "derivation": "paraphrase",
      "ground_truth": "invalid",
      "system_a": {
        "verdict": "invalid",
        "tier_reached": 3,
        "confidence": 0.87,
        "input_tokens": 1240,
        "output_tokens": 310,
        "api_calls": 4,
        "latency_ms": 8200
      },
      "system_b": {
        "verdict": "valid",
        "tier_reached": 2,
        "confidence": 0.71,
        "input_tokens": 890,
        "output_tokens": 220,
        "api_calls": 1,
        "latency_ms": 2100
      },
      "system_c": { ... }
    }
  ]
}
```

---

## Troubleshooting

**`ModuleNotFoundError: No module named 'policy_memo_agent'`**

Both scripts add `backend/src` to `sys.path` automatically, but they must be run from the `backend/` directory (so `uv run` picks up the correct environment):

```bash
cd backend   # ← required
uv run python ../experiment-scripts/run_experiment.py
```

**`ANTHROPIC_API_KEY is not set`**

Export the key before running, or use `--dry-run` to skip API calls.

**Rate limit errors from Anthropic**

Reduce concurrency:

```bash
--concurrency 1
```

System A at Tier 3 makes 4 parallel LLM calls per claim. At `--concurrency 3` that's 12 simultaneous calls. Drop to `--concurrency 1` if your API tier has a low RPM limit.

**NLI model download hangs**

The DeBERTa model (~1.5 GB) downloads from Hugging Face Hub on first use. If behind a proxy or with limited bandwidth, pre-download it in a separate terminal first (see Prerequisites above).

**Claims showing `verdict: "error"` in results**

Individual claim failures are recorded but do not abort the run. Check the `error` field in the raw JSON for the exception message. Errors are excluded from metric calculations.

---

## Known Issues

### Issue 1 — Eval set too small for reliable per-type metrics

`data/eval-set.json` currently has **50 claims** (not the 104 minimum specified in `experiment-design.md`). Several per-type cells are as small as n=3:

| Claim Type | Valid | Invalid |
|------------|-------|---------|
| causal | 3 | 6 |
| comparative | 3 | 5 |
| synthesis | 5 | 3 |

With n=3 in a cell, per-type precision/recall figures are statistically meaningless. Until the eval set is expanded, treat per-type breakdowns in the analysis report as directional only. Overall metrics (across all 50 claims) are still valid for a first-pass comparison.

**Fix**: add more ground-truth entries to `data/eval-set.json` following the existing format, targeting at least 8 valid and 8 invalid per claim type.

---

### Issue 2 — System B silently drops low-confidence verdicts (methodological bug)

`tier2_judge.py` applies the confidence threshold **inside** `run_tier2()` before returning — responses with confidence ≤ 0.85 are already converted to `Verdict.UNCERTAIN` before `_run_system_b` sees them. The analyzer maps `UNCERTAIN` to `None` and excludes those claims from metrics.

This means System B (LLM-as-Judge baseline) does not commit to a verdict for ~30–40% of claims, making it look weaker than a true single-call judge would be. A fair baseline should force the model to commit to whichever verdict it leaned toward, regardless of confidence.

**Fix**: refactor `_run_system_b` in `run_experiment.py` to call the Anthropic API directly (bypassing `run_tier2`) and use the raw `verdict` field from the JSON response before any threshold filtering is applied.

---

## Interpreting the analysis report

The report uses this decision framework (from `experiment-design.md`):

| Condition | Conclusion |
|-----------|-----------|
| F1(A) > F1(B) by ≥ 3pp **and** cost-adjusted F1(A) ≥ cost-adjusted F1(B) | HERALD is justified |
| F1(A) > F1(B) by ≥ 3pp **but** cost-adjusted F1(A) < cost-adjusted F1(B) | HERALD is marginal |
| F1(A) > F1(B) by < 3pp **and** cost-adjusted F1(A) ≥ cost-adjusted F1(B) | HERALD is marginal |
| F1(A) ≤ F1(B) or cost(A) ≥ cost(B) with no F1 gain | HERALD is not justified |

**False-Invalid Rate (FIR)**: fraction of truly valid claims incorrectly marked invalid. High FIR means the system is too aggressive — it would reject good claims in production.

**False-Valid Rate (FVR)**: fraction of truly invalid claims incorrectly marked valid. High FVR means the system misses bad claims — the bigger risk in a policy memo context.

**Cost-adjusted F1**: F1 divided by cost-per-claim in USD. Useful for comparing value at scale.

**Tier distribution** (Systems A and C only): shows how often each tier makes the final call. A high Tier 1 exit rate means NLI is pulling its weight. A high Tier 3 escalation rate means the LLM judge is often uncertain.
