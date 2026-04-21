# HERALD Evaluation Pipeline — Experiment Results Report

**Date:** April 21, 2026  
**Git commit:** `259502c`  
**Model:** `gpt-4o` (Tier 2 LLM Judge and Tier 3 Debate)  
**NLI backend:** DeBERTa-v3-large-mnli via local Python service (`http://localhost:8000`)

---

## Overview

This report compares three claim evaluation systems across three ground-truth evaluation datasets. The central question: does HERALD's multi-tier escalation pipeline produce meaningfully better verdicts than a single LLM call alone, and is the quality improvement worth the added complexity and cost?

---

## Systems

### HERALD Full Pipeline

The complete four-tier HERALD architecture as implemented in `src/herald/router.ts`. Claims are routed to the appropriate starting tier based on their type:

- **Statistical, comparative, and causal claims** begin at Tier 1 (NLI). The local DeBERTa model checks whether the source chunk entails the claim. If confidence exceeds the threshold (0.90 for statistical/comparative, 0.85 for causal), the pipeline exits early without any LLM call. Uncertain results escalate to Tier 2.
- **Predictive, normative, and synthesis claims** skip NLI entirely and begin at Tier 2, since NLI cannot meaningfully evaluate projections, prescriptions, or multi-source inferences.
- **Tier 2 (LLM Judge):** A single `gpt-4o` call with a claim-type-specific system prompt evaluates accuracy, completeness, and potential logical gaps. Confident verdicts (confidence > 0.80) exit here.
- **Tier 3 (Multi-Agent Debate):** Uncertain Tier 2 results escalate to three parallel `gpt-4o` persona calls (Domain Expert, Research Methodologist, Critical Skeptic) followed by a Judge synthesis call.

This system makes between 0 and 5 LLM API calls per claim depending on how far it escalates.

### LLM-as-Judge Baseline

A single `gpt-4o` call applied to every claim, regardless of type. Uses the identical Tier 2 prompt template and output schema as the Full Pipeline — the only difference is that there is no NLI pre-screening and no multi-agent debate. If the judge returns `uncertain`, it is treated as `invalid` (no tier to escalate to). This system always makes exactly 1 LLM API call per claim, making it the cheapest and simplest possible baseline.

### HERALD without NLI (Ablation)

Identical to the Full Pipeline except Tier 1 NLI is disabled for all claim types. Statistical, comparative, and causal claims go directly to Tier 2 instead of passing through the DeBERTa model first. Tier 3 escalation remains intact. This is an ablation study to isolate the contribution of Tier 1 independent of the rest of the pipeline.

---

## Evaluation Datasets

### Balanced Benchmark Set (eval-set.json)

50 claims drawn evenly across all six claim types (8–9 claims per type), with a near-balanced valid/invalid split (24 valid, 26 invalid). Derivation methods are well-distributed, with a notably high proportion of `agent_inference` claims (11 of 50, 22%) — the highest-risk derivation category where the agent reasons beyond what the sources directly state. This set is designed to stress-test the full taxonomy under controlled conditions.

| Claim Type | Count | Valid | Invalid |
|------------|------:|------:|--------:|
| Statistical | 9 | 5 | 4 |
| Causal | 9 | 5 | 4 |
| Comparative | 8 | 4 | 4 |
| Normative | 8 | 5 | 3 |
| Predictive | 8 | 5 | 3 |
| Synthesis | 8 | 0 | 8 |
| **Total** | **50** | **24** | **26** |

### Statistical and Causal Heavy Set (eval-set-2.json)

53 claims with a concentration in statistical (17) and causal (14) claims, which together account for 58% of the set. Normative and predictive claims are underrepresented (2 and 1 claim respectively). The valid/invalid split is skewed toward valid (35 valid, 18 invalid), reflecting a more realistic production distribution where most claims in a well-researched memo are correct. Paraphrase derivations dominate (23 of 53, 43%), making this a set where slight rewording of source material is common.

| Claim Type | Count | Valid | Invalid |
|------------|------:|------:|--------:|
| Statistical | 17 | 9 | 8 |
| Causal | 14 | 10 | 4 |
| Comparative | 12 | 8 | 4 |
| Synthesis | 7 | 6 | 1 |
| Normative | 2 | 2 | 0 |
| Predictive | 1 | 0 | 1 |
| **Total** | **53** | **35** | **18** |

### Causal-Dominated Challenge Set (eval-set-3.json)

50 claims with causal claims as the single largest category (16 of 50, 32%), followed by statistical (14) and comparative (10). This is the most challenging set for all systems: causal claims require detecting correlation-as-causation traps, and the high paraphrase derivation rate (20 of 50, 40%) means the agent has reworded source content in ways that may subtly alter the causal relationship asserted. The valid/invalid split again skews valid (32 valid, 18 invalid).

| Claim Type | Count | Valid | Invalid |
|------------|------:|------:|--------:|
| Causal | 16 | 11 | 5 |
| Statistical | 14 | 8 | 6 |
| Comparative | 10 | 7 | 3 |
| Normative | 3 | 3 | 0 |
| Predictive | 3 | 3 | 0 |
| Synthesis | 4 | 0 | 4 |
| **Total** | **50** | **32** | **18** |

---

## Results

### Overall Accuracy and F1

| Dataset | System | Accuracy | Precision | Recall | F1 | False Invalid Rate | False Valid Rate |
|---------|--------|:--------:|:---------:|:------:|:--:|:-----------------:|:----------------:|
| Balanced Benchmark | HERALD Full Pipeline | **86.0%** | **82.8%** | 92.3% | **87.3%** | 20.8% | 7.7% |
| Balanced Benchmark | LLM-as-Judge Baseline | 78.0% | 72.7% | 92.3% | 81.4% | 37.5% | 7.7% |
| Balanced Benchmark | HERALD without NLI | 80.0% | 75.0% | 92.3% | 82.8% | 33.3% | 7.7% |
| Statistical & Causal Heavy | HERALD Full Pipeline | **84.9%** | **69.2%** | **100.0%** | **81.8%** | 22.9% | **0.0%** |
| Statistical & Causal Heavy | LLM-as-Judge Baseline | 81.1% | 64.3% | 100.0% | 78.3% | 28.6% | 0.0% |
| Statistical & Causal Heavy | HERALD without NLI | 79.2% | 62.1% | 100.0% | 76.6% | 31.4% | 0.0% |
| Causal-Dominated Challenge | HERALD Full Pipeline | **80.0%** | **64.3%** | **100.0%** | **78.3%** | 31.3% | **0.0%** |
| Causal-Dominated Challenge | LLM-as-Judge Baseline | 76.0% | 60.0% | 100.0% | 75.0% | 37.5% | 0.0% |
| Causal-Dominated Challenge | HERALD without NLI | 74.0% | 58.1% | 100.0% | 73.5% | 40.6% | 0.0% |

### Cross-Dataset F1 Summary

| System | Balanced Benchmark | Statistical & Causal Heavy | Causal-Dominated Challenge | **Average F1** |
|--------|:-----------------:|:--------------------------:|:--------------------------:|:--------------:|
| HERALD Full Pipeline | 87.3% | 81.8% | 78.3% | **82.5%** |
| LLM-as-Judge Baseline | 81.4% | 78.3% | 75.0% | **78.2%** |
| HERALD without NLI | 82.8% | 76.6% | 73.5% | **77.6%** |

HERALD Full Pipeline leads across all three datasets by an average of 4.3 percentage points over the LLM-as-Judge Baseline and 4.9 points over the NLI Ablation — both exceeding the pre-specified 3pp decision threshold.

---

## Key Findings

### 1. HERALD Consistently Outperforms a Single LLM Call

Across all three datasets, the Full Pipeline achieves 3.3–5.9pp higher F1 than the LLM-as-Judge Baseline, consistently meeting the ≥3pp threshold that justifies the added pipeline complexity. The performance gap is largest on the Balanced Benchmark (5.9pp), where the diverse claim type mix allows NLI to exit early on clear statistical and comparative entailments, reserving LLM calls for genuinely ambiguous cases.

### 2. Tier 1 NLI Contributes Meaningfully to Accuracy

Comparing the Full Pipeline against the NLI Ablation isolates the contribution of Tier 1:

| Dataset | F1 gain from NLI |
|---------|:----------------:|
| Balanced Benchmark | +4.5pp |
| Statistical & Causal Heavy | +5.2pp |
| Causal-Dominated Challenge | +4.8pp |

The gain is most pronounced in the Statistical & Causal Heavy set (5.2pp), where NLI exits 32% of claims at Tier 1 — the highest early-exit rate across all three runs. On the Balanced Benchmark, NLI exits only 14% of claims (7 of 50), yet still contributes a 4.5pp F1 gain because those 7 early exits are disproportionately correct statistical and comparative verdicts that the LLM judge would have gotten wrong.

### 3. The Primary Differentiator is Precision, Not Recall

All three systems achieve identical or near-identical recall across each dataset. The performance differences are entirely in **precision** — specifically in reducing false invalid verdicts (valid claims incorrectly rejected). The Full Pipeline's NLI pre-filter prevents the LLM judge from overzealously marking well-supported statistical and comparative claims as invalid.

| Dataset | Full Pipeline False Invalid Rate | Baseline False Invalid Rate | Reduction |
|---------|:--------------------------------:|:---------------------------:|:---------:|
| Balanced Benchmark | 20.8% | 37.5% | −16.7pp |
| Statistical & Causal Heavy | 22.9% | 28.6% | −5.7pp |
| Causal-Dominated Challenge | 31.3% | 37.5% | −6.2pp |

### 4. Causal Claims Are the Hardest for All Systems

The Causal-Dominated Challenge Set is the hardest across the board. Causal claims have the lowest per-type accuracy in every run:

| Dataset | Causal Accuracy (Full Pipeline) |
|---------|:-------------------------------:|
| Balanced Benchmark | 88.9% |
| Statistical & Causal Heavy | 78.6% |
| Causal-Dominated Challenge | 62.5% |

The degradation from 88.9% to 62.5% as causal claim density increases suggests that the systems struggle to detect subtle correlation-as-causation traps at scale, especially when claims are paraphrased (the dominant derivation in the Causal-Dominated set). Paraphrased causal claims are the most common error pattern: `paraphrase` derivation appears in the wrong-claims tables of all three datasets for all three systems.

### 5. Synthesis Claims Exhibit a Bimodal Pattern

Synthesis claims show radically different behavior across datasets:

- **Balanced Benchmark:** F1 of 40% for all three systems — the worst-performing claim type, driven by two false valid verdicts (GT-042, GT-023) where logical gaps in cross-source inferences went undetected.
- **Statistical & Causal Heavy Set:** F1 of 66.7% — improved, but still the second-worst type. One false invalid (GT-091, cross-source synthesis of valid combined evidence).
- **Causal-Dominated Challenge Set:** F1 of 0% for all systems (4 claims, all invalid, all correctly predicted invalid) — technically perfect recall but the metric is degenerate given all four ground-truth labels are invalid.

The consistent difficulty with synthesis claims suggests the multi-agent Tier 3 debate — which is specifically designed to catch logical gaps — was not engaged on these claims (Tier 3 was reached 0 times across all three runs), meaning Tier 2 was resolving synthesis claims with sufficient confidence to exit before escalation.

### 6. Tier 3 Was Never Reached

Across all three datasets and all three systems, zero claims reached Tier 3. Every evaluation exited at either Tier 1 (NLI, for Full Pipeline statistical/comparative/causal claims) or Tier 2 (LLM Judge). This means the cost and latency of the multi-agent debate was never incurred in practice — but it also means the expected benefit of Tier 3 for ambiguous causal and synthesis claims was not realized. The LLM Judge is resolving all claims with confidence > 0.80, leaving no room for escalation.

---

## Cost and Efficiency

### Per-Claim Cost Comparison

| Dataset | System | Mean Cost/Claim | Mean API Calls | Cost-Adjusted F1 |
|---------|--------|:--------------:|:--------------:|:----------------:|
| Balanced Benchmark | HERALD Full Pipeline | $0.00031 | 0.86 | 2822.7 |
| Balanced Benchmark | LLM-as-Judge Baseline | $0.00035 | 1.00 | 2346.8 |
| Balanced Benchmark | HERALD without NLI | $0.00035 | 1.00 | 2389.0 |
| Statistical & Causal Heavy | HERALD Full Pipeline | $0.00024 | 0.68 | 3396.8 |
| Statistical & Causal Heavy | LLM-as-Judge Baseline | $0.00033 | 1.00 | 2375.6 |
| Statistical & Causal Heavy | HERALD without NLI | $0.00033 | 1.00 | 2320.3 |
| Causal-Dominated Challenge | HERALD Full Pipeline | $0.00027 | 0.76 | 2932.3 |
| Causal-Dominated Challenge | LLM-as-Judge Baseline | $0.00033 | 1.00 | 2286.3 |
| Causal-Dominated Challenge | HERALD without NLI | $0.00033 | 1.00 | 2235.8 |

The Full Pipeline is **cheaper per claim** than the Baseline in every dataset. This is counterintuitive — a multi-tier system costs less than a single-tier system — because Tier 1 NLI exits 14–32% of claims before any LLM call is made. On the Statistical & Causal Heavy Set, where NLI exits 32% of claims, the per-claim cost drops to $0.00024 vs. $0.00033 for the Baseline — a 27% cost reduction alongside a 3.5pp F1 improvement.

The cost-adjusted F1 (F1 divided by mean cost per claim) is highest for the Full Pipeline in every dataset, confirming that HERALD delivers more quality per dollar than either alternative.

### Scale Projection — 1,000 Claims/Day

| System | Est. Daily Cost | Est. Monthly Cost |
|--------|:--------------:|:-----------------:|
| HERALD Full Pipeline | ~$0.27–$0.31 | ~$7–9 |
| LLM-as-Judge Baseline | ~$0.33–$0.35 | ~$10 |
| HERALD without NLI | ~$0.33–$0.35 | ~$10 |

At 1,000 claims/day, the Full Pipeline saves approximately $1–3/month over the alternatives. The savings scale proportionally: at 100,000 claims/day, the monthly cost difference reaches $100–300 in favor of HERALD.

---

## Agreement Between Systems

### HERALD Full Pipeline vs. LLM-as-Judge Baseline

| Dataset | Agreement Rate | Full Pipeline Wins | Baseline Wins |
|---------|:--------------:|:-----------------:|:-------------:|
| Balanced Benchmark | 88.0% (44/50) | 5 | 1 |
| Statistical & Causal Heavy | 88.7% (47/53) | 4 | 2 |
| Causal-Dominated Challenge | 96.0% (48/50) | 2 | 0 |

When the two systems disagree, the Full Pipeline is correct more often (11 vs. 3 across all three datasets). The Baseline's wins are mostly statistical and comparative claims where the NLI pre-filter's conservative threshold caused the Full Pipeline to skip an LLM call on a claim that the LLM judge would have gotten right.

---

## Per Claim Type Summary Across All Datasets

| Claim Type | Full Pipeline F1 (avg) | Baseline F1 (avg) | NLI Ablation F1 (avg) | Full Pipeline advantage |
|------------|:----------------------:|:-----------------:|:---------------------:|:-----------------------:|
| Statistical | ~88.6% | ~81.7% | ~81.7% | +6.9pp over baseline |
| Comparative | ~91.5% | ~88.6% | ~88.6% | +2.9pp over baseline |
| Causal | ~75.8% | ~68.7% | ~69.4% | +7.1pp over baseline |
| Normative | ~62.9% | ~60.0% | ~60.0% | +2.9pp over baseline |
| Predictive | ~60.0% | ~60.0% | ~53.3% | ~equal vs baseline |
| Synthesis | ~35.6% | ~35.6% | ~35.6% | ~equal vs baseline |

Statistical and causal claims benefit most from the Full Pipeline, driven by NLI early exits on clear entailments and the lower NLI threshold for causal claims (0.85 vs. 0.90). Synthesis claims show no benefit from any tier above Tier 2 — a strong signal that the Tier 3 confidence threshold should be reconsidered for synthesis, or that the Tier 2 judge prompt for synthesis claims should be made more conservative to force escalation.

---

## Decision Criteria

| Question | Answer |
|----------|--------|
| **Is HERALD worth the complexity?** | ✅ Yes — F1(Full Pipeline) > F1(Baseline) by 3.3–5.9pp across all three datasets, exceeding the ≥3pp threshold. Cost-adjusted F1 also favors HERALD. |
| **Does Tier 1 NLI contribute accuracy?** | ✅ Yes — F1(Full Pipeline) > F1(NLI Ablation) by 4.5–5.2pp. NLI also reduces per-claim cost by saving LLM calls on confident entailments. |
| **Which claim types benefit most from HERALD?** | Statistical (+6.9pp) and causal (+7.1pp) see the largest gains. Synthesis, predictive, and normative claims show minimal benefit — consider a hybrid approach for production. |
| **Is Tier 3 being used?** | ❌ No — zero claims escalated to Tier 3 in any run. The Tier 2 judge's confidence threshold (0.80) is too permissive, preventing escalation of genuinely ambiguous claims. |

---

## Limitations

- **Eval set size:** 50–53 claims per dataset provides directional conclusions but wide confidence intervals. Performance differences under ~3pp should not be over-interpreted.
- **Tier 3 never fired:** All results reflect a two-tier system in practice (NLI + LLM Judge), not the full four-tier design. The multi-agent debate's contribution to synthesis and causal claim accuracy remains untested.
- **No failed verdicts:** Zero evaluation errors across all runs suggests the LLM is consistently confident, which may reflect the model rather than genuine claim clarity.
- **Single run per dataset:** Results reflect one random ordering per dataset. For key findings, multiple trials with reported mean ± std would strengthen conclusions.
- **Paraphrase causal claims are a persistent blind spot:** The most common error pattern across all datasets is `paraphrase` + `causal` → False Invalid. A targeted prompt revision for paraphrased causal claims is the highest-priority improvement.
