# HERALD Experiment Analysis

**Run timestamp:** 2026-04-23T03:04:43.132Z
**Git commit:** `8d9ab71`
**Eval set:** `data/eval-set-3.json`
**Systems run:** A, B, C
**Total claims:** 50
**Model:** gpt-4o (input: $2.5/1M tokens, output: $10/1M tokens)

## 1. Overall Accuracy

| Metric | System A (HERALD) | System B (Tier 2 only) | System C (No NLI) |
|--------|:-----------------:|:----------------------:|:-----------------:|
| Accuracy | 74.0% | 74.0% | 74.0% |
| Precision | 58.1% | 58.1% | 58.1% |
| Recall | 100.0% | 100.0% | 100.0% |
| F1 | 73.5% | 73.5% | 73.5% |
| False Invalid Rate | 40.6% | 40.6% | 40.6% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |
| Eval Errors | 0 | 0 | 0 |

## 2. Per Claim Type

### causal (n=16)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 50.0% | 56.3% | 56.3% |
| F1 | 55.6% | 58.8% | 58.8% |
| False Invalid Rate | 72.7% | 63.6% | 63.6% |
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
| Accuracy | 66.7% | 66.7% | 66.7% |
| F1 | 80.0% | 80.0% | 80.0% |
| False Invalid Rate | 100.0% | 100.0% | 100.0% |
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
| System A (HERALD) | 2166 | 2149 | 3922 |
| System B (Tier 2 only) | 2038 | 1999 | 2945 |
| System C (No NLI) | 2055 | 2047 | 2968 |

## 5. Cost Analysis

*Model: gpt-4o. Pricing: $2.5/1M input tokens, $10/1M output tokens.*

### 5.1 Token Usage per Claim (mean)

| System | Mean Input Tokens | Mean Output Tokens | Mean API Calls | Mean Cost/Claim |
|--------|------------------:|-------------------:|---------------:|----------------:|
| System A (HERALD) | 1766 | 147 | 1.0 | $0.0059 |
| System B (Tier 2 only) | 1624 | 141 | 1.0 | $0.0055 |
| System C (No NLI) | 1624 | 141 | 1.0 | $0.0055 |

### 5.2 Cost per Claim by Type

| Claim Type | System A Cost/Claim | System B Cost/Claim | System A API Calls | System B API Calls |
|------------|:-------------------:|:-------------------:|:-----------------:|:-----------------:|
| causal | $0.0061 | $0.0057 | 1.0 | 1.0 |
| comparative | $0.0054 | $0.0049 | 1.0 | 1.0 |
| normative | $0.0061 | $0.0061 | 1.0 | 1.0 |
| predictive | $0.0056 | $0.0056 | 1.0 | 1.0 |
| statistical | $0.0056 | $0.0053 | 1.0 | 1.0 |
| synthesis | $0.0063 | $0.0063 | 1.0 | 1.0 |

### 5.3 Accuracy per Dollar (F1 / mean cost per claim)

*Higher is better. Measures how much accuracy each dollar buys.*

| System | F1 | Mean Cost/Claim | F1 per Dollar |
|--------|:--:|----------------:|--------------:|
| System A (HERALD) | 73.5% | $0.0059 | 124.5 |
| System B (Tier 2 only) | 73.5% | $0.0055 | 133.6 |
| System C (No NLI) | 73.5% | $0.0055 | 133.6 |

### 5.4 Cost at Scale (1,000 claims/day)

| System | Daily Cost | Monthly Cost (30d) |
|--------|:----------:|:-----------------:|
| System A (HERALD) | $5.90 | $177.00 |
| System B (Tier 2 only) | $5.50 | $165.00 |
| System C (No NLI) | $5.50 | $165.00 |

### 5.5 Decision: Cost-Performance Verdict

- **F1 delta (A − B):** 0.0%
- **Cost delta (A − B):** $0.0004 per claim (HERALD costs more)
- **F1/$ System A:** 124.5 vs System B: 133.6

❌ **LLM-as-Judge wins** — HERALD achieves no accuracy gain (F1 delta: 0.0%) while costing $0.0004 more per claim.

### Does Tier 1 NLI contribute accuracy?

⚠️ **Marginal** — F1(A) ≈ F1(C) (delta: 0.0%). NLI adds infrastructure cost without clear accuracy gain.

## 6. Agreement: System A vs System B

Agreement rate: **96.0%** (48/50 claims)

**Disagreements (2 claims):**

| Claim ID | Type | Ground Truth | System A | System B | Winner |
|----------|------|:------------:|:--------:|:--------:|:------:|
| GT-131 | causal | valid | invalid | valid | B ✓ |
| GT-153 | statistical | valid | valid | invalid | A ✓ |

## 7. Wrong Claims

### System A — 13 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-113 | causal | paraphrase | valid | invalid | False Invalid |
| GT-137 | comparative | direct_extraction | valid | invalid | False Invalid |
| GT-129 | causal | paraphrase | valid | invalid | False Invalid |
| GT-127 | predictive | paraphrase | valid | invalid | False Invalid |
| GT-118 | causal | paraphrase | valid | invalid | False Invalid |
| GT-131 | causal | paraphrase | valid | invalid | False Invalid |
| GT-151 | causal | paraphrase | valid | invalid | False Invalid |
| GT-108 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-139 | causal | paraphrase | valid | invalid | False Invalid |
| GT-134 | causal | paraphrase | valid | invalid | False Invalid |
| GT-109 | statistical | direct_extraction | valid | invalid | False Invalid |
| GT-111 | causal | paraphrase | valid | invalid | False Invalid |
| GT-149 | statistical | paraphrase | valid | invalid | False Invalid |

### System B — 13 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-113 | causal | paraphrase | valid | invalid | False Invalid |
| GT-137 | comparative | direct_extraction | valid | invalid | False Invalid |
| GT-129 | causal | paraphrase | valid | invalid | False Invalid |
| GT-127 | predictive | paraphrase | valid | invalid | False Invalid |
| GT-118 | causal | paraphrase | valid | invalid | False Invalid |
| GT-151 | causal | paraphrase | valid | invalid | False Invalid |
| GT-108 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-139 | causal | paraphrase | valid | invalid | False Invalid |
| GT-134 | causal | paraphrase | valid | invalid | False Invalid |
| GT-109 | statistical | direct_extraction | valid | invalid | False Invalid |
| GT-111 | causal | paraphrase | valid | invalid | False Invalid |
| GT-149 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-153 | statistical | direct_extraction | valid | invalid | False Invalid |

### System C — 13 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-113 | causal | paraphrase | valid | invalid | False Invalid |
| GT-137 | comparative | direct_extraction | valid | invalid | False Invalid |
| GT-129 | causal | paraphrase | valid | invalid | False Invalid |
| GT-127 | predictive | paraphrase | valid | invalid | False Invalid |
| GT-118 | causal | paraphrase | valid | invalid | False Invalid |
| GT-151 | causal | paraphrase | valid | invalid | False Invalid |
| GT-108 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-139 | causal | paraphrase | valid | invalid | False Invalid |
| GT-134 | causal | paraphrase | valid | invalid | False Invalid |
| GT-109 | statistical | direct_extraction | valid | invalid | False Invalid |
| GT-111 | causal | paraphrase | valid | invalid | False Invalid |
| GT-149 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-153 | statistical | direct_extraction | valid | invalid | False Invalid |
