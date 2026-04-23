# HERALD Experiment — Final Report: GenAI Eval Set (5 Trials)

**Eval set:** `data/genai-eval-set.json`
**Trials:** 5 independent runs, same eval set (shuffled order each run)
**Claims per run:** 100
**Total claim evaluations:** 500 (166 per system)
**Tier 2 model:** gpt-4o-mini ($0.15/1M input, $0.6/1M output)
**Tier 3 model:** claude-haiku-4-5 ($0.8/1M input, $4/1M output) — usage not tracked
**Git commits:** 4a1c725

## 1. Per-Run Results

| Run | File | A Acc | A F1 | B Acc | B F1 | C Acc | C F1 |
|-----|------|------:|-----:|------:|-----:|------:|-----:|
| 1 | `experiment-genai-2026-04-23.1.json` | 93.9% | 92.9% | 90.0% | 88.9% | 91.9% | 90.7% |
| 2 | `experiment-genai-2026-04-23.2.json` | 94.9% | 94.0% | 90.0% | 89.1% | 89.9% | 88.6% |
| 3 | `experiment-genai-2026-04-23.3.json` | 94.8% | 93.7% | 89.0% | 87.9% | 91.8% | 90.7% |
| 4 | `experiment-genai-2026-04-23.4.json` | 94.9% | 93.8% | 90.0% | 89.1% | 91.8% | 90.9% |
| 5 | `experiment-genai-2026-04-23.5.json` | 94.9% | 93.8% | 90.0% | 88.9% | 92.9% | 92.0% |

## 2. Overall Accuracy

### 2.1 Mean ± Std Across 5 Runs

| Metric | System A (HERALD) | System B (Tier 2 only) | System C (No NLI) |
|--------|:-----------------:|:----------------------:|:-----------------:|
| Accuracy | 94.7% ± 0.4% | 89.8% ± 0.4% | 91.7% ± 1.0% |
| Precision | 97.0% ± 0.9% | 86.0% ± 0.8% | 89.6% ± 1.6% |
| Recall | 90.5% ± 0.2% | 91.8% ± 1.1% | 91.6% ± 1.1% |
| F1 | 93.6% ± 0.4% | 88.8% ± 0.5% | 90.6% ± 1.1% |
| False Invalid Rate | 2.1% ± 0.7% | 11.8% ± 0.9% | 8.3% ± 1.4% |
| False Valid Rate | 9.5% ± 0.2% | 8.2% ± 1.1% | 8.4% ± 1.1% |

### 2.2 Pooled Metrics (500 claim evaluations per system)

| Metric | System A (HERALD) | System B (Tier 2 only) | System C (No NLI) |
|--------|:-----------------:|:----------------------:|:-----------------:|
| Accuracy | 94.7% | 89.8% | 91.7% |
| Precision | 97.0% | 86.0% | 89.5% |
| Recall | 90.5% | 91.8% | 91.6% |
| F1 | 93.6% | 88.8% | 90.6% |
| False Invalid Rate | 2.2% | 11.8% | 8.3% |
| False Valid Rate | 9.5% | 8.2% | 8.4% |
| Eval Errors | 10 | 0 | 8 |

## 3. Per Claim Type (Pooled)

### causal (n=25 per run, 125 total evaluations)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 95.2% | 85.6% | 86.1% |
| F1 | 94.3% | 83.9% | 84.7% |
| False Invalid Rate | 1.4% | 14.3% | 13.4% |
| False Valid Rate | 9.1% | 14.5% | 14.5% |

### comparative (n=18 per run, 90 total evaluations)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 100.0% | 100.0% | 100.0% |
| F1 | 100.0% | 100.0% | 100.0% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### normative (n=11 per run, 55 total evaluations)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 89.1% | 90.9% | 90.0% |
| F1 | 89.4% | 92.3% | 90.9% |
| False Invalid Rate | 20.0% | 20.0% | 20.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### predictive (n=11 per run, 55 total evaluations)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 100.0% | 90.9% | 98.2% |
| F1 | 100.0% | 92.3% | 98.4% |
| False Invalid Rate | 0.0% | 20.0% | 4.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### statistical (n=23 per run, 115 total evaluations)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 95.7% | 88.7% | 93.0% |
| F1 | 94.7% | 88.5% | 92.6% |
| False Invalid Rate | 0.0% | 20.0% | 12.3% |
| False Valid Rate | 10.0% | 0.0% | 0.0% |

### synthesis (n=12 per run, 60 total evaluations)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 83.3% | 83.3% | 83.3% |
| F1 | 50.0% | 50.0% | 50.0% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 66.7% | 66.7% | 66.7% |

## 4. Tier Distribution (Pooled, Systems A and C)

**System A** (500 total evaluations)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 1 | 180 | 36.0% |
| Tier 2 | 270 | 54.0% |
| Tier 3 | 50 | 10.0% |
| Tier 4 | 0 | 0.0% |

**System C** (500 total evaluations)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 1 | 0 | 0.0% |
| Tier 2 | 455 | 91.0% |
| Tier 3 | 45 | 9.0% |
| Tier 4 | 0 | 0.0% |

## 5. Latency (Pooled)

| System | Mean (ms) | Median (ms) | p95 (ms) |
|--------|----------:|------------:|---------:|
| System A (HERALD) | 2595 | 2449 | 7582 |
| System B (Tier 2 only) | 2598 | 2490 | 3978 |
| System C (No NLI) | 3033 | 2640 | 6703 |

## 6. Cost Analysis (Tier 2 Tokens Only)

*gpt-4o-mini: $0.15/1M input, $0.6/1M output.*
*Tier 3 (claude-haiku-4-5) usage not tracked — costs are understated for claims reaching Tier 3.*

### 6.1 Mean Token Usage per Claim

| System | Mean Input Tokens | Mean Output Tokens | Mean API Calls | Mean Cost/Claim |
|--------|------------------:|-------------------:|---------------:|----------------:|
| System A (HERALD) | 1812 | 135 | 1.0 | $0.3530m |
| System B (Tier 2 only) | 1714 | 129 | 1.0 | $0.3350m |
| System C (No NLI) | 1714 | 130 | 1.0 | $0.3350m |

### 6.2 F1 per Dollar

*Higher is better.*

| System | Pooled F1 | Mean Cost/Claim | F1/$ |
|--------|:---------:|----------------:|-----:|
| System A (HERALD) | 93.6% | $0.3530m | 2652 |
| System B (Tier 2 only) | 88.8% | $0.3350m | 2650 |
| System C (No NLI) | 90.6% | $0.3350m | 2704 |

### 6.3 Cost at Scale (1,000 claims/day)

| System | Daily Cost | Monthly Cost (30d) |
|--------|:----------:|:-----------------:|
| System A (HERALD) | $0.35 | $10.59 |
| System B (Tier 2 only) | $0.34 | $10.05 |
| System C (No NLI) | $0.34 | $10.05 |

### 6.4 Cost-Performance Verdict

- **F1 delta A − B:** +4.8%
- **Cost delta A − B:** $0.0180m per claim (HERALD costs more)
- **F1/$ — System A:** 2652 vs System B: 2650

✅ **HERALD wins on both axes** — higher F1 (+4.8%) AND better F1/$.

### Does Tier 1 NLI contribute?

✅ **Yes** — F1(A) > F1(C) by 3.1%. NLI contradiction detection and paraphrase handling are contributing.

## 7. Agreement: System A vs System B (Pooled)

Agreement rate: **90.6%** (453/500 evaluations)

**Disagreements (47 evaluations across 5 runs):**

| Claim ID | Type | Ground Truth | System A | System B | Winner |
|----------|------|:------------:|:--------:|:--------:|:------:|
| GT-013 | normative | invalid | uncertain | invalid | B ✓ |
| GT-016 | causal | invalid | invalid | valid | A ✓ |
| GT-018 | predictive | valid | valid | invalid | A ✓ |
| GT-021 | normative | invalid | uncertain | invalid | B ✓ |
| GT-029 | normative | invalid | uncertain | invalid | B ✓ |
| GT-030 | causal | valid | valid | invalid | A ✓ |
| GT-108 | statistical | valid | valid | invalid | A ✓ |
| GT-111 | causal | valid | uncertain | valid | B ✓ |
| GT-118 | causal | valid | valid | invalid | A ✓ |
| GT-135 | statistical | invalid | valid | invalid | B ✓ |
| GT-149 | statistical | valid | valid | invalid | A ✓ |
| GT-151 | causal | valid | invalid | valid | B ✓ |
| GT-153 | statistical | valid | valid | invalid | A ✓ |

## 8. Wrong Claims (Pooled)

### System A — 36 wrong evaluations across 5 runs (10 unique claims)

| Claim | Type | Derivation | GT | Predicted | Runs Wrong |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-135 | statistical | paraphrase | invalid | valid | 5/5 | False Valid |
| GT-023 | synthesis | cross_source | invalid | valid | 5/5 | False Valid |
| GT-034 | normative | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-042 | synthesis | cross_source | invalid | valid | 5/5 | False Valid |
| GT-025 | causal | paraphrase | invalid | valid | 5/5 | False Valid |
| GT-013 | normative | agent_inference | invalid | uncertain | 5/5 | False Valid |
| GT-021 | normative | agent_inference | invalid | uncertain | 3/5 | False Valid |
| GT-151 | causal | paraphrase | valid | invalid | 1/5 | False Invalid |
| GT-111 | causal | paraphrase | valid | uncertain | 1/5 | False Valid |
| GT-029 | normative | cross_source | invalid | uncertain | 1/5 | False Valid |

### System B — 51 wrong evaluations across 5 runs (11 unique claims)

| Claim | Type | Derivation | GT | Predicted | Runs Wrong |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-030 | causal | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-149 | statistical | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-023 | synthesis | cross_source | invalid | valid | 5/5 | False Valid |
| GT-018 | predictive | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-118 | causal | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-034 | normative | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-042 | synthesis | cross_source | invalid | valid | 5/5 | False Valid |
| GT-153 | statistical | direct_extraction | valid | invalid | 5/5 | False Invalid |
| GT-025 | causal | paraphrase | invalid | valid | 5/5 | False Valid |
| GT-016 | causal | cross_source | invalid | valid | 3/5 | False Valid |
| GT-108 | statistical | paraphrase | valid | invalid | 3/5 | False Invalid |

### System C — 49 wrong evaluations across 5 runs (12 unique claims)

| Claim | Type | Derivation | GT | Predicted | Runs Wrong |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-030 | causal | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-149 | statistical | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-023 | synthesis | cross_source | invalid | valid | 5/5 | False Valid |
| GT-118 | causal | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-034 | normative | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-042 | synthesis | cross_source | invalid | valid | 5/5 | False Valid |
| GT-025 | causal | paraphrase | invalid | valid | 5/5 | False Valid |
| GT-013 | normative | agent_inference | invalid | uncertain | 5/5 | False Valid |
| GT-016 | causal | cross_source | invalid | valid | 3/5 | False Valid |
| GT-153 | statistical | direct_extraction | valid | invalid | 3/5 | False Invalid |
| GT-113 | causal | paraphrase | valid | invalid | 2/5 | False Invalid |
| GT-018 | predictive | paraphrase | valid | invalid | 1/5 | False Invalid |
