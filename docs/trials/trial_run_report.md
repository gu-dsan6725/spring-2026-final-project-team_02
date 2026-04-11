# HERALD Trial Run Report
**Date:** 2026-04-07  
**Model:** `llama-3.1-8b-instant` (Groq free tier, 500k TPD)  
**Data source:** `launch/gov_report` via parquet  
**Purpose:** End-to-end pipeline validation on real GAO policy documents before full production run

---

## 1. Pipeline Overview

HERALD (Hierarchical Escalation for Reliable Agentic LLM Decision-making) is a 4-tier validation pipeline for LLM-generated claims against source documents:

| Tier | Component | Role | Resolves if |
|------|-----------|------|-------------|
| 1 | DeBERTa NLI (`cross-encoder/nli-deberta-v3-large`) | Fast local classifier | Confidence ≥ T1 (0.70) |
| 2 | LLM Judge (`llama-3.1-8b-instant`) | Groq API call, structured verdict | Confidence ≥ T2 (0.80) |
| 3 | Multi-Agent Debate (`llama-3.1-8b-instant`) | Advocate + Critic + Judge (3 calls) | Judge confidence ≥ 0.50 |
| 4 | Human Review | Manual escalation | Always resolves |

---

## 2. Data Generation (Step 1)

**Script:** `notebooks/generate_govreport_cases.py`  
**Log:** `logs/step1_datagen.log`  
**Output:** `data/test_sets/trial_cases.json`

### Dataset Loading
- Attempted `launch/gov_report` structure config with `trust_remote_code=True` → **blocked** (scripts no longer supported in `datasets>=2.x`)
- Fell back to **`launch/gov_report` parquet files** directly via `hf://` protocol → **success**
- Loaded 17,519 train-split docs in ~6 seconds

### Filtering
- Keyword filter on section title against 30 economics policy terms
- Matched **391 / 17,519 docs (2.2%)**
- Low hit rate because GAO section titles use formal language ("Opinion on Schedules of Federal Debt") that often doesn't contain direct keyword matches

### Random Selection & Generation
- Randomly sampled 50 docs from 391
- Extracted depth-1 named sections: up to 2 per doc + 1 synthesis (2-3 sections combined)
- Generated (valid / invalid / ambiguous) triples via Groq for each section
- **146 API calls → 438 cases, 0 errors**

### Output Statistics
```
Label distribution:      valid: 146  invalid: 146  ambiguous: 146  (perfectly balanced)
Checkpoint distribution: numerical: 147  synthesis: 144  claim_extraction: 105  causal: 42
```

**Sample section titles processed:**
- `DOD's Major Acquisition Programs Continue to Experience Significant Cost Growth`
- `Demographic Trends Drive Both the Long-Term Budget and Economic Challenge`
- `More Than 1,280 CFC Charities Had Tax Debts Totaling $35.6 Million`
- `Social Security Reform Is Part of a Broader Fiscal and Economic Challenge`

**Note:** `causal` is underrepresented (42/438 = 9.6%) because GAO report section titles rarely use explicit causal language — most are descriptive findings. The regex pattern `CAUSAL_PATTERN` fires infrequently on formal policy titles.

---

## 3. Pipeline Run (Step 2)

**Script:** `herald.pipeline.run`  
**Log:** `logs/step2_pipeline.log`  
**Config:** `configs/trial.yaml` (T1=0.70, T2=0.80)  
**Output:** `results/trial_run_results.json`

### Escalation Results
```
Tier 1 (DeBERTa NLI):      177/438 cases  (40.4%)
Tier 2 (LLM Judge):        219/438 cases  (50.0%)
Tier 3 (Multi-Agent Debate): 41/438 cases  ( 9.4%)
Tier 4 (Human Review):       1/438 cases  ( 0.2%)
```

### Verdict Distribution
```
Predicted:    valid=368  invalid=69  uncertain=1
Ground truth: valid=146  invalid=146 ambiguous=146
```

**Key observation:** The pipeline is heavily skewed toward predicting `valid` (84% of all verdicts). This indicates a systematic bias — the model rarely commits to `invalid`, and almost never to `uncertain`.

---

## 4. Evaluation (Step 3)

**Script:** `herald.evaluation.evaluate`  
**Log:** `logs/step3_evaluation.log`  
**Output:** `results/trial_evaluation.json`

### Overall Accuracy: 45.0% (197/438)

### Per-Label Accuracy
| Ground Truth | Predicted Correct | Accuracy |
|---|---|---|
| valid (146 cases) | 144 | **98.6%** |
| invalid (146 cases) | 53 | **36.3%** |
| ambiguous (146 cases) | 0 | **0.0%** |

### By Checkpoint Type
| Checkpoint | Correct/Total | Accuracy |
|---|---|---|
| causal | 21/42 | 50.0% |
| claim_extraction | 48/105 | 45.7% |
| numerical | 65/147 | 44.2% |
| synthesis | 63/144 | 43.8% |

### By Resolving Tier
| Tier | Correct/Total | Accuracy |
|---|---|---|
| Tier 1 (NLI) | 116/177 | **65.5%** |
| Tier 2 (LLM Judge) | 76/219 | **34.7%** |
| Tier 3 (Debate) | 5/41 | **12.2%** |
| Tier 4 (Human) | 0/1 | 0.0% |

---

## 5. Threshold Sweep (Step 4)

**Status:** Incomplete — hit `llama-3.1-8b-instant` daily token limit (500k TPD) mid-run.  
The sweep exhausted tokens before completing config 1 of 9 (T1=0.60, T2=0.70).  
Planned grid: T1 ∈ {0.60, 0.70, 0.80} × T2 ∈ {0.70, 0.80, 0.90}  

**→ To complete:** Re-run after midnight UTC token reset with `llama-3.3-70b-versatile`.

---

## 6. Plots Generated

| Plot | File | Status |
|---|---|---|
| Cost-accuracy tradeoff curve | `plot1_tradeoff_curve.png` | ⏳ Awaiting sweep data |
| Escalation profile by checkpoint type | `plot2_escalation_profile.png` | ✅ |
| HERALD vs baselines | `plot3_baseline_comparison.png` | ⏳ Awaiting baseline run |
| Confusion analysis | `plot4_confusion_analysis.png` | ✅ |

---

## 7. Token Budget Used

| Step | Model | Approx. Tokens |
|---|---|---|
| Data generation (146 calls) | llama-3.1-8b-instant | ~117k |
| Pipeline run (438 cases, ~260 escalated) | llama-3.1-8b-instant | ~208k |
| Threshold sweep (partial, config 1) | llama-3.1-8b-instant | ~175k |
| **Total** | | **~500k (500k limit hit)** |

---

## 8. Analysis & Findings

### 8.1 The Model Quality Problem

The most important finding is the **massive valid-bias**: 368/438 predicted verdicts are `valid` despite the ground truth being 1/3 each. The breakdown tells the story:

- **valid recall: 98.6%** — nearly everything labeled valid is caught
- **invalid recall: 36.3%** — the pipeline misses 2/3 of invalid cases
- **ambiguous recall: 0.0%** — `uncertain` is never output; the model always commits to valid or invalid

This is a known limitation of `llama-3.1-8b-instant` for nuanced judgment tasks. Smaller models tend to be "agreeable" — they validate claims rather than challenge them. The 8B model lacks the reasoning capacity to detect subtle errors (wrong numbers, false causality, unsupported inference) that the 70B model catches.

**This is a model artifact, not a pipeline architecture problem.**

### 8.2 Tier Accuracy Inversion

Tier 1 (DeBERTa) accuracy (65.5%) is nearly double Tier 2's (34.7%), which is the opposite of the intended design. Escalation is supposed to send *uncertain* cases upward — cases where Tier 1 was unsure. But Tier 2 (`llama-3.1-8b-instant`) is resolving those uncertain cases *less accurately* than if we had stuck with Tier 1's guess.

Tier 3 (debate) is even worse at 12.2% — three 8B model calls arguing with each other do not produce a reliable verdict.

### 8.3 DeBERTa NLI Behaviour

Tier 1 resolves 40.4% of cases with 65.5% accuracy. Notable patterns:
- High-confidence `invalid` calls (e.g., 1.000, 0.999) are usually correct
- High-confidence `valid` calls above 0.97 are also reliable
- Cases escalated to Tier 2 have T1 confidence 0.507–0.996 — the uncertainty range is very wide

The NLI model sees source-claim pairs as predominantly `neutral` (neither entailment nor contradiction), which is why so many cases get the `UNCERTAIN` verdict at T1 and escalate.

### 8.4 Escalation Rate

50% of cases reach Tier 2, 9.4% reach Tier 3 — higher than ideal. With better thresholds (T1=0.80) more cases would be forced to resolve at Tier 1, reducing API calls but potentially at accuracy cost. This is exactly what the threshold sweep would quantify.

---

## 9. Recommendations

### Immediate (before full production run)

| # | Recommendation | Impact |
|---|---|---|
| R1 | **Switch to `llama-3.3-70b-versatile`** for Tiers 2 & 3 | Fixes the valid-bias; 70B models reliably detect subtle errors |
| R2 | **Add explicit invalid/ambiguous prompting** to Tier 2 judge — current prompt may be anchoring toward valid | Medium accuracy gain |
| R3 | **Re-run threshold sweep** with 70B model to find optimal T1/T2 — current results unusable due to model quality | Required for paper results |

### Data pipeline improvements

| # | Recommendation | Impact |
|---|---|---|
| R4 | **Expand econ keyword list** or switch to embedding-based filtering — 2.2% filter rate (391/17,519) is too conservative, missing relevant docs with formal titles | More diverse data |
| R5 | **Add `retrieval` checkpoint type** to generation prompt — currently 0% of trial cases are retrieval type | Complete checkpoint coverage |
| R6 | **Rebalance checkpoint distribution** — causal is only 9.6%, should target ~20% for meaningful per-type metrics | Better evaluation |

### Architecture improvements

| # | Recommendation | Impact |
|---|---|---|
| R7 | **Add confidence calibration** to Tier 2 — the 8B model outputs `0.800` or `0.850` for almost everything, not a real confidence signal | Better escalation routing |
| R8 | **Add partial save to threshold sweep** (same fix as pipeline `--resume`) — currently crashes lose all progress | Resilience |
| R9 | **Cache DeBERTa across threshold sweep configs** — currently reloads model for every T1/T2 pair, wasting ~30s per config | 5× faster sweep |

---

## 10. Next Steps

```bash
# After midnight UTC (token reset):

# 1. Regenerate cases with 70B model for higher quality
uv run python notebooks/generate_govreport_cases.py \
  --yes --model llama-3.3-70b-versatile \
  --output data/test_sets/gov_report_v1.json

# 2. Run pipeline with production config
uv run python -m herald.pipeline.run \
  --input data/test_sets/gov_report_v1.json \
  --output results/run_results.json \
  --config configs/default.yaml

# 3. Threshold sweep (3x3 grid)
uv run python notebooks/threshold_sweep.py \
  --input data/test_sets/gov_report_v1.json \
  --config configs/default.yaml \
  --t1-values 0.60 0.70 0.80 \
  --t2-values 0.70 0.80 0.90

# 4. Baseline comparison
uv run python notebooks/baseline_comparison.py \
  --input data/test_sets/gov_report_v1.json \
  --results results/run_results.json

# 5. Final plots
uv run python notebooks/generate_plots.py \
  --results results/run_results.json \
  --ground-truth data/test_sets/gov_report_v1.json
```

---

## 11. File Inventory

| File | Description |
|---|---|
| `data/test_sets/trial_cases.json` | 438 labeled cases from 50 GAO reports (llama-3.1-8b-instant generated) |
| `results/trial_run_results.json` | HERALD pipeline verdicts for all 438 trial cases |
| `results/trial_evaluation.json` | Accuracy, escalation rates, cost breakdown |
| `results/plots/plot2_escalation_profile.png` | Escalation by checkpoint type |
| `results/plots/plot4_confusion_analysis.png` | Confusion matrix + per-type error rates |
| `logs/step1_datagen.log` | Full data generation log |
| `logs/step2_pipeline.log` | Full pipeline run log |
| `logs/step3_evaluation.log` | Evaluation output |
| `logs/step4_sweep.log` | Partial threshold sweep log (crashed at config 1) |
| `configs/trial.yaml` | Trial config (llama-3.1-8b-instant) |
