# HERALD Experiment — Final Report (5 Trials)

**Eval set:** `data/human-eval-set-2.json`
**Trials:** 5 independent runs, same eval set (shuffled order each run)
**Claims per run:** 52 (52 after skipping 1 invalid entry)
**Total claim evaluations:** 260 (86 per system)
**Tier 2 model:** gpt-4o-mini ($0.15/1M input, $0.6/1M output)
**Tier 3 model:** claude-haiku-4-5 ($0.8/1M input, $4/1M output) — usage not tracked
**Git commits:** 4a1c725, 9fb8f32

## 1. Per-Run Results

| Run | File | A Acc | A F1 | B Acc | B F1 | C Acc | C F1 |
|-----|------|------:|-----:|------:|-----:|------:|-----:|
| 1 | `experiment-2026-04-23.json` | 82.7% | 79.1% | 84.6% | 81.0% | 82.7% | 79.1% |
| 2 | `experiment-2026-04-23.2.json` | 84.6% | 81.8% | 84.6% | 81.0% | 84.6% | 81.0% |
| 3 | `experiment-2026-04-23.3.json` | 82.7% | 79.1% | 84.6% | 81.0% | 84.6% | 81.0% |
| 4 | `experiment-2026-04-23.4.json` | 82.7% | 79.1% | 84.6% | 81.0% | 84.6% | 81.0% |
| 5 | `experiment-2026-04-23.5.json` | 82.7% | 79.1% | 84.6% | 81.0% | 84.6% | 81.0% |

## 2. Overall Accuracy

### 2.1 Mean ± Std Across 5 Runs

| Metric | System A (HERALD) | System B (Tier 2 only) | System C (No NLI) |
|--------|:-----------------:|:----------------------:|:-----------------:|
| Accuracy | 83.1% ± 0.8% | 84.6% ± 0.0% | 84.2% ± 0.8% |
| Precision | 81.1% ± 0.3% | 85.0% ± 0.0% | 84.2% ± 1.6% |
| Recall | 78.2% ± 1.8% | 77.3% ± 0.0% | 77.3% ± 0.0% |
| F1 | 79.6% ± 1.1% | 81.0% ± 0.0% | 80.6% ± 0.8% |
| False Invalid Rate | 13.3% ± 0.0% | 10.0% ± 0.0% | 10.7% ± 1.3% |
| False Valid Rate | 21.8% ± 1.8% | 22.7% ± 0.0% | 22.7% ± 0.0% |

### 2.2 Pooled Metrics (260 claim evaluations per system)

| Metric | System A (HERALD) | System B (Tier 2 only) | System C (No NLI) |
|--------|:-----------------:|:----------------------:|:-----------------:|
| Accuracy | 83.1% | 84.6% | 84.2% |
| Precision | 81.1% | 85.0% | 84.2% |
| Recall | 78.2% | 77.3% | 77.3% |
| F1 | 79.6% | 81.0% | 80.6% |
| False Invalid Rate | 13.3% | 10.0% | 10.7% |
| False Valid Rate | 21.8% | 22.7% | 22.7% |
| Eval Errors | 0 | 0 | 0 |

## 3. Per Claim Type (Pooled)

### causal (n=20 per run, 60 total evaluations)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 91.7% | 91.7% | 91.7% |
| F1 | 88.9% | 88.9% | 88.9% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 20.0% | 20.0% | 20.0% |

### comparative (n=20 per run, 60 total evaluations)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 83.3% | 83.3% | 81.7% |
| F1 | 75.0% | 75.0% | 73.2% |
| False Invalid Rate | 22.2% | 22.2% | 24.4% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### normative (n=3 per run, 10 total evaluations)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 100.0% | 100.0% | 100.0% |
| F1 | 0.0% | 0.0% | 0.0% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### predictive (n=3 per run, 10 total evaluations)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 100.0% | 100.0% | 100.0% |
| F1 | 100.0% | 100.0% | 100.0% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 0.0% | 0.0% | 0.0% |

### statistical (n=28 per run, 85 total evaluations)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 77.6% | 82.4% | 82.4% |
| F1 | 81.2% | 84.2% | 84.2% |
| False Invalid Rate | 28.6% | 14.3% | 14.3% |
| False Valid Rate | 18.0% | 20.0% | 20.0% |

### synthesis (n=11 per run, 35 total evaluations)

| Metric | System A | System B | System C |
|--------|:--------:|:--------:|:--------:|
| Accuracy | 71.4% | 71.4% | 71.4% |
| F1 | 50.0% | 50.0% | 50.0% |
| False Invalid Rate | 0.0% | 0.0% | 0.0% |
| False Valid Rate | 66.7% | 66.7% | 66.7% |

## 4. Tier Distribution (Pooled, Systems A and C)

**System A** (260 total evaluations)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 1 | 120 | 46.2% |
| Tier 2 | 131 | 50.4% |
| Tier 3 | 9 | 3.5% |
| Tier 4 | 0 | 0.0% |

**System C** (260 total evaluations)

| Tier | Claims | % |
|------|-------:|--:|
| Tier 1 | 0 | 0.0% |
| Tier 2 | 247 | 95.0% |
| Tier 3 | 13 | 5.0% |
| Tier 4 | 0 | 0.0% |

## 5. Latency (Pooled)

| System | Mean (ms) | Median (ms) | p95 (ms) |
|--------|----------:|------------:|---------:|
| System A (HERALD) | 2037 | 2187 | 4487 |
| System B (Tier 2 only) | 2685 | 2567 | 3954 |
| System C (No NLI) | 2854 | 2550 | 5014 |

## 6. Cost Analysis (Tier 2 Tokens Only)

*gpt-4o-mini: $0.15/1M input, $0.6/1M output.*
*Tier 3 (claude-haiku-4-5) usage not tracked — costs are understated for claims reaching Tier 3.*

### 6.1 Mean Token Usage per Claim

| System | Mean Input Tokens | Mean Output Tokens | Mean API Calls | Mean Cost/Claim |
|--------|------------------:|-------------------:|---------------:|----------------:|
| System A (HERALD) | 1836 | 131 | 1.0 | $0.3540m |
| System B (Tier 2 only) | 1710 | 128 | 1.0 | $0.3330m |
| System C (No NLI) | 1710 | 127 | 1.0 | $0.3330m |

### 6.2 F1 per Dollar

*Higher is better.*

| System | Pooled F1 | Mean Cost/Claim | F1/$ |
|--------|:---------:|----------------:|-----:|
| System A (HERALD) | 79.6% | $0.3540m | 2249 |
| System B (Tier 2 only) | 81.0% | $0.3330m | 2431 |
| System C (No NLI) | 80.6% | $0.3330m | 2419 |

### 6.3 Cost at Scale (1,000 claims/day)

| System | Daily Cost | Monthly Cost (30d) |
|--------|:----------:|:-----------------:|
| System A (HERALD) | $0.35 | $10.62 |
| System B (Tier 2 only) | $0.33 | $9.99 |
| System C (No NLI) | $0.33 | $9.99 |

### 6.4 Cost-Performance Verdict

- **F1 delta A − B:** -1.3% (-1.3pp)
- **Cost delta A − B:** $0.0210m per claim (HERALD costs more)
- **F1/$ — System A:** 2249 vs System B: 2431

❌ **LLM-as-Judge (B) wins** — HERALD achieves no F1 gain (-1.3%) while costing more per claim.

### Does Tier 1 NLI contribute?

⚠️ **Marginal** — F1(A) ≈ F1(C) (delta: -0.9%). NLI adds infrastructure overhead without accuracy gain.

## 7. Agreement: System A vs System B (Pooled)

Agreement rate: **93.8%** (244/260 evaluations)

**Disagreements (16 evaluations):**

| Claim ID | Type | Ground Truth | System A | System B | Winner |
|----------|------|:------------:|:--------:|:--------:|:------:|
| GT-053 | statistical | valid | invalid | valid | B ✓ |
| GT-067 | comparative | valid | valid | invalid | A ✓ |
| GT-084 | comparative | valid | valid | invalid | A ✓ |
| GT-096 | comparative | valid | invalid | valid | B ✓ |
| GT-100 | statistical | invalid | invalid | valid | A ✓ |

## 8. Wrong Claims (Pooled)

### System A — 44 wrong evaluations across 5 runs (9 unique claims)

| Claim | Type | Derivation | GT | Predicted | Runs Wrong |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-065 | statistical | direct_extraction | invalid | valid | 5/5 |
| GT-062 | causal | direct_extraction | invalid | valid | 5/5 |
| GT-096 | comparative | direct_extraction | valid | invalid | 5/5 |
| GT-059 | statistical | paraphrase | valid | invalid | 5/5 |
| GT-079 | synthesis | cross_source | invalid | valid | 5/5 |
| GT-103 | comparative | direct_extraction | valid | invalid | 5/5 |
| GT-053 | statistical | paraphrase | valid | invalid | 5/5 |
| GT-057 | synthesis | cross_source | invalid | valid | 5/5 |
| GT-100 | statistical | paraphrase | invalid | valid | 4/5 |

### System B — 40 wrong evaluations across 5 runs (9 unique claims)

| Claim | Type | Derivation | GT | Predicted | Runs Wrong |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-065 | statistical | direct_extraction | invalid | valid | 5/5 |
| GT-062 | causal | direct_extraction | invalid | valid | 5/5 |
| GT-100 | statistical | paraphrase | invalid | valid | 5/5 |
| GT-059 | statistical | paraphrase | valid | invalid | 5/5 |
| GT-079 | synthesis | cross_source | invalid | valid | 5/5 |
| GT-103 | comparative | direct_extraction | valid | invalid | 5/5 |
| GT-057 | synthesis | cross_source | invalid | valid | 5/5 |
| GT-084 | comparative | paraphrase | valid | invalid | 4/5 |
| GT-067 | comparative | paraphrase | valid | invalid | 1/5 |

### System C — 41 wrong evaluations across 5 runs (9 unique claims)

| Claim | Type | Derivation | GT | Predicted | Runs Wrong |
|-------|------|------------|:--:|:---------:|:----------:|
| GT-065 | statistical | direct_extraction | invalid | valid | 5/5 |
| GT-062 | causal | direct_extraction | invalid | valid | 5/5 |
| GT-100 | statistical | paraphrase | invalid | valid | 5/5 |
| GT-059 | statistical | paraphrase | valid | invalid | 5/5 |
| GT-079 | synthesis | cross_source | invalid | valid | 5/5 |
| GT-103 | comparative | direct_extraction | valid | invalid | 5/5 |
| GT-057 | synthesis | cross_source | invalid | valid | 5/5 |
| GT-084 | comparative | paraphrase | valid | invalid | 4/5 |
| GT-067 | comparative | paraphrase | valid | invalid | 2/5 |
