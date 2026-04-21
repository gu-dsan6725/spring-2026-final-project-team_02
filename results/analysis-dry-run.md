# HERALD Experiment Analysis

**Run timestamp:** 2026-04-21T18:12:56.153Z
**Git commit:** `1de8dbd`
**Eval set:** `data/eval-set.json`
**Systems run:** A, B, C
**Total claims:** 50
**Model:** gpt-4o-mini (input: $0.15/1M tokens, output: $0.6/1M tokens)
**⚠ DRY RUN — mock verdicts only, token counts are zero**

## 1. Overall Accuracy

| Metric             | System A (HERALD) | System B (Tier 2 only) | System C (No NLI) |
| ------------------ | :---------------: | :--------------------: | :---------------: |
| Accuracy           |      100.0%       |         100.0%         |      100.0%       |
| Precision          |      100.0%       |         100.0%         |      100.0%       |
| Recall             |      100.0%       |         100.0%         |      100.0%       |
| F1                 |      100.0%       |         100.0%         |      100.0%       |
| False Invalid Rate |       0.0%        |          0.0%          |       0.0%        |
| False Valid Rate   |       0.0%        |          0.0%          |       0.0%        |
| Eval Errors        |         0         |           0            |         0         |

## 2. Per Claim Type

### causal (n=9)

| Metric             | System A | System B | System C |
| ------------------ | :------: | :------: | :------: |
| Accuracy           |  100.0%  |  100.0%  |  100.0%  |
| F1                 |  100.0%  |  100.0%  |  100.0%  |
| False Invalid Rate |   0.0%   |   0.0%   |   0.0%   |
| False Valid Rate   |   0.0%   |   0.0%   |   0.0%   |

### comparative (n=8)

| Metric             | System A | System B | System C |
| ------------------ | :------: | :------: | :------: |
| Accuracy           |  100.0%  |  100.0%  |  100.0%  |
| F1                 |  100.0%  |  100.0%  |  100.0%  |
| False Invalid Rate |   0.0%   |   0.0%   |   0.0%   |
| False Valid Rate   |   0.0%   |   0.0%   |   0.0%   |

### normative (n=8)

| Metric             | System A | System B | System C |
| ------------------ | :------: | :------: | :------: |
| Accuracy           |  100.0%  |  100.0%  |  100.0%  |
| F1                 |  100.0%  |  100.0%  |  100.0%  |
| False Invalid Rate |   0.0%   |   0.0%   |   0.0%   |
| False Valid Rate   |   0.0%   |   0.0%   |   0.0%   |

### predictive (n=8)

| Metric             | System A | System B | System C |
| ------------------ | :------: | :------: | :------: |
| Accuracy           |  100.0%  |  100.0%  |  100.0%  |
| F1                 |  100.0%  |  100.0%  |  100.0%  |
| False Invalid Rate |   0.0%   |   0.0%   |   0.0%   |
| False Valid Rate   |   0.0%   |   0.0%   |   0.0%   |

### statistical (n=9)

| Metric             | System A | System B | System C |
| ------------------ | :------: | :------: | :------: |
| Accuracy           |  100.0%  |  100.0%  |  100.0%  |
| F1                 |  100.0%  |  100.0%  |  100.0%  |
| False Invalid Rate |   0.0%   |   0.0%   |   0.0%   |
| False Valid Rate   |   0.0%   |   0.0%   |   0.0%   |

### synthesis (n=8)

| Metric             | System A | System B | System C |
| ------------------ | :------: | :------: | :------: |
| Accuracy           |  100.0%  |  100.0%  |  100.0%  |
| F1                 |  100.0%  |  100.0%  |  100.0%  |
| False Invalid Rate |   0.0%   |   0.0%   |   0.0%   |
| False Valid Rate   |   0.0%   |   0.0%   |   0.0%   |

## 3. Tier Distribution

**System A** (50 claims)

| Tier   | Claims |     % |
| ------ | -----: | ----: |
| Tier 1 |     12 | 24.0% |
| Tier 2 |     26 | 52.0% |
| Tier 3 |     12 | 24.0% |
| Tier 4 |      0 |  0.0% |

**System C** (50 claims)

| Tier   | Claims |     % |
| ------ | -----: | ----: |
| Tier 1 |     12 | 24.0% |
| Tier 2 |     26 | 52.0% |
| Tier 3 |     12 | 24.0% |
| Tier 4 |      0 |  0.0% |

## 4. Latency

| System | Mean (ms) | Median (ms) | p95 (ms) |
| ------ | --------: | ----------: | -------: |

## 5. Cost Analysis

_Model: gpt-4o-mini. Pricing: $0.15/1M input tokens, $0.6/1M output tokens._

### 5.1 Token Usage per Claim (mean)

| System | Mean Input Tokens | Mean Output Tokens | Mean API Calls | Mean Cost/Claim |
| ------ | ----------------: | -----------------: | -------------: | --------------: |

### 5.2 Cost per Claim by Type

| Claim Type  | System A Cost/Claim | System B Cost/Claim | System A API Calls | System B API Calls |
| ----------- | :-----------------: | :-----------------: | :----------------: | :----------------: |
| causal      |          —          |          —          |         —          |         —          |
| comparative |          —          |          —          |         —          |         —          |
| normative   |          —          |          —          |         —          |         —          |
| predictive  |          —          |          —          |         —          |         —          |
| statistical |          —          |          —          |         —          |         —          |
| synthesis   |          —          |          —          |         —          |         —          |

### 5.3 Accuracy per Dollar (F1 / mean cost per claim)

_Higher is better. Measures how much accuracy each dollar buys._

| System | F1  | Mean Cost/Claim | F1 per Dollar |
| ------ | :-: | --------------: | ------------: |

### 5.4 Cost at Scale (1,000 claims/day)

| System | Daily Cost | Monthly Cost (30d) |
| ------ | :--------: | :----------------: |

### 5.5 Decision: Cost-Performance Verdict

- **F1 delta (A − B):** 0.0%
- **Cost delta (A − B):** $0.0000m per claim (HERALD costs less)
- **F1/$ System A:** 0.0 vs System B: 0.0

❌ **LLM-as-Judge wins** — HERALD achieves no accuracy gain (F1 delta: 0.0%) while costing $0.0000m more per claim.

### Does Tier 1 NLI contribute accuracy?

⚠️ **Marginal** — F1(A) ≈ F1(C) (delta: 0.0%). NLI adds infrastructure cost without clear accuracy gain.

## 6. Agreement: System A vs System B

Agreement rate: **100.0%** (50/50 claims)

## 7. Wrong Claims

### System A — 0 wrong

No wrong claims.

### System B — 0 wrong

No wrong claims.

### System C — 0 wrong

No wrong claims.
