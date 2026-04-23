# HERALD Experiment Analysis

**Run timestamp:** 2026-04-23T15:24:54.070Z
**Git commit:** `4a1c725`
**Eval set:** `data/genai-eval-set.json`
**Systems run:** A, B, C
**Total claims:** 100
**Tier 2 model:** gpt-4o-mini (input: $0.15/1M, output: $0.6/1M)
**Tier 3 model:** claude-haiku-4-5 (input: $0.8/1M, output: $4/1M) — usage not tracked

## 1. Overall Accuracy

| Metric | System A (HERALD) | System B (Tier 2 only) | System C (No NLI) |
|--------|:-----------------:|:----------------------:|:-----------------:|
| Accuracy | 94.9% | 90.0% | 92.9% |
| Precision | 97.4% | 87.0% | 90.9% |
| Recall | 90.5% | 90.9% | 93.0% |
| F1 | 93.8% | 88.9% | 92.0% |
| False Invalid Rate | 1.8% | 10.7% | 7.3% |
| False Valid Rate | 9.5% | 9.1% | 7.0% |
| Eval Errors | 2 | 0 | 2 |

## 2. Per Claim Type

### causal (n=25)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 96.0% | 84.0% | 91.7% |
| F1 | 95.2% | 81.8% | 90.9% |
| False Invalid Rate | 0.0% | 14.3% | 7.7% |
| False Valid Rate | 9.1% | 18.2% | 9.1% |

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
| Accuracy | 100.0% | 90.9% | 100.0% |
| F1 | 100.0% | 92.3% | 100.0% |
| False Invalid Rate | 0.0% | 20.0% | 0.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### statistical (n=23)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 95.7% | 91.3% | 91.3% |
| F1 | 94.7% | 90.9% | 90.9% |
| False Invalid Rate | 0.0% | 15.4% | 15.4% |
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
| Tier 2 | 54 | 54.0% |
| Tier 3 | 10 | 10.0% |
| Tier 4 | 0 | 0.0% |

**System C** (100 claims)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 1 | 0 | 0.0% |
| Tier 2 | 89 | 89.0% |
| Tier 3 | 11 | 11.0% |
| Tier 4 | 0 | 0.0% |

## 4. Latency

| System | Mean (ms) | Median (ms) | p95 (ms) |
|--------|----------:|------------:|---------:|
| System A (HERALD) | 2343 | 1843 | 6656 |
| System B (Tier 2 only) | 2299 | 2152 | 4159 |
| System C (No NLI) | 2863 | 2533 | 6336 |

## 5. Cost Analysis

*Tier 2 model: gpt-4o-mini. Pricing: $0.15/1M input, $0.6/1M output.*
*Tier 3 model: claude-haiku-4-5 ($0.8/1M input, $4/1M output) — Tier 3 token usage is not tracked; cost stats reflect Tier 2 only.*

### 5.1 Token Usage per Claim (mean)

| System | Mean Input Tokens | Mean Output Tokens | Mean API Calls | Mean Cost/Claim |
|--------|------------------:|-------------------:|---------------:|----------------:|
| System A (HERALD) | 1812 | 137 | 1.0 | $0.0004 |
| System B (Tier 2 only) | 1714 | 128 | 1.0 | $0.0003 |
| System C (No NLI) | 1714 | 130 | 1.0 | $0.0003 |

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
| System B (Tier 2 only) | 88.9% | $0.0003 | 2963.0 |
| System C (No NLI) | 92.0% | $0.0003 | 3065.0 |

### 5.4 Cost at Scale (1,000 claims/day)

| System | Daily Cost | Monthly Cost (30d) |
|--------|:----------:|:-----------------:|
| System A (HERALD) | $0.40 | $12.00 |
| System B (Tier 2 only) | $0.30 | $9.00 |
| System C (No NLI) | $0.30 | $9.00 |

### 5.5 Decision: Cost-Performance Verdict

- **F1 delta (A − B):** 4.9%
- **Cost delta (A − B):** $0.0001 per claim (HERALD costs more)
- **F1/$ System A:** 2345.8 vs System B: 2963.0

⚠️ **HERALD wins on accuracy but not on cost-efficiency** — F1 is +4.9% higher but costs 33.3% more per claim. Worthwhile only if accuracy gains are critical.

### Does Tier 1 NLI contribute accuracy?

⚠️ **Marginal** — F1(A) ≈ F1(C) (delta: 1.9%). NLI adds infrastructure cost without clear accuracy gain.

## 6. Agreement: System A vs System B

Agreement rate: **91.0%** (91/100 claims)

**Disagreements (9 claims):**

| Claim ID | Type | Ground Truth | System A | System B | Winner |
|----------|------|:------------:|:--------:|:--------:|:------:|
| GT-021 | normative | invalid | uncertain | invalid | B ✓ |
| GT-135 | statistical | invalid | valid | invalid | B ✓ |
| GT-030 | causal | valid | valid | invalid | A ✓ |
| GT-013 | normative | invalid | uncertain | invalid | B ✓ |
| GT-118 | causal | valid | valid | invalid | A ✓ |
| GT-149 | statistical | valid | valid | invalid | A ✓ |
| GT-018 | predictive | valid | valid | invalid | A ✓ |
| GT-016 | causal | invalid | invalid | valid | A ✓ |
| GT-153 | statistical | valid | valid | invalid | A ✓ |

## 7. Wrong Claims

### System A — 7 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-021 | normative | agent_inference | invalid | uncertain | False Valid |
| GT-034 | normative | paraphrase | valid | invalid | False Invalid |
| GT-135 | statistical | paraphrase | invalid | valid | False Valid |
| GT-023 | synthesis | cross_source | invalid | valid | False Valid |
| GT-013 | normative | agent_inference | invalid | uncertain | False Valid |
| GT-025 | causal | paraphrase | invalid | valid | False Valid |
| GT-042 | synthesis | cross_source | invalid | valid | False Valid |

### System B — 10 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-034 | normative | paraphrase | valid | invalid | False Invalid |
| GT-023 | synthesis | cross_source | invalid | valid | False Valid |
| GT-030 | causal | paraphrase | valid | invalid | False Invalid |
| GT-118 | causal | paraphrase | valid | invalid | False Invalid |
| GT-149 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-025 | causal | paraphrase | invalid | valid | False Valid |
| GT-018 | predictive | paraphrase | valid | invalid | False Invalid |
| GT-042 | synthesis | cross_source | invalid | valid | False Valid |
| GT-016 | causal | cross_source | invalid | valid | False Valid |
| GT-153 | statistical | direct_extraction | valid | invalid | False Invalid |

### System C — 9 wrong

| Claim | Type | Derivation | GT | Predicted | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-034 | normative | paraphrase | valid | invalid | False Invalid |
| GT-023 | synthesis | cross_source | invalid | valid | False Valid |
| GT-030 | causal | paraphrase | valid | uncertain | False Valid |
| GT-013 | normative | agent_inference | invalid | uncertain | False Valid |
| GT-118 | causal | paraphrase | valid | invalid | False Invalid |
| GT-149 | statistical | paraphrase | valid | invalid | False Invalid |
| GT-025 | causal | paraphrase | invalid | valid | False Valid |
| GT-042 | synthesis | cross_source | invalid | valid | False Valid |
| GT-153 | statistical | direct_extraction | valid | invalid | False Invalid |
