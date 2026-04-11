# HERALD Trial Run Report v2.0 (Gemma)
**Date:** 2026-04-07  
**Model:** `gemma-3-27b-it` (Gemini provider)  
**Data source:** `launch/gov_report` via parquet  
**Purpose:** Standardized second trial run for comparison against the original Llama-based HERALD experiment

**Scope note:** This report uses the internally consistent Gemma rerun artifacts: `data/test_sets/gov_report_v2_100.json`, `results/govreport_v2_100_results.json`, and `results/govreport_v2_eval.json`. The full regenerated corpus is `data/test_sets/gov_report_v2.json` (459 cases), but the standardized evaluation run was performed on a 100-case subset.

---

## 1. Pipeline Overview

HERALD (Hierarchical Escalation for Reliable Agentic LLM Decision-making) is a 4-tier validation pipeline for LLM-generated claims against source documents:

| Tier | Component | Role | Resolves if |
|------|-----------|------|-------------|
| 1 | DeBERTa NLI (`cross-encoder/nli-deberta-v3-large`) | Fast local classifier | Confidence ≥ T1 (0.70) |
| 2 | LLM Judge (`gemma-3-27b-it`) | Gemini API call, structured verdict | Confidence ≥ T2 (0.80) |
| 3 | Multi-Agent Debate (`gemma-3-27b-it`) | Advocate + Critic + Judge (3 calls) | Judge confidence ≥ 0.50 |
| 4 | Human Review | Manual escalation | Always resolves |

---

## 2. Data Generation (Step 1)

**Script:** `notebooks/generate_govreport_cases.py`  
**Primary output:** `data/test_sets/gov_report_v2.json`  
**Standardized trial subset:** `data/test_sets/gov_report_v2_100.json`

### Dataset Loading
- Source remained **`launch/gov_report` parquet files** via `hf://`
- Generated cases come from **50 sampled GAO documents**
- Full regenerated corpus contains **459 cases** across **50 documents**
- Standardized evaluation subset contains **100 cases** across **43 documents**

### Generation Changes vs. Original Trial
- Added **`retrieval`** as a checkpoint type
- Full v2 corpus now covers **5 checkpoint types** instead of 4
- Labels remain exactly balanced in the full generated set

### Output Statistics
Full regenerated corpus (`gov_report_v2.json`):
```text
Label distribution:      valid: 153  invalid: 153  ambiguous: 153  (perfectly balanced)
Checkpoint distribution: synthesis: 147  numerical: 120  claim_extraction: 108  causal: 69  retrieval: 15
```

Standardized evaluation subset (`gov_report_v2_100.json`):
```text
Label distribution:      valid: 34  invalid: 32  ambiguous: 34
Checkpoint distribution: numerical: 30  synthesis: 29  claim_extraction: 26  causal: 8  retrieval: 7
```

**Sample section titles processed:**
- `Projected Salvage Volumes Were Achieved, but More Could Have Been Offered for Sale`
- `VERA Has Had A Substantial Effect on Network Resources and Workload`
- `The Corps Reprogrammed Significant Amounts of Funds among Hundreds of Projects`
- `Background`
- `Government-wide Spending on IT Operations and Maintenance Is Increasing`
- `Legal Authorities Governing Set-Asides`

**Note:** Retrieval is still underrepresented in the full corpus (15/459 = 3.3%), but unlike the original run it is now present and measurable.

---

## 3. Pipeline Run (Step 2)

**Script:** `herald.pipeline.run`  
**Config:** `configs/default.yaml` (T1=0.70, T2=0.80)  
**Input:** `data/test_sets/gov_report_v2_100.json`  
**Output:** `results/govreport_v2_100_results.json`

### Escalation Results
```text
Tier 1 (DeBERTa NLI):         54/100 cases  (54.0%)
Tier 2 (LLM Judge):           22/100 cases  (22.0%)
Tier 3 (Multi-Agent Debate):  24/100 cases  (24.0%)
Tier 4 (Human Review):         0/100 cases  ( 0.0%)
```

### Verdict Distribution
```text
Predicted:    valid=64  invalid=36  uncertain=0
Ground truth: valid=34  invalid=32  ambiguous=34
```

**Key observation:** The Gemma run is still skewed toward `valid`, but much less extremely than the original Llama run. The pipeline no longer collapses almost entirely to `valid`, yet it still never outputs `uncertain`, so all ambiguous cases are forced into valid/invalid decisions.

---

## 4. Evaluation (Step 3)

**Script:** `herald.evaluation.evaluate`  
**Output:** `results/govreport_v2_eval.json`

### Overall Accuracy: 58.0% (58/100)

### Per-Label Accuracy
| Ground Truth | Predicted Correct | Accuracy |
|---|---|---|
| valid (34 cases) | 32 | **94.1%** |
| invalid (32 cases) | 26 | **81.2%** |
| ambiguous (34 cases) | 0 | **0.0%** |

### By Checkpoint Type
| Checkpoint | Correct/Total | Accuracy |
|---|---|---|
| causal | 5/8 | 62.5% |
| claim_extraction | 16/26 | 61.5% |
| numerical | 18/30 | 60.0% |
| synthesis | 17/29 | 58.6% |
| retrieval | 2/7 | 28.6% |

### By Resolving Tier
| Tier | Correct/Total | Accuracy |
|---|---|---|
| Tier 1 (NLI) | 43/54 | **79.6%** |
| Tier 2 (LLM Judge) | 12/22 | **54.5%** |
| Tier 3 (Debate) | 3/24 | **12.5%** |
| Tier 4 (Human) | 0/0 | n/a |

---

## 5. Threshold Sweep (Step 4)

**Status:** Not completed for the Gemma standardized run.  
No aligned threshold sweep output for `gov_report_v2_100.json` was found among the saved artifacts. The existing `logs/step4_sweep.log` corresponds to the earlier Llama run and should not be mixed into this report.

**→ To complete:** Re-run `notebooks/threshold_sweep.py` on `data/test_sets/gov_report_v2_100.json` or the full `gov_report_v2.json` corpus using the Gemma config.

---

## 6. Plots Generated

| Plot | File | Status |
|---|---|---|
| Cost-accuracy tradeoff curve | `plot1_tradeoff_curve.png` | ⏳ Awaiting Gemma sweep data |
| Escalation profile by checkpoint type | `plot2_escalation_profile.png` | ✅ |
| HERALD vs baselines | `plot3_baseline_comparison.png` | ⏳ Baseline JSON exists, plot not generated |
| Confusion analysis | `plot4_confusion_analysis.png` | ✅ |

---

## 7. Token / Cost Budget Used

Exact token usage was **not logged** for the Gemma rerun artifacts.

What is confirmed from saved outputs:
- **Human review rate:** 0.0%
- **Cost per case (evaluation output):** 0
- **Human escalations avoided:** 100/100 cases

**Note:** If this section is needed for the paper, token/call accounting should be added to the Gemma pipeline scripts before the next run.

---

## 8. Analysis & Findings

### 8.1 Major Improvement on Invalid Detection

The most important improvement is that Gemma substantially reduced the original model's tendency to over-accept bad claims:

- **valid accuracy: 94.1%**
- **invalid accuracy: 81.2%**
- **ambiguous accuracy: 0.0%**

Compared with the original trial, invalid-case performance improved dramatically. The model is now willing to reject clearly wrong claims much more often.

### 8.2 The Ambiguity Problem Remains Unsolved

Despite the improvement on invalid cases, the pipeline still never outputs `uncertain`. As a result:

- all **34 ambiguous cases** are misclassified
- overall accuracy is capped by forced binary decisions
- ambiguity handling remains the main bottleneck for reliable escalation

This suggests the central failure mode has shifted from "agreeable valid-bias" to "binary overcommitment."

### 8.3 Tier Accuracy Still Inverts After Tier 1

Tier 1 remains the strongest-performing layer:

- **Tier 1:** 79.6%
- **Tier 2:** 54.5%
- **Tier 3:** 12.5%

This means escalation above Tier 1 is still not adding reliable value on average. Tier 2 is better than in the original run, but it is still materially weaker than Tier 1. Tier 3 debate remains extremely unreliable.

### 8.4 Retrieval Is the Weakest Checkpoint Type

Retrieval accuracy is only **28.6% (2/7)**, far below the other checkpoint types. That likely reflects two factors:

- retrieval cases are structurally different from source-grounded section validation
- the judge/debate prompts may not be calibrated for cross-document relevance and evidence matching

This checkpoint should be treated as a separate error mode in the next comparison analysis.

### 8.5 Escalation Pattern Changed

Compared with the original run, the Gemma setup resolves more cases at Tier 1 and none at Tier 4:

- **54%** resolved at Tier 1
- **22%** resolved at Tier 2
- **24%** resolved at Tier 3
- **0%** reached human review

The system is more decisive, but that decisiveness is not helping on ambiguous examples.

---

## 9. Recommendations

### Immediate

| # | Recommendation | Impact |
|---|---|---|
| R1 | **Add explicit `uncertain`-favoring prompt instructions** to Tier 2 and Tier 3 | Highest priority; ambiguity is currently never surfaced |
| R2 | **Revisit debate design or bypass Tier 3 for now** | Tier 3 accuracy (12.5%) is too low to justify cost/complexity |
| R3 | **Run Gemma threshold sweep on the same 100-case set** | Required for clean comparison to v1 |

### Data pipeline improvements

| # | Recommendation | Impact |
|---|---|---|
| R4 | **Increase retrieval coverage** in future generated sets | Needed for stable per-type evaluation |
| R5 | **Preserve a fixed standardized subset** for repeated model comparisons | Enables apples-to-apples reporting across runs |
| R6 | **Log generation metadata explicitly** (calls, timing, sampling details) for v2+ runs | Makes report writing reproducible |

### Architecture improvements

| # | Recommendation | Impact |
|---|---|---|
| R7 | **Use Tier 1 as the default resolver more aggressively** until upper tiers are recalibrated | Likely improves end-to-end accuracy |
| R8 | **Calibrate Tier 2 confidence outputs** for Gemma | Current confidence values appear clustered and coarse |
| R9 | **Treat retrieval as a specialized path** with checkpoint-specific prompting | May recover the worst-performing category |

---

## 10. Next Steps

```bash
# 1. Re-run Gemma threshold sweep on the standardized trial set
uv run python notebooks/threshold_sweep.py \
  --input data/test_sets/gov_report_v2_100.json \
  --config configs/default.yaml \
  --t1-values 0.60 0.70 0.80 \
  --t2-values 0.70 0.80 0.90

# 2. Re-run baseline comparison on the same standardized set
uv run python notebooks/baseline_comparison.py \
  --input data/test_sets/gov_report_v2_100.json \
  --results results/govreport_v2_100_results.json \
  --output results/baseline_comparison_v2.json

# 3. Generate comparison-ready plots
uv run python notebooks/generate_plots.py \
  --results results/govreport_v2_100_results.json \
  --ground-truth data/test_sets/gov_report_v2_100.json
```

---

## 11. File Inventory

| File | Description |
|---|---|
| `data/test_sets/gov_report_v2.json` | Full regenerated Gemma-era GAO corpus: 459 balanced cases from 50 documents |
| `data/test_sets/gov_report_v2_100.json` | Standardized 100-case subset used for the v2 trial run |
| `results/govreport_v2_100_results.json` | HERALD pipeline verdicts for the 100-case Gemma trial |
| `results/govreport_v2_eval.json` | Accuracy and escalation metrics for the standardized Gemma trial |
| `results/baseline_comparison_v2.json` | Baseline comparison summary for the v2 setup |
| `results/plots/plot2_escalation_profile.png` | Escalation by checkpoint type |
| `results/plots/plot4_confusion_analysis.png` | Confusion matrix and error analysis |
| `configs/default.yaml` | Current default config using Gemini provider + `gemma-3-27b-it` |
