# HERALD Experiment Analysis

**Run timestamp:** 2026-04-21T19:48:54.162Z
**Git commit:** `1de8dbd`
**Eval set:** `data/eval-set-2.json`
**Systems run:** A, B, C
**Total claims:** 53
**Model:** gpt-4o-mini (input: $0.15/1M tokens, output: $0.6/1M tokens)

## 1. Overall Accuracy

| Metric             | System A (HERALD) | System B (Tier 2 only) | System C (No NLI) |
| ------------------ | :---------------: | :--------------------: | :---------------: |
| Accuracy           |       96.2%       |         92.5%          |       92.3%       |
| Precision          |       94.4%       |         81.8%          |       81.0%       |
| Recall             |       94.4%       |         100.0%         |      100.0%       |
| F1                 |       94.4%       |         90.0%          |       89.5%       |
| False Invalid Rate |       2.9%        |         11.4%          |       11.4%       |
| False Valid Rate   |       5.6%        |          0.0%          |       0.0%        |
| Eval Errors        |         0         |           0            |         1         |

## 2. Per Claim Type

### causal (n=14)

| Metric             | System A | System B | System C |
| ------------------ | :------: | :------: | :------: |
| Accuracy           |  92.9%   |  100.0%  |  100.0%  |
| F1                 |  85.7%   |  100.0%  |  100.0%  |
| False Invalid Rate |   0.0%   |   0.0%   |   0.0%   |
| False Valid Rate   |  25.0%   |   0.0%   |   0.0%   |

### comparative (n=12)

| Metric             | System A | System B | System C |
| ------------------ | :------: | :------: | :------: |
| Accuracy           |  100.0%  |  75.0%   |  75.0%   |
| F1                 |  100.0%  |  72.7%   |  72.7%   |
| False Invalid Rate |   0.0%   |  37.5%   |  37.5%   |
| False Valid Rate   |   0.0%   |   0.0%   |   0.0%   |

### normative (n=2)

| Metric             | System A | System B | System C |
| ------------------ | :------: | :------: | :------: |
| Accuracy           |  100.0%  |  100.0%  |  100.0%  |
| F1                 |   0.0%   |   0.0%   |   0.0%   |
| False Invalid Rate |   0.0%   |   0.0%   |   0.0%   |
| False Valid Rate   |   0.0%   |   0.0%   |   0.0%   |

### predictive (n=1)

| Metric             | System A | System B | System C |
| ------------------ | :------: | :------: | :------: |
| Accuracy           |  100.0%  |  100.0%  |  100.0%  |
| F1                 |   0.0%   |   0.0%   |   0.0%   |
| False Invalid Rate |   0.0%   |   0.0%   |   0.0%   |
| False Valid Rate   |   0.0%   |   0.0%   |   0.0%   |

### statistical (n=17)

| Metric             | System A | System B | System C |
| ------------------ | :------: | :------: | :------: |
| Accuracy           |  94.1%   |  94.1%   |  94.1%   |
| F1                 |  94.7%   |  94.7%   |  94.7%   |
| False Invalid Rate |  12.5%   |  12.5%   |  12.5%   |
| False Valid Rate   |   0.0%   |   0.0%   |   0.0%   |

### synthesis (n=7)

| Metric             | System A | System B | System C |
| ------------------ | :------: | :------: | :------: |
| Accuracy           |  100.0%  |  100.0%  |  100.0%  |
| F1                 |  100.0%  |  100.0%  |   0.0%   |
| False Invalid Rate |   0.0%   |   0.0%   |   0.0%   |
| False Valid Rate   |   0.0%   |   0.0%   |   0.0%   |

## 3. Tier Distribution

**System A** (53 claims)

| Tier   | Claims |     % |
| ------ | -----: | ----: |
| Tier 1 |     25 | 47.2% |
| Tier 2 |     28 | 52.8% |
| Tier 3 |      0 |  0.0% |
| Tier 4 |      0 |  0.0% |

**System C** (53 claims)

| Tier   | Claims |      % |
| ------ | -----: | -----: |
| Tier 1 |      0 |   0.0% |
| Tier 2 |     53 | 100.0% |
| Tier 3 |      0 |   0.0% |
| Tier 4 |      0 |   0.0% |

## 4. Latency

| System                 | Mean (ms) | Median (ms) | p95 (ms) |
| ---------------------- | --------: | ----------: | -------: |
| System A (HERALD)      |      3305 |        2104 |     8260 |
| System B (Tier 2 only) |      3348 |        2469 |     7985 |
| System C (No NLI)      |      4542 |        2564 |     8283 |

## 5. Cost Analysis

_Model: gpt-4o-mini. Pricing: $0.15/1M input tokens, $0.6/1M output tokens._

### 5.1 Token Usage per Claim (mean)

| System                 | Mean Input Tokens | Mean Output Tokens | Mean API Calls | Mean Cost/Claim |
| ---------------------- | ----------------: | -----------------: | -------------: | --------------: |
| System A (HERALD)      |              2236 |                136 |            1.0 |         $0.0004 |
| System B (Tier 2 only) |              1980 |                133 |            1.0 |         $0.0004 |
| System C (No NLI)      |              1966 |                132 |            1.0 |         $0.0004 |

### 5.2 Cost per Claim by Type

| Claim Type  | System A Cost/Claim | System B Cost/Claim | System A API Calls | System B API Calls |
| ----------- | :-----------------: | :-----------------: | :----------------: | :----------------: |
| causal      |       $0.0004       |       $0.0004       |        1.0         |        1.0         |
| comparative |       $0.0004       |       $0.0003       |        1.0         |        1.0         |
| normative   |       $0.0004       |       $0.0004       |        1.0         |        1.0         |
| predictive  |       $0.0004       |       $0.0004       |        1.0         |        1.0         |
| statistical |       $0.0004       |       $0.0003       |        1.0         |        1.0         |
| synthesis   |       $0.0005       |       $0.0005       |        1.0         |        1.0         |

### 5.3 Accuracy per Dollar (F1 / mean cost per claim)

_Higher is better. Measures how much accuracy each dollar buys._

| System                 |  F1   | Mean Cost/Claim | F1 per Dollar |
| ---------------------- | :---: | --------------: | ------------: |
| System A (HERALD)      | 94.4% |         $0.0004 |        2361.0 |
| System B (Tier 2 only) | 90.0% |         $0.0004 |        2250.0 |
| System C (No NLI)      | 89.5% |         $0.0004 |        2236.8 |

### 5.4 Cost at Scale (1,000 claims/day)

| System                 | Daily Cost | Monthly Cost (30d) |
| ---------------------- | :--------: | :----------------: |
| System A (HERALD)      |   $0.40    |       $12.00       |
| System B (Tier 2 only) |   $0.40    |       $12.00       |
| System C (No NLI)      |   $0.40    |       $12.00       |

### 5.5 Decision: Cost-Performance Verdict

- **F1 delta (A − B):** 4.4%
- **Cost delta (A − B):** $0.0000m per claim (HERALD costs less)
- **F1/$ System A:** 2361.0 vs System B: 2250.0

✅ **HERALD wins on both axes** — higher accuracy (+4.4%) AND better accuracy-per-dollar.

### Does Tier 1 NLI contribute accuracy?

✅ **Yes** — F1(A) > F1(C) by 5.0%

## 6. Agreement: System A vs System B

Agreement rate: **92.5%** (49/53 claims)

**Disagreements (4 claims):**

| Claim ID | Type        | Ground Truth | System A | System B | Winner |
| -------- | ----------- | :----------: | :------: | :------: | :----: |
| GT-054   | causal      |   invalid    |  valid   | invalid  |  B ✓   |
| GT-103   | comparative |    valid     |  valid   | invalid  |  A ✓   |
| GT-067   | comparative |    valid     |  valid   | invalid  |  A ✓   |
| GT-060   | comparative |    valid     |  valid   | invalid  |  A ✓   |

## 7. Wrong Claims

### System A — 2 wrong

| Claim  | Type        | Derivation |   GT    | Predicted |  Error Type   |
| ------ | ----------- | ---------- | :-----: | :-------: | :-----------: |
| GT-054 | causal      | paraphrase | invalid |   valid   |  False Valid  |
| GT-059 | statistical | paraphrase |  valid  |  invalid  | False Invalid |

### System B — 4 wrong

| Claim  | Type        | Derivation        |  GT   | Predicted |  Error Type   |
| ------ | ----------- | ----------------- | :---: | :-------: | :-----------: |
| GT-103 | comparative | direct_extraction | valid |  invalid  | False Invalid |
| GT-059 | statistical | paraphrase        | valid |  invalid  | False Invalid |
| GT-067 | comparative | paraphrase        | valid |  invalid  | False Invalid |
| GT-060 | comparative | direct_extraction | valid |  invalid  | False Invalid |

### System C — 5 wrong

| Claim  | Type        | Derivation        |   GT    | Predicted |  Error Type   |
| ------ | ----------- | ----------------- | :-----: | :-------: | :-----------: |
| GT-103 | comparative | direct_extraction |  valid  |  invalid  | False Invalid |
| GT-059 | statistical | paraphrase        |  valid  |  invalid  | False Invalid |
| GT-067 | comparative | paraphrase        |  valid  |  invalid  | False Invalid |
| GT-060 | comparative | direct_extraction |  valid  |  invalid  | False Invalid |
| GT-095 | synthesis   | agent_inference   | invalid | uncertain |  False Valid  |
