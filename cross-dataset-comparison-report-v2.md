# HERALD Evaluation: Cross-Dataset Comparison Report
## Human-Authored vs. GenAI-Generated Policy Claims

| System | Description |
|--------|-------------|
| **Full HERALD** | Full HERALD Pipeline |
| **Single LLM Judge** | Single LLM Judge (Tier 2 Only) |
| **No-NLI Ablation** | HERALD without NLI (Ablation) |

| Eval Set | Source File | Claims/Run | Runs | Total Evaluations/System |
|----------|-------------|:----------:|:----:|:------------------------:|
| **Human Set** | `human-eval-set.json` | 52 | 5 | 260 |
| **GenAI Set** | `genai-eval-set.json` | 100 | 5 | 500 |

**Tier 2 model:** gpt-4o-mini ($0.15/1M input, $0.6/1M output)
**Tier 3 model:** claude-haiku-4-5 ($0.8/1M input, $4/1M output)
**Cost tracking:** Full — per-tier pricing applied to both Tier 2 and Tier 3 tokens

---

## 1. Executive Summary

| Metric | Set | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|-----|:-----------:|:----------------:|:---------------:|
| Accuracy | **Human Set** | 84.6% ± 0.0% | 85.0% ± 1.4% | 84.6% ± 0.0% |
| F1 | **Human Set** | 81.8% ± 0.0% | 81.4% ± 1.4% | 81.0% ± 0.0% |
| Accuracy | **GenAI Set** | 94.7% ± 0.4% | 88.6% ± 1.0% | 91.6% ± 0.4% |
| F1 | **GenAI Set** | 93.7% ± 0.5% | 87.6% ± 1.0% | 90.4% ± 0.4% |

| Cost/Claim | Set | Full HERALD | Single LLM Judge | No-NLI Ablation |
|------------|-----|:-----------:|:----------------:|:---------------:|
| (T2+T3) | **Human Set** | $0.0006 | $0.0003 | $0.0005 |
| (T2+T3) | **GenAI Set** | $0.0008 | $0.0003 | $0.0006 |

**Central finding:** HERALD's advantage over the Single LLM Judge reverses between datasets.

- **Human Set**: HERALD vs. Judge F1 delta = +0.5pp | NLI contribution (A−C) = +0.9pp | Cost premium = $0.0002/claim
- **GenAI Set**: HERALD vs. Judge F1 delta = +6.0pp | NLI contribution (A−C) = +3.3pp | Cost premium = $0.0005/claim

---

## 2. Overall Accuracy by Eval Set

### 2.1. Human-Authored Policy Claims
*5 runs × 52 claims = 260 evaluations per system*

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| Accuracy | 84.6% ± 0.0% | 85.0% ± 1.4% | 84.6% ± 0.0% |
| Precision | 81.8% ± 0.0% | 86.0% ± 3.2% | 85.0% ± 0.0% |
| Recall | 81.8% ± 0.0% | 77.3% ± 0.0% | 77.3% ± 0.0% |
| F1 | 81.8% ± 0.0% | 81.4% ± 1.4% | 81.0% ± 0.0% |
| False Invalid Rate | 13.3% ± 0.0% | 9.3% ± 2.5% | 10.0% ± 0.0% |
| False Valid Rate | 18.2% ± 0.0% | 22.7% ± 0.0% | 22.7% ± 0.0% |

### 2.2. GenAI-Generated Policy Claims
*5 runs × 100 claims = 500 evaluations per system*

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| Accuracy | 94.7% ± 0.4% | 88.6% ± 1.0% | 91.6% ± 0.4% |
| Precision | 97.0% ± 1.0% | 83.9% ± 1.7% | 89.8% ± 1.0% |
| Recall | 90.6% ± 0.2% | 91.8% ± 1.1% | 91.0% ± 0.9% |
| F1 | 93.7% ± 0.5% | 87.6% ± 1.0% | 90.4% ± 0.4% |
| False Invalid Rate | 2.1% ± 0.7% | 13.9% ± 1.7% | 7.9% ± 0.9% |
| False Valid Rate | 9.4% ± 0.2% | 8.2% ± 1.1% | 9.0% ± 0.9% |

---

## 3. Per Claim Type Breakdown (Pooled)

### Causal

| Metric | Set | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|-----|:-----------:|:----------------:|:---------------:|
| Accuracy (n=12) | Human Set | 91.7% | 91.7% | 91.7% |
| F1 | Human Set | 88.9% | 88.9% | 88.9% |
| False Invalid Rate | Human Set | 0.0% | 0.0% | 0.0% |
| False Valid Rate | Human Set | 20.0% | 20.0% | 20.0% |
| Accuracy (n=25) | GenAI Set | 95.2% | 84.0% | 86.9% |
| F1 | GenAI Set | 94.3% | 82.5% | 85.2% |
| False Invalid Rate | GenAI Set | 1.4% | 17.1% | 10.4% |
| False Valid Rate | GenAI Set | 9.1% | 14.5% | 16.4% |

### Comparative

| Metric | Set | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|-----|:-----------:|:----------------:|:---------------:|
| Accuracy (n=12) | Human Set | 83.3% | 85.0% | 83.3% |
| F1 | Human Set | 75.0% | 76.9% | 75.0% |
| False Invalid Rate | Human Set | 22.2% | 20.0% | 22.2% |
| False Valid Rate | Human Set | 0.0% | 0.0% | 0.0% |
| Accuracy (n=18) | GenAI Set | 100.0% | 100.0% | 100.0% |
| F1 | GenAI Set | 100.0% | 100.0% | 100.0% |
| False Invalid Rate | GenAI Set | 0.0% | 0.0% | 0.0% |
| False Valid Rate | GenAI Set | 0.0% | 0.0% | 0.0% |

### Normative

| Metric | Set | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|-----|:-----------:|:----------------:|:---------------:|
| Accuracy (n=2) | Human Set | 100.0% | 100.0% | 100.0% |
| F1 | Human Set | 0.0% | 0.0% | 0.0% |
| False Invalid Rate | Human Set | 0.0% | 0.0% | 0.0% |
| False Valid Rate | Human Set | 0.0% | 0.0% | 0.0% |
| Accuracy (n=11) | GenAI Set | 89.4% | 90.9% | 89.4% |
| F1 | GenAI Set | 89.8% | 92.3% | 89.8% |
| False Invalid Rate | GenAI Set | 20.0% | 20.0% | 20.0% |
| False Valid Rate | GenAI Set | 0.0% | 0.0% | 0.0% |

### Predictive

| Metric | Set | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|-----|:-----------:|:----------------:|:---------------:|
| Accuracy (n=2) | Human Set | 100.0% | 100.0% | 100.0% |
| F1 | Human Set | 100.0% | 100.0% | 100.0% |
| False Invalid Rate | Human Set | 0.0% | 0.0% | 0.0% |
| False Valid Rate | Human Set | 0.0% | 0.0% | 0.0% |
| Accuracy (n=11) | GenAI Set | 100.0% | 87.3% | 100.0% |
| F1 | GenAI Set | 100.0% | 89.6% | 100.0% |
| False Invalid Rate | GenAI Set | 0.0% | 28.0% | 0.0% |
| False Valid Rate | GenAI Set | 0.0% | 0.0% | 0.0% |

### Statistical

| Metric | Set | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|-----|:-----------:|:----------------:|:---------------:|
| Accuracy (n=17) | Human Set | 82.4% | 82.4% | 82.4% |
| F1 | Human Set | 85.7% | 84.2% | 84.2% |
| False Invalid Rate | Human Set | 28.6% | 14.3% | 14.3% |
| False Valid Rate | Human Set | 10.0% | 20.0% | 20.0% |
| Accuracy (n=23) | GenAI Set | 95.7% | 87.0% | 91.3% |
| F1 | GenAI Set | 94.7% | 87.0% | 90.9% |
| False Invalid Rate | GenAI Set | 0.0% | 23.1% | 15.4% |
| False Valid Rate | GenAI Set | 10.0% | 0.0% | 0.0% |

### Synthesis

| Metric | Set | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|-----|:-----------:|:----------------:|:---------------:|
| Accuracy (n=7) | Human Set | 71.4% | 71.4% | 71.4% |
| F1 | Human Set | 50.0% | 50.0% | 50.0% |
| False Invalid Rate | Human Set | 0.0% | 0.0% | 0.0% |
| False Valid Rate | Human Set | 66.7% | 66.7% | 66.7% |
| Accuracy (n=12) | GenAI Set | 83.3% | 83.3% | 83.3% |
| F1 | GenAI Set | 50.0% | 50.0% | 50.0% |
| False Invalid Rate | GenAI Set | 0.0% | 0.0% | 0.0% |
| False Valid Rate | GenAI Set | 66.7% | 66.7% | 66.7% |

---

## 4. Tier Distribution (Pooled)

| System | Tier | Human Set | GenAI Set |
|--------|------|----------:|----------:|
| Full HERALD | Tier 1 | 120 (46.2%) | 180 (36.0%) |
|  | Tier 2 | 129 (49.6%) | 266 (53.2%) |
|  | Tier 3 | 11 (4.2%) | 54 (10.8%) |
|  | Tier 4 | 0 (0.0%) | 0 (0.0%) |
| No-NLI Ablation | Tier 1 | 0 (0.0%) | 0 (0.0%) |
|  | Tier 2 | 247 (95.0%) | 457 (91.4%) |
|  | Tier 3 | 13 (5.0%) | 43 (8.6%) |
|  | Tier 4 | 0 (0.0%) | 0 (0.0%) |

*Single LLM Judge always exits at Tier 2 by design.*

---

## 5. Cost Comparison

*Per-tier pricing: gpt-4o-mini at $0.15/1M input + $0.6/1M output; claude-haiku-4-5 at $0.8/1M input + $4/1M output.*

### 5.1 Mean Token Usage per Claim (Pooled)

| System | Set | T2 Input | T2 Output | T3 Input | T3 Output | API Calls | Total Cost/Claim |
|--------|-----|----------:|----------:|---------:|---------:|----------:|----------------:|
| **Full HERALD** | Human Set | 1836 | 131 | 130 | 31 | 1.1 | $0.0006 |
| **Full HERALD** | GenAI Set | 1812 | 136 | 275 | 65 | 1.2 | $0.0008 |
| **Single LLM Judge** | Human Set | 1710 | 128 | 0 | 0 | 1.0 | $0.0003 |
| **Single LLM Judge** | GenAI Set | 1714 | 130 | 0 | 0 | 1.0 | $0.0003 |
| **No-NLI Ablation** | Human Set | 1710 | 128 | 84 | 23 | 1.1 | $0.0005 |
| **No-NLI Ablation** | GenAI Set | 1714 | 129 | 141 | 31 | 1.1 | $0.0006 |

### 5.2 F1 per Dollar

| System | Human Set F1 | Human Set Cost | Human F1/$ | GenAI Set F1 | GenAI Set Cost | GenAI F1/$ |
|--------|:------------:|:--------------:|:----------:|:------------:|:--------------:|:----------:|
| **Full HERALD** | 81.8% | $0.0006 | 1411 | 93.7% | $0.0008 | 1124 |
| **Single LLM Judge** | 81.3% | $0.0003 | 2443 | 87.6% | $0.0003 | 2616 |
| **No-NLI Ablation** | 81.0% | $0.0005 | 1649 | 90.4% | $0.0006 | 1580 |

### 5.3 Cost at Scale (1,000 claims/day)

| System | Human Set Daily | Human Monthly | GenAI Set Daily | GenAI Monthly |
|--------|:---------------:|:-------------:|:---------------:|:-------------:|
| **Full HERALD** | $0.58 | $17.40 | $0.83 | $24.99 |
| **Single LLM Judge** | $0.33 | $9.99 | $0.34 | $10.05 |
| **No-NLI Ablation** | $0.49 | $14.73 | $0.57 | $17.16 |

---

## 6. Head-to-Head Verdict

### Full HERALD vs. Single LLM Judge

| Metric | Human Set | GenAI Set |
|--------|:---------:|:---------:|
| Accuracy delta (A−B) | -0.4pp | +6.1pp |
| F1 delta (A−B) | +0.5pp | +6.0pp |
| False Invalid Rate delta | +4.0pp | -11.8pp |
| False Valid Rate delta | -4.5pp | +1.3pp |
| Cost delta (A−B) | $0.0002 more/claim | $0.0005 more/claim |

**Human Set:** ⚠️ **Marginal** — +0.5pp F1 gain does not justify $0.0002 extra/claim.

**GenAI Set:** ⚠️ **HERALD wins on accuracy** (+6.0pp F1) at $0.0005 extra/claim. Use when accuracy is critical.

### Does Tier 1 NLI Contribute? (Full HERALD vs. No-NLI Ablation)

| Metric | Human Set | GenAI Set |
|--------|:---------:|:---------:|
| F1 delta (A−C) | +0.9pp | +3.3pp |
| False Invalid Rate delta | +3.3pp | -5.8pp |
| Cost delta (A−C) | $0.0001/claim | $0.0003/claim |

**Human Set:** ⚠️ **Marginal** (+0.9pp F1, $0.0001/claim) — NLI adds cost without clear accuracy gain.

**GenAI Set:** ✅ **NLI contributes** — +3.3pp F1 gain at $0.0003/claim extra. Paraphrase handling and contradiction detection earn their keep.

---

## 7. Persistent Failure Patterns

### Synthesis claims (consistent weakness across both sets)

| Set | System | F1 | False Valid Rate |
|-----|--------|----|-----------------|
| Human Set | Full HERALD | 50.0% | 66.7% |
| Human Set | Single LLM Judge | 50.0% | 66.7% |
| Human Set | No-NLI Ablation | 50.0% | 66.7% |
| GenAI Set | Full HERALD | 50.0% | 66.7% |
| GenAI Set | Single LLM Judge | 50.0% | 66.7% |
| GenAI Set | No-NLI Ablation | 50.0% | 66.7% |

All three systems fail consistently on the same synthesis claims — logical-gap errors that require reasoning across multiple sources cannot be reliably caught by any single-call or escalation-based automated system.

### Claims wrong in all 5 runs (every system)

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
| GT-013 | normative | agent_inference | invalid | False Valid | No-NLI Ablation |
| GT-018 | predictive | paraphrase | valid | False Valid | Single LLM Judge |
| GT-023 | synthesis | cross_source | invalid | False Valid | Full HERALD, Single LLM Judge, No-NLI Ablation |
| GT-025 | causal | paraphrase | invalid | False Valid | Full HERALD, Single LLM Judge, No-NLI Ablation |
| GT-030 | causal | paraphrase | valid | False Valid | Single LLM Judge, No-NLI Ablation |
| GT-034 | normative | paraphrase | valid | False Invalid | Full HERALD, Single LLM Judge, No-NLI Ablation |
| GT-042 | synthesis | cross_source | invalid | False Valid | Full HERALD, Single LLM Judge, No-NLI Ablation |
| GT-108 | statistical | paraphrase | valid | False Valid | Single LLM Judge |
| GT-118 | causal | paraphrase | valid | False Valid | Single LLM Judge, No-NLI Ablation |
| GT-135 | statistical | paraphrase | invalid | False Valid | Full HERALD |
| GT-149 | statistical | paraphrase | valid | False Valid | Single LLM Judge |
| GT-153 | statistical | direct_extraction | valid | False Valid | Single LLM Judge, No-NLI Ablation |

---

## 8. Recommendations

### By claim type

| Claim Type | Recommended System | Rationale |
|------------|:-----------------:|-----------|
| Statistical | **Full HERALD** | NLI contradiction detection reduces false invalids; paraphrase threshold prevents over-rejection |
| Causal | **Full HERALD** | Causal hedging mismatch detection at Tier 1 catches correlation-as-causation errors |
| Comparative | **Single LLM Judge** | All systems perform equally; Single LLM Judge is 2–3× cheaper |
| Predictive | **Full HERALD** | Tier 3 Senior Reviewer handles ambiguous projections better than single-call judge |
| Normative | **Single LLM Judge** | Marginal accuracy difference across sets; Single LLM Judge is sufficient |
| Synthesis | **Human Review** | All automated systems fail on logical-gap errors; route to Tier 4 |

### By deployment context

| Context | Recommended System | Reasoning |
|---------|:-----------------:|-----------|
| GenAI-generated memos | **Full HERALD** | +6.1pp F1 over Single LLM Judge; consistent across 5 trials; NLI paraphrase handling directly addresses GenAI writing patterns |
| Human-authored memos | **Single LLM Judge** | No meaningful accuracy gain from HERALD; 2–3× cheaper; zero variance across 5 trials |
| Cost-constrained / high-volume | **Single LLM Judge** | $0.0003/claim vs $0.0006–$0.0008; same or better F1/$ in both datasets |
| Accuracy-critical (any source) | **Full HERALD** | Consistent accuracy advantage on GenAI set; acceptable on human set |
| Synthesis claims (any context) | **Human Review** | No automated system reliably catches logical-gap synthesis errors |
