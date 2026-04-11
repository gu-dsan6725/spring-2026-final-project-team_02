# HERALD Trial Run Report v2.0 (Binary Filtered)
**Date:** 2026-04-07  
**Model:** `gemma-3-27b-it` (via current default config)  
**Data source:** `launch/gov_report` via parquet  
**Purpose:** Evaluate HERALD on a binary filtered subset containing only `valid` and `invalid` labels, and compare results against prior 3-class trial reports

---

## 1. Scope

This report summarizes HERALD performance on:

- **Input dataset:** `data/test_sets/gov_report_v2_filtered.json`
- **Run output:** `results/runs/run_04_govreport_v2_100_filtered/gov_report_v2_filtered_run.json`
- **Evaluation output:** `results/evaluation/gov_report_v2_filtered_evaluation.json`

The filtered dataset was derived from `data/test_sets/gov_report_v2.json` by removing all `ambiguous` examples. That leaves:

```text
valid:   153
invalid: 153
total:   306
```

This report also compares the filtered binary run against:

- [docs/trial_run_report.md](/Users/vivianaluccioli/Dropbox/DSAN6725-GenAI/project/docs/trial_run_report.md)
- [docs/trial_run_report_v1.2_gemma.md](/Users/vivianaluccioli/Dropbox/DSAN6725-GenAI/project/docs/trial_run_report_v1.2_gemma.md)

Important caveat: this is **not a direct apples-to-apples comparison** with those earlier reports, because both prior evaluations used 3-class datasets that included `ambiguous` cases, while this run does not.

---

## 2. Evaluation Summary

### Overall Accuracy: 88.9% (272/306)

### Per-Label Accuracy

| Ground Truth | Predicted Correct | Accuracy |
|---|---:|---:|
| valid (153 cases) | 148 | **96.7%** |
| invalid (153 cases) | 124 | **81.0%** |

### Verdict Distribution

```text
Predicted:    valid=177  invalid=129
Ground truth: valid=153  invalid=153
```

This verdict balance is much healthier than the original Llama run, which strongly over-predicted `valid`.

---

## 3. By Checkpoint Type

| Checkpoint | Correct/Total | Accuracy |
|---|---:|---:|
| claim_extraction | 69/72 | **95.8%** |
| numerical | 70/80 | **87.5%** |
| synthesis | 87/98 | **88.8%** |
| causal | 38/46 | **82.6%** |
| retrieval | 8/10 | **80.0%** |

The strongest category is `claim_extraction`, while `retrieval` and `causal` remain the weakest of the five checkpoint types, though still materially stronger than in prior runs.

---

## 4. By Resolving Tier

| Tier | Correct/Total | Accuracy |
|---|---:|---:|
| Tier 1 (NLI) | 184/211 | **87.2%** |
| Tier 2 (LLM Judge) | 74/78 | **94.9%** |
| Tier 3 (Debate) | 14/17 | **82.4%** |

### Escalation Rates

```text
Tier 1: 211/306 (69.0%)
Tier 2:  78/306 (25.5%)
Tier 3:  17/306 ( 5.6%)
Tier 4:   0/306 ( 0.0%)
```

This is a much healthier escalation profile than either earlier report: most cases resolve at Tier 1, relatively few reach Tier 3, and no cases require human review.

---

## 5. Comparison to Prior Reports

### Headline Metrics

| Run | Dataset | Overall Accuracy | Tier 1 Acc | Tier 2 Acc | Tier 3 Acc |
|---|---|---:|---:|---:|---:|
| Original Llama trial | 438 cases, includes ambiguous | 45.0% | 65.5% | 34.7% | 12.2% |
| Gemma standardized trial | 100 cases, includes ambiguous | 58.0% | 79.6% | 54.5% | 12.5% |
| Binary filtered run | 306 cases, no ambiguous | 88.9% | 87.2% | 94.9% | 82.4% |

### Improvement vs. Original Llama Trial

- Overall accuracy: `+43.9` points
- Tier 1 accuracy: `+21.7` points
- Tier 2 accuracy: `+60.2` points
- Tier 3 accuracy: `+70.2` points

### Improvement vs. Gemma Standardized Trial

- Overall accuracy: `+30.9` points
- Tier 1 accuracy: `+7.6` points
- Tier 2 accuracy: `+40.4` points
- Tier 3 accuracy: `+69.9` points

### Label-Level Comparison

| Run | Valid Accuracy | Invalid Accuracy | Ambiguous Accuracy |
|---|---:|---:|---:|
| Original Llama trial | 98.6% | 36.3% | 0.0% |
| Gemma standardized trial | 94.1% | 81.2% | 0.0% |
| Binary filtered run | 96.7% | 81.0% | n/a |

The binary filtered run preserves the strong invalid detection seen in the Gemma report while also pushing valid-case performance back up. However, the absence of ambiguous cases removes the hardest class from evaluation, which naturally raises end-to-end accuracy.

---

## 6. Interpretation

The most defensible reading of this run is:

- On the binary subset containing only `valid` and `invalid` examples, HERALD performs strongly.
- The pipeline is no longer exhibiting the severe `valid` bias seen in the original Llama-based trial.
- Tier 2 and Tier 3 are both dramatically more reliable on this filtered set than they were in either earlier report.
- The system appears operationally efficient, resolving most cases at Tier 1 and escalating only a small minority to Tier 3.

At the same time, this result should **not** be presented as a direct replacement for the earlier 3-class evaluations. Removing `ambiguous` cases changes the task meaningfully:

- it eliminates the class that both prior reports found most difficult
- it converts the task from 3-way judgment into binary discrimination
- it makes overall accuracy substantially easier to optimize

The correct takeaway is therefore:

> On a binary filtered subset containing only valid and invalid cases, HERALD achieves **88.9% accuracy (272/306)**, with **96.7% accuracy on valid claims** and **81.0% accuracy on invalid claims**. This substantially outperforms both the original Llama trial (45.0%) and the standardized Gemma trial (58.0%), but the comparison is not directly equivalent because the filtered evaluation excludes ambiguous cases.

---

## 7. Key Findings

- HERALD is strong on binary claim validation when ambiguity is removed from the task.
- `claim_extraction` is the best-performing checkpoint type in the filtered setting.
- `retrieval` and `causal` remain relatively weaker and may still need checkpoint-specific prompting or calibration.
- Tier 2 is highly effective on this binary subset, suggesting the judge stage is much better aligned when forced to distinguish only between supported and unsupported claims.
- Tier 3 no longer collapses as it did in earlier reports, though its sample size here is small (`17` cases).

---

## 8. Recommendation for Reporting

For slides, writeups, or the paper, this run should be described as a **binary ablation** or **filtered binary evaluation**, not as the main replacement for the full 3-class benchmark.

Suggested phrasing:

> We additionally evaluate HERALD on a binary filtered subset that excludes ambiguous examples. In this easier but still policy-relevant setting, the system reaches 88.9% accuracy over 306 cases, with strong performance on both valid and invalid claims. This suggests that the current architecture is already effective at binary evidence validation, while ambiguity handling remains the main source of difficulty in the full benchmark.
