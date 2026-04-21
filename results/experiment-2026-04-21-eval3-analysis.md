# HERALD Experiment Analysis

**Run timestamp:** 2026-04-21T21:36:02.825Z
**Git commit:** `259502c`
**Eval set:** `data/eval-set-3.json`
**Systems run:** A, B, C
**Total claims:** 50

## 1. Overall Results

| Metric | System A (HERALD) | System B (Tier 2 only) | System C (No NLI) |
|--------|:-----------------:|:----------------------:|:-----------------:|
| Accuracy | 80.0% | 76.0% | 74.0% |
| Precision | 64.3% | 60.0% | 58.1% |
| Recall | 100.0% | 100.0% | 100.0% |
| F1 | 78.3% | 75.0% | 73.5% |
| False Invalid Rate | 31.3% | 37.5% | 40.6% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |
| Eval Errors | 0 | 0 | 0 |

### Decision: Is HERALD worth the complexity?

✅ **Yes** — F1(A) > F1(B) by 3.3% (≥ 3pp threshold met)

### Decision: Does Tier 1 NLI contribute accuracy?

✅ **Yes** — F1(A) > F1(C) by 4.8%

## 2. Per Claim Type

### causal (n=16)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 62.5% | 56.3% | 56.3% |
| F1 | 62.5% | 58.8% | 58.8% |
| False Invalid Rate | 54.5% | 63.6% | 63.6% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### comparative (n=10)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 90.0% | 90.0% | 90.0% |
| F1 | 85.7% | 85.7% | 85.7% |
| False Invalid Rate | 14.3% | 14.3% | 14.3% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### normative (n=3)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 100.0% | 100.0% | 100.0% |
| F1 | 100.0% | 100.0% | 100.0% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### predictive (n=3)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 100.0% | 100.0% | 66.7% |
| F1 | 100.0% | 100.0% | 80.0% |
| False Invalid Rate | 0.0% | 0.0% | 100.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### statistical (n=14)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 78.6% | 71.4% | 71.4% |
| F1 | 80.0% | 75.0% | 75.0% |
| False Invalid Rate | 37.5% | 50.0% | 50.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### synthesis (n=4)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 100.0% | 100.0% | 100.0% |
| F1 | 0.0% | 0.0% | 0.0% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

## 3. Tier Distribution

**System A** (50 claims)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 1 | 12 | 24.0% |
| Tier 2 | 38 | 76.0% |
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
| System A (HERALD) | 6746 | 4611 | 18528 |
| System B (Tier 2 only) | 5441 | 3855 | 11501 |
| System C (No NLI) | 5780 | 3527 | 15374 |

## 5. Cost Analysis

> Pricing: $0.15/1M input tokens, $0.60/1M output tokens (gpt-4o-mini)

| System | Total Input Tokens | Total Output Tokens | Total API Calls | Total Cost (USD) | Mean Cost/Claim | Mean API Calls/Claim |
|--------|-------------------:|--------------------:|----------------:|-----------------:|----------------:|---------------------:|
| System A (HERALD) | 67,118 | 5,473 | 38 | $0.0134 | $0.00027 | 0.76 |
| System B (Tier 2 only) | 81,219 | 7,032 | 50 | $0.0164 | $0.00033 | 1.00 |
| System C (No NLI) | 81,219 | 7,090 | 50 | $0.0164 | $0.00033 | 1.00 |

### Cost-Adjusted F1 (F1 / mean cost per claim)

> Higher = more quality per dollar. Only meaningful when cost > 0.

| System | F1 | Mean Cost/Claim | Cost-Adjusted F1 |
|--------|:--:|----------------:|-----------------:|
| System A (HERALD) | 78.3% | $0.00027 | 2932.3 |
| System B (Tier 2 only) | 75.0% | $0.00033 | 2286.3 |
| System C (No NLI) | 73.5% | $0.00033 | 2235.8 |

### Scale Projection — 1,000 Claims/Day

| System | Est. Daily Cost (USD) | Est. Monthly Cost (USD) |
|--------|-----------------------:|------------------------:|
| System A (HERALD) | $0.27 | $8.01 |
| System B (Tier 2 only) | $0.33 | $9.84 |
| System C (No NLI) | $0.33 | $9.86 |

## 6. Agreement: System A vs System B

Agreement rate: **96.0%** (48/50 claims)

**Disagreements (2 claims):**

| Claim ID | Type | Ground Truth | System A | System B | Winner |
|----------|------|:------------:|:--------:|:--------:|:------:|
| GT-153 | statistical | valid | valid | invalid | A ✓ |
| GT-129 | causal | valid | valid | invalid | A ✓ |

## 7. Wrong Claims

### System A — 10 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-111 | causal | paraphrase | valid | invalid | False Invalid |
| GT-149 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-151 | causal | paraphrase | valid | invalid | False Invalid |
| GT-137 | comparative | direct_extraction | valid | invalid | False Invalid |
| GT-109 | statistical | direct_extraction | valid | invalid | False Invalid |
| GT-139 | causal | paraphrase | valid | invalid | False Invalid |
| GT-108 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-118 | causal | paraphrase | valid | invalid | False Invalid |
| GT-134 | causal | paraphrase | valid | invalid | False Invalid |
| GT-113 | causal | paraphrase | valid | invalid | False Invalid |

### System B — 12 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-111 | causal | paraphrase | valid | invalid | False Invalid |
| GT-149 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-151 | causal | paraphrase | valid | invalid | False Invalid |
| GT-137 | comparative | direct_extraction | valid | invalid | False Invalid |
| GT-109 | statistical | direct_extraction | valid | invalid | False Invalid |
| GT-153 | statistical | direct_extraction | valid | invalid | False Invalid |
| GT-139 | causal | paraphrase | valid | invalid | False Invalid |
| GT-108 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-118 | causal | paraphrase | valid | invalid | False Invalid |
| GT-134 | causal | paraphrase | valid | invalid | False Invalid |
| GT-113 | causal | paraphrase | valid | invalid | False Invalid |
| GT-129 | causal | paraphrase | valid | invalid | False Invalid |

### System C — 13 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-111 | causal | paraphrase | valid | invalid | False Invalid |
| GT-149 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-151 | causal | paraphrase | valid | invalid | False Invalid |
| GT-137 | comparative | direct_extraction | valid | invalid | False Invalid |
| GT-109 | statistical | direct_extraction | valid | invalid | False Invalid |
| GT-153 | statistical | direct_extraction | valid | invalid | False Invalid |
| GT-139 | causal | paraphrase | valid | invalid | False Invalid |
| GT-127 | predictive | paraphrase | valid | invalid | False Invalid |
| GT-108 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-118 | causal | paraphrase | valid | invalid | False Invalid |
| GT-134 | causal | paraphrase | valid | invalid | False Invalid |
| GT-113 | causal | paraphrase | valid | invalid | False Invalid |
| GT-129 | causal | paraphrase | valid | invalid | False Invalid |
