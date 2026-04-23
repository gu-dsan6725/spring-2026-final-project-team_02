# HERALD Experiment Analysis

**Run timestamp:** 2026-04-23T16:58:06.190Z
**Git commit:** `011305a`
**Eval set:** `data/genai-eval-set.json`
**Systems run:** A, B, C
**Total claims:** 100
**Tier 2 model:** gpt-4o-mini (input: $0.15/1M, output: $0.6/1M)
**Tier 3 model:** claude-haiku-4-5 (input: $0.8/1M, output: $4/1M)

## 1. Overall Accuracy

| Metric | System A (HERALD) | System B (Tier 2 only) | System C (No NLI) |
|--------|:-----------------:|:----------------------:|:-----------------:|
| Accuracy | 95.0% | 89.0% | 91.7% |
| Precision | 97.6% | 85.1% | 90.2% |
| Recall | 90.9% | 90.9% | 90.2% |
| F1 | 94.1% | 87.9% | 90.2% |
| False Invalid Rate | 1.8% | 12.5% | 7.3% |
| False Valid Rate | 9.1% | 9.1% | 9.8% |
| Eval Errors | 0 | 0 | 4 |

## 2. Per Claim Type

### causal (n=25)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 96.0% | 84.0% | 87.5% |
| F1 | 95.2% | 81.8% | 85.7% |
| False Invalid Rate | 0.0% | 14.3% | 7.7% |
| False Valid Rate | 9.1% | 18.2% | 18.2% |

### comparative (n=18)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 100.0% | 100.0% | 100.0% |
| F1 | 100.0% | 100.0% | 100.0% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### normative (n=11)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 90.9% | 90.9% | 87.5% |
| F1 | 92.3% | 92.3% | 85.7% |
| False Invalid Rate | 20.0% | 20.0% | 20.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### predictive (n=11)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 100.0% | 90.9% | 100.0% |
| F1 | 100.0% | 92.3% | 100.0% |
| False Invalid Rate | 0.0% | 20.0% | 0.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### statistical (n=23)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 95.7% | 87.0% | 91.3% |
| F1 | 94.7% | 87.0% | 90.9% |
| False Invalid Rate | 0.0% | 23.1% | 15.4% |
| False Valid Rate | 10.0% | 0.0% | 0.0% |

### synthesis (n=12)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 83.3% | 83.3% | 83.3% |
| F1 | 50.0% | 50.0% | 50.0% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 66.7% | 66.7% | 66.7% |

## 3. Tier Distribution

**System A** (100 claims)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 1 | 36 | 36.0% |
| Tier 2 | 53 | 53.0% |
| Tier 3 | 11 | 11.0% |
| Tier 4 | 0 | 0.0% |

**System C** (100 claims)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 1 | 0 | 0.0% |
| Tier 2 | 90 | 90.0% |
| Tier 3 | 10 | 10.0% |
| Tier 4 | 0 | 0.0% |

## 4. Latency

| System | Mean (ms) | Median (ms) | p95 (ms) |
|--------|----------:|------------:|---------:|
| System A (HERALD) | 2331 | 2040 | 7159 |
| System B (Tier 2 only) | 2292 | 2149 | 3578 |
| System C (No NLI) | 2544 | 2093 | 6305 |

## 5. Cost Analysis

*Tier 2 model: gpt-4o-mini. Pricing: $0.15/1M input, $0.6/1M output.*
*Tier 3 model: claude-haiku-4-5 ($0.8/1M input, $4/1M output). Tier 3 costs are included when usage data is available.*

### 5.1 Token Usage per Claim (mean)

| System | Mean Input Tokens | Mean Output Tokens | Mean API Calls | Mean Cost/Claim |
|--------|------------------:|-------------------:|---------------:|----------------:|
| System A (HERALD) | 2093 | 201 | 1.2 | $0.0008 |
| System B (Tier 2 only) | 1714 | 131 | 1.0 | $0.0003 |
| System C (No NLI) | 1878 | 164 | 1.1 | $0.0006 |

### 5.2 Cost per Claim by Type

| Claim Type | System A Cost/Claim | System B Cost/Claim | System A API Calls | System B API Calls |
|------------|:-------------------:|:-------------------:|:-----------------:|:-----------------:|
| causal | $0.0012 | $0.0003 | 1.3 | 1.0 |
| comparative | $0.0009 | $0.0003 | 1.2 | 1.0 |
| normative | $0.0013 | $0.0003 | 1.4 | 1.0 |
| predictive | $0.0006 | $0.0003 | 1.1 | 1.0 |
| statistical | $0.0006 | $0.0003 | 1.1 | 1.0 |
| synthesis | $0.0004 | $0.0004 | 1.0 | 1.0 |

### 5.3 Accuracy per Dollar (F1 / mean cost per claim)

*Higher is better. Measures how much accuracy each dollar buys.*

| System | F1 | Mean Cost/Claim | F1 per Dollar |
|--------|:--:|----------------:|--------------:|
| System A (HERALD) | 94.1% | $0.0008 | 1176.5 |
| System B (Tier 2 only) | 87.9% | $0.0003 | 2930.3 |
| System C (No NLI) | 90.2% | $0.0006 | 1504.0 |

### 5.4 Cost at Scale (1,000 claims/day)

| System | Daily Cost | Monthly Cost (30d) |
|--------|:----------:|:-----------------:|
| System A (HERALD) | $0.80 | $24.00 |
| System B (Tier 2 only) | $0.30 | $9.00 |
| System C (No NLI) | $0.60 | $18.00 |

### 5.5 Decision: Cost-Performance Verdict

- **F1 delta (A − B):** 6.2%
- **Cost delta (A − B):** $0.0005 per claim (HERALD costs more)
- **F1/$ System A:** 1176.5 vs System B: 2930.3

⚠️ **HERALD wins on accuracy but not on cost-efficiency** — F1 is +6.2% higher but costs 166.7% more per claim. Worthwhile only if accuracy gains are critical.

### Does Tier 1 NLI contribute accuracy?

✅ **Yes** — F1(A) > F1(C) by 3.9%

## 6. Agreement: System A vs System B

Agreement rate: **92.0%** (92/100 claims)

**Disagreements (8 claims):**

| Claim ID | Type | Ground Truth | System A | System B | Winner |
|----------|------|:------------:|:--------:|:--------:|:------:|
| GT-108 | statistical | valid | valid | invalid | A ✓ |
| GT-149 | statistical | valid | valid | invalid | A ✓ |
| GT-018 | predictive | valid | valid | invalid | A ✓ |
| GT-135 | statistical | invalid | valid | invalid | B ✓ |
| GT-153 | statistical | valid | valid | invalid | A ✓ |
| GT-030 | causal | valid | valid | invalid | A ✓ |
| GT-118 | causal | valid | valid | invalid | A ✓ |
| GT-016 | causal | invalid | invalid | valid | A ✓ |

## 7. Wrong Claims

### System A — 5 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-135 | statistical | paraphrase | invalid | valid | False Valid |
| GT-034 | normative | paraphrase | valid | invalid | False Invalid |
| GT-023 | synthesis | cross_source | invalid | valid | False Valid |
| GT-042 | synthesis | cross_source | invalid | valid | False Valid |
| GT-025 | causal | paraphrase | invalid | valid | False Valid |

### System B — 11 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-108 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-149 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-018 | predictive | paraphrase | valid | invalid | False Invalid |
| GT-153 | statistical | direct_extraction | valid | invalid | False Invalid |
| GT-030 | causal | paraphrase | valid | invalid | False Invalid |
| GT-034 | normative | paraphrase | valid | invalid | False Invalid |
| GT-023 | synthesis | cross_source | invalid | valid | False Valid |
| GT-118 | causal | paraphrase | valid | invalid | False Invalid |
| GT-016 | causal | cross_source | invalid | valid | False Valid |
| GT-042 | synthesis | cross_source | invalid | valid | False Valid |
| GT-025 | causal | paraphrase | invalid | valid | False Valid |

### System C — 12 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-013 | normative | agent_inference | invalid | uncertain | False Valid |
| GT-149 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-153 | statistical | direct_extraction | valid | invalid | False Invalid |
| GT-030 | causal | paraphrase | valid | uncertain | False Valid |
| GT-034 | normative | paraphrase | valid | invalid | False Invalid |
| GT-023 | synthesis | cross_source | invalid | valid | False Valid |
| GT-118 | causal | paraphrase | valid | invalid | False Invalid |
| GT-016 | causal | cross_source | invalid | valid | False Valid |
| GT-042 | synthesis | cross_source | invalid | valid | False Valid |
| GT-021 | normative | agent_inference | invalid | uncertain | False Valid |
| GT-025 | causal | paraphrase | invalid | valid | False Valid |
| GT-029 | normative | cross_source | invalid | uncertain | False Valid |
