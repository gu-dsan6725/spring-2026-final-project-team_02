# HERALD Experiment Analysis

**Run timestamp:** 2026-04-23T16:06:59.493Z
**Git commit:** `011305a`
**Eval set:** `data/human-eval-set.json`
**Systems run:** A, B, C
**Total claims:** 52
**Tier 2 model:** gpt-4o-mini (input: $0.15/1M, output: $0.6/1M)
**Tier 3 model:** claude-haiku-4-5 (input: $0.8/1M, output: $4/1M)

## 1. Overall Accuracy

| Metric | System A (HERALD) | System B (Tier 2 only) | System C (No NLI) |
|--------|:-----------------:|:----------------------:|:-----------------:|
| Accuracy | 84.6% | 86.5% | 84.6% |
| Precision | 81.8% | 89.5% | 85.0% |
| Recall | 81.8% | 77.3% | 77.3% |
| F1 | 81.8% | 82.9% | 81.0% |
| False Invalid Rate | 13.3% | 6.7% | 10.0% |
| False Valid Rate | 18.2% | 22.7% | 22.7% |
| Eval Errors | 0 | 0 | 0 |

## 2. Per Claim Type

### causal (n=12)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 91.7% | 91.7% | 91.7% |
| F1 | 88.9% | 88.9% | 88.9% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 20.0% | 20.0% | 20.0% |

### comparative (n=12)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 83.3% | 91.7% | 83.3% |
| F1 | 75.0% | 85.7% | 75.0% |
| False Invalid Rate | 22.2% | 11.1% | 22.2% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### normative (n=2)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 100.0% | 100.0% | 100.0% |
| F1 | 0.0% | 0.0% | 0.0% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### predictive (n=2)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 100.0% | 100.0% | 100.0% |
| F1 | 100.0% | 100.0% | 100.0% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### statistical (n=17)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 82.3% | 82.3% | 82.3% |
| F1 | 85.7% | 84.2% | 84.2% |
| False Invalid Rate | 28.6% | 14.3% | 14.3% |
| False Valid Rate | 10.0% | 20.0% | 20.0% |

### synthesis (n=7)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 71.4% | 71.4% | 71.4% |
| F1 | 50.0% | 50.0% | 50.0% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 66.7% | 66.7% | 66.7% |

## 3. Tier Distribution

**System A** (52 claims)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 1 | 24 | 46.2% |
| Tier 2 | 25 | 48.1% |
| Tier 3 | 3 | 5.8% |
| Tier 4 | 0 | 0.0% |

**System C** (52 claims)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 1 | 0 | 0.0% |
| Tier 2 | 49 | 94.2% |
| Tier 3 | 3 | 5.8% |
| Tier 4 | 0 | 0.0% |

## 4. Latency

| System | Mean (ms) | Median (ms) | p95 (ms) |
|--------|----------:|------------:|---------:|
| System A (HERALD) | 2021 | 2115 | 6104 |
| System B (Tier 2 only) | 2391 | 2249 | 3420 |
| System C (No NLI) | 2675 | 2353 | 7117 |

## 5. Cost Analysis

*Tier 2 model: gpt-4o-mini. Pricing: $0.15/1M input, $0.6/1M output.*
*Tier 3 model: claude-haiku-4-5 ($0.8/1M input, $4/1M output). Tier 3 costs are included when usage data is available.*

### 5.1 Token Usage per Claim (mean)

| System | Mean Input Tokens | Mean Output Tokens | Mean API Calls | Mean Cost/Claim |
|--------|------------------:|-------------------:|---------------:|----------------:|
| System A (HERALD) | 2016 | 174 | 1.1 | $0.0007 |
| System B (Tier 2 only) | 1710 | 127 | 1.0 | $0.0003 |
| System C (No NLI) | 1807 | 156 | 1.1 | $0.0005 |

### 5.2 Cost per Claim by Type

| Claim Type | System A Cost/Claim | System B Cost/Claim | System A API Calls | System B API Calls |
|------------|:-------------------:|:-------------------:|:-----------------:|:-----------------:|
| causal | $0.0008 | $0.0003 | 1.1 | 1.0 |
| comparative | $0.0003 | $0.0003 | 1.0 | 1.0 |
| normative | $0.0003 | $0.0003 | 1.0 | 1.0 |
| predictive | $0.0003 | $0.0003 | 1.0 | 1.0 |
| statistical | $0.0007 | $0.0003 | 1.1 | 1.0 |
| synthesis | $0.0008 | $0.0004 | 1.1 | 1.0 |

### 5.3 Accuracy per Dollar (F1 / mean cost per claim)

*Higher is better. Measures how much accuracy each dollar buys.*

| System | F1 | Mean Cost/Claim | F1 per Dollar |
|--------|:--:|----------------:|--------------:|
| System A (HERALD) | 81.8% | $0.0007 | 1168.9 |
| System B (Tier 2 only) | 82.9% | $0.0003 | 2764.3 |
| System C (No NLI) | 81.0% | $0.0005 | 1619.0 |

### 5.4 Cost at Scale (1,000 claims/day)

| System | Daily Cost | Monthly Cost (30d) |
|--------|:----------:|:-----------------:|
| System A (HERALD) | $0.70 | $21.00 |
| System B (Tier 2 only) | $0.30 | $9.00 |
| System C (No NLI) | $0.50 | $15.00 |

### 5.5 Decision: Cost-Performance Verdict

- **F1 delta (A − B):** -1.1%
- **Cost delta (A − B):** $0.0004 per claim (HERALD costs more)
- **F1/$ System A:** 1168.9 vs System B: 2764.3

❌ **LLM-as-Judge wins** — HERALD achieves no accuracy gain (F1 delta: -1.1%) while costing $0.0004 more per claim.

### Does Tier 1 NLI contribute accuracy?

⚠️ **Marginal** — F1(A) ≈ F1(C) (delta: 0.9%). NLI adds infrastructure cost without clear accuracy gain.

## 6. Agreement: System A vs System B

Agreement rate: **94.2%** (49/52 claims)

**Disagreements (3 claims):**

| Claim ID | Type | Ground Truth | System A | System B | Winner |
|----------|------|:------------:|:--------:|:--------:|:------:|
| GT-053 | statistical | valid | invalid | valid | B ✓ |
| GT-096 | comparative | valid | invalid | valid | B ✓ |
| GT-100 | statistical | invalid | invalid | valid | A ✓ |

## 7. Wrong Claims

### System A — 8 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-053 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-062 | causal | direct_extraction | invalid | valid | False Valid |
| GT-079 | synthesis | cross_source | invalid | valid | False Valid |
| GT-057 | synthesis | cross_source | invalid | valid | False Valid |
| GT-059 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-096 | comparative | direct_extraction | valid | invalid | False Invalid |
| GT-065 | statistical | direct_extraction | invalid | valid | False Valid |
| GT-103 | comparative | direct_extraction | valid | invalid | False Invalid |

### System B — 7 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-062 | causal | direct_extraction | invalid | valid | False Valid |
| GT-079 | synthesis | cross_source | invalid | valid | False Valid |
| GT-057 | synthesis | cross_source | invalid | valid | False Valid |
| GT-059 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-065 | statistical | direct_extraction | invalid | valid | False Valid |
| GT-100 | statistical | paraphrase | invalid | valid | False Valid |
| GT-103 | comparative | direct_extraction | valid | invalid | False Invalid |

### System C — 8 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-062 | causal | direct_extraction | invalid | valid | False Valid |
| GT-079 | synthesis | cross_source | invalid | valid | False Valid |
| GT-057 | synthesis | cross_source | invalid | valid | False Valid |
| GT-059 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-084 | comparative | paraphrase | valid | invalid | False Invalid |
| GT-065 | statistical | direct_extraction | invalid | valid | False Valid |
| GT-100 | statistical | paraphrase | invalid | valid | False Valid |
| GT-103 | comparative | direct_extraction | valid | invalid | False Invalid |
