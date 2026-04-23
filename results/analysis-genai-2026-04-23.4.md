# HERALD Experiment Analysis

**Run timestamp:** 2026-04-23T15:11:01.361Z
**Git commit:** `4a1c725`
**Eval set:** `data/genai-eval-set.json`
**Systems run:** A, B, C
**Total claims:** 100
**Tier 2 model:** gpt-4o-mini (input: $0.15/1M, output: $0.6/1M)
**Tier 3 model:** claude-haiku-4-5 (input: $0.8/1M, output: $4/1M) — usage not tracked

## 1. Overall Accuracy

| Metric | System A (HERALD) | System B (Tier 2 only) | System C (No NLI) |
|--------|:-----------------:|:----------------------:|:-----------------:|
| Accuracy | 94.9% | 90.0% | 91.8% |
| Precision | 97.4% | 85.4% | 88.9% |
| Recall | 90.5% | 93.2% | 93.0% |
| F1 | 93.8% | 89.1% | 90.9% |
| False Invalid Rate | 1.8% | 12.5% | 9.1% |
| False Valid Rate | 9.5% | 6.8% | 7.0% |
| Eval Errors | 2 | 0 | 2 |

## 2. Per Claim Type

### causal (n=25)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 96.0% | 88.0% | 87.5% |
| F1 | 95.2% | 87.0% | 87.0% |
| False Invalid Rate | 0.0% | 14.3% | 15.4% |
| False Valid Rate | 9.1% | 9.1% | 9.1% |

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
| Accuracy | 100.0% | 90.9% | 90.9% |
| F1 | 100.0% | 92.3% | 92.3% |
| False Invalid Rate | 0.0% | 20.0% | 20.0% |
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
| Tier 2 | 91 | 91.0% |
| Tier 3 | 9 | 9.0% |
| Tier 4 | 0 | 0.0% |

## 4. Latency

| System | Mean (ms) | Median (ms) | p95 (ms) |
|--------|----------:|------------:|---------:|
| System A (HERALD) | 2770 | 2572 | 7892 |
| System B (Tier 2 only) | 2698 | 2630 | 3723 |
| System C (No NLI) | 3093 | 2621 | 7491 |

## 5. Cost Analysis

*Tier 2 model: gpt-4o-mini. Pricing: $0.15/1M input, $0.6/1M output.*
*Tier 3 model: claude-haiku-4-5 ($0.8/1M input, $4/1M output) — Tier 3 token usage is not tracked; cost stats reflect Tier 2 only.*

### 5.1 Token Usage per Claim (mean)

| System | Mean Input Tokens | Mean Output Tokens | Mean API Calls | Mean Cost/Claim |
|--------|------------------:|-------------------:|---------------:|----------------:|
| System A (HERALD) | 1812 | 134 | 1.0 | $0.0004 |
| System B (Tier 2 only) | 1714 | 129 | 1.0 | $0.0003 |
| System C (No NLI) | 1714 | 129 | 1.0 | $0.0003 |

### 5.2 Cost per Claim by Type

| Claim Type | System A Cost/Claim | System B Cost/Claim | System A API Calls | System B API Calls |
|------------|:-------------------:|:-------------------:|:-----------------:|:-----------------:|
| causal | $0.0004 | $0.0003 | 1.0 | 1.0 |
| comparative | $0.0003 | $0.0003 | 1.0 | 1.0 |
| normative | $0.0003 | $0.0003 | 1.0 | 1.0 |
| predictive | $0.0003 | $0.0003 | 1.0 | 1.0 |
| statistical | $0.0003 | $0.0003 | 1.0 | 1.0 |
| synthesis | $0.0004 | $0.0004 | 1.0 | 1.0 |

### 5.3 Accuracy per Dollar (F1 / mean cost per claim)

*Higher is better. Measures how much accuracy each dollar buys.*

| System | F1 | Mean Cost/Claim | F1 per Dollar |
|--------|:--:|----------------:|--------------:|
| System A (HERALD) | 93.8% | $0.0004 | 2345.8 |
| System B (Tier 2 only) | 89.1% | $0.0003 | 2971.0 |
| System C (No NLI) | 90.9% | $0.0003 | 3030.3 |

### 5.4 Cost at Scale (1,000 claims/day)

| System | Daily Cost | Monthly Cost (30d) |
|--------|:----------:|:-----------------:|
| System A (HERALD) | $0.40 | $12.00 |
| System B (Tier 2 only) | $0.30 | $9.00 |
| System C (No NLI) | $0.30 | $9.00 |

### 5.5 Decision: Cost-Performance Verdict

- **F1 delta (A − B):** 4.7%
- **Cost delta (A − B):** $0.0001 per claim (HERALD costs more)
- **F1/$ System A:** 2345.8 vs System B: 2971.0

⚠️ **HERALD wins on accuracy but not on cost-efficiency** — F1 is +4.7% higher but costs 33.3% more per claim. Worthwhile only if accuracy gains are critical.

### Does Tier 1 NLI contribute accuracy?

✅ **Yes** — F1(A) > F1(C) by 2.9%

## 6. Agreement: System A vs System B

Agreement rate: **91.0%** (91/100 claims)

**Disagreements (9 claims):**

| Claim ID | Type | Ground Truth | System A | System B | Winner |
|----------|------|:------------:|:--------:|:--------:|:------:|
| GT-149 | statistical | valid | valid | invalid | A ✓ |
| GT-018 | predictive | valid | valid | invalid | A ✓ |
| GT-030 | causal | valid | valid | invalid | A ✓ |
| GT-021 | normative | invalid | uncertain | invalid | B ✓ |
| GT-153 | statistical | valid | valid | invalid | A ✓ |
| GT-108 | statistical | valid | valid | invalid | A ✓ |
| GT-013 | normative | invalid | uncertain | invalid | B ✓ |
| GT-118 | causal | valid | valid | invalid | A ✓ |
| GT-135 | statistical | invalid | valid | invalid | B ✓ |

## 7. Wrong Claims

### System A — 7 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-042 | synthesis | cross_source | invalid | valid | False Valid |
| GT-025 | causal | paraphrase | invalid | valid | False Valid |
| GT-021 | normative | agent_inference | invalid | uncertain | False Valid |
| GT-034 | normative | paraphrase | valid | invalid | False Invalid |
| GT-023 | synthesis | cross_source | invalid | valid | False Valid |
| GT-013 | normative | agent_inference | invalid | uncertain | False Valid |
| GT-135 | statistical | paraphrase | invalid | valid | False Valid |

### System B — 10 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-149 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-042 | synthesis | cross_source | invalid | valid | False Valid |
| GT-025 | causal | paraphrase | invalid | valid | False Valid |
| GT-018 | predictive | paraphrase | valid | invalid | False Invalid |
| GT-030 | causal | paraphrase | valid | invalid | False Invalid |
| GT-034 | normative | paraphrase | valid | invalid | False Invalid |
| GT-153 | statistical | direct_extraction | valid | invalid | False Invalid |
| GT-108 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-023 | synthesis | cross_source | invalid | valid | False Valid |
| GT-118 | causal | paraphrase | valid | invalid | False Invalid |

### System C — 10 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-149 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-042 | synthesis | cross_source | invalid | valid | False Valid |
| GT-025 | causal | paraphrase | invalid | valid | False Valid |
| GT-018 | predictive | paraphrase | valid | invalid | False Invalid |
| GT-113 | causal | paraphrase | valid | invalid | False Invalid |
| GT-030 | causal | paraphrase | valid | uncertain | False Valid |
| GT-034 | normative | paraphrase | valid | invalid | False Invalid |
| GT-023 | synthesis | cross_source | invalid | valid | False Valid |
| GT-013 | normative | agent_inference | invalid | uncertain | False Valid |
| GT-118 | causal | paraphrase | valid | invalid | False Invalid |
