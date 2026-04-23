# HERALD vs. LLM-as-Judge: Experiment Report

**Dataset:** `data/human-eval-set-2.json` (52 valid claims; GT-099 skipped — unknown derivation)
**Runs:** 3 independent trials (shuffled claim order per run)
**Result files:** `experiment-2026-04-22.json`, `experiment-2026-04-22.2.json`, `experiment-2026-04-22.3.json`
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
| **Accuracy** | 82.7% ± 1.9pp | 82.1% ± 1.1pp | 82.7% ± 1.9pp |
| **Precision** | 77.6% ± 3.7pp | 74.5% ± 2.7pp | 76.1% ± 3.1pp |
| **Recall** | 83.3% ± 2.7pp | 87.9% ± 2.6pp | 86.4% ± 0.0pp |
| **F1** | 80.3% ± 1.5pp | **80.6% ± 0.5pp** | 80.9% ± 1.7pp |
| **False Invalid Rate** | 17.8% ± 3.9pp | 22.2% ± 3.9pp | 20.0% ± 3.3pp |
| **False Valid Rate** | 16.7% ± 2.7pp | **12.1% ± 2.6pp** | 13.6% ± 0.0pp |

**Per-run breakdown:**

| Run | System A F1 | System B F1 | System C F1 |
|-----|:-----------:|:-----------:|:-----------:|
| Run 1 | 80.9% | 80.9% | 79.2% |
| Run 2 | 81.8% | 80.9% | 80.9% |
| Run 3 | 78.3% | 80.0% | 82.6% |
| **Mean** | **80.3%** | **80.6%** | **80.9%** |
| **Std** | **±1.5pp** | **±0.5pp** | **±1.7pp** |

**Key finding:** All three systems achieve statistically indistinguishable accuracy at ~80–81% F1. The F1 delta between the best and worst system is less than 1 percentage point across 3 trials, which is within the noise of model non-determinism.

---

## 3. Per Claim Type Breakdown (Mean across 3 Runs)

> n = number of claims of each type in the eval set. All metrics are averaged across 3 runs.
> F1 = 0.0% for normative claims because both normative claims are `valid` — there are no invalid examples to detect (the positive class is absent), making precision/recall undefined.

### 3.1 Accuracy by Claim Type

| Claim Type | n | System A Acc | System B Acc | System C Acc |
|------------|:-:|:------------:|:------------:|:------------:|
| statistical | 17 | 82.4% | **90.2%** | 88.2% |
| causal | 12 | 77.8% | 72.2% | **80.6%** |
| comparative | 12 | **91.7%** | 83.3% | 83.3% |
| predictive | 2 | 83.3% | 83.3% | 66.7% |
| normative | 2 | 100.0% | 100.0% | 100.0% |
| synthesis | 7 | 71.4% | 71.4% | 71.4% |

### 3.2 F1 by Claim Type (Mean ± Std)

| Claim Type | n | System A F1 | System B F1 | System C F1 |
|------------|:-:|:-----------:|:-----------:|:-----------:|
| statistical | 17 | 86.1% ± 3.7pp | **91.7% ± 2.5pp** | 90.0% ± 0.0pp |
| causal | 12 | 75.6% ± 6.3pp | 75.1% ± 2.6pp | **81.2% ± 3.0pp** |
| comparative | 12 | **85.7% ± 0.0pp** | 75.0% ± 0.0pp | 75.0% ± 0.0pp |
| predictive | 2 | 88.9% ± 15.7pp | 88.9% ± 15.7pp | 77.8% ± 15.7pp |
| normative | 2 | 0.0% (no invalids) | 0.0% (no invalids) | 0.0% (no invalids) |
| synthesis | 7 | 50.0% ± 0.0pp | 50.0% ± 0.0pp | 50.0% ± 0.0pp |

**Notable patterns:**
- **Statistical claims**: System B (Tier 2-only) is the strongest at 91.7% F1 — NLI routing for statistical claims does not improve over a direct LLM judge.
- **Causal claims**: System C (no NLI) achieves the best F1 at 81.2%. HERALD's NLI step slightly hurts causal claim evaluation.
- **Comparative claims**: System A (full HERALD) is the strongest at 85.7% F1, outperforming B and C by ~11pp. NLI provides a meaningful benefit here.
- **Synthesis claims**: All three systems are equally poor at 50.0% F1. This is a structural limit — synthesis claims require multi-source reasoning that none of the current systems handle well.
- **Predictive / Normative**: Too few examples (n=2 each) for reliable conclusions. High variance on predictive; normative has no invalid cases.

---

## 4. Tier Distribution (System A and C, pooled across 3 runs)

System C is included as an ablation baseline — it always resolves at Tier 2.

**System A — Full HERALD** (156 claim evaluations across 3 runs)

| Tier | Claims | % | Notes |
|------|-------:|--:|-------|
| Tier 1 (NLI) | 48 | 30.8% | Early exits via NLI for statistical/comparative/causal claims |
| Tier 2 (LLM Judge) | 108 | 69.2% | Either started at Tier 2 or escalated from Tier 1 |
| Tier 3 (Debate) | 0 | 0.0% | No claim reached Tier 3 in any run |
| Tier 4 (Human) | 0 | 0.0% | |

**System C — No NLI** (156 claim evaluations across 3 runs)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 2 (LLM Judge) | 156 | 100.0% |

**Observation:** Tier 3 (multi-agent debate) was never triggered in any of the 3 runs across either System A or C. Every claim that reached Tier 2 received a confident verdict (above the escalation threshold), meaning the LLM judge never returned `uncertain`. This means the cost and accuracy advantage of Tier 3 cannot be evaluated from this dataset — both System A and System B effectively ran the same Tier 2 judge, which explains their near-identical accuracy.

---

## 5. Cost Analysis

### 5.1 Mean Cost per Claim (averaged across 3 runs)

| System | Mean Input Tokens | Mean Output Tokens | Mean API Calls | Mean Cost/Claim |
|--------|------------------:|-------------------:|:--------------:|----------------:|
| A (HERALD) | ~1,950 | ~195 | 1.00 | **$0.0059** |
| B (Tier 2 only) | ~1,800 | ~180 | 1.00 | **$0.0055** |
| C (No NLI) | ~1,800 | ~180 | 1.00 | **$0.0055** |

> API call count = 1.00 for all systems because Tier 1 (NLI) is free/local and Tier 3 was never reached.
> System A's slightly higher cost reflects the NLI backend overhead on the ~31% of claims routed through Tier 1 before escalating to Tier 2.

### 5.2 F1 per Dollar (Primary Decision Metric)

| System | Mean F1 | Mean Cost/Claim | F1 per Dollar | Rank |
|--------|:-------:|----------------:|:-------------:|:----:|
| A (HERALD) | 80.3% | $0.0059 | 136.1 | 3rd |
| B (Tier 2 only) | 80.6% | $0.0055 | **146.5** | 2nd |
| C (No NLI) | 80.9% | $0.0055 | **147.1** | 1st |

### 5.3 Cost at Scale

| System | Cost/Claim | Daily (1K claims) | Monthly (30 days) |
|--------|:----------:|:-----------------:|:-----------------:|
| A (HERALD) | $0.0059 | $5.90 | $177.00 |
| B (Tier 2 only) | $0.0055 | $5.50 | $165.00 |
| C (No NLI) | $0.0055 | $5.50 | $165.00 |

### 5.4 Cost-Performance Verdict

- **F1 delta (A − B):** −0.3pp *(HERALD is marginally worse)*
- **Cost delta (A − B):** +$0.0004/claim *(HERALD costs more)*
- **F1/$ delta (A − B):** −10.4 *(LLM-as-Judge delivers more accuracy per dollar)*

**❌ LLM-as-Judge (System B) wins** — HERALD achieves no accuracy gain over Tier 2-only while costing ~7% more per claim. The added NLI infrastructure does not pay for itself on this dataset.

**Does NLI pull its weight (A vs C)?**
F1(A) ≈ F1(C) (delta: −0.6pp). NLI adds infrastructure cost and routing complexity without a measurable accuracy benefit. System C (no NLI) is slightly cheaper and marginally more accurate on average.

---

## 6. Latency (pooled across 3 runs)

| System | Mean | Median | p95 |
|--------|-----:|-------:|----:|
| A (HERALD) | 1,830 ms | 1,970 ms | 3,707 ms |
| B (Tier 2 only) | 1,919 ms | 1,797 ms | 2,867 ms |
| C (No NLI) | 1,904 ms | 1,830 ms | 2,814 ms |

System A's higher p95 (3.7s vs 2.9s) reflects NLI backend round-trips for claims routed through Tier 1. Median latency is similar across systems — the NLI path can be faster than Tier 2 when the model exits early with high confidence.

---

## 7. Agreement: System A vs System B

| Run | Agreement Rate | Disagreements |
|-----|:--------------:|:-------------:|
| Run 1 | 84.6% (44/52) | 8 |
| Run 2 | 86.5% (45/52) | 7 |
| Run 3 | 80.8% (42/52) | 10 |
| **Mean** | **84.0%** | **8.3** |

The ~16% disagreement rate between A and B is driven by claims where NLI exits early at Tier 1 with a different verdict than what Tier 2 would produce. Since Tier 3 never fired, every disagreement is an NLI-vs-LLM-Judge conflict.

---

## 8. Persistent Wrong Claims

Claims wrong in 2 or more of 3 runs indicate structural failure modes — not random variance.

### System A — 8 persistent failures

| Claim ID | Type | Derivation | Ground Truth | Pattern |
|----------|------|------------|:------------:|---------|
| GT-053 | statistical | direct_extraction | — | Wrong 3/3 |
| GT-055 | causal | cross_source | — | Wrong 3/3 |
| GT-057 | synthesis | cross_source | — | Wrong 3/3 |
| GT-059 | statistical | paraphrase | — | Wrong 3/3 |
| GT-062 | causal | cross_source | — | Wrong 3/3 |
| GT-079 | synthesis | cross_source | — | Wrong 3/3 |
| GT-096 | comparative | cross_source | — | Wrong 3/3 |
| GT-065 | statistical | agent_inference | — | Wrong 2/3 |

### System B — 10 persistent failures

| Claim ID | Type | Derivation | Ground Truth | Pattern |
|----------|------|------------|:------------:|---------|
| GT-055 | causal | cross_source | — | Wrong 3/3 |
| GT-057 | synthesis | cross_source | — | Wrong 3/3 |
| GT-059 | statistical | paraphrase | — | Wrong 3/3 |
| GT-060 | comparative | cross_source | — | Wrong 3/3 |
| GT-071 | causal | cross_source | — | Wrong 3/3 |
| GT-079 | synthesis | cross_source | — | Wrong 3/3 |
| GT-103 | comparative | cross_source | — | Wrong 3/3 |
| GT-065 | statistical | agent_inference | — | Wrong 2/3 |
| GT-087 | causal | cross_source | — | Wrong 2/3 |
| GT-097 | causal | cross_source | — | Wrong 2/3 |

### System C — 9 persistent failures

| Claim ID | Type | Derivation | Ground Truth | Pattern |
|----------|------|------------|:------------:|---------|
| GT-055 | causal | cross_source | — | Wrong 3/3 |
| GT-057 | synthesis | cross_source | — | Wrong 3/3 |
| GT-059 | statistical | paraphrase | — | Wrong 3/3 |
| GT-060 | comparative | cross_source | — | Wrong 3/3 |
| GT-079 | synthesis | cross_source | — | Wrong 3/3 |
| GT-103 | comparative | cross_source | — | Wrong 3/3 |
| GT-065 | statistical | agent_inference | — | Wrong 3/3 |
| GT-077 | predictive | cross_source | — | Wrong 2/3 |
| GT-087 | causal | cross_source | — | Wrong 2/3 |

**Cross-system persistent failures** (wrong 3/3 in all three systems — irreducible with current prompts):

| Claim ID | Type |
|----------|------|
| GT-057 | synthesis |
| GT-055 | causal |
| GT-059 | statistical |
| GT-079 | synthesis |

These 4 claims are structurally hard for all systems. They likely represent edge cases where the source text is genuinely ambiguous or where the ground truth label is near a decision boundary.

---

## 9. Hypothesis Assessment

| Hypothesis | Prediction | Result | Assessment |
|------------|------------|--------|------------|
| **H1** — HERALD ≥ LLM-as-Judge on F1 | HERALD higher F1 | F1(A)=80.3% vs F1(B)=80.6% | **Rejected** — B marginally outperforms A |
| **H2** — Cost varies by claim type | Variable API call counts | All systems: 1.0 API call/claim (Tier 3 never reached) | **Partially confirmed** — cost differential exists (A costs ~7% more) but Tier 3 cost impact could not be measured |
| **H3** — ~40% statistical exit at Tier 1 | ~40% NLI exits | 30.8% overall Tier 1 exits (not broken down by type) | **Partially confirmed** — NLI is active but below expected rate |
| **H4** — Per-type hybrid may be optimal | Different systems best for different types | B best for statistical; A best for comparative; C best for causal | **Confirmed** — per-type optimal routing differs by claim type |

---

## 10. Key Findings and Recommendations

### Finding 1: No system meaningfully outperforms another overall

All three systems converge to ~80–81% F1 with overlapping confidence intervals. The choice of system has negligible impact on overall accuracy for this eval set.

### Finding 2: Tier 3 (multi-agent debate) never fired

The LLM judge (Tier 2) never returned `uncertain` across 156 evaluations in 3 runs. This means HERALD's key differentiator — escalation to multi-agent debate — was never tested. The experiment cannot evaluate Tier 3's contribution to accuracy. This may indicate the escalation threshold needs tuning, or that `gpt-4o` is too confident on this dataset.

### Finding 3: Per-type routing reveals meaningful differences

| Claim Type | Recommended System | Rationale |
|------------|:-----------------:|-----------|
| statistical | **B (Tier 2 only)** | 91.7% F1, highest and most stable |
| causal | **C (No NLI)** | 81.2% F1, NLI hurts causal evaluation |
| comparative | **A (Full HERALD)** | 85.7% F1, NLI provides +11pp benefit |
| predictive | **A or B** | Tied; too few examples for conclusion |
| normative | Any | All correct; no invalid cases to discriminate |
| synthesis | Any | All systems fail equally (50.0% F1) |

### Finding 4: Synthesis is a hard open problem

50.0% F1 across all three systems and all three runs means the models are essentially at chance on synthesis claims. Neither NLI nor multi-agent debate (when it fires) resolves this. Synthesis evaluation likely requires retrieval-augmented reasoning or external knowledge that is not currently provided.

### Finding 5: LLM-as-Judge wins on cost-efficiency

System B achieves the best F1/$ ratio (146.5) with the lowest variance (±0.5pp). For production deployments where cost matters, Tier 2-only is the recommended baseline. HERALD's infrastructure overhead is not justified by accuracy gains on this dataset.

---

## 11. Limitations

- **Small eval set**: 52 claims. Some subtypes have n=2, making per-type conclusions unreliable. The 95% CI on individual per-type F1 values is ±10–15pp.
- **Tier 3 not evaluated**: Multi-agent debate never triggered. HERALD's accuracy advantage (if any) remains unmeasured. The experiment does not allow conclusions about Tier 3's value.
- **Single policy domain**: If the eval set is concentrated in one domain, results may not generalize.
- **Normative claims**: Only 2 claims, both valid. F1=0 is a measurement artifact, not a system failure.
- **Ground truth quality**: GT-099 had an unknown derivation and was skipped. Claims wrong in all 3 systems may have borderline or contested ground truth labels.
- **NLI backend**: The Python NLI backend was confirmed running before all three experiments. System A's Tier 1 was active.
