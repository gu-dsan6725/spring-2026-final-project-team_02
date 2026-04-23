# HERALD vs. LLM-as-Judge: Experiment Report (eval-set.json)

**Dataset:** `data/eval-set.json` (50 claims, balanced across 6 claim types)
**Runs:** 3 independent trials (shuffled claim order per run)
**Result files:** `experiment-eval-set-2026-04-22.json`, `experiment-eval-set-2026-04-22.2.json`, `experiment-eval-set-2026-04-22.3.json`
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
| **Accuracy** | 83.3% ± 2.5pp | 83.3% ± 3.3pp | 80.7% ± 1.2pp |
| **Precision** | 79.3% ± 3.3pp | 79.4% ± 4.3pp | 75.8% ± 1.4pp |
| **Recall** | **92.3% ± 0.0pp** | **92.3% ± 0.0pp** | **92.3% ± 0.0pp** |
| **F1** | **85.3% ± 1.9pp** | **85.3% ± 2.5pp** | 83.3% ± 0.8pp |
| **False Invalid Rate** | 26.4% ± 5.2pp | 26.4% ± 6.7pp | 31.9% ± 2.4pp |
| **False Valid Rate** | **7.7% ± 0.0pp** | **7.7% ± 0.0pp** | **7.7% ± 0.0pp** |

**Per-run breakdown:**

| Run | System A Acc | System A F1 | System B Acc | System B F1 | System C Acc | System C F1 |
|-----|:------------:|:-----------:|:------------:|:-----------:|:------------:|:-----------:|
| Run 1 | 80.0% | 82.8% | 80.0% | 82.8% | 80.0% | 82.8% |
| Run 2 | 86.0% | 87.3% | 88.0% | 88.9% | 82.0% | 84.2% |
| Run 3 | 84.0% | 85.7% | 82.0% | 84.2% | 80.0% | 82.8% |
| **Mean** | **83.3%** | **85.3%** | **83.3%** | **85.3%** | **80.7%** | **83.3%** |
| **Std** | **±2.5pp** | **±1.9pp** | **±3.3pp** | **±2.5pp** | **±1.2pp** | **±0.8pp** |

**Key finding:** Systems A and B are statistically tied in mean accuracy (83.3%) and F1 (85.3%). System C (No NLI) trails by ~2pp F1 and is notably more stable (±0.8pp), suggesting NLI routing introduces some variance while also providing marginal accuracy gains for certain claim types. All three systems exhibit perfect recall consistency (92.3% in every run), meaning false valid rate is rock-solid — the variance is entirely driven by precision (false invalid rate).

---

## 3. Per Claim Type Breakdown (Mean across 3 Runs)

> n = number of claims of each type. All metrics averaged across 3 independent runs.

### 3.1 Accuracy by Claim Type

| Claim Type | n | System A Acc | System B Acc | System C Acc |
|------------|:-:|:------------:|:------------:|:------------:|
| statistical | 9 | **100.0%** | 92.6% | 88.9% |
| causal | 9 | 81.5% | 81.5% | 77.8% |
| comparative | 8 | **100.0%** | **100.0%** | **100.0%** |
| predictive | 8 | 79.2% | 83.3% | 79.2% |
| normative | 8 | 75.0% | 79.2% | 75.0% |
| synthesis | 8 | 62.5% | 62.5% | 62.5% |

### 3.2 F1 by Claim Type (Mean ± Std)

| Claim Type | n | System A F1 | System B F1 | System C F1 | Best System |
|------------|:-:|:-----------:|:-----------:|:-----------:|:-----------:|
| statistical | 9 | **100.0% ± 0.0pp** | 92.6% ± 5.2pp | 88.9% ± 0.0pp | **A** |
| causal | 9 | 88.2% ± 5.8pp | 87.9% ± 3.1pp | 85.7% ± 0.0pp | **A** (marginal) |
| comparative | 8 | **100.0% ± 0.0pp** | **100.0% ± 0.0pp** | **100.0% ± 0.0pp** | Tied |
| predictive | 8 | 83.0% ± 4.2pp | **85.9% ± 4.2pp** | 83.0% ± 4.2pp | **B** |
| normative | 8 | 80.0% ± 0.0pp | **83.0% ± 4.2pp** | 80.0% ± 0.0pp | **B** |
| synthesis | 8 | 40.0% ± 0.0pp | 40.0% ± 0.0pp | 40.0% ± 0.0pp | Tied (all fail) |

**Notable patterns:**
- **Statistical claims**: System A achieves perfect 100.0% F1 in all 3 runs. NLI early-exit is highly effective for statistical entailment — a direct match for NLI's strengths.
- **Comparative claims**: All three systems achieve perfect 100.0% F1 — comparative claims in this dataset are unambiguous enough for any approach to resolve correctly.
- **Causal claims**: A and B are neck-and-neck (~88% F1). C lags by ~2pp, suggesting Tier 2 routing benefits causal claim evaluation marginally.
- **Predictive claims**: System B edges out A and C by ~3pp. The direct LLM judge handles forward-looking claims without NLI interference.
- **Normative claims**: System B leads at 83.0% F1. Normative claims benefit from the LLM's broad reasoning rather than NLI entailment checks.
- **Synthesis claims**: All systems fail equally at 40.0% F1 with zero variance. This is a hard ceiling — the current pipeline architecture cannot reliably evaluate synthesis claims regardless of tier routing.

---

## 4. Tier Distribution (Pooled across 3 Runs)

**System A — Full HERALD** (150 claim evaluations across 3 runs)

| Tier | Claims | % | Notes |
|------|-------:|--:|-------|
| Tier 1 (NLI) | 21 | 14.0% | Early NLI exits for statistical/comparative/causal claims |
| Tier 2 (LLM Judge) | 129 | 86.0% | NLI escalations + direct Tier 2 entries (predictive/normative/synthesis) |
| Tier 3 (Debate) | 0 | 0.0% | Never triggered — Tier 2 always returned a confident verdict |
| Tier 4 (Human) | 0 | 0.0% | |

**System C — No NLI** (150 claim evaluations across 3 runs)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 2 (LLM Judge) | 150 | 100.0% |

**Observation:** Only 14.0% of System A's claims exited at Tier 1 (NLI), lower than the 30.8% observed on `human-eval-set-2.json`. This dataset has a higher share of predictive, normative, and synthesis claims (which skip Tier 1 by design), reducing NLI's share. Tier 3 (multi-agent debate) was never triggered — the LLM judge consistently returned confident verdicts above the escalation threshold across all 150 evaluations.

---

## 5. Cost Analysis

### 5.1 Mean Cost per Claim (averaged across 3 runs)

| System | Mean Input Tokens | Mean Output Tokens | Mean API Calls | Mean Cost/Claim |
|--------|------------------:|-------------------:|:--------------:|----------------:|
| A (HERALD) | 1,783 | 156 | 1.00 | **$0.0060** |
| B (Tier 2 only) | 1,695 | 152 | 1.00 | **$0.0058** |
| C (No NLI) | 1,695 | 156 | 1.00 | **$0.0058** |

> API call count = 1.00 for all systems because Tier 1 (NLI) is free/local and Tier 3 was never reached. System A costs slightly more per claim due to the NLI overhead on the 14% of claims routed through Tier 1 before escalating to Tier 2.

### 5.2 F1 per Dollar (Primary Decision Metric)

| System | Mean F1 | Mean Cost/Claim | F1 per Dollar | Rank |
|--------|:-------:|----------------:|:-------------:|:----:|
| A (HERALD) | 85.3% | $0.0060 | 142.2 | 3rd |
| B (Tier 2 only) | 85.3% | $0.0058 | **147.1** | 1st |
| C (No NLI) | 83.3% | $0.0058 | 143.6 | 2nd |

### 5.3 Cost at Scale

| System | Cost/Claim | Daily (1K claims) | Monthly (30 days) |
|--------|:----------:|:-----------------:|:-----------------:|
| A (HERALD) | $0.0060 | $6.00 | $180.00 |
| B (Tier 2 only) | $0.0058 | $5.80 | $174.00 |
| C (No NLI) | $0.0058 | $5.80 | $174.00 |

### 5.4 Cost-Performance Verdict

- **F1 delta (A − B):** 0.0pp *(exactly tied)*
- **Cost delta (A − B):** +$0.0002/claim *(HERALD costs ~3% more)*
- **F1/$ delta (A − B):** −4.9 *(LLM-as-Judge delivers marginally more accuracy per dollar)*

**❌ LLM-as-Judge (System B) wins on cost-efficiency** — HERALD achieves no accuracy gain over Tier 2-only while adding NLI infrastructure overhead and ~3% higher cost per claim. For this dataset, the full pipeline is not justified.

**Does NLI pull its weight (A vs C)?**
F1(A) > F1(C) by +2.0pp (85.3% vs 83.3%), driven entirely by NLI's strong performance on statistical claims (100% vs 88.9% F1). NLI provides a measurable accuracy benefit for statistical claims, but the gain does not outweigh the cost overhead at the overall level given B achieves the same result without NLI.

---

## 6. Latency (Pooled across 3 Runs)

| System | Mean | Median | p95 |
|--------|-----:|-------:|----:|
| A (HERALD) | 2,135 ms | 2,007 ms | 3,499 ms |
| B (Tier 2 only) | 1,950 ms | 1,906 ms | 2,759 ms |
| C (No NLI) | 1,991 ms | 1,976 ms | 2,803 ms |

System A's higher mean and p95 latency reflects NLI backend round-trips for the 14% of claims passing through Tier 1. System B is the fastest system overall — the direct Tier 2 path with no routing overhead.

---

## 7. Agreement: System A vs System B

| Run | Agreement Rate | Disagreements |
|-----|:--------------:|:-------------:|
| Run 1 | 96.0% (48/50) | 2 |
| Run 2 | 98.0% (49/50) | 1 |
| Run 3 | 94.0% (47/50) | 3 |
| **Mean** | **96.0%** | **2** |

System A and B agree on 96% of claims — substantially higher than the 84% agreement observed on `human-eval-set-2.json`. The near-perfect agreement confirms that on this dataset, NLI and the LLM judge almost always reach the same verdict, making HERALD's routing overhead unnecessary. The rare disagreements are NLI-vs-LLM-Judge conflicts; Tier 3 never arbitrated any of them.

---

## 8. Persistent Wrong Claims

Claims wrong in 2 or more of 3 runs indicate structural failure modes, not random variance.

### System A — 8 persistent failures

| Claim ID | Type | Derivation | Pattern |
|----------|------|------------|---------|
| GT-008 | normative | — | Wrong 3/3 |
| GT-018 | predictive | — | Wrong 3/3 |
| GT-023 | synthesis | — | Wrong 3/3 |
| GT-030 | causal | — | Wrong 3/3 |
| GT-034 | normative | — | Wrong 3/3 |
| GT-036 | synthesis | — | Wrong 3/3 |
| GT-042 | synthesis | — | Wrong 3/3 |
| GT-032 | predictive | — | Wrong 2/3 |

### System B — 8 persistent failures

| Claim ID | Type | Derivation | Pattern |
|----------|------|------------|---------|
| GT-018 | predictive | — | Wrong 3/3 |
| GT-023 | synthesis | — | Wrong 3/3 |
| GT-030 | causal | — | Wrong 3/3 |
| GT-034 | normative | — | Wrong 3/3 |
| GT-036 | synthesis | — | Wrong 3/3 |
| GT-042 | synthesis | — | Wrong 3/3 |
| GT-008 | normative | — | Wrong 2/3 |
| GT-048 | causal | — | Wrong 2/3 |

### System C — 9 persistent failures

| Claim ID | Type | Derivation | Pattern |
|----------|------|------------|---------|
| GT-008 | normative | — | Wrong 3/3 |
| GT-018 | predictive | — | Wrong 3/3 |
| GT-023 | synthesis | — | Wrong 3/3 |
| GT-030 | causal | — | Wrong 3/3 |
| GT-034 | normative | — | Wrong 3/3 |
| GT-036 | synthesis | — | Wrong 3/3 |
| GT-042 | synthesis | — | Wrong 3/3 |
| GT-048 | causal | — | Wrong 3/3 |
| GT-020 | statistical | — | Wrong 2/3 |

**Cross-system persistent failures** (wrong 3/3 in all three systems — irreducible with current prompts):

| Claim ID | Type | Implication |
|----------|------|-------------|
| GT-018 | predictive | Forward-looking claim the judge consistently misjudges |
| GT-023 | synthesis | Multi-source reasoning gap |
| GT-030 | causal | Correlation-as-causation the judge accepts |
| GT-034 | normative | Consensus assessment failure |
| GT-036 | synthesis | Multi-source reasoning gap |
| GT-042 | synthesis | Multi-source reasoning gap |

Three of the six universal failures are synthesis claims, reinforcing the finding that synthesis is the most structurally difficult claim type for the current pipeline.

---

## 9. Hypothesis Assessment

| Hypothesis | Prediction | Result | Assessment |
|------------|------------|--------|------------|
| **H1** — HERALD ≥ LLM-as-Judge on F1 | HERALD higher F1 | F1(A) = F1(B) = 85.3% | **Not confirmed** — tied, no HERALD advantage |
| **H2** — Cost varies by claim type and tier | Variable API calls depending on escalation | All systems: 1.0 API call/claim (Tier 3 never reached) | **Partially confirmed** — A costs ~3% more due to NLI overhead; Tier 3 impact unmeasurable |
| **H3** — ~40% statistical/comparative exit at Tier 1 | ~40% NLI exits for those types | 14.0% overall Tier 1 exits | **Not confirmed** — NLI exit rate lower than predicted; dataset mix (many Tier-2-starting types) reduces NLI share |
| **H4** — Per-type hybrid may be optimal | Different systems best for different types | A best for statistical (100% F1); B best for predictive/normative; Tied on comparative/synthesis | **Confirmed** — per-type optimal routing differs meaningfully |

---

## 10. Key Findings and Recommendations

### Finding 1: HERALD and LLM-as-Judge are tied overall, but differ by claim type

At 85.3% mean F1, A and B are exactly tied. However, the per-type breakdown reveals meaningful routing implications: System A dominates on statistical claims (100% F1, perfect across all 3 runs) while System B is better on predictive and normative claims. A claim-type-aware hybrid would outperform either system alone.

### Finding 2: NLI is uniquely valuable for statistical claims

System A achieves perfect F1 on statistical claims in all 3 runs, compared to 92.6% for B and 88.9% for C. This is the clearest evidence that Tier 1 NLI earns its keep — but only for statistical/numeric entailment. For all other claim types, NLI either matches or slightly underperforms the direct LLM judge.

### Finding 3: Tier 3 never fired — escalation threshold needs investigation

As with `human-eval-set-2.json`, the multi-agent debate (Tier 3) was never triggered across 150 evaluations in 3 runs. The LLM judge consistently returned confident verdicts (above the escalation threshold). This means the experiment cannot evaluate Tier 3's accuracy contribution. Two explanations are possible: (a) `gpt-4o` is overconfident on this dataset, or (b) the escalation threshold is set too high. This warrants a dedicated threshold sensitivity experiment.

### Finding 4: Synthesis claims are a hard ceiling at 40% F1

All three systems fail identically on synthesis claims — 40.0% F1 with zero variance across all 3 runs. This is below random chance for binary classification, suggesting the models are systematically wrong on synthesis claims (not just uncertain). Three of the six universal failures are synthesis type. The current single-source prompt architecture fundamentally cannot evaluate multi-source logical inferences.

### Finding 5: Recall is perfectly stable; variance comes entirely from precision

All three systems achieve 92.3% recall in every single run — zero variance. False valid rate (7.7%) is equally locked. The only source of run-to-run variance is precision (false invalid rate), driven by a handful of borderline valid claims that the models flip between runs.

### Finding 6: Recommended routing policy (per-type hybrid)

| Claim Type | Recommended System | Mean F1 | Rationale |
|------------|:-----------------:|:-------:|-----------|
| statistical | **A (Full HERALD)** | 100.0% | NLI perfectly handles numeric entailment |
| causal | **A or B** | ~88% | Tied; A marginally higher but within noise |
| comparative | **Any** | 100.0% | All systems perfect — no routing needed |
| predictive | **B (Tier 2 only)** | 85.9% | Direct LLM judge outperforms NLI-routed path |
| normative | **B (Tier 2 only)** | 83.0% | Direct LLM judge outperforms NLI-routed path |
| synthesis | **Investigate** | 40.0% | All systems fail — architecture change needed |

---

## 11. Comparison with human-eval-set-2.json Results

| Metric | eval-set.json | human-eval-set-2.json | Delta |
|--------|:-------------:|:---------------------:|:-----:|
| Mean F1 (System A) | 85.3% | 80.3% | +5.0pp |
| Mean F1 (System B) | 85.3% | 80.6% | +4.7pp |
| Mean F1 (System C) | 83.3% | 80.9% | +2.4pp |
| Tier 1 exit rate (A) | 14.0% | 30.8% | −16.8pp |
| A vs B agreement | 96.0% | 84.0% | +12.0pp |
| Synthesis F1 | 40.0% | 50.0% | −10.0pp |
| Causal F1 (A) | 88.2% | 75.6% | +12.6pp |

`eval-set.json` yields higher overall F1 (~85% vs ~81%), likely because it is a more balanced, purpose-built benchmark with cleaner ground truth labels. The lower Tier 1 exit rate reflects this dataset's higher share of Tier-2-starting claim types (predictive, normative, synthesis = 48% of claims). The near-perfect A vs B agreement (96%) vs 84% on `human-eval-set-2` confirms `eval-set.json` contains fewer ambiguous claims where NLI and the LLM judge diverge.

---

## 12. Limitations

- **Small eval set**: 50 claims total; 8–9 per type. Per-type F1 confidence intervals are approximately ±10–15pp. Results are directionally valid but should not be over-interpreted at the decimal level.
- **Tier 3 not evaluated**: Multi-agent debate never triggered in any run. HERALD's Tier 3 accuracy contribution remains unmeasured on both eval sets.
- **Synthesis claims**: 40% F1 may reflect systematic mislabeling of hard synthesis cases rather than (or in addition to) model failure. Claims wrong in all 3 systems across all 3 runs deserve manual review.
- **Balanced dataset design**: `eval-set.json` has equal claim counts per type (8–9 each), which may not reflect real-world policy memo claim distributions where statistical and causal claims dominate.
- **Single domain**: Generalizability to other policy domains is not established.
