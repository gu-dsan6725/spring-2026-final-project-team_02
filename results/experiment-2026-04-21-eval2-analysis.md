# HERALD Experiment Analysis

**Run timestamp:** 2026-04-21T21:26:19.278Z
**Git commit:** `259502c`
**Eval set:** `data/eval-set-2.json`
**Systems run:** A, B, C
**Total claims:** 53

## 1. Overall Results

| Metric | System A (HERALD) | System B (Tier 2 only) | System C (No NLI) |
|--------|:-----------------:|:----------------------:|:-----------------:|
| Accuracy | 84.9% | 81.1% | 79.2% |
| Precision | 69.2% | 64.3% | 62.1% |
| Recall | 100.0% | 100.0% | 100.0% |
| F1 | 81.8% | 78.3% | 76.6% |
| False Invalid Rate | 22.9% | 28.6% | 31.4% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |
| Eval Errors | 0 | 0 | 0 |

### Decision: Is HERALD worth the complexity?

✅ **Yes** — F1(A) > F1(B) by 3.5% (≥ 3pp threshold met)

### Decision: Does Tier 1 NLI contribute accuracy?

✅ **Yes** — F1(A) > F1(C) by 5.2%

## 2. Per Claim Type

### causal (n=14)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 78.6% | 64.3% | 57.1% |
| F1 | 72.7% | 61.5% | 57.1% |
| False Invalid Rate | 30.0% | 50.0% | 60.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### comparative (n=12)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 91.7% | 83.3% | 83.3% |
| F1 | 88.9% | 80.0% | 80.0% |
| False Invalid Rate | 12.5% | 25.0% | 25.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### normative (n=2)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 100.0% | 100.0% | 100.0% |
| F1 | 0.0% | 0.0% | 0.0% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### predictive (n=1)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 100.0% | 100.0% | 100.0% |
| F1 | 0.0% | 0.0% | 0.0% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### statistical (n=17)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 82.4% | 88.2% | 88.2% |
| F1 | 85.7% | 90.0% | 90.0% |
| False Invalid Rate | 37.5% | 25.0% | 25.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### synthesis (n=7)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 85.7% | 85.7% | 85.7% |
| F1 | 66.7% | 66.7% | 66.7% |
| False Invalid Rate | 16.7% | 16.7% | 16.7% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

## 3. Tier Distribution

**System A** (53 claims)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 1 | 17 | 32.1% |
| Tier 2 | 36 | 67.9% |
| Tier 3 | 0 | 0.0% |
| Tier 4 | 0 | 0.0% |

**System C** (53 claims)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 1 | 0 | 0.0% |
| Tier 2 | 53 | 100.0% |
| Tier 3 | 0 | 0.0% |
| Tier 4 | 0 | 0.0% |

## 4. Latency

| System | Mean (ms) | Median (ms) | p95 (ms) |
|--------|----------:|------------:|---------:|
| System A (HERALD) | 6391 | 4175 | 18125 |
| System B (Tier 2 only) | 6097 | 4791 | 13842 |
| System C (No NLI) | 6175 | 5535 | 13963 |

## 5. Cost Analysis

> Pricing: $0.15/1M input tokens, $0.60/1M output tokens (gpt-4o-mini)

| System | Total Input Tokens | Total Output Tokens | Total API Calls | Total Cost (USD) | Mean Cost/Claim | Mean API Calls/Claim |
|--------|-------------------:|--------------------:|----------------:|-----------------:|----------------:|---------------------:|
| System A (HERALD) | 64,644 | 5,111 | 36 | $0.0128 | $0.00024 | 0.68 |
| System B (Tier 2 only) | 86,933 | 7,382 | 53 | $0.0175 | $0.00033 | 1.00 |
| System C (No NLI) | 86,933 | 7,428 | 53 | $0.0175 | $0.00033 | 1.00 |

### Cost-Adjusted F1 (F1 / mean cost per claim)

> Higher = more quality per dollar. Only meaningful when cost > 0.

| System | F1 | Mean Cost/Claim | Cost-Adjusted F1 |
|--------|:--:|----------------:|-----------------:|
| System A (HERALD) | 81.8% | $0.00024 | 3396.8 |
| System B (Tier 2 only) | 78.3% | $0.00033 | 2375.6 |
| System C (No NLI) | 76.6% | $0.00033 | 2320.3 |

### Scale Projection — 1,000 Claims/Day

| System | Est. Daily Cost (USD) | Est. Monthly Cost (USD) |
|--------|-----------------------:|------------------------:|
| System A (HERALD) | $0.24 | $7.22 |
| System B (Tier 2 only) | $0.33 | $9.89 |
| System C (No NLI) | $0.33 | $9.90 |

## 6. Agreement: System A vs System B

Agreement rate: **88.7%** (47/53 claims)

**Disagreements (6 claims):**

| Claim ID | Type | Ground Truth | System A | System B | Winner |
|----------|------|:------------:|:--------:|:--------:|:------:|
| GT-062 | causal | valid | valid | invalid | A ✓ |
| GT-053 | statistical | valid | invalid | valid | B ✓ |
| GT-096 | comparative | valid | invalid | valid | B ✓ |
| GT-060 | comparative | valid | valid | invalid | A ✓ |
| GT-103 | comparative | valid | valid | invalid | A ✓ |
| GT-087 | causal | valid | valid | invalid | A ✓ |

## 7. Wrong Claims

### System A — 8 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-083 | causal | paraphrase | valid | invalid | False Invalid |
| GT-097 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-053 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-059 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-091 | synthesis | cross_source | valid | invalid | False Invalid |
| GT-089 | causal | paraphrase | valid | invalid | False Invalid |
| GT-096 | comparative | direct_extraction | valid | invalid | False Invalid |
| GT-055 | causal | direct_extraction | valid | invalid | False Invalid |

### System B — 10 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-083 | causal | paraphrase | valid | invalid | False Invalid |
| GT-062 | causal | direct_extraction | valid | invalid | False Invalid |
| GT-097 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-059 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-091 | synthesis | cross_source | valid | invalid | False Invalid |
| GT-089 | causal | paraphrase | valid | invalid | False Invalid |
| GT-060 | comparative | direct_extraction | valid | invalid | False Invalid |
| GT-055 | causal | direct_extraction | valid | invalid | False Invalid |
| GT-103 | comparative | direct_extraction | valid | invalid | False Invalid |
| GT-087 | causal | paraphrase | valid | invalid | False Invalid |

### System C — 11 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-083 | causal | paraphrase | valid | invalid | False Invalid |
| GT-062 | causal | direct_extraction | valid | invalid | False Invalid |
| GT-097 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-071 | causal | paraphrase | valid | invalid | False Invalid |
| GT-059 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-091 | synthesis | cross_source | valid | invalid | False Invalid |
| GT-089 | causal | paraphrase | valid | invalid | False Invalid |
| GT-060 | comparative | direct_extraction | valid | invalid | False Invalid |
| GT-055 | causal | direct_extraction | valid | invalid | False Invalid |
| GT-103 | comparative | direct_extraction | valid | invalid | False Invalid |
| GT-087 | causal | paraphrase | valid | invalid | False Invalid |
