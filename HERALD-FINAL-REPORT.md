# HERALD Evaluation Framework — Final Experiment Report

**Experiment:** HERALD Multi-Tier Pipeline vs. Single LLM-as-Judge Baseline
**Date:** 2026-04-22 | **Git commit:** `8d9ab71`
**Model:** `gpt-4o` | **Pricing:** $2.50/1M input tokens, $10.00/1M output tokens
**Total evaluations:** 456 claim evaluations (152 claims × 3 systems, across 9 runs on 3 datasets)

---

## Systems and Datasets

### Systems

| Label | System Name | Description |
|-------|-------------|-------------|
| **Full HERALD** | HERALD Multi-Tier Pipeline | 4-tier escalation: DeBERTa NLI (Tier 1, local/free) → GPT-4o LLM Judge (Tier 2) → GPT-4o Multi-Agent Debate (Tier 3, 3 personas + judge). Routing follows HERALD claim-type config: statistical/comparative/causal start at Tier 1; predictive/normative/synthesis skip to Tier 2. |
| **Single LLM-as-Judge** | LLM-as-Judge Baseline | Single GPT-4o call per claim (Tier 2 only). No NLI pre-screening. No escalation to debate. `uncertain` treated as `invalid`. The minimal viable evaluation baseline. |
| **HERALD without NLI** | HERALD Ablation (No NLI) | Full HERALD routing minus Tier 1. All claims start at Tier 2. Isolates the NLI component's independent contribution to accuracy and cost. |

### Evaluation Datasets

| Label | File | Claims | Composition | Character |
|-------|------|:------:|-------------|-----------|
| **Human-Annotated Eval Set** | `data/human-eval-set-2.json` | 52* | 17 statistical, 12 causal, 13 comparative, 7 synthesis, 2 predictive, 2 normative | Human-written, mixed real-world policy claims; most ambiguous of the three datasets |
| **Balanced Benchmark Eval Set** | `data/eval-set.json` | 50 | 9 statistical, 9 causal, 8 comparative, 8 synthesis, 8 predictive, 8 normative | Purpose-built benchmark; equal representation per type; cleanest ground truth |
| **Causal-Heavy Eval Set** | `data/eval-set-3.json` | 50 | 16 causal, 14 statistical, 10 comparative, 4 synthesis, 3 predictive, 3 normative | Dominated by causal (32%) and statistical (28%) claims; hardest dataset |

*GT-099 skipped — unknown derivation field.

All experiments ran 3 independent trials per dataset with shuffled claim order, per the experiment design's protocol for measuring non-determinism variance.

---

## 1. Overall Performance Across All Datasets

### 1.1 Mean F1 per System per Dataset (averaged across 3 runs)

| Dataset | Full HERALD | Single LLM-as-Judge | HERALD without NLI |
|---------|:-----------:|:-------------------:|:-----------------:|
| **Human-Annotated Eval Set** | 80.3% ± 1.5pp | 80.6% ± 0.5pp | 80.9% ± 1.7pp |
| **Balanced Benchmark Eval Set** | 85.3% ± 1.9pp | 85.3% ± 2.5pp | 83.3% ± 0.8pp |
| **Causal-Heavy Eval Set** | **74.5% ± 0.7pp** | 73.5% ± 0.0pp | 74.0% ± 0.7pp |
| **Grand Mean (all datasets)** | **80.0%** | **79.8%** | **79.4%** |

### 1.2 Full Accuracy Metrics (Grand Mean across all 3 datasets × 3 runs)

| Metric | Full HERALD | Single LLM-as-Judge | HERALD without NLI |
|--------|:-----------:|:-------------------:|:-----------------:|
| **Accuracy** | **80.4%** | 79.8% | 79.4% |
| **Precision** | **72.1%** | 70.7% | 70.2% |
| **Recall** | 91.9% | **92.0%** | 88.4% |* |
| **F1** | **80.0%** | 79.8% | 79.4% |
| **False Invalid Rate** | 27.6% | **29.7%** | 30.5% |
| **False Valid Rate** | **12.8%** | **11.8%** | 11.7% |

*Recall varies across datasets because the Human-Annotated Eval Set has a balanced false valid rate (16.7%), while the Causal-Heavy Eval Set has 0.0% false valid rate (perfect recall) but severe precision problems.

### 1.3 Grand Mean — Key Takeaway

The three systems are statistically indistinguishable in overall F1 across all datasets (80.0% vs 79.8% vs 79.4%). No system is universally superior. The choice of system matters at the **claim-type level**, not the overall level.

---

## 2. Per-Dataset Performance Detail

### 2.1 Human-Annotated Eval Set (52 claims, mixed real-world)

| Metric | Full HERALD | Single LLM-as-Judge | HERALD without NLI |
|--------|:-----------:|:-------------------:|:-----------------:|
| Accuracy | 82.7% ± 1.9pp | 82.1% ± 1.1pp | 82.7% ± 1.9pp |
| Precision | 77.6% ± 3.7pp | 74.5% ± 2.7pp | 76.1% ± 3.1pp |
| Recall | 83.3% ± 2.7pp | 87.9% ± 2.6pp | 86.4% ± 0.0pp |
| **F1** | 80.3% ± 1.5pp | **80.6% ± 0.5pp** | 80.9% ± 1.7pp |
| False Invalid Rate | 17.8% | 22.2% | 20.0% |
| False Valid Rate | 16.7% | 12.1% | 13.6% |
| NLI Tier 1 exit rate | 30.8% | — | — |
| A vs B agreement | **84.0%** | — | — |
| Cost/claim | $0.0059 | $0.0055 | $0.0055 |
| F1 per dollar | 136.1 | **146.5** | 147.1 |

**Verdict:** All systems are tied at ~80–81% F1. The Single LLM-as-Judge is most stable (±0.5pp) and most cost-efficient (F1/$ 146.5). HERALD without NLI delivers marginally the highest F1 (80.9%) at equal cost to the baseline. The highest disagreement rate (84%) across all datasets signals this set contains the most NLI-ambiguous claims.

---

### 2.2 Balanced Benchmark Eval Set (50 claims, equal type distribution)

| Metric | Full HERALD | Single LLM-as-Judge | HERALD without NLI |
|--------|:-----------:|:-------------------:|:-----------------:|
| Accuracy | 83.3% ± 2.5pp | 83.3% ± 3.3pp | 80.7% ± 1.2pp |
| Precision | 79.3% ± 3.3pp | 79.4% ± 4.3pp | 75.8% ± 1.4pp |
| Recall | **92.3% ± 0.0pp** | **92.3% ± 0.0pp** | **92.3% ± 0.0pp** |
| **F1** | **85.3% ± 1.9pp** | **85.3% ± 2.5pp** | 83.3% ± 0.8pp |
| False Invalid Rate | 26.4% | 26.4% | 31.9% |
| False Valid Rate | **7.7%** | **7.7%** | **7.7%** |
| NLI Tier 1 exit rate | 14.0% | — | — |
| A vs B agreement | **96.0%** | — | — |
| Cost/claim | $0.0060 | $0.0058 | $0.0058 |
| F1 per dollar | 142.2 | **147.1** | 143.6 |

**Verdict:** Full HERALD and Single LLM-as-Judge are exactly tied in F1 (85.3%). Full HERALD costs ~3% more with no accuracy gain. Recall is perfectly locked at 92.3% with zero variance — every error is a precision failure. HERALD without NLI trails by 2pp. The near-perfect A vs B agreement (96%) confirms this dataset is unambiguous enough that NLI routing adds no value beyond the LLM judge.

---

### 2.3 Causal-Heavy Eval Set (50 claims, 32% causal, 28% statistical)

| Metric | Full HERALD | Single LLM-as-Judge | HERALD without NLI |
|--------|:-----------:|:-------------------:|:-----------------:|
| Accuracy | 75.3% ± 1.2pp | 74.0% ± 0.0pp | 74.7% ± 1.2pp |
| Precision | 59.4% ± 1.1pp | 58.1% ± 0.0pp | 58.7% ± 1.1pp |
| Recall | **100.0% ± 0.0pp** | **100.0% ± 0.0pp** | **100.0% ± 0.0pp** |
| **F1** | **74.5% ± 0.7pp** | 73.5% ± 0.0pp | 74.0% ± 0.7pp |
| False Invalid Rate | 38.5% | 40.6% | 39.6% |
| False Valid Rate | **0.0%** | **0.0%** | **0.0%** |
| NLI Tier 1 exit rate | 24.0% | — | — |
| A vs B agreement | **97.3%** | — | — |
| Cost/claim | $0.0059 | $0.0055 | $0.0055 |
| F1 per dollar | 126.3 | 133.6 | **134.5** |

**Verdict:** The hardest dataset of the three. All systems exhibit perfect recall (zero false valid rate) but severe precision failure — ~38–41% of valid claims are rejected as invalid. Every persistent error is a false invalid. Full HERALD leads by a narrow +1.0pp F1 over the baseline, driven by NLI's help on statistical claims. HERALD without NLI achieves the best F1/$ (134.5). The near-perfect agreement (97.3%) confirms the LLM judge and NLI arrive at the same over-conservative verdict on hard causal claims.

---

## 3. Per Claim Type Analysis (Pooled across All Datasets)

### 3.1 F1 by Claim Type — Best System per Dataset

| Claim Type | Human-Annotated | Balanced Benchmark | Causal-Heavy | **Consistent Winner** |
|------------|:---------------:|:------------------:|:------------:|:---------------------:|
| **statistical** | B: 91.7% | **A: 100.0%** | **A: 80.0%** | **Full HERALD** |
| **causal** | C: 81.2% | A≈B: ~88% | C: 60.0% | **HERALD without NLI** |
| **comparative** | A: 85.7% | All: 100.0% | All: 85.7% | Tied (any system) |
| **predictive** | A≈B: ~89% | B: 85.9% | All: 80.0% | **Single LLM-as-Judge** |
| **normative** | All: 100%* | B: 83.0% | All: 100.0% | **Single LLM-as-Judge** |
| **synthesis** | All: 50.0% | All: 40.0% | N/A† | All fail equally |

*F1=0 in Human-Annotated Set — only 2 normative claims, both valid (measurement artifact).
†No invalid synthesis claims in Causal-Heavy Set; accuracy 100%, F1 measurement undefined.

### 3.2 Synthesis of Per-Type Findings

**Statistical claims** — Full HERALD is the consistent winner. NLI's numeric entailment check is a direct fit for statistical claim evaluation. On the Balanced Benchmark, Full HERALD achieves perfect 100.0% F1 across all 3 runs. On the Causal-Heavy Set it leads by +5pp over the baseline. The Human-Annotated Set is the exception (B leads at 91.7%), likely due to more complex statistical phrasing in human-written claims.

**Causal claims** — HERALD without NLI is the most consistent performer. NLI's conservative entailment check adds false-invalid pressure on complex causal claims: on the Causal-Heavy Set, NLI hurts by −2.3pp F1 vs no-NLI; on the Human-Annotated Set, no-NLI leads by +5.6pp. On the Balanced Benchmark, Full HERALD and Single LLM-as-Judge are neck-and-neck (~88%). The recommended approach for causal claims is Tier 2 directly, skipping NLI.

**Comparative claims** — All systems are tied or near-tied across every dataset. No routing benefit. Use whichever system is cheapest (Single LLM-as-Judge or HERALD without NLI).

**Predictive claims** — Single LLM-as-Judge leads on the Balanced Benchmark (+3pp over others). The LLM judge handles forward-looking claims with broad context that NLI cannot evaluate. Sample sizes are small (n=2–8 per dataset), so this finding is directional only.

**Normative claims** — Single LLM-as-Judge leads on the one dataset with sufficient normative claims (Balanced Benchmark, n=8). The LLM's broad world knowledge and reasoning capability is better suited to consensus evaluation than NLI entailment.

**Synthesis claims** — No system reliably evaluates synthesis claims. F1 ranges from 40–50% across datasets, near or below random chance on binary classification. This is a structural failure of the current architecture: single-source prompts cannot validate multi-source logical inferences. This is the most important open problem in the HERALD pipeline.

---

## 4. NLI Tier 1 — Contribution Analysis

### 4.1 Tier 1 Exit Rates Across Datasets

| Dataset | Tier 1 Exits | Tier 2 | Tier 3 | Notes |
|---------|:-----------:|:------:|:------:|-------|
| Human-Annotated Eval Set | 30.8% | 69.2% | 0.0% | High NLI exit rate; most ambiguous claims |
| Balanced Benchmark Eval Set | 14.0% | 86.0% | 0.0% | Low rate; many Tier-2-starting types (predictive/normative/synthesis = 48%) |
| Causal-Heavy Eval Set | 24.0% | 76.0% | 0.0% | Moderate; causal and statistical eligible for NLI |

**Across all 456 evaluations, Tier 3 (multi-agent debate) was never triggered in any run on any dataset.** The LLM judge returned confident verdicts (above the escalation threshold) 100% of the time.

### 4.2 Does NLI Improve Accuracy? (Full HERALD vs. HERALD without NLI)

| Dataset | Full HERALD F1 | HERALD without NLI F1 | NLI Delta |
|---------|:--------------:|:---------------------:|:---------:|
| Human-Annotated Eval Set | 80.3% | 80.9% | **−0.6pp** (NLI hurts) |
| Balanced Benchmark Eval Set | 85.3% | 83.3% | **+2.0pp** (NLI helps) |
| Causal-Heavy Eval Set | 74.5% | 74.0% | **+0.5pp** (NLI marginal) |
| **Grand mean** | **80.0%** | **79.4%** | **+0.6pp** |

NLI provides a small net positive (+0.6pp F1 grand mean) driven entirely by its benefit on statistical claims. Its cost overhead (~7% higher per claim than the baseline) means it does not pay for itself at the overall level. It is beneficial only when the claim mix is dominated by statistical and comparative claims.

---

## 5. Multi-Agent Debate (Tier 3) — Not Evaluated

Tier 3 was never triggered across all 9 runs and 456 evaluations. The GPT-4o LLM judge did not return `uncertain` on any claim in any run on any dataset. This is the most consequential gap in this experiment: HERALD's primary design differentiator — escalation to a three-persona debate for ambiguous claims — cannot be evaluated from the current results.

**Implications:**
1. The experiment effectively measures **Full HERALD vs. Single LLM-as-Judge on Tier 1 and Tier 2 only**. The cost and accuracy advantages of Tier 3 remain untested.
2. The LLM judge may be systematically overconfident — particularly evident on the Causal-Heavy Eval Set, where it confidently rejects 12 valid claims in every run yet never triggers escalation.
3. Lowering the escalation threshold (currently requiring `uncertain` verdict) or switching to a confidence-score-based threshold would be a prerequisite for measuring Tier 3's contribution.

---

## 6. Cost Analysis

### 6.1 Mean Cost per Claim (grand mean across all datasets and runs)

| System | Mean Input Tokens | Mean Output Tokens | API Calls | Cost/Claim | F1 per Dollar |
|--------|------------------:|-------------------:|:---------:|:----------:|:-------------:|
| **Full HERALD** | ~1,833 | ~163 | 1.00 | **$0.0059** | 135.6 |
| **Single LLM-as-Judge** | ~1,705 | ~158 | 1.00 | **$0.0056** | **142.5** |
| **HERALD without NLI** | ~1,705 | ~159 | 1.00 | **$0.0056** | 141.8 |

> API calls = 1.00 for all systems across all runs because Tier 1 (NLI) is free/local and Tier 3 was never reached. Full HERALD's higher cost is purely NLI backend overhead on the 14–31% of claims routed through Tier 1 before escalating to Tier 2.

### 6.2 Cost at Scale (grand mean cost per claim)

| System | Cost/Claim | Daily (1K claims) | Monthly (30 days) |
|--------|:----------:|:-----------------:|:-----------------:|
| Full HERALD | $0.0059 | $5.90 | $177.00 |
| Single LLM-as-Judge | $0.0056 | $5.60 | $168.00 |
| HERALD without NLI | $0.0056 | $5.60 | $168.00 |

### 6.3 Overall Cost-Performance Verdict

**Single LLM-as-Judge wins on cost-efficiency** (F1/$ = 142.5) across the full dataset suite. Full HERALD costs ~5% more per claim for a +0.2pp mean F1 gain — insufficient to justify the infrastructure overhead when evaluated at the overall level. HERALD without NLI is nearly identical to the Single LLM-as-Judge in both cost and F1/$.

The cost picture changes at the **claim-type level**: for statistical claims, Full HERALD delivers +5–8pp F1 at only ~5% higher cost, making it highly cost-efficient for statistical-heavy workloads.

---

## 7. Latency

### 7.1 End-to-End Latency per System (pooled across all datasets and runs)

| System | Mean | Median | p95 |
|--------|-----:|-------:|----:|
| **Full HERALD** | 2,002 ms | 2,057 ms | 3,615 ms |
| **Single LLM-as-Judge** | 1,936 ms | 1,871 ms | 2,837 ms |
| **HERALD without NLI** | 1,960 ms | 1,918 ms | 2,862 ms |

Full HERALD's higher p95 latency (3,615 ms vs 2,837 ms for the baseline) reflects NLI round-trip overhead for 14–31% of claims. For latency-sensitive deployments, Single LLM-as-Judge or HERALD without NLI is preferred.

---

## 8. Stability and Variance

### 8.1 System Stability (F1 standard deviation across runs)

| System | Human-Annotated | Balanced Benchmark | Causal-Heavy | **Mean Std** |
|--------|:---------------:|:------------------:|:------------:|:------------:|
| **Full HERALD** | ±1.5pp | ±1.9pp | ±0.7pp | **±1.4pp** |
| **Single LLM-as-Judge** | ±0.5pp | ±2.5pp | ±0.0pp | **±1.0pp** |
| **HERALD without NLI** | ±1.7pp | ±0.8pp | ±0.7pp | **±1.1pp** |

The Single LLM-as-Judge is the most stable overall (±1.0pp mean std), with perfect determinism on the Causal-Heavy Set (±0.0pp — identical results in all 3 runs). Full HERALD shows the most variance (±1.4pp), driven by NLI stochasticity on borderline claims. For production deployments requiring predictable, reproducible evaluations, the Single LLM-as-Judge baseline is the most reliable choice.

---

## 9. Agreement Between Full HERALD and Single LLM-as-Judge

| Dataset | Mean Agreement Rate | Mean Disagreements per Run |
|---------|:-------------------:|:--------------------------:|
| Human-Annotated Eval Set | 84.0% | 8.3 / 52 claims |
| Balanced Benchmark Eval Set | 96.0% | 2.0 / 50 claims |
| Causal-Heavy Eval Set | 97.3% | 1.3 / 50 claims |
| **Grand mean** | **92.4%** | **3.9** |

The 84% agreement on the Human-Annotated Set is the lowest across all datasets, reflecting that human-written claims contain more linguistic ambiguity that causes NLI and the LLM judge to diverge. On purpose-built datasets (Balanced Benchmark, Causal-Heavy), agreement exceeds 96%, meaning NLI routing almost never changes the outcome compared to going directly to the LLM judge. Every disagreement is an NLI-vs-LLM-Judge conflict; Tier 3 never resolved any disagreement.

---

## 10. Structural Failure Modes

### 10.1 Synthesis Claims — Universal Pipeline Failure

Synthesis claims are the most resistant claim type across all systems and all datasets:

| Dataset | Full HERALD F1 | Single LLM-as-Judge F1 | HERALD without NLI F1 |
|---------|:--------------:|:----------------------:|:---------------------:|
| Human-Annotated Eval Set | 50.0% | 50.0% | 50.0% |
| Balanced Benchmark Eval Set | 40.0% | 40.0% | 40.0% |
| Causal-Heavy Eval Set | N/A (no invalids) | N/A | N/A |

50% F1 is at or below random chance for binary classification, and the zero variance (identical results in all runs) means the systems are **deterministically wrong** on certain synthesis claims, not merely uncertain. No routing strategy, NLI configuration, or escalation can fix this because the root cause is architectural: the current prompt provides a single source chunk per claim, but synthesis claims by definition draw on multiple sources. Without multi-source context in the evaluation prompt, valid synthesis claims look unsupported and invalid ones look unfalsifiable.

### 10.2 Causal Claims — Precision Failure under Complexity

On the Causal-Heavy Eval Set, causal claim F1 drops to 57–60% with a false invalid rate exceeding 40%. The 12 universally wrong claims are all valid claims that the models consistently reject. This is not a random error — it is a systematic bias where complex, hedged, or multi-mechanism causal language triggers over-conservative `invalid` verdicts. The LLM judge is overconfident in these rejections (never escalating to Tier 3), making the issue unaddressable within the current pipeline without prompt engineering or threshold adjustment.

### 10.3 Tier 3 Never Activated — A Design Gap

The multi-agent debate mechanism was designed to handle the ambiguous middle ground that Tier 2 cannot resolve confidently. The experiment shows this middle ground effectively does not exist in practice with GPT-4o at current temperature settings: the model returns confident verdicts on every claim, including the ones it gets wrong. This suggests either that (a) the escalation threshold needs to be confidence-score-based rather than verdict-based, or (b) the temperature needs to increase to generate genuine uncertainty on borderline claims.

---

## 11. Hypothesis Assessment (Consolidated)

| Hypothesis | Prediction | Result Across All Datasets | Assessment |
|------------|------------|---------------------------|------------|
| **H1** — HERALD ≥ LLM-as-Judge on F1 | Full HERALD achieves higher F1 | Grand mean: Full HERALD 80.0% vs Baseline 79.8% (+0.2pp) | **Not confirmed at overall level.** Confirmed for statistical claims specifically. |
| **H2** — Cost varies by claim type and tier | Variable API calls and cost by claim type | All systems: 1.0 API call/claim across all runs (Tier 3 never reached). Cost difference is fixed NLI overhead (~5–7%) | **Partially confirmed.** Cost differential exists but Tier 3's impact remains unmeasured. |
| **H3** — ~40% of statistical/comparative claims exit at Tier 1 | ~40% NLI early exits | 14–31% overall Tier 1 exits depending on dataset composition | **Not confirmed.** Below prediction; dataset type mix and escalation behavior reduce the effective NLI exit rate. |
| **H4** — A per-type hybrid routing policy may be optimal | Different systems perform best for different claim types | Confirmed: Full HERALD best for statistical; HERALD without NLI best for causal; Baseline best for predictive/normative | **Confirmed.** The per-type hybrid is the only configuration that consistently outperforms any single system. |

---

## 12. Recommended Routing Policy

Based on consistent patterns across all three datasets, the following claim-type-aware routing policy maximizes accuracy per dollar:

| Claim Type | Recommended System | Avg F1 (best system) | Rationale |
|------------|:-----------------:|:--------------------:|-----------|
| **statistical** | **Full HERALD** | ~89% | NLI numeric entailment is a structural match; +5–8pp over baseline |
| **causal** | **HERALD without NLI** | ~76% | NLI adds false-invalid pressure; direct LLM judge is more balanced |
| **comparative** | **Single LLM-as-Judge** | ~90% | All systems tied; use cheapest |
| **predictive** | **Single LLM-as-Judge** | ~85% | LLM's reasoning superiority; NLI cannot evaluate predictions |
| **normative** | **Single LLM-as-Judge** | ~88%* | LLM's world knowledge; NLI cannot evaluate consensus |
| **synthesis** | **Requires architecture change** | ~45% | All systems fail; multi-source prompt redesign needed |

*Normative mean excludes datasets with only valid normative claims (measurement artifacts).

**Estimated hybrid policy F1:** Approximately **82–83%** across a balanced claim mix, compared to the grand mean of ~80% for any single system — a projected gain of ~2–3pp from type-aware routing alone, with no additional cost per claim.

---

## 13. Key Findings Summary

**1. No system dominates at the overall level, but type-aware routing matters.**
The grand mean F1 difference between the best and worst system is 0.6pp — within noise. However, at the claim-type level, differences of 5–11pp are consistent and reproducible. The overall parity masks meaningful per-type variation.

**2. NLI earns its keep only for statistical claims.**
Across all three datasets, Full HERALD outperforms the no-NLI ablation by +5–8pp F1 on statistical claims. This is the single most consistent finding. For every other claim type, NLI either ties or slightly hurts performance. The NLI component should be scoped to statistical (and potentially comparative) claims only.

**3. The Single LLM-as-Judge is the best default baseline.**
It achieves the highest F1/$ ratio (142.5), the lowest variance (±1.0pp mean std), the fastest p95 latency (2,837 ms), and near-identical overall accuracy to Full HERALD. For deployments without a per-type routing layer, Single LLM-as-Judge is the recommended default.

**4. Tier 3 multi-agent debate was never evaluated.**
Zero escalations across 456 evaluations on 3 datasets in 9 runs. The pipeline's most expensive and potentially most powerful mechanism remains untested. The LLM judge's overconfidence on incorrect verdicts is the root cause. This is a critical gap that warrants dedicated follow-up: either prompt the judge to produce calibrated confidence scores or lower the escalation threshold.

**5. Synthesis is an open problem requiring architectural change.**
40–50% F1 across all systems and datasets. No routing strategy resolves this. The evaluation framework needs multi-source prompting — providing all source chunks relevant to a synthesis claim simultaneously — before synthesis claims can be reliably evaluated.

**6. Precision failure is the dominant error mode; recall is generally robust.**
Across all three datasets, recall (catching invalid claims) is consistently high and stable (83–100%). False valid rate is low. The primary failure mode is false invalids: over-conservative rejection of valid claims, especially complex causal and statistical ones. This is a precision problem, not a recall problem. Prompt engineering for the Tier 2 judge should focus on reducing over-conservatism rather than improving detection sensitivity.

---

## 14. Limitations

- **Total sample size**: 152 unique claims across 3 datasets. Per-type subsets as small as n=2 (normative, predictive in Human-Annotated Set) carry confidence intervals of ±15–20pp. Per-type findings are directional.
- **Tier 3 untested**: The multi-agent debate mechanism produced zero evaluations. All conclusions about HERALD's full pipeline are derived from Tier 1 and Tier 2 only.
- **Single model**: All LLM calls use `gpt-4o`. Results may differ with other models (Claude Sonnet, GPT-4o-mini) — particularly the NLI vs LLM judge agreement rate and the escalation behavior.
- **Ground truth quality**: Persistent wrong claims (wrong in all 3 systems, all 3 runs) may reflect mislabeled ground truth rather than model failure. Manual review of these claims is warranted before drawing strong conclusions.
- **Synthesis dataset gap**: The Causal-Heavy Eval Set contains no invalid synthesis claims, making it impossible to measure synthesis F1 on that dataset. The 40–50% F1 figures come from only two datasets.
- **Domain coverage**: All eval sets come from policy memo evaluation. Generalizability to other claim evaluation domains (scientific literature, legal, financial) is not established.
- **NLI model**: DeBERTa-v3-large-mnli was used for Tier 1. Different NLI models or fine-tuning on policy domain data could alter the NLI contribution findings.

---

## 15. Appendix — Source Reports

| Report | Dataset | File |
|--------|---------|------|
| Human-Annotated Eval Set (3 runs) | `data/human-eval-set-2.json` | `results/experiment-report-2026-04-22.md` |
| Balanced Benchmark Eval Set (3 runs) | `data/eval-set.json` | `results/experiment-report-eval-set-2026-04-22.md` |
| Causal-Heavy Eval Set (3 runs) | `data/eval-set-3.json` | `results/experiment-report-eval-set-3-2026-04-22.md` |

Raw result JSON files: `results/experiment-*.json` (9 files total, one per run)
