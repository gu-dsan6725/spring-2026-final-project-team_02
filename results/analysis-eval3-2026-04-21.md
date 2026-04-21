# HERALD Experiment Analysis

**Run timestamp:** 2026-04-21T19:49:13.865Z
**Git commit:** `1de8dbd`
**Eval set:** `data/eval-set-3.json`
**Systems run:** A, B, C
**Total claims:** 50
**Model:** gpt-4o-mini (input: $0.15/1M tokens, output: $0.6/1M tokens)

## 1. Overall Accuracy

| Metric             | System A (HERALD) | System B (Tier 2 only) | System C (No NLI) |
| ------------------ | :---------------: | :--------------------: | :---------------: |
| Accuracy           |       91.8%       |         90.0%          |       92.0%       |
| Precision          |       88.2%       |         78.3%          |       81.8%       |
| Recall             |       88.2%       |         100.0%         |      100.0%       |
| F1                 |       88.2%       |         87.8%          |       90.0%       |
| False Invalid Rate |       6.3%        |         15.6%          |       12.5%       |
| False Valid Rate   |       11.8%       |          0.0%          |       0.0%        |
| Eval Errors        |         1         |           0            |         0         |

## 2. Per Claim Type

### causal (n=16)

| Metric             | System A | System B | System C |
| ------------------ | :------: | :------: | :------: |
| Accuracy           |  93.8%   |  100.0%  |  100.0%  |
| F1                 |  90.9%   |  100.0%  |  100.0%  |
| False Invalid Rate |   9.1%   |   0.0%   |   0.0%   |
| False Valid Rate   |   0.0%   |   0.0%   |   0.0%   |

### comparative (n=10)

| Metric             | System A | System B | System C |
| ------------------ | :------: | :------: | :------: |
| Accuracy           |  100.0%  |  90.0%   |  100.0%  |
| F1                 |  100.0%  |  85.7%   |  100.0%  |
| False Invalid Rate |   0.0%   |  14.3%   |   0.0%   |
| False Valid Rate   |   0.0%   |   0.0%   |   0.0%   |

### normative (n=3)

| Metric             | System A | System B | System C |
| ------------------ | :------: | :------: | :------: |
| Accuracy           |  100.0%  |  100.0%  |  100.0%  |
| F1                 |  100.0%  |  100.0%  |  100.0%  |
| False Invalid Rate |   0.0%   |   0.0%   |   0.0%   |
| False Valid Rate   |   0.0%   |   0.0%   |   0.0%   |

### predictive (n=3)

| Metric             | System A | System B | System C |
| ------------------ | :------: | :------: | :------: |
| Accuracy           |  100.0%  |  100.0%  |  100.0%  |
| F1                 |  100.0%  |  100.0%  |  100.0%  |
| False Invalid Rate |   0.0%   |   0.0%   |   0.0%   |
| False Valid Rate   |   0.0%   |   0.0%   |   0.0%   |

### statistical (n=14)

| Metric             | System A | System B | System C |
| ------------------ | :------: | :------: | :------: |
| Accuracy           |  78.6%   |  71.4%   |  71.4%   |
| F1                 |  72.7%   |  75.0%   |  75.0%   |
| False Invalid Rate |  12.5%   |  50.0%   |  50.0%   |
| False Valid Rate   |  33.3%   |   0.0%   |   0.0%   |

### synthesis (n=4)

| Metric             | System A | System B | System C |
| ------------------ | :------: | :------: | :------: |
| Accuracy           |  100.0%  |  100.0%  |  100.0%  |
| F1                 |   0.0%   |   0.0%   |   0.0%   |
| False Invalid Rate |   0.0%   |   0.0%   |   0.0%   |
| False Valid Rate   |   0.0%   |   0.0%   |   0.0%   |

## 3. Tier Distribution

**System A** (50 claims)

| Tier   | Claims |     % |
| ------ | -----: | ----: |
| Tier 1 |     24 | 48.0% |
| Tier 2 |     26 | 52.0% |
| Tier 3 |      0 |  0.0% |
| Tier 4 |      0 |  0.0% |

**System C** (50 claims)

| Tier   | Claims |     % |
| ------ | -----: | ----: |
| Tier 1 |      0 |  0.0% |
| Tier 2 |     49 | 98.0% |
| Tier 3 |      1 |  2.0% |
| Tier 4 |      0 |  0.0% |

## 4. Latency

| System                 | Mean (ms) | Median (ms) | p95 (ms) |
| ---------------------- | --------: | ----------: | -------: |
| System A (HERALD)      |      3629 |        2087 |     9452 |
| System B (Tier 2 only) |      5179 |        2541 |    17291 |
| System C (No NLI)      |      3188 |        2606 |     8350 |

## 5. Cost Analysis

_Model: gpt-4o-mini. Pricing: $0.15/1M input tokens, $0.6/1M output tokens._

### 5.1 Token Usage per Claim (mean)

| System                 | Mean Input Tokens | Mean Output Tokens | Mean API Calls | Mean Cost/Claim |
| ---------------------- | ----------------: | -----------------: | -------------: | --------------: |
| System A (HERALD)      |              2233 |                138 |            1.0 |         $0.0004 |
| System B (Tier 2 only) |              1975 |                134 |            1.0 |         $0.0004 |
| System C (No NLI)      |              2091 |                145 |            1.1 |         $0.0004 |

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
| System A (HERALD)      | 88.2% |         $0.0004 |        2206.0 |
| System B (Tier 2 only) | 87.8% |         $0.0004 |        2195.0 |
| System C (No NLI)      | 90.0% |         $0.0004 |        2250.0 |

### 5.4 Cost at Scale (1,000 claims/day)

| System                 | Daily Cost | Monthly Cost (30d) |
| ---------------------- | :--------: | :----------------: |
| System A (HERALD)      |   $0.40    |       $12.00       |
| System B (Tier 2 only) |   $0.40    |       $12.00       |
| System C (No NLI)      |   $0.40    |       $12.00       |

### 5.5 Decision: Cost-Performance Verdict

- **F1 delta (A − B):** 0.4%
- **Cost delta (A − B):** $0.0000m per claim (HERALD costs less)
- **F1/$ System A:** 2206.0 vs System B: 2195.0

⚠️ **HERALD marginal** — small F1 gain (+0.4%) but better accuracy-per-dollar. Lean toward HERALD for high-volume or cost-sensitive deployments.

### Does Tier 1 NLI contribute accuracy?

⚠️ **Marginal** — F1(A) ≈ F1(C) (delta: -1.8%). NLI adds infrastructure cost without clear accuracy gain.

## 6. Agreement: System A vs System B

Agreement rate: **84.0%** (42/50 claims)

**Disagreements (8 claims):**

| Claim ID | Type        | Ground Truth | System A  | System B | Winner |
| -------- | ----------- | :----------: | :-------: | :------: | :----: |
| GT-109   | statistical |    valid     |   valid   | invalid  |  A ✓   |
| GT-153   | statistical |    valid     |   valid   | invalid  |  A ✓   |
| GT-118   | causal      |    valid     |  invalid  |  valid   |  B ✓   |
| GT-149   | statistical |    valid     |   valid   | invalid  |  A ✓   |
| GT-137   | comparative |    valid     |   valid   | invalid  |  A ✓   |
| GT-135   | statistical |   invalid    |   valid   | invalid  |  B ✓   |
| GT-152   | normative   |   invalid    | uncertain | invalid  |  B ✓   |
| GT-114   | statistical |   invalid    |   valid   | invalid  |  B ✓   |

## 7. Wrong Claims

### System A — 5 wrong

| Claim  | Type        | Derivation        |   GT    | Predicted |  Error Type   |
| ------ | ----------- | ----------------- | :-----: | :-------: | :-----------: |
| GT-108 | statistical | paraphrase        |  valid  |  invalid  | False Invalid |
| GT-118 | causal      | paraphrase        |  valid  |  invalid  | False Invalid |
| GT-135 | statistical | paraphrase        | invalid |   valid   |  False Valid  |
| GT-152 | normative   | agent_inference   | invalid | uncertain |  False Valid  |
| GT-114 | statistical | direct_extraction | invalid |   valid   |  False Valid  |

### System B — 5 wrong

| Claim  | Type        | Derivation        |  GT   | Predicted |  Error Type   |
| ------ | ----------- | ----------------- | :---: | :-------: | :-----------: |
| GT-109 | statistical | direct_extraction | valid |  invalid  | False Invalid |
| GT-108 | statistical | paraphrase        | valid |  invalid  | False Invalid |
| GT-153 | statistical | direct_extraction | valid |  invalid  | False Invalid |
| GT-149 | statistical | paraphrase        | valid |  invalid  | False Invalid |
| GT-137 | comparative | direct_extraction | valid |  invalid  | False Invalid |

### System C — 4 wrong

| Claim  | Type        | Derivation        |  GT   | Predicted |  Error Type   |
| ------ | ----------- | ----------------- | :---: | :-------: | :-----------: |
| GT-109 | statistical | direct_extraction | valid |  invalid  | False Invalid |
| GT-108 | statistical | paraphrase        | valid |  invalid  | False Invalid |
| GT-153 | statistical | direct_extraction | valid |  invalid  | False Invalid |
| GT-149 | statistical | paraphrase        | valid |  invalid  | False Invalid |
