# HERALD Experiment — Final Report: GenAI-Generated Eval Set (5 Trials)

**Eval set:** `data/genai-eval-set.json`
**Trials:** 5 independent runs, same eval set (shuffled order each run)
**Claims per run:** 100
**Total claim evaluations:** 166 per system (500 total)
**Tier 2 model:** gpt-4o-mini ($0.15/1M input, $0.6/1M output)
**Tier 3 model:** claude-haiku-4-5 ($0.8/1M input, $4/1M output)
**Cost tracking:** Full — Tier 2 (gpt-4o-mini) + Tier 3 (claude-haiku-4-5) per-tier pricing applied
**Git commits:** 011305a

## 1. Per-Run Results

| Run | File | A Acc | A F1 | A Cost | B Acc | B F1 | B Cost | C Acc | C F1 | C Cost |
|-----|------|------:|-----:|-------:|------:|-----:|-------:|------:|-----:|-------:|
| 1 | `experiment-genai2-2026-04-23.1.json` | 94.9% | 93.8% | $0.0007 | 90.0% | 89.1% | $0.0003 | 91.8% | 90.7% | $0.0006 |
| 2 | `experiment-genai2-2026-04-23.2.json` | 94.9% | 93.8% | $0.0009 | 88.0% | 87.2% | $0.0003 | 90.9% | 89.7% | $0.0005 |
| 3 | `experiment-genai2-2026-04-23.3.json` | 94.8% | 93.8% | $0.0009 | 89.0% | 87.9% | $0.0003 | 91.8% | 90.7% | $0.0006 |
| 4 | `experiment-genai2-2026-04-23.4.json` | 93.9% | 92.7% | $0.0008 | 87.0% | 86.0% | $0.0003 | 91.9% | 90.7% | $0.0006 |
| 5 | `experiment-genai2-2026-04-23.5.json` | 95.0% | 94.1% | $0.0008 | 89.0% | 87.9% | $0.0003 | 91.7% | 90.2% | $0.0006 |

## 2. Overall Accuracy

### 2.1 Mean ± Std Across 5 Runs

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| Accuracy | 94.7% ± 0.4% | 88.6% ± 1.0% | 91.6% ± 0.4% |
| Precision | 97.0% ± 1.0% | 83.9% ± 1.7% | 89.8% ± 1.0% |
| Recall | 90.6% ± 0.2% | 91.8% ± 1.1% | 91.0% ± 0.9% |
| F1 | 93.7% ± 0.5% | 87.6% ± 1.0% | 90.4% ± 0.4% |
| False Invalid Rate | 2.1% ± 0.7% | 13.9% ± 1.7% | 7.9% ± 0.9% |
| False Valid Rate | 9.4% ± 0.2% | 8.2% ± 1.1% | 9.0% ± 0.9% |

### 2.2 Pooled Metrics (500 claim evaluations per system)

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| Accuracy | 94.7% | 88.6% | 91.6% |
| Precision | 97.0% | 83.8% | 89.8% |
| Recall | 90.6% | 91.8% | 91.0% |
| F1 | 93.7% | 87.6% | 90.4% |
| False Invalid Rate | 2.2% | 13.9% | 7.9% |
| False Valid Rate | 9.4% | 8.2% | 9.0% |
| Eval Errors | 9 | 0 | 11 |

## 3. Per Claim Type (Pooled)

### causal (n=25 per run, 125 total evaluations)

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| Accuracy | 95.2% | 84.0% | 86.9% |
| F1 | 94.3% | 82.5% | 85.2% |
| False Invalid Rate | 1.4% | 17.1% | 10.4% |
| False Valid Rate | 9.1% | 14.5% | 16.4% |

### comparative (n=18 per run, 90 total evaluations)

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| Accuracy | 100.0% | 100.0% | 100.0% |
| F1 | 100.0% | 100.0% | 100.0% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### normative (n=11 per run, 55 total evaluations)

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| Accuracy | 89.4% | 90.9% | 89.4% |
| F1 | 89.8% | 92.3% | 89.8% |
| False Invalid Rate | 20.0% | 20.0% | 20.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### predictive (n=11 per run, 55 total evaluations)

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| Accuracy | 100.0% | 87.3% | 100.0% |
| F1 | 100.0% | 89.6% | 100.0% |
| False Invalid Rate | 0.0% | 28.0% | 0.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### statistical (n=23 per run, 115 total evaluations)

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| Accuracy | 95.7% | 87.0% | 91.3% |
| F1 | 94.7% | 87.0% | 90.9% |
| False Invalid Rate | 0.0% | 23.1% | 15.4% |
| False Valid Rate | 10.0% | 0.0% | 0.0% |

### synthesis (n=12 per run, 60 total evaluations)

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| Accuracy | 83.3% | 83.3% | 83.3% |
| F1 | 50.0% | 50.0% | 50.0% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 66.7% | 66.7% | 66.7% |

## 4. Tier Distribution (Pooled)

**Full HERALD** (500 total evaluations)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 1 | 180 | 36.0% |
| Tier 2 | 266 | 53.2% |
| Tier 3 | 54 | 10.8% |
| Tier 4 | 0 | 0.0% |

**No-NLI Ablation** (500 total evaluations)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 1 | 0 | 0.0% |
| Tier 2 | 457 | 91.4% |
| Tier 3 | 43 | 8.6% |
| Tier 4 | 0 | 0.0% |

## 5. Latency (Pooled)

| System | Mean (ms) | Median (ms) | p95 (ms) |
|--------|----------:|------------:|---------:|
| Full HERALD | 2382 | 2125 | 7275 |
| Single LLM Judge | 2342 | 2238 | 3453 |
| No-NLI Ablation | 2623 | 2239 | 6245 |

## 6. Cost Analysis

*gpt-4o-mini: $0.15/1M input, $0.6/1M output.*
*claude-haiku-4-5: $0.8/1M input, $4/1M output. Per-tier pricing applied.*

### 6.1 Mean Token Usage per Claim

| System | T2 Input | T2 Output | T3 Input | T3 Output | API Calls | Cost/Claim |
|--------|----------:|----------:|---------:|---------:|----------:|-----------:|
| Full HERALD | 1812 | 136 | 275 | 65 | 1.2 | $0.0008 |
| Single LLM Judge | 1714 | 130 | 0 | 0 | 1.0 | $0.0003 |
| No-NLI Ablation | 1714 | 129 | 141 | 31 | 1.1 | $0.0006 |

### 6.2 F1 per Dollar

| System | Pooled F1 | Cost/Claim | F1/$ |
|--------|:---------:|-----------:|-----:|
| Full HERALD | 93.7% | $0.0008 | 1124 |
| Single LLM Judge | 87.6% | $0.0003 | 2616 |
| No-NLI Ablation | 90.4% | $0.0006 | 1580 |

### 6.3 Cost at Scale (1,000 claims/day)

| System | Daily Cost | Monthly Cost (30d) |
|--------|:----------:|:-----------------:|
| Full HERALD | $0.83 | $24.99 |
| Single LLM Judge | $0.34 | $10.05 |
| No-NLI Ablation | $0.57 | $17.16 |

### 6.4 Cost-Performance Verdict

- **F1 delta (HERALD − Judge):** +6.0pp
- **Cost delta (HERALD − Judge):** $0.0005 per claim (HERALD costs more)
- **F1/$ — Full HERALD:** 1124 vs Single LLM Judge: 2616

⚠️ **HERALD wins on accuracy** (+6.0pp F1) but costs $0.0005 more per claim. Use when accuracy is critical.

### Does Tier 1 NLI contribute?

✅ **Yes** — F1(HERALD) > F1(No-NLI) by 3.3pp. NLI contradiction detection and paraphrase handling reduce false invalids.

## 7. Agreement: Full HERALD vs Single LLM Judge (Pooled)

Agreement rate: **90.0%** (450/500 evaluations)

**Disagreements (50 evaluations):**

| Claim ID | Type | Ground Truth | Full HERALD | Single LLM Judge | Winner |
|----------|------|:------------:|:-----------:|:----------------:|:------:|
| GT-013 | normative | invalid | uncertain | invalid | Judge ✓ |
| GT-016 | causal | invalid | invalid | valid | HERALD ✓ |
| GT-018 | predictive | valid | valid | invalid | HERALD ✓ |
| GT-021 | normative | invalid | uncertain | invalid | Judge ✓ |
| GT-030 | causal | valid | valid | invalid | HERALD ✓ |
| GT-108 | statistical | valid | valid | invalid | HERALD ✓ |
| GT-111 | causal | valid | uncertain | valid | Judge ✓ |
| GT-111 | causal | valid | valid | invalid | HERALD ✓ |
| GT-118 | causal | valid | valid | invalid | HERALD ✓ |
| GT-127 | predictive | valid | valid | invalid | HERALD ✓ |
| GT-135 | statistical | invalid | valid | invalid | Judge ✓ |
| GT-149 | statistical | valid | valid | invalid | HERALD ✓ |
| GT-152 | normative | invalid | uncertain | invalid | Judge ✓ |
| GT-153 | statistical | valid | valid | invalid | HERALD ✓ |

## 8. Wrong Claims (Pooled)

### Full HERALD — 35 wrong evaluations (10 unique claims)

| Claim | Type | Derivation | GT | Predicted | Runs Wrong | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|:----------:|
| GT-042 | synthesis | cross_source | invalid | valid | 5/5 | False Valid |
| GT-034 | normative | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-025 | causal | paraphrase | invalid | valid | 5/5 | False Valid |
| GT-023 | synthesis | cross_source | invalid | valid | 5/5 | False Valid |
| GT-135 | statistical | paraphrase | invalid | valid | 5/5 | False Valid |
| GT-013 | normative | agent_inference | invalid | uncertain | 4/5 | False Valid |
| GT-021 | normative | agent_inference | invalid | uncertain | 3/5 | False Valid |
| GT-111 | causal | paraphrase | valid | uncertain | 1/5 | False Valid |
| GT-113 | causal | paraphrase | valid | invalid | 1/5 | False Invalid |
| GT-152 | normative | agent_inference | invalid | uncertain | 1/5 | False Valid |

### Single LLM Judge — 57 wrong evaluations (14 unique claims)

| Claim | Type | Derivation | GT | Predicted | Runs Wrong | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|:----------:|
| GT-108 | statistical | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-042 | synthesis | cross_source | invalid | valid | 5/5 | False Valid |
| GT-118 | causal | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-034 | normative | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-025 | causal | paraphrase | invalid | valid | 5/5 | False Valid |
| GT-153 | statistical | direct_extraction | valid | invalid | 5/5 | False Invalid |
| GT-023 | synthesis | cross_source | invalid | valid | 5/5 | False Valid |
| GT-149 | statistical | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-030 | causal | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-018 | predictive | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-016 | causal | cross_source | invalid | valid | 3/5 | False Valid |
| GT-127 | predictive | paraphrase | valid | invalid | 2/5 | False Invalid |
| GT-111 | causal | paraphrase | valid | invalid | 1/5 | False Invalid |
| GT-113 | causal | paraphrase | valid | invalid | 1/5 | False Invalid |

### No-NLI Ablation — 52 wrong evaluations (13 unique claims)

| Claim | Type | Derivation | GT | Predicted | Runs Wrong | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|:----------:|
| GT-042 | synthesis | cross_source | invalid | valid | 5/5 | False Valid |
| GT-118 | causal | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-034 | normative | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-025 | causal | paraphrase | invalid | valid | 5/5 | False Valid |
| GT-153 | statistical | direct_extraction | valid | invalid | 5/5 | False Invalid |
| GT-023 | synthesis | cross_source | invalid | valid | 5/5 | False Valid |
| GT-030 | causal | paraphrase | valid | uncertain | 5/5 | False Valid |
| GT-013 | normative | agent_inference | invalid | uncertain | 5/5 | False Valid |
| GT-149 | statistical | paraphrase | valid | invalid | 4/5 | False Invalid |
| GT-016 | causal | cross_source | invalid | valid | 4/5 | False Valid |
| GT-021 | normative | agent_inference | invalid | uncertain | 2/5 | False Valid |
| GT-108 | statistical | paraphrase | valid | invalid | 1/5 | False Invalid |
| GT-029 | normative | cross_source | invalid | uncertain | 1/5 | False Valid |
