# HERALD Experiment Analysis

**Run timestamp:** 2026-04-23T16:51:46.522Z
**Git commit:** `011305a`
**Eval set:** `data/genai-eval-set.json`
**Systems run:** A, B, C
**Total claims:** 100
**Tier 2 model:** gpt-4o-mini (input: $0.15/1M, output: $0.6/1M)
**Tier 3 model:** claude-haiku-4-5 (input: $0.8/1M, output: $4/1M)

## 1. Overall Accuracy

| Metric | System A (HERALD) | System B (Tier 2 only) | System C (No NLI) |
|--------|:-----------------:|:----------------------:|:-----------------:|
| Accuracy | 93.9% | 87.0% | 91.9% |
| Precision | 95.0% | 81.6% | 90.7% |
| Recall | 90.5% | 90.9% | 90.7% |
| F1 | 92.7% | 86.0% | 90.7% |
| False Invalid Rate | 3.6% | 16.1% | 7.1% |
| False Valid Rate | 9.5% | 9.1% | 9.3% |
| Eval Errors | 2 | 0 | 1 |

## 2. Per Claim Type

### causal (n=25)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 92.0% | 80.0% | 84.0% |
| F1 | 90.9% | 78.3% | 81.8% |
| False Invalid Rate | 7.1% | 21.4% | 14.3% |
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
| Accuracy | 88.9% | 90.9% | 90.0% |
| F1 | 88.9% | 92.3% | 90.9% |
| False Invalid Rate | 20.0% | 20.0% | 20.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### predictive (n=11)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 100.0% | 81.8% | 100.0% |
| F1 | 100.0% | 85.7% | 100.0% |
| False Invalid Rate | 0.0% | 40.0% | 0.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### statistical (n=23)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 95.7% | 87.0% | 95.7% |
| F1 | 94.7% | 87.0% | 95.2% |
| False Invalid Rate | 0.0% | 23.1% | 7.7% |
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
| Tier 2 | 92 | 92.0% |
| Tier 3 | 8 | 8.0% |
| Tier 4 | 0 | 0.0% |

## 4. Latency

| System | Mean (ms) | Median (ms) | p95 (ms) |
|--------|----------:|------------:|---------:|
| System A (HERALD) | 2333 | 2102 | 7593 |
| System B (Tier 2 only) | 2271 | 2251 | 3172 |
| System C (No NLI) | 2582 | 2194 | 6573 |

## 5. Cost Analysis

*Tier 2 model: gpt-4o-mini. Pricing: $0.15/1M input, $0.6/1M output.*
*Tier 3 model: claude-haiku-4-5 ($0.8/1M input, $4/1M output). Tier 3 costs are included when usage data is available.*

### 5.1 Token Usage per Claim (mean)

| System | Mean Input Tokens | Mean Output Tokens | Mean API Calls | Mean Cost/Claim |
|--------|------------------:|-------------------:|---------------:|----------------:|
| System A (HERALD) | 2092 | 199 | 1.2 | $0.0008 |
| System B (Tier 2 only) | 1714 | 130 | 1.0 | $0.0003 |
| System C (No NLI) | 1845 | 158 | 1.1 | $0.0006 |

### 5.2 Cost per Claim by Type

| Claim Type | System A Cost/Claim | System B Cost/Claim | System A API Calls | System B API Calls |
|------------|:-------------------:|:-------------------:|:-----------------:|:-----------------:|
| causal | $0.0012 | $0.0003 | 1.3 | 1.0 |
| comparative | $0.0008 | $0.0003 | 1.2 | 1.0 |
| normative | $0.0013 | $0.0003 | 1.4 | 1.0 |
| predictive | $0.0006 | $0.0003 | 1.1 | 1.0 |
| statistical | $0.0006 | $0.0003 | 1.1 | 1.0 |
| synthesis | $0.0004 | $0.0004 | 1.0 | 1.0 |

### 5.3 Accuracy per Dollar (F1 / mean cost per claim)

*Higher is better. Measures how much accuracy each dollar buys.*

| System | F1 | Mean Cost/Claim | F1 per Dollar |
|--------|:--:|----------------:|--------------:|
| System A (HERALD) | 92.7% | $0.0008 | 1158.5 |
| System B (Tier 2 only) | 86.0% | $0.0003 | 2867.3 |
| System C (No NLI) | 90.7% | $0.0006 | 1511.7 |

### 5.4 Cost at Scale (1,000 claims/day)

| System | Daily Cost | Monthly Cost (30d) |
|--------|:----------:|:-----------------:|
| System A (HERALD) | $0.80 | $24.00 |
| System B (Tier 2 only) | $0.30 | $9.00 |
| System C (No NLI) | $0.60 | $18.00 |

### 5.5 Decision: Cost-Performance Verdict

- **F1 delta (A − B):** 6.7%
- **Cost delta (A − B):** $0.0005 per claim (HERALD costs more)
- **F1/$ System A:** 1158.5 vs System B: 2867.3

⚠️ **HERALD wins on accuracy but not on cost-efficiency** — F1 is +6.7% higher but costs 166.7% more per claim. Worthwhile only if accuracy gains are critical.

### Does Tier 1 NLI contribute accuracy?

⚠️ **Marginal** — F1(A) ≈ F1(C) (delta: 2.0%). NLI adds infrastructure cost without clear accuracy gain.

## 6. Agreement: System A vs System B

Agreement rate: **89.0%** (89/100 claims)

**Disagreements (11 claims):**

| Claim ID | Type | Ground Truth | System A | System B | Winner |
|----------|------|:------------:|:--------:|:--------:|:------:|
| GT-118 | causal | valid | valid | invalid | A ✓ |
| GT-108 | statistical | valid | valid | invalid | A ✓ |
| GT-153 | statistical | valid | valid | invalid | A ✓ |
| GT-135 | statistical | invalid | valid | invalid | B ✓ |
| GT-127 | predictive | valid | valid | invalid | A ✓ |
| GT-016 | causal | invalid | invalid | valid | A ✓ |
| GT-013 | normative | invalid | uncertain | invalid | B ✓ |
| GT-149 | statistical | valid | valid | invalid | A ✓ |
| GT-018 | predictive | valid | valid | invalid | A ✓ |
| GT-152 | normative | invalid | uncertain | invalid | B ✓ |
| GT-030 | causal | valid | valid | invalid | A ✓ |

## 7. Wrong Claims

### System A — 8 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-135 | statistical | paraphrase | invalid | valid | False Valid |
| GT-113 | causal | paraphrase | valid | invalid | False Invalid |
| GT-023 | synthesis | cross_source | invalid | valid | False Valid |
| GT-013 | normative | agent_inference | invalid | uncertain | False Valid |
| GT-025 | causal | paraphrase | invalid | valid | False Valid |
| GT-034 | normative | paraphrase | valid | invalid | False Invalid |
| GT-042 | synthesis | cross_source | invalid | valid | False Valid |
| GT-152 | normative | agent_inference | invalid | uncertain | False Valid |

### System B — 13 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-118 | causal | paraphrase | valid | invalid | False Invalid |
| GT-108 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-153 | statistical | direct_extraction | valid | invalid | False Invalid |
| GT-113 | causal | paraphrase | valid | invalid | False Invalid |
| GT-127 | predictive | paraphrase | valid | invalid | False Invalid |
| GT-023 | synthesis | cross_source | invalid | valid | False Valid |
| GT-016 | causal | cross_source | invalid | valid | False Valid |
| GT-025 | causal | paraphrase | invalid | valid | False Valid |
| GT-149 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-034 | normative | paraphrase | valid | invalid | False Invalid |
| GT-042 | synthesis | cross_source | invalid | valid | False Valid |
| GT-018 | predictive | paraphrase | valid | invalid | False Invalid |
| GT-030 | causal | paraphrase | valid | invalid | False Invalid |

### System C — 9 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-118 | causal | paraphrase | valid | invalid | False Invalid |
| GT-153 | statistical | direct_extraction | valid | invalid | False Invalid |
| GT-023 | synthesis | cross_source | invalid | valid | False Valid |
| GT-016 | causal | cross_source | invalid | valid | False Valid |
| GT-013 | normative | agent_inference | invalid | uncertain | False Valid |
| GT-025 | causal | paraphrase | invalid | valid | False Valid |
| GT-034 | normative | paraphrase | valid | invalid | False Invalid |
| GT-042 | synthesis | cross_source | invalid | valid | False Valid |
| GT-030 | causal | paraphrase | valid | invalid | False Invalid |
