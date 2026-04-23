# HERALD Experiment Analysis

**Run timestamp:** 2026-04-23T02:50:06.222Z
**Git commit:** `8d9ab71`
**Eval set:** `data/eval-set.json`
**Systems run:** A, B, C
**Total claims:** 50
**Model:** gpt-4o (input: $2.5/1M tokens, output: $10/1M tokens)

## 1. Overall Accuracy

| Metric | System A (HERALD) | System B (Tier 2 only) | System C (No NLI) |
|--------|:-----------------:|:----------------------:|:-----------------:|
| Accuracy | 86.0% | 88.0% | 82.0% |
| Precision | 82.8% | 85.7% | 77.4% |
| Recall | 92.3% | 92.3% | 92.3% |
| F1 | 87.3% | 88.9% | 84.2% |
| False Invalid Rate | 20.8% | 16.7% | 29.2% |
| False Valid Rate | 7.7% | 7.7% | 7.7% |
| Eval Errors | 0 | 0 | 0 |

## 2. Per Claim Type

### causal (n=9)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 88.9% | 88.9% | 77.8% |
| F1 | 92.3% | 92.3% | 85.7% |
| False Invalid Rate | 33.3% | 33.3% | 66.7% |
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
| Accuracy | 75.0% | 87.5% | 75.0% |
| F1 | 80.0% | 88.9% | 80.0% |
| False Invalid Rate | 50.0% | 25.0% | 50.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### predictive (n=8)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 87.5% | 87.5% | 87.5% |
| F1 | 88.9% | 88.9% | 88.9% |
| False Invalid Rate | 25.0% | 25.0% | 25.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### statistical (n=9)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 100.0% | 100.0% | 88.9% |
| F1 | 100.0% | 100.0% | 88.9% |
| False Invalid Rate | 0.0% | 0.0% | 20.0% |
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
| System A (HERALD) | 1974 | 1989 | 3009 |
| System B (Tier 2 only) | 1867 | 1841 | 2454 |
| System C (No NLI) | 1878 | 1886 | 2803 |

## 5. Cost Analysis

*Model: gpt-4o. Pricing: $2.5/1M input tokens, $10/1M output tokens.*

### 5.1 Token Usage per Claim (mean)

| System | Mean Input Tokens | Mean Output Tokens | Mean API Calls | Mean Cost/Claim |
|--------|------------------:|-------------------:|---------------:|----------------:|
| System A (HERALD) | 1783 | 154 | 1.0 | $0.0060 |
| System B (Tier 2 only) | 1695 | 150 | 1.0 | $0.0057 |
| System C (No NLI) | 1695 | 155 | 1.0 | $0.0058 |

### 5.2 Cost per Claim by Type

| Claim Type | System A Cost/Claim | System B Cost/Claim | System A API Calls | System B API Calls |
|------------|:-------------------:|:-------------------:|:-----------------:|:-----------------:|
| causal | $0.0061 | $0.0057 | 1.0 | 1.0 |
| comparative | $0.0058 | $0.0054 | 1.0 | 1.0 |
| normative | $0.0061 | $0.0061 | 1.0 | 1.0 |
| predictive | $0.0056 | $0.0057 | 1.0 | 1.0 |
| statistical | $0.0055 | $0.0051 | 1.0 | 1.0 |
| synthesis | $0.0068 | $0.0066 | 1.0 | 1.0 |

### 5.3 Accuracy per Dollar (F1 / mean cost per claim)

*Higher is better. Measures how much accuracy each dollar buys.*

| System | F1 | Mean Cost/Claim | F1 per Dollar |
|--------|:--:|----------------:|--------------:|
| System A (HERALD) | 87.3% | $0.0060 | 145.4 |
| System B (Tier 2 only) | 88.9% | $0.0057 | 155.9 |
| System C (No NLI) | 84.2% | $0.0058 | 145.2 |

### 5.4 Cost at Scale (1,000 claims/day)

| System | Daily Cost | Monthly Cost (30d) |
|--------|:----------:|:-----------------:|
| System A (HERALD) | $6.00 | $180.00 |
| System B (Tier 2 only) | $5.70 | $171.00 |
| System C (No NLI) | $5.80 | $174.00 |

### 5.5 Decision: Cost-Performance Verdict

- **F1 delta (A − B):** -1.6%
- **Cost delta (A − B):** $0.0003 per claim (HERALD costs more)
- **F1/$ System A:** 145.4 vs System B: 155.9

❌ **LLM-as-Judge wins** — HERALD achieves no accuracy gain (F1 delta: -1.6%) while costing $0.0003 more per claim.

### Does Tier 1 NLI contribute accuracy?

✅ **Yes** — F1(A) > F1(C) by 3.1%

## 6. Agreement: System A vs System B

Agreement rate: **98.0%** (49/50 claims)

**Disagreements (1 claims):**

| Claim ID | Type | Ground Truth | System A | System B | Winner |
|----------|------|:------------:|:--------:|:--------:|:------:|
| GT-008 | normative | valid | invalid | valid | B ✓ |

## 7. Wrong Claims

### System A — 7 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-023 | synthesis | cross_source | invalid | valid | False Valid |
| GT-034 | normative | paraphrase | valid | invalid | False Invalid |
| GT-008 | normative | paraphrase | valid | invalid | False Invalid |
| GT-018 | predictive | paraphrase | valid | invalid | False Invalid |
| GT-042 | synthesis | cross_source | invalid | valid | False Valid |
| GT-030 | causal | paraphrase | valid | invalid | False Invalid |
| GT-036 | synthesis | agent_inference | valid | invalid | False Invalid |

### System B — 6 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-023 | synthesis | cross_source | invalid | valid | False Valid |
| GT-034 | normative | paraphrase | valid | invalid | False Invalid |
| GT-018 | predictive | paraphrase | valid | invalid | False Invalid |
| GT-042 | synthesis | cross_source | invalid | valid | False Valid |
| GT-030 | causal | paraphrase | valid | invalid | False Invalid |
| GT-036 | synthesis | agent_inference | valid | invalid | False Invalid |

### System C — 9 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-020 | statistical | direct_extraction | valid | invalid | False Invalid |
| GT-023 | synthesis | cross_source | invalid | valid | False Valid |
| GT-034 | normative | paraphrase | valid | invalid | False Invalid |
| GT-008 | normative | paraphrase | valid | invalid | False Invalid |
| GT-018 | predictive | paraphrase | valid | invalid | False Invalid |
| GT-042 | synthesis | cross_source | invalid | valid | False Valid |
| GT-048 | causal | paraphrase | valid | invalid | False Invalid |
| GT-030 | causal | paraphrase | valid | invalid | False Invalid |
| GT-036 | synthesis | agent_inference | valid | invalid | False Invalid |
