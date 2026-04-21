# HERALD Experiment Analysis

**Run timestamp:** 2026-04-21T21:17:06.414Z
**Git commit:** `259502c`
**Eval set:** `data/eval-set.json`
**Systems run:** A, B, C
**Total claims:** 50

## 1. Overall Results

| Metric | System A (HERALD) | System B (Tier 2 only) | System C (No NLI) |
|--------|:-----------------:|:----------------------:|:-----------------:|
| Accuracy | 86.0% | 78.0% | 80.0% |
| Precision | 82.8% | 72.7% | 75.0% |
| Recall | 92.3% | 92.3% | 92.3% |
| F1 | 87.3% | 81.4% | 82.8% |
| False Invalid Rate | 20.8% | 37.5% | 33.3% |
| False Valid Rate | 7.7% | 7.7% | 7.7% |
| Eval Errors | 0 | 0 | 0 |

### Decision: Is HERALD worth the complexity?

✅ **Yes** — F1(A) > F1(B) by 5.9% (≥ 3pp threshold met)

### Decision: Does Tier 1 NLI contribute accuracy?

✅ **Yes** — F1(A) > F1(C) by 4.5%

## 2. Per Claim Type

### causal (n=9)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 88.9% | 77.8% | 88.9% |
| F1 | 92.3% | 85.7% | 92.3% |
| False Invalid Rate | 33.3% | 66.7% | 33.3% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### comparative (n=8)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 100.0% | 100.0% | 100.0% |
| F1 | 100.0% | 100.0% | 100.0% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### normative (n=8)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 87.5% | 75.0% | 75.0% |
| F1 | 88.9% | 80.0% | 80.0% |
| False Invalid Rate | 25.0% | 50.0% | 50.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### predictive (n=8)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 75.0% | 75.0% | 75.0% |
| F1 | 80.0% | 80.0% | 80.0% |
| False Invalid Rate | 50.0% | 50.0% | 50.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### statistical (n=9)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 100.0% | 77.8% | 77.8% |
| F1 | 100.0% | 80.0% | 80.0% |
| False Invalid Rate | 0.0% | 40.0% | 40.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### synthesis (n=8)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 62.5% | 62.5% | 62.5% |
| F1 | 40.0% | 40.0% | 40.0% |
| False Invalid Rate | 20.0% | 20.0% | 20.0% |
| False Valid Rate | 66.7% | 66.7% | 66.7% |

## 3. Tier Distribution

**System A** (50 claims)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 1 | 7 | 14.0% |
| Tier 2 | 43 | 86.0% |
| Tier 3 | 0 | 0.0% |
| Tier 4 | 0 | 0.0% |

**System C** (50 claims)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 1 | 0 | 0.0% |
| Tier 2 | 50 | 100.0% |
| Tier 3 | 0 | 0.0% |
| Tier 4 | 0 | 0.0% |

## 4. Latency

| System | Mean (ms) | Median (ms) | p95 (ms) |
|--------|----------:|------------:|---------:|
| System A (HERALD) | 7507 | 4672 | 19948 |
| System B (Tier 2 only) | 6577 | 4121 | 16403 |
| System C (No NLI) | 5743 | 3323 | 14099 |

## 5. Cost Analysis

> Pricing: $0.15/1M input tokens, $0.60/1M output tokens (gpt-4o-mini)

| System | Total Input Tokens | Total Output Tokens | Total API Calls | Total Cost (USD) | Mean Cost/Claim | Mean API Calls/Claim |
|--------|-------------------:|--------------------:|----------------:|-----------------:|----------------:|---------------------:|
| System A (HERALD) | 76,675 | 6,604 | 43 | $0.0155 | $0.00031 | 0.86 |
| System B (Tier 2 only) | 84,728 | 7,722 | 50 | $0.0173 | $0.00035 | 1.00 |
| System C (No NLI) | 84,728 | 7,700 | 50 | $0.0173 | $0.00035 | 1.00 |

### Cost-Adjusted F1 (F1 / mean cost per claim)

> Higher = more quality per dollar. Only meaningful when cost > 0.

| System | F1 | Mean Cost/Claim | Cost-Adjusted F1 |
|--------|:--:|----------------:|-----------------:|
| System A (HERALD) | 87.3% | $0.00031 | 2822.7 |
| System B (Tier 2 only) | 81.4% | $0.00035 | 2346.8 |
| System C (No NLI) | 82.8% | $0.00035 | 2389.0 |

### Scale Projection — 1,000 Claims/Day

| System | Est. Daily Cost (USD) | Est. Monthly Cost (USD) |
|--------|-----------------------:|------------------------:|
| System A (HERALD) | $0.31 | $9.28 |
| System B (Tier 2 only) | $0.35 | $10.41 |
| System C (No NLI) | $0.35 | $10.40 |

## 6. Agreement: System A vs System B

Agreement rate: **88.0%** (44/50 claims)

**Disagreements (6 claims):**

| Claim ID | Type | Ground Truth | System A | System B | Winner |
|----------|------|:------------:|:--------:|:--------:|:------:|
| GT-027 | predictive | valid | invalid | valid | B ✓ |
| GT-008 | normative | valid | valid | invalid | A ✓ |
| GT-032 | predictive | valid | valid | invalid | A ✓ |
| GT-041 | statistical | valid | valid | invalid | A ✓ |
| GT-020 | statistical | valid | valid | invalid | A ✓ |
| GT-048 | causal | valid | valid | invalid | A ✓ |

## 7. Wrong Claims

### System A — 7 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-042 | synthesis | cross_source | invalid | valid | False Valid |
| GT-023 | synthesis | cross_source | invalid | valid | False Valid |
| GT-027 | predictive | paraphrase | valid | invalid | False Invalid |
| GT-034 | normative | paraphrase | valid | invalid | False Invalid |
| GT-030 | causal | paraphrase | valid | invalid | False Invalid |
| GT-018 | predictive | paraphrase | valid | invalid | False Invalid |
| GT-036 | synthesis | agent_inference | valid | invalid | False Invalid |

### System B — 11 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-042 | synthesis | cross_source | invalid | valid | False Valid |
| GT-023 | synthesis | cross_source | invalid | valid | False Valid |
| GT-034 | normative | paraphrase | valid | invalid | False Invalid |
| GT-030 | causal | paraphrase | valid | invalid | False Invalid |
| GT-018 | predictive | paraphrase | valid | invalid | False Invalid |
| GT-036 | synthesis | agent_inference | valid | invalid | False Invalid |
| GT-008 | normative | paraphrase | valid | invalid | False Invalid |
| GT-032 | predictive | direct_extraction | valid | invalid | False Invalid |
| GT-041 | statistical | direct_extraction | valid | invalid | False Invalid |
| GT-020 | statistical | direct_extraction | valid | invalid | False Invalid |
| GT-048 | causal | paraphrase | valid | invalid | False Invalid |

### System C — 10 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-042 | synthesis | cross_source | invalid | valid | False Valid |
| GT-023 | synthesis | cross_source | invalid | valid | False Valid |
| GT-034 | normative | paraphrase | valid | invalid | False Invalid |
| GT-030 | causal | paraphrase | valid | invalid | False Invalid |
| GT-018 | predictive | paraphrase | valid | invalid | False Invalid |
| GT-036 | synthesis | agent_inference | valid | invalid | False Invalid |
| GT-008 | normative | paraphrase | valid | invalid | False Invalid |
| GT-032 | predictive | direct_extraction | valid | invalid | False Invalid |
| GT-041 | statistical | direct_extraction | valid | invalid | False Invalid |
| GT-020 | statistical | direct_extraction | valid | invalid | False Invalid |
