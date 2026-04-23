# HERALD Evaluation: Cross-Dataset Comparison Report

Comparing three claim-evaluation systems across two independent eval sets:

| System | Description |
|--------|-------------|
| **Full HERALD** | Full HERALD Pipeline |
| **Single LLM Judge** | Single LLM Judge (Tier 2 Only) |
| **No-NLI Ablation** | HERALD without NLI (Ablation) |

| Eval Set | Source | Claims/Run | Runs |
|----------|--------|:----------:|:----:|
| **Human Set** | `human-eval-set-2.json` | 52 | 5 |
| **GenAI Set** | `genai-eval-set.json` | 100 | 5 |

**Tier 2 model:** gpt-4o-mini · **Tier 3 model:** claude-haiku-4-5 (usage not tracked)

---

## 1. Executive Summary

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| **Human Set — Accuracy** | 83.1% ± 0.8% | 84.6% ± 0.0% | 84.2% ± 0.8% |
| **Human Set — F1** | 79.6% ± 1.1% | 81.0% ± 0.0% | 80.6% ± 0.8% |
| **GenAI Set — Accuracy** | 94.7% ± 0.4% | 89.8% ± 0.4% | 91.7% ± 1.0% |
| **GenAI Set — F1** | 93.6% ± 0.4% | 88.8% ± 0.5% | 90.6% ± 1.1% |

**Key finding:** HERALD's advantage over the Single LLM Judge reverses between datasets.

- **Human Set**: HERALD vs. Single LLM Judge F1 delta = -1.3pp; NLI contribution (A vs C) = -0.9pp
- **GenAI Set**: HERALD vs. Single LLM Judge F1 delta = +4.8pp; NLI contribution (A vs C) = +3.1pp

---

## 2. Overall Accuracy by Eval Set

### 2.1. Human-Authored Policy Claims
*5 runs × 52 claims = 260 evaluations per system*

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| Accuracy | 83.1% ± 0.8% | 84.6% ± 0.0% | 84.2% ± 0.8% |
| Precision | 81.1% ± 0.3% | 85.0% ± 0.0% | 84.2% ± 1.6% |
| Recall | 78.2% ± 1.8% | 77.3% ± 0.0% | 77.3% ± 0.0% |
| F1 | 79.6% ± 1.1% | 81.0% ± 0.0% | 80.6% ± 0.8% |
| False Invalid Rate | 13.3% ± 0.0% | 10.0% ± 0.0% | 10.7% ± 1.3% |
| False Valid Rate | 21.8% ± 1.8% | 22.7% ± 0.0% | 22.7% ± 0.0% |
| Eval Errors | 0 | 0 | 0 |

### 2.2. GenAI-Generated Policy Claims
*5 runs × 100 claims = 500 evaluations per system*

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| Accuracy | 94.7% ± 0.4% | 89.8% ± 0.4% | 91.7% ± 1.0% |
| Precision | 97.0% ± 0.9% | 86.0% ± 0.8% | 89.6% ± 1.6% |
| Recall | 90.5% ± 0.2% | 91.8% ± 1.1% | 91.6% ± 1.1% |
| F1 | 93.6% ± 0.4% | 88.8% ± 0.5% | 90.6% ± 1.1% |
| False Invalid Rate | 2.1% ± 0.7% | 11.8% ± 0.9% | 8.3% ± 1.4% |
| False Valid Rate | 9.5% ± 0.2% | 8.2% ± 1.1% | 8.4% ± 1.1% |
| Eval Errors | 10 | 0 | 8 |

---

## 3. Per Claim Type Breakdown

### Causal

| Metric | Set | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|-----|:-----------:|:----------------:|:---------------:|
| Accuracy | Human Set (n=12) | 91.7% | 91.7% | 91.7% |
| F1 |  | 88.9% | 88.9% | 88.9% |
| False Invalid Rate |  | 0.0% | 0.0% | 0.0% |
| False Valid Rate |  | 20.0% | 20.0% | 20.0% |
| Accuracy | GenAI Set (n=25) | 95.2% | 85.6% | 86.1% |
| F1 |  | 94.3% | 83.9% | 84.7% |
| False Invalid Rate |  | 1.4% | 14.3% | 13.4% |
| False Valid Rate |  | 9.1% | 14.5% | 14.5% |

### Comparative

| Metric | Set | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|-----|:-----------:|:----------------:|:---------------:|
| Accuracy | Human Set (n=12) | 83.3% | 83.3% | 81.7% |
| F1 |  | 75.0% | 75.0% | 73.2% |
| False Invalid Rate |  | 22.2% | 22.2% | 24.4% |
| False Valid Rate |  | 0.0% | 0.0% | 0.0% |
| Accuracy | GenAI Set (n=18) | 100.0% | 100.0% | 100.0% |
| F1 |  | 100.0% | 100.0% | 100.0% |
| False Invalid Rate |  | 0.0% | 0.0% | 0.0% |
| False Valid Rate |  | 0.0% | 0.0% | 0.0% |

### Normative

| Metric | Set | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|-----|:-----------:|:----------------:|:---------------:|
| Accuracy | Human Set (n=2) | 100.0% | 100.0% | 100.0% |
| F1 |  | 0.0% | 0.0% | 0.0% |
| False Invalid Rate |  | 0.0% | 0.0% | 0.0% |
| False Valid Rate |  | 0.0% | 0.0% | 0.0% |
| Accuracy | GenAI Set (n=11) | 89.1% | 90.9% | 90.0% |
| F1 |  | 89.4% | 92.3% | 90.9% |
| False Invalid Rate |  | 20.0% | 20.0% | 20.0% |
| False Valid Rate |  | 0.0% | 0.0% | 0.0% |

### Predictive

| Metric | Set | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|-----|:-----------:|:----------------:|:---------------:|
| Accuracy | Human Set (n=2) | 100.0% | 100.0% | 100.0% |
| F1 |  | 100.0% | 100.0% | 100.0% |
| False Invalid Rate |  | 0.0% | 0.0% | 0.0% |
| False Valid Rate |  | 0.0% | 0.0% | 0.0% |
| Accuracy | GenAI Set (n=11) | 100.0% | 90.9% | 98.2% |
| F1 |  | 100.0% | 92.3% | 98.4% |
| False Invalid Rate |  | 0.0% | 20.0% | 4.0% |
| False Valid Rate |  | 0.0% | 0.0% | 0.0% |

### Statistical

| Metric | Set | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|-----|:-----------:|:----------------:|:---------------:|
| Accuracy | Human Set (n=17) | 77.6% | 82.4% | 82.4% |
| F1 |  | 81.2% | 84.2% | 84.2% |
| False Invalid Rate |  | 28.6% | 14.3% | 14.3% |
| False Valid Rate |  | 18.0% | 20.0% | 20.0% |
| Accuracy | GenAI Set (n=23) | 95.7% | 88.7% | 93.0% |
| F1 |  | 94.7% | 88.5% | 92.6% |
| False Invalid Rate |  | 0.0% | 20.0% | 12.3% |
| False Valid Rate |  | 10.0% | 0.0% | 0.0% |

### Synthesis

| Metric | Set | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|-----|:-----------:|:----------------:|:---------------:|
| Accuracy | Human Set (n=7) | 71.4% | 71.4% | 71.4% |
| F1 |  | 50.0% | 50.0% | 50.0% |
| False Invalid Rate |  | 0.0% | 0.0% | 0.0% |
| False Valid Rate |  | 66.7% | 66.7% | 66.7% |
| Accuracy | GenAI Set (n=12) | 83.3% | 83.3% | 83.3% |
| F1 |  | 50.0% | 50.0% | 50.0% |
| False Invalid Rate |  | 0.0% | 0.0% | 0.0% |
| False Valid Rate |  | 66.7% | 66.7% | 66.7% |

---

## 4. Tier Distribution

| System | Tier | Human Set | GenAI Set |
|--------|------|----------:|----------:|
| Full HERALD | Tier 1 | 120 (46.2%) | 180 (36.0%) |
|  | Tier 2 | 131 (50.4%) | 270 (54.0%) |
|  | Tier 3 | 9 (3.5%) | 50 (10.0%) |
|  | Tier 4 | 0 (0.0%) | 0 (0.0%) |
| No-NLI Ablation | Tier 1 | 0 (0.0%) | 0 (0.0%) |
|  | Tier 2 | 247 (95.0%) | 455 (91.0%) |
|  | Tier 3 | 13 (5.0%) | 45 (9.0%) |
|  | Tier 4 | 0 (0.0%) | 0 (0.0%) |

*Single LLM Judge always exits at Tier 2 by design — not shown.*

---

## 5. Cost Comparison (Tier 2 Tokens Only)

*Pricing: gpt-4o-mini at $0.15/1M input, $0.60/1M output. Tier 3 (claude-haiku-4-5) costs not tracked.*

| System | Human Set Cost/Claim | GenAI Set Cost/Claim |
|--------|:--------------------:|:--------------------:|
| **Full HERALD** | $0.354m | $0.353m |
| **Single LLM Judge** | $0.333m | $0.335m |
| **No-NLI Ablation** | $0.333m | $0.335m |

### F1 per Dollar

| System | Human Set F1/$ | GenAI Set F1/$ |
|--------|:--------------:|:--------------:|
| **Full HERALD** | 2249 | 2652 |
| **Single LLM Judge** | 2431 | 2650 |
| **No-NLI Ablation** | 2419 | 2704 |

---

## 6. Head-to-Head Verdict

### Full HERALD vs. Single LLM Judge

| | Human Set | GenAI Set |
|---|:---------:|:---------:|
| Accuracy delta (HERALD − Judge) | -1.5pp | +4.9pp |
| F1 delta (HERALD − Judge) | -1.3pp | +4.8pp |
| False Invalid Rate delta (HERALD − Judge) | +3.3pp | -9.6pp |
| False Valid Rate delta (HERALD − Judge) | -0.9pp | +1.3pp |

**Human Set:** ❌ **Single LLM Judge wins** — HERALD gains no F1 (-1.3pp) while costing more.

**GenAI Set:** ✅ **HERALD wins on both axes** — ++4.8pp F1 at better F1/$.

### Does Tier 1 NLI Contribute? (Full HERALD vs. No-NLI Ablation)

| | Human Set | GenAI Set |
|---|:---------:|:---------:|
| F1 delta (A − C) | -0.9pp | +3.1pp |
| False Invalid Rate delta | +2.7pp | -6.2pp |

**Human Set:** ⚠️ **Marginal** (-0.9pp) — NLI adds cost without accuracy gain on this set.

**GenAI Set:** ✅ **NLI contributes** (+3.1pp) — sliding-window and paraphrase threshold reduce false invalids that the LLM judge misses.

---

## 7. Persistent Failure Patterns

### Claims wrong across all 5 runs in both systems (all three systems)

#### Human Set

| Claim | Type | Derivation | GT | Error Type | Systems |
|-------|------|------------|:--:|:----------:|---------|
| GT-053 | statistical | paraphrase | valid | False Invalid | Full HERALD |
| GT-057 | synthesis | cross_source | invalid | False Valid | Full HERALD, Single LLM Judge, No-NLI Ablation |
| GT-059 | statistical | paraphrase | valid | False Invalid | Full HERALD, Single LLM Judge, No-NLI Ablation |
| GT-062 | causal | direct_extraction | invalid | False Valid | Full HERALD, Single LLM Judge, No-NLI Ablation |
| GT-065 | statistical | direct_extraction | invalid | False Valid | Full HERALD, Single LLM Judge, No-NLI Ablation |
| GT-079 | synthesis | cross_source | invalid | False Valid | Full HERALD, Single LLM Judge, No-NLI Ablation |
| GT-096 | comparative | direct_extraction | valid | False Invalid | Full HERALD |
| GT-100 | statistical | paraphrase | invalid | False Valid | Single LLM Judge, No-NLI Ablation |
| GT-103 | comparative | direct_extraction | valid | False Invalid | Full HERALD, Single LLM Judge, No-NLI Ablation |

#### GenAI Set

| Claim | Type | Derivation | GT | Error Type | Systems |
|-------|------|------------|:--:|:----------:|---------|
| GT-013 | normative | agent_inference | invalid | False Valid | Full HERALD, No-NLI Ablation |
| GT-018 | predictive | paraphrase | valid | False Valid | Single LLM Judge |
| GT-023 | synthesis | cross_source | invalid | False Valid | Full HERALD, Single LLM Judge, No-NLI Ablation |
| GT-025 | causal | paraphrase | invalid | False Valid | Full HERALD, Single LLM Judge, No-NLI Ablation |
| GT-030 | causal | paraphrase | valid | False Valid | Single LLM Judge, No-NLI Ablation |
| GT-034 | normative | paraphrase | valid | False Invalid | Full HERALD, Single LLM Judge, No-NLI Ablation |
| GT-042 | synthesis | cross_source | invalid | False Valid | Full HERALD, Single LLM Judge, No-NLI Ablation |
| GT-118 | causal | paraphrase | valid | False Valid | Single LLM Judge, No-NLI Ablation |
| GT-135 | statistical | paraphrase | invalid | False Valid | Full HERALD |
| GT-149 | statistical | paraphrase | valid | False Valid | Single LLM Judge, No-NLI Ablation |
| GT-153 | statistical | direct_extraction | valid | False Valid | Single LLM Judge |

### Synthesis Claims (consistent weakness across both sets)

| Set | System | F1 | False Valid Rate |
|-----|--------|----|-----------------|
| Human Set | Full HERALD | 50.0% | 66.7% |
| Human Set | Single LLM Judge | 50.0% | 66.7% |
| Human Set | No-NLI Ablation | 50.0% | 66.7% |
| GenAI Set | Full HERALD | 50.0% | 66.7% |
| GenAI Set | Single LLM Judge | 50.0% | 66.7% |
| GenAI Set | No-NLI Ablation | 50.0% | 66.7% |

All three systems fail to catch the same synthesis claims — the logical gap errors are beyond what a single-source entailment check or a single LLM call can reliably detect.

---

## 8. Recommendations

### By claim type

| Claim Type | Recommended System | Rationale |
|------------|:-----------------:|-----------|
| Statistical | **Full HERALD** | NLI contradiction detection catches direct misquotes; lower false invalid rate than Single LLM Judge |
| Causal | **Full HERALD** | Causal hedging mismatch detection at Tier 1 + Tier 3 Senior Reviewer for ambiguous cases |
| Comparative | **Single LLM Judge** | All systems perform equally on comparatives; Single LLM Judge is cheaper |
| Predictive | **Full HERALD** | Tier 3 escalation handles ambiguous projections; Single LLM Judge over-rejects paraphrase predictives |
| Normative | **Single LLM Judge** | Marginal accuracy difference; Single LLM Judge is sufficient and cheaper |
| Synthesis | **Human Review** | All automated systems fail on the same logical-gap errors; escalate to Tier 4 |

### Overall deployment recommendation

- **For GenAI-generated memos** (denser, more paraphrase-heavy claims): use **Full HERALD**. The +4.8pp F1 advantage over Single LLM Judge is consistent across 5 trials and is driven by NLI's paraphrase handling and Tier 3 escalation on genuinely ambiguous claims.
- **For human-authored memos** (shorter, more direct claims): **Single LLM Judge** is sufficient and more cost-efficient. HERALD adds no accuracy gain on this distribution.
- **Synthesis claims in both sets**: route directly to human review. No automated system reliably catches logical-gap synthesis errors.
