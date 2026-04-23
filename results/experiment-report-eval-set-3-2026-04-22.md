# HERALD vs. LLM-as-Judge: Experiment Report (eval-set-3.json)

**Dataset:** `data/eval-set-3.json` (50 claims — causal-heavy: 16 causal, 14 statistical, 10 comparative, 4 synthesis, 3 predictive, 3 normative)
**Runs:** 3 independent trials (shuffled claim order per run)
**Result files:** `experiment-eval-set-3-2026-04-22.json`, `experiment-eval-set-3-2026-04-22.2.json`, `experiment-eval-set-3-2026-04-22.3.json`
**Date:** 2026-04-22 | **Git commit:** `8d9ab71`
**Model:** `gpt-4o` | **Pricing:** $2.50/1M input tokens, $10.00/1M output tokens

---

## 1. Systems Under Comparison

| System | Description |
|--------|-------------|
| **A — Full HERALD** | Complete 4-tier pipeline: NLI (Tier 1) → LLM Judge (Tier 2) → Multi-Agent Debate (Tier 3). NLI backend at `localhost:8000`. |
| **B — LLM-as-Judge** | Tier 2 only. Single `gpt-4o` call per claim. `uncertain` treated as `invalid`. |
| **C — HERALD (No NLI)** | HERALD with Tier 1 disabled. Starts at Tier 2 for all claim types. Ablation to isolate NLI's contribution. |

---

## 2. Overall Performance (Mean ± Std across 3 Runs)

> "Positive" = **invalid** (the thing we want to catch). F1 measures detection of invalid claims.

| Metric | System A (HERALD) | System B (Tier 2 Only) | System C (No NLI) |
|--------|:-----------------:|:----------------------:|:-----------------:|
| **Accuracy** | 75.3% ± 1.2pp | 74.0% ± 0.0pp | 74.7% ± 1.2pp |
| **Precision** | 59.4% ± 1.1pp | 58.1% ± 0.0pp | 58.7% ± 1.1pp |
| **Recall** | **100.0% ± 0.0pp** | **100.0% ± 0.0pp** | **100.0% ± 0.0pp** |
| **F1** | **74.5% ± 0.7pp** | 73.5% ± 0.0pp | 74.0% ± 0.7pp |
| **False Invalid Rate** | 38.5% ± 1.8pp | 40.6% ± 0.0pp | 39.6% ± 1.8pp |
| **False Valid Rate** | **0.0% ± 0.0pp** | **0.0% ± 0.0pp** | **0.0% ± 0.0pp** |

**Per-run breakdown:**

| Run | System A Acc | System A F1 | System B Acc | System B F1 | System C Acc | System C F1 |
|-----|:------------:|:-----------:|:------------:|:-----------:|:------------:|:-----------:|
| Run 1 | 74.0% | 73.5% | 74.0% | 73.5% | 74.0% | 73.5% |
| Run 2 | 76.0% | 75.0% | 74.0% | 73.5% | 74.0% | 73.5% |
| Run 3 | 76.0% | 75.0% | 74.0% | 73.5% | 76.0% | 75.0% |
| **Mean** | **75.3%** | **74.5%** | **74.0%** | **73.5%** | **74.7%** | **74.0%** |
| **Std** | **±1.2pp** | **±0.7pp** | **±0.0pp** | **±0.0pp** | **±1.2pp** | **±0.7pp** |

**Key finding — this dataset exposes a precision failure mode.** All three systems achieve perfect recall (100%) and zero false valid rate across every run, meaning no invalid claim ever slips through. However, precision is only ~58–59%, with a false invalid rate of ~38–41%. Every error on this dataset is a false invalid — the systems over-flag valid claims as invalid. This is particularly severe on causal and statistical claims, where legitimate valid claims are being wrongly rejected. System B is the most stable (zero variance) but also the least precise. System A leads narrowly in mean F1 (+1.0pp over B) and false invalid rate (−2.1pp lower than B).

---

## 3. Per Claim Type Breakdown (Mean across 3 Runs)

> n = number of claims per type. All metrics averaged across 3 independent runs.
> Synthesis F1 = 0.0% with Acc = 100.0% is a measurement artifact: all 4 synthesis claims in this dataset are `valid` (no invalid examples), so there are no true positives to compute F1 from. The systems correctly classify all synthesis claims.

### 3.1 Accuracy by Claim Type

| Claim Type | n | System A Acc | System B Acc | System C Acc |
|------------|:-:|:------------:|:------------:|:------------:|
| statistical | 14 | **78.6%** | 71.4% | 71.4% |
| causal | 16 | 54.2% | 56.3% | **58.3%** |
| comparative | 10 | **90.0%** | **90.0%** | **90.0%** |
| predictive | 3 | 66.7% | 66.7% | 66.7% |
| normative | 3 | **100.0%** | **100.0%** | **100.0%** |
| synthesis | 4 | **100.0%** | **100.0%** | **100.0%** |

### 3.2 F1 by Claim Type (Mean ± Std)

| Claim Type | n | System A F1 | System B F1 | System C F1 | Best System |
|------------|:-:|:-----------:|:-----------:|:-----------:|:-----------:|
| statistical | 14 | **80.0% ± 0.0pp** | 75.0% ± 0.0pp | 75.0% ± 0.0pp | **A** |
| causal | 16 | 57.7% ± 1.5pp | 58.8% ± 0.0pp | **60.0% ± 1.7pp** | **C** (marginal) |
| comparative | 10 | **85.7% ± 0.0pp** | **85.7% ± 0.0pp** | **85.7% ± 0.0pp** | Tied |
| predictive | 3 | **80.0% ± 0.0pp** | **80.0% ± 0.0pp** | **80.0% ± 0.0pp** | Tied |
| normative | 3 | **100.0% ± 0.0pp** | **100.0% ± 0.0pp** | **100.0% ± 0.0pp** | Tied (perfect) |
| synthesis | 4 | 0.0% (no invalids) | 0.0% (no invalids) | 0.0% (no invalids) | N/A |

**Notable patterns:**
- **Statistical claims**: System A leads at 80.0% F1 vs 75.0% for B and C. NLI's numeric entailment checking provides a +5pp benefit, consistent with findings from `eval-set.json`.
- **Causal claims**: The hardest claim type — only 54–58% accuracy across all systems. System C (no NLI) marginally leads at 60.0% F1, suggesting NLI is a slight liability for causal evaluation. The very low precision on causal (~40–43%) drives a false invalid rate above 40% for this type alone.
- **Comparative and predictive**: All systems tied. Comparative at 85.7% F1 reflects good entailment signal; predictive at 80.0% is stable but limited by small sample size (n=3).
- **Normative**: Perfect 100% across all systems and all runs. All 3 normative claims in this dataset are straightforward enough for universal agreement.
- **Synthesis**: All 4 synthesis claims are valid; F1=0 is a dataset artifact (no invalids to detect), not a system failure. Accuracy is 100%.

---

## 4. Tier Distribution (Pooled across 3 Runs)

**System A — Full HERALD** (150 claim evaluations across 3 runs)

| Tier | Claims | % | Notes |
|------|-------:|--:|-------|
| Tier 1 (NLI) | 36 | 24.0% | Early exits for statistical/comparative/causal claims |
| Tier 2 (LLM Judge) | 114 | 76.0% | NLI escalations + direct Tier 2 starts |
| Tier 3 (Debate) | 0 | 0.0% | Never triggered — LLM judge always returned confident verdict |
| Tier 4 (Human) | 0 | 0.0% | |

**System C — No NLI** (150 claim evaluations across 3 runs)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 2 (LLM Judge) | 150 | 100.0% |

**Observation:** The Tier 1 exit rate of 24.0% is between the rates observed on `human-eval-set-2.json` (30.8%) and `eval-set.json` (14.0%). This dataset has more statistical and causal claims (which are eligible for Tier 1), but fewer normative/predictive/synthesis claims that bypass NLI. Tier 3 was never triggered across all 150 evaluations — the LLM judge consistently returned confident verdicts, all pointing toward `invalid` for borderline causal and statistical claims, which is the source of the high false invalid rate.

---

## 5. Cost Analysis

### 5.1 Mean Cost per Claim (averaged across 3 runs)

| System | Mean Input Tokens | Mean Output Tokens | Mean API Calls | Mean Cost/Claim |
|--------|------------------:|-------------------:|:--------------:|----------------:|
| A (HERALD) | 1,766 | 149 | 1.00 | **$0.0059** |
| B (Tier 2 only) | 1,624 | 141 | 1.00 | **$0.0055** |
| C (No NLI) | 1,624 | 142 | 1.00 | **$0.0055** |

### 5.2 F1 per Dollar (Primary Decision Metric)

| System | Mean F1 | Mean Cost/Claim | F1 per Dollar | Rank |
|--------|:-------:|----------------:|:-------------:|:----:|
| A (HERALD) | 74.5% | $0.0059 | 126.3 | 3rd |
| B (Tier 2 only) | 73.5% | $0.0055 | 133.6 | 2nd |
| C (No NLI) | 74.0% | $0.0055 | **134.5** | 1st |

### 5.3 Cost at Scale

| System | Cost/Claim | Daily (1K claims) | Monthly (30 days) |
|--------|:----------:|:-----------------:|:-----------------:|
| A (HERALD) | $0.0059 | $5.90 | $177.00 |
| B (Tier 2 only) | $0.0055 | $5.50 | $165.00 |
| C (No NLI) | $0.0055 | $5.50 | $165.00 |

### 5.4 Cost-Performance Verdict

- **F1 delta (A − B):** +1.0pp *(HERALD marginally better)*
- **Cost delta (A − B):** +$0.0004/claim *(HERALD costs ~7% more)*
- **F1/$ delta (A − B):** −7.3 *(LLM-as-Judge more cost-efficient overall)*

**⚠️ Mixed verdict.** System A achieves a marginal +1.0pp F1 advantage over B, but at ~7% higher cost, resulting in a lower F1/$ ratio. System C achieves the best F1/$ (134.5), combining B's low cost with A's slightly better accuracy. The +1.0pp F1 gain from HERALD is within run-to-run variance and should not be treated as a definitive advantage given System A's std of ±0.7pp.

**Does NLI pull its weight (A vs C)?**
F1(A) = 74.5% vs F1(C) = 74.0% — a +0.5pp advantage for HERALD, driven by NLI's benefit on statistical claims (+5pp F1 for type A). However, NLI slightly hurts causal claims (−2.3pp F1 for type A vs C). The net effect is near-zero. NLI's infrastructure overhead is not clearly justified on this dataset.

---

## 6. Latency (Pooled across 3 Runs)

| System | Mean | Median | p95 |
|--------|-----:|-------:|----:|
| A (HERALD) | 2,041 ms | 2,193 ms | 3,638 ms |
| B (Tier 2 only) | 1,938 ms | 1,910 ms | 2,886 ms |
| C (No NLI) | 1,986 ms | 1,947 ms | 2,968 ms |

System A's higher p95 (3,638 ms vs 2,886 ms) reflects NLI backend round-trips for the 24% of claims routed through Tier 1. System B remains the fastest with the lowest variance.

---

## 7. Agreement: System A vs System B

| Run | Agreement Rate | Disagreements |
|-----|:--------------:|:-------------:|
| Run 1 | 96.0% (48/50) | 2 |
| Run 2 | 98.0% (49/50) | 1 |
| Run 3 | 98.0% (49/50) | 1 |
| **Mean** | **97.3%** | **1.3** |

Near-perfect agreement (97.3%) — among the highest across all three datasets. On this causal-heavy dataset, both NLI and the LLM judge arrive at the same (predominantly over-conservative) verdicts. The rare disagreements are NLI catching a case the LLM judge misses, or vice versa. Tier 3 never arbitrated any disagreements.

---

## 8. Persistent Wrong Claims

All persistent wrong claims have `ground_truth = valid`. Every structural failure on this dataset is a **false invalid** — the systems consistently reject valid claims. There are zero persistent false valid errors.

### System A — 12 persistent failures (all false invalids)

| Claim ID | Type | Pattern |
|----------|------|---------|
| GT-108 | statistical | Wrong 3/3 |
| GT-109 | statistical | Wrong 3/3 |
| GT-111 | causal | Wrong 3/3 |
| GT-113 | causal | Wrong 3/3 |
| GT-118 | causal | Wrong 3/3 |
| GT-129 | causal | Wrong 3/3 |
| GT-134 | causal | Wrong 3/3 |
| GT-137 | comparative | Wrong 3/3 |
| GT-139 | causal | Wrong 3/3 |
| GT-149 | statistical | Wrong 3/3 |
| GT-151 | causal | Wrong 3/3 |
| GT-127 | predictive | Wrong 3/3 |

### System B — 13 persistent failures (all false invalids)

| Claim ID | Type | Pattern |
|----------|------|---------|
| GT-108 | statistical | Wrong 3/3 |
| GT-109 | statistical | Wrong 3/3 |
| GT-111 | causal | Wrong 3/3 |
| GT-113 | causal | Wrong 3/3 |
| GT-118 | causal | Wrong 3/3 |
| GT-129 | causal | Wrong 3/3 |
| GT-134 | causal | Wrong 3/3 |
| GT-137 | comparative | Wrong 3/3 |
| GT-139 | causal | Wrong 3/3 |
| GT-149 | statistical | Wrong 3/3 |
| GT-151 | causal | Wrong 3/3 |
| GT-127 | predictive | Wrong 3/3 |
| GT-153 | statistical | Wrong 3/3 |

### System C — 13 persistent failures (all false invalids)

| Claim ID | Type | Pattern |
|----------|------|---------|
| GT-108 | statistical | Wrong 3/3 |
| GT-109 | statistical | Wrong 3/3 |
| GT-111 | causal | Wrong 3/3 |
| GT-113 | causal | Wrong 3/3 |
| GT-118 | causal | Wrong 3/3 |
| GT-129 | causal | Wrong 3/3 |
| GT-137 | comparative | Wrong 3/3 |
| GT-139 | causal | Wrong 3/3 |
| GT-149 | statistical | Wrong 3/3 |
| GT-151 | causal | Wrong 3/3 |
| GT-127 | predictive | Wrong 3/3 |
| GT-153 | statistical | Wrong 3/3 |
| GT-134 | causal | Wrong 2/3 |

**Cross-system universal failures** (wrong 3/3 in all three systems, all 3 runs):

| Claim ID | Type | Implication |
|----------|------|-------------|
| GT-108 | statistical | Valid statistical claim consistently rejected |
| GT-109 | statistical | Valid statistical claim consistently rejected |
| GT-111 | causal | Valid causal claim consistently rejected |
| GT-113 | causal | Valid causal claim consistently rejected |
| GT-118 | causal | Valid causal claim consistently rejected |
| GT-127 | predictive | Valid predictive claim consistently rejected |
| GT-129 | causal | Valid causal claim consistently rejected |
| GT-134 | causal | Valid causal claim consistently rejected |
| GT-137 | comparative | Valid comparative claim consistently rejected |
| GT-139 | causal | Valid causal claim consistently rejected |
| GT-149 | statistical | Valid statistical claim consistently rejected |
| GT-151 | causal | Valid causal claim consistently rejected |

**12 claims are universally and persistently wrong** — all valid claims being incorrectly flagged as invalid. This is a systematic over-conservatism in the models' evaluation of causal and statistical claims on this dataset, not random noise.

---

## 9. Hypothesis Assessment

| Hypothesis | Prediction | Result | Assessment |
|------------|------------|--------|------------|
| **H1** — HERALD ≥ LLM-as-Judge on F1 | HERALD higher F1 | F1(A)=74.5% vs F1(B)=73.5% (+1.0pp) | **Marginally confirmed** — A leads by 1pp, within noise |
| **H2** — Cost varies by claim type and tier | Variable API calls | All systems: 1.0 API call/claim (Tier 3 never reached) | **Partially confirmed** — cost differential exists; Tier 3 unmeasurable |
| **H3** — ~40% statistical/comparative exit at Tier 1 | ~40% NLI exits | 24.0% overall Tier 1 exits | **Not confirmed** — below prediction; causal/stat share is high but many NLI calls escalate |
| **H4** — Per-type hybrid may be optimal | Different systems best per type | A best for statistical; C best for causal; tied on comparative/normative | **Confirmed** |

---

## 10. Key Findings and Recommendations

### Finding 1: Systematic over-conservatism on valid causal and statistical claims

This dataset's defining characteristic is that every error is a false invalid. The systems have perfect recall (0 invalid claims missed) but reject ~38–41% of valid claims as invalid. This points to a systematic bias in the LLM judge and NLI model: when a causal or statistical claim is complex, nuanced, or uses hedged language, the evaluators default to `invalid` rather than `valid`. On a dataset with ~36% causal claims, this drives overall accuracy down to ~74%.

### Finding 2: This is the hardest dataset across all three eval sets

| Dataset | System B Mean F1 | False Invalid Rate (B) |
|---------|:----------------:|:---------------------:|
| eval-set.json | 85.3% | 26.4% |
| human-eval-set-2.json | 80.6% | 22.2% |
| **eval-set-3.json** | **73.5%** | **40.6%** |

`eval-set-3.json` produces the lowest F1 and highest false invalid rate across all datasets tested. The causal-heavy composition (32% causal) and the presence of nuanced valid claims that challenge the models' conservatism explain the performance gap.

### Finding 3: NLI helps statistical claims, slightly hurts causal claims

System A achieves 80.0% F1 on statistical claims vs 75.0% for B and C — a consistent +5pp benefit from NLI. However, on causal claims, C (60.0% F1) outperforms A (57.7%) and B (58.8%). NLI's conservative entailment check for causal claims adds extra false invalid pressure on top of the LLM judge's existing over-conservatism.

### Finding 4: Tier 3 never fired — the debate mechanism cannot correct precision failures

Multi-agent debate was never triggered in any run. The LLM judge returns high-confidence verdicts even on the 12 universally wrong valid claims, meaning it does not "know what it doesn't know." Tier 3 could in principle help by giving the Skeptic persona an opportunity to defend valid causal claims — but it never gets the chance when the judge is overconfident.

### Finding 5: Recommended routing policy (per-type hybrid)

| Claim Type | Recommended System | Mean F1 | Rationale |
|------------|:-----------------:|:-------:|-----------|
| statistical | **A (Full HERALD)** | 80.0% | NLI entailment check reliably benefits numeric claims |
| causal | **C (No NLI)** | 60.0% | NLI adds false-invalid pressure; direct LLM judge slightly better |
| comparative | **Any** | 85.7% | All systems tied; no routing benefit |
| predictive | **Any** | 80.0% | All systems tied (n=3, too small for conclusion) |
| normative | **Any** | 100.0% | All systems perfect on this dataset |
| synthesis | **N/A** | 0.0% F1* | No invalid synthesis claims in dataset; accuracy 100% |

*F1=0 is a measurement artifact; synthesis accuracy is 100%.

---

## 11. Comparison Across All Three Eval Sets

| Metric | eval-set-3.json | eval-set.json | human-eval-set-2.json |
|--------|:---------------:|:-------------:|:---------------------:|
| System A mean F1 | 74.5% | 85.3% | 80.3% |
| System B mean F1 | 73.5% | 85.3% | 80.6% |
| System C mean F1 | 74.0% | 83.3% | 80.9% |
| False Invalid Rate (A) | 38.5% | 26.4% | 17.8% |
| False Valid Rate (A) | **0.0%** | **7.7%** | **16.7%** |
| Tier 1 exit rate (A) | 24.0% | 14.0% | 30.8% |
| A vs B agreement | 97.3% | 96.0% | 84.0% |
| Causal F1 (best system) | 60.0% (C) | 88.2% (A) | 81.2% (C) |
| Synthesis F1 | 0.0%* | 40.0% | 50.0% |

`eval-set-3.json` has the most extreme precision-recall tradeoff: perfect recall / zero FVR but the highest false invalid rate (38.5%) of any dataset tested. This reflects that the dataset contains many challenging valid causal and statistical claims that the models over-conservatively reject.

---

## 12. Limitations

- **Small eval set**: 50 claims; per-type samples as small as n=3 (predictive, normative). Per-type conclusions for small types carry wide confidence intervals.
- **No invalid synthesis claims**: The F1=0 for synthesis is a dataset property, not a system failure. Synthesis accuracy is 100% on this dataset, so conclusions about synthesis performance cannot be drawn.
- **Tier 3 not evaluated**: Multi-agent debate never triggered. The over-conservatism finding cannot be addressed by Tier 3 in the current configuration because the LLM judge does not escalate.
- **Causal claim difficulty may be domain-specific**: The high false invalid rate on causal claims may reflect domain-specific valid claims that use language patterns the models associate with invalid causal reasoning. Manual review of the 12 universal failures is warranted.
- **Single run temperature**: All runs use fixed temperature settings. The zero variance of System B (identical results across all 3 runs) confirms near-determinism at the chosen temperature, but System A and C show small variance from NLI stochasticity.
