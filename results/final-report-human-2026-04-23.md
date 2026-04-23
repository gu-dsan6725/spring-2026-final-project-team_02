# HERALD Experiment — Final Report: Human-Authored Eval Set (5 Trials)

**Eval set:** `data/human-eval-set.json`
**Trials:** 5 independent runs, same eval set (shuffled order each run)
**Claims per run:** 52 (52 after skipping 1 invalid entry)
**Total claim evaluations:** 86 per system (260 total)
**Tier 2 model:** gpt-4o-mini ($0.15/1M input, $0.6/1M output)
**Tier 3 model:** claude-haiku-4-5 ($0.8/1M input, $4/1M output)
**Git commits:** 011305a

## 1. Per-Run Results

| Run | File | A Acc | A F1 | A Cost | B Acc | B F1 | B Cost | C Acc | C F1 | C Cost |
|-----|------|------:|-----:|-------:|------:|-----:|-------:|------:|-----:|-------:|
| 1 | `experiment-human-2026-04-23.1.json` | 84.6% | 81.8% | $0.0007 | 86.5% | 82.9% | $0.0003 | 84.6% | 81.0% | $0.0005 |
| 2 | `experiment-human-2026-04-23.2.json` | 84.6% | 81.8% | $0.0004 | 84.6% | 81.0% | $0.0003 | 84.6% | 81.0% | $0.0005 |
| 3 | `experiment-human-2026-04-23.3.json` | 84.6% | 81.8% | $0.0006 | 86.5% | 82.9% | $0.0003 | 84.6% | 81.0% | $0.0004 |
| 4 | `experiment-human-2026-04-23.4.json` | 84.6% | 81.8% | $0.0007 | 84.6% | 81.0% | $0.0003 | 84.6% | 81.0% | $0.0005 |
| 5 | `experiment-human-2026-04-23.5.json` | 84.6% | 81.8% | $0.0006 | 82.7% | 79.1% | $0.0003 | 84.6% | 81.0% | $0.0005 |

## 2. Overall Accuracy

### 2.1 Mean ± Std Across 5 Runs

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| Accuracy | 84.6% ± 0.0% | 85.0% ± 1.4% | 84.6% ± 0.0% |
| Precision | 81.8% ± 0.0% | 86.0% ± 3.2% | 85.0% ± 0.0% |
| Recall | 81.8% ± 0.0% | 77.3% ± 0.0% | 77.3% ± 0.0% |
| F1 | 81.8% ± 0.0% | 81.4% ± 1.4% | 81.0% ± 0.0% |
| False Invalid Rate | 13.3% ± 0.0% | 9.3% ± 2.5% | 10.0% ± 0.0% |
| False Valid Rate | 18.2% ± 0.0% | 22.7% ± 0.0% | 22.7% ± 0.0% |

### 2.2 Pooled Metrics (260 claim evaluations per system)

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| Accuracy | 84.6% | 85.0% | 84.6% |
| Precision | 81.8% | 85.9% | 85.0% |
| Recall | 81.8% | 77.3% | 77.3% |
| F1 | 81.8% | 81.3% | 81.0% |
| False Invalid Rate | 13.3% | 9.3% | 10.0% |
| False Valid Rate | 18.2% | 22.7% | 22.7% |
| Eval Errors | 0 | 0 | 0 |

## 3. Per Claim Type (Pooled)

### causal (n=12 per run, 60 total evaluations)

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| Accuracy | 91.7% | 91.7% | 91.7% |
| F1 | 88.9% | 88.9% | 88.9% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 20.0% | 20.0% | 20.0% |

### comparative (n=12 per run, 60 total evaluations)

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| Accuracy | 83.3% | 85.0% | 83.3% |
| F1 | 75.0% | 76.9% | 75.0% |
| False Invalid Rate | 22.2% | 20.0% | 22.2% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### normative (n=2 per run, 10 total evaluations)

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| Accuracy | 100.0% | 100.0% | 100.0% |
| F1 | 0.0% | 0.0% | 0.0% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### predictive (n=2 per run, 10 total evaluations)

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| Accuracy | 100.0% | 100.0% | 100.0% |
| F1 | 100.0% | 100.0% | 100.0% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### statistical (n=17 per run, 85 total evaluations)

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| Accuracy | 82.4% | 82.4% | 82.4% |
| F1 | 85.7% | 84.2% | 84.2% |
| False Invalid Rate | 28.6% | 14.3% | 14.3% |
| False Valid Rate | 10.0% | 20.0% | 20.0% |

### synthesis (n=7 per run, 35 total evaluations)

| Metric | Full HERALD | Single LLM Judge | No-NLI Ablation |
|--------|:-----------:|:----------------:|:---------------:|
| Accuracy | 71.4% | 71.4% | 71.4% |
| F1 | 50.0% | 50.0% | 50.0% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 66.7% | 66.7% | 66.7% |

## 4. Tier Distribution (Pooled)

**Full HERALD** (260 total evaluations)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 1 | 120 | 46.2% |
| Tier 2 | 129 | 49.6% |
| Tier 3 | 11 | 4.2% |
| Tier 4 | 0 | 0.0% |

**No-NLI Ablation** (260 total evaluations)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 1 | 0 | 0.0% |
| Tier 2 | 247 | 95.0% |
| Tier 3 | 13 | 5.0% |
| Tier 4 | 0 | 0.0% |

## 5. Latency (Pooled)

| System | Mean (ms) | Median (ms) | p95 (ms) |
|--------|----------:|------------:|---------:|
| Full HERALD | 1869 | 1798 | 5035 |
| Single LLM Judge | 2286 | 2215 | 3369 |
| No-NLI Ablation | 2501 | 2173 | 5616 |

## 6. Cost Analysis

*gpt-4o-mini: $0.15/1M input, $0.6/1M output.*
*claude-haiku-4-5: $0.8/1M input, $4/1M output. Per-tier pricing applied.*

### 6.1 Mean Token Usage per Claim

| System | T2 Input | T2 Output | T3 Input | T3 Output | API Calls | Cost/Claim |
|--------|----------:|----------:|---------:|---------:|----------:|-----------:|
| Full HERALD | 1836 | 131 | 130 | 31 | 1.1 | $0.0006 |
| Single LLM Judge | 1710 | 128 | 0 | 0 | 1.0 | $0.0003 |
| No-NLI Ablation | 1710 | 128 | 84 | 23 | 1.1 | $0.0005 |

### 6.2 F1 per Dollar

| System | Pooled F1 | Cost/Claim | F1/$ |
|--------|:---------:|-----------:|-----:|
| Full HERALD | 81.8% | $0.0006 | 1411 |
| Single LLM Judge | 81.3% | $0.0003 | 2443 |
| No-NLI Ablation | 81.0% | $0.0005 | 1649 |

### 6.3 Cost at Scale (1,000 claims/day)

| System | Daily Cost | Monthly Cost (30d) |
|--------|:----------:|:-----------------:|
| Full HERALD | $0.58 | $17.40 |
| Single LLM Judge | $0.33 | $9.99 |
| No-NLI Ablation | $0.49 | $14.73 |

### 6.4 Cost-Performance Verdict

- **F1 delta (HERALD − Judge):** +0.5pp
- **Cost delta (HERALD − Judge):** $0.0002 per claim (HERALD costs more)
- **F1/$ — Full HERALD:** 1411 vs Single LLM Judge: 2443

⚠️ **Marginal** — small F1 gain (+0.5pp) without cost efficiency.

### Does Tier 1 NLI contribute?

⚠️ **Marginal** — F1(HERALD) ≈ F1(No-NLI) (delta: +0.9pp). NLI adds infrastructure overhead without accuracy gain on this dataset.

## 7. Agreement: Full HERALD vs Single LLM Judge (Pooled)

Agreement rate: **92.7%** (241/260 evaluations)

**Disagreements (19 evaluations):**

| Claim ID | Type | Ground Truth | Full HERALD | Single LLM Judge | Winner |
|----------|------|:------------:|:-----------:|:----------------:|:------:|
| GT-053 | statistical | valid | invalid | valid | Judge ✓ |
| GT-067 | comparative | valid | valid | invalid | HERALD ✓ |
| GT-084 | comparative | valid | valid | invalid | HERALD ✓ |
| GT-096 | comparative | valid | invalid | valid | Judge ✓ |
| GT-100 | statistical | invalid | invalid | valid | HERALD ✓ |

## 8. Wrong Claims (Pooled)

### Full HERALD — 40 wrong evaluations (8 unique claims)

| Claim | Type | Derivation | GT | Predicted | Runs Wrong | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|:----------:|
| GT-053 | statistical | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-062 | causal | direct_extraction | invalid | valid | 5/5 | False Valid |
| GT-079 | synthesis | cross_source | invalid | valid | 5/5 | False Valid |
| GT-057 | synthesis | cross_source | invalid | valid | 5/5 | False Valid |
| GT-059 | statistical | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-096 | comparative | direct_extraction | valid | invalid | 5/5 | False Invalid |
| GT-065 | statistical | direct_extraction | invalid | valid | 5/5 | False Valid |
| GT-103 | comparative | direct_extraction | valid | invalid | 5/5 | False Invalid |

### Single LLM Judge — 39 wrong evaluations (9 unique claims)

| Claim | Type | Derivation | GT | Predicted | Runs Wrong | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|:----------:|
| GT-062 | causal | direct_extraction | invalid | valid | 5/5 | False Valid |
| GT-079 | synthesis | cross_source | invalid | valid | 5/5 | False Valid |
| GT-057 | synthesis | cross_source | invalid | valid | 5/5 | False Valid |
| GT-059 | statistical | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-065 | statistical | direct_extraction | invalid | valid | 5/5 | False Valid |
| GT-100 | statistical | paraphrase | invalid | valid | 5/5 | False Valid |
| GT-103 | comparative | direct_extraction | valid | invalid | 5/5 | False Invalid |
| GT-084 | comparative | paraphrase | valid | invalid | 2/5 | False Invalid |
| GT-067 | comparative | paraphrase | valid | invalid | 2/5 | False Invalid |

### No-NLI Ablation — 40 wrong evaluations (9 unique claims)

| Claim | Type | Derivation | GT | Predicted | Runs Wrong | Error Type |
|-------|------|------------|:--:|:---------:|:----------:|:----------:|
| GT-062 | causal | direct_extraction | invalid | valid | 5/5 | False Valid |
| GT-079 | synthesis | cross_source | invalid | valid | 5/5 | False Valid |
| GT-057 | synthesis | cross_source | invalid | valid | 5/5 | False Valid |
| GT-059 | statistical | paraphrase | valid | invalid | 5/5 | False Invalid |
| GT-065 | statistical | direct_extraction | invalid | valid | 5/5 | False Valid |
| GT-100 | statistical | paraphrase | invalid | valid | 5/5 | False Valid |
| GT-103 | comparative | direct_extraction | valid | invalid | 5/5 | False Invalid |
| GT-067 | comparative | paraphrase | valid | invalid | 3/5 | False Invalid |
| GT-084 | comparative | paraphrase | valid | invalid | 2/5 | False Invalid |
