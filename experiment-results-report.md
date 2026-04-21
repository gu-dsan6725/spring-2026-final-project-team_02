# HERALD vs. LLM-as-Judge: Cross-Eval-Set Comparison Report

**Date:** 2026-04-21
**Git commit:** `1de8dbd`
**Model:** gpt-4o-mini (input: $0.15/1M tokens, output: $0.60/1M tokens)

---

## Eval Sets

| Name                         | File                   | Claims | Type Distribution                                                                 | Valid / Invalid |
| ---------------------------- | ---------------------- | :----: | --------------------------------------------------------------------------------- | :-------------: |
| **Balanced**                 | `data/eval-set.json`   |   50   | Statistical=9, Causal=9, Comparative=8, Predictive=8, Normative=8, Synthesis=8    |     24 / 26     |
| **Statistical-Causal Heavy** | `data/eval-set-2.json` |   53   | Statistical=17, Causal=14, Comparative=12, Synthesis=7, Normative=2, Predictive=1 |     35 / 18     |
| **Causal-Heavy**             | `data/eval-set-3.json` |   50   | Causal=16, Statistical=14, Comparative=10, Synthesis=4, Predictive=3, Normative=3 |     32 / 18     |

## Systems

| Name                       | Description                                               |
| -------------------------- | --------------------------------------------------------- |
| **HERALD (Full Pipeline)** | NLI Tier 1 → LLM Judge Tier 2 → Multi-Agent Debate Tier 3 |
| **LLM-as-Judge**           | Single LLM Judge call per claim, no escalation, no NLI    |
| **HERALD (No NLI)**        | LLM Judge + Debate escalation, NLI step removed           |

---

## 1. Overall Accuracy

| Eval Set                 | HERALD (Full Pipeline) | LLM-as-Judge | HERALD (No NLI) |
| ------------------------ | :--------------------: | :----------: | :-------------: |
| Balanced                 |       **94.0%**        |    90.0%     |      90.0%      |
| Statistical-Causal Heavy |       **96.2%**        |    92.5%     |      92.3%      |
| Causal-Heavy             |         91.8%          |    90.0%     |    **92.0%**    |

| Eval Set                 | HERALD (Full Pipeline) F1 | LLM-as-Judge F1 | HERALD (No NLI) F1 |
| ------------------------ | :-----------------------: | :-------------: | :----------------: |
| Balanced                 |         **94.3%**         |      90.6%      |       90.6%        |
| Statistical-Causal Heavy |         **94.4%**         |      90.0%      |       89.5%        |
| Causal-Heavy             |           88.2%           |      87.8%      |     **90.0%**      |

HERALD (Full Pipeline) leads on 2 of 3 eval sets. The Causal-Heavy set is the exception — HERALD (No NLI) edges ahead by 1.8pp F1, and HERALD (Full Pipeline) falls to third, driven by NLI over-confidence on statistical claims.

---

## 2. Cost per Claim

| Eval Set                 | HERALD (Full Pipeline) | LLM-as-Judge | HERALD (No NLI) |
| ------------------------ | :--------------------: | :----------: | :-------------: |
| Balanced                 |        $0.0006         |   $0.0004    |     $0.0005     |
| Statistical-Causal Heavy |        $0.0004         |   $0.0004    |     $0.0004     |
| Causal-Heavy             |        $0.0004         |   $0.0004    |     $0.0004     |

The Balanced set is the only eval set where HERALD (Full Pipeline) costs more — 8% of claims escalated to Tier 3 (4 API calls each), raising mean cost to $0.0006. On the Statistical-Causal Heavy and Causal-Heavy sets, Tier 3 was barely triggered and all three systems converged on the same per-claim cost.

---

## 3. F1 per Dollar (Accuracy-per-Dollar)

_Higher is better. F1 divided by mean cost per claim._

| Eval Set                 | HERALD (Full Pipeline) | LLM-as-Judge | HERALD (No NLI) |         Winner         |
| ------------------------ | :--------------------: | :----------: | :-------------: | :--------------------: |
| Balanced                 |          1572          |   **2264**   |      1811       |      LLM-as-Judge      |
| Statistical-Causal Heavy |        **2361**        |     2250     |      2237       | HERALD (Full Pipeline) |
| Causal-Heavy             |          2206          |     2195     |    **2250**     |    HERALD (No NLI)     |

No single system dominates on cost-efficiency across all eval sets. The winner depends on how frequently Tier 3 escalates and how well NLI performs on the specific claim mix. HERALD (Full Pipeline) wins when NLI resolves many claims without reaching Tier 3; LLM-as-Judge wins when Tier 3 escalation inflates HERALD's cost.

---

## 4. Tier Distribution — HERALD (Full Pipeline)

| Eval Set                 | Tier 1 (NLI) | Tier 2 (LLM Judge) | Tier 3 (Debate) | Tier 4 (Human) |
| ------------------------ | :----------: | :----------------: | :-------------: | :------------: |
| Balanced                 |    22.0%     |       70.0%        |    **8.0%**     |       0%       |
| Statistical-Causal Heavy |  **47.2%**   |       52.8%        |      0.0%       |       0%       |
| Causal-Heavy             |  **48.0%**   |       52.0%        |      0.0%       |       0%       |

NLI resolved roughly half of all claims at Tier 1 on both heavier eval sets, acting as an effective early filter. Tier 3 fired only in the Balanced set (8% of claims), which is the direct cause of its higher per-claim cost. The multi-agent debate was not triggered at all on Statistical-Causal Heavy or Causal-Heavy.

---

## 5. Per-Claim-Type F1 Breakdown

### Causal

| Eval Set                 |  n  | HERALD (Full Pipeline) | LLM-as-Judge | HERALD (No NLI) |
| ------------------------ | :-: | :--------------------: | :----------: | :-------------: |
| Balanced                 |  9  |       **100.0%**       |    83.3%     |      83.3%      |
| Statistical-Causal Heavy | 14  |         85.7%          |  **100.0%**  |   **100.0%**    |
| Causal-Heavy             | 16  |         90.9%          |  **100.0%**  |   **100.0%**    |

HERALD (Full Pipeline) dominates on the Balanced set but produces one false-valid each on Statistical-Causal Heavy (GT-054, paraphrase) and Causal-Heavy (GT-118, paraphrase). LLM-as-Judge and HERALD (No NLI) achieve perfect causal accuracy on both heavier sets.

### Comparative

| Eval Set                 |  n  | HERALD (Full Pipeline) | LLM-as-Judge | HERALD (No NLI) |
| ------------------------ | :-: | :--------------------: | :----------: | :-------------: |
| Balanced                 |  8  |       **100.0%**       |  **100.0%**  |   **100.0%**    |
| Statistical-Causal Heavy | 12  |       **100.0%**       |    72.7%     |      72.7%      |
| Causal-Heavy             | 10  |       **100.0%**       |    85.7%     |   **100.0%**    |

HERALD (Full Pipeline) achieves 100% F1 on comparative claims across all three eval sets. LLM-as-Judge and HERALD (No NLI) produce false-invalids — especially on direct_extraction and paraphrase claims in Statistical-Causal Heavy (3 comparative false-invalids: GT-103, GT-067, GT-060).

### Statistical

| Eval Set                 |  n  | HERALD (Full Pipeline) | LLM-as-Judge | HERALD (No NLI) |
| ------------------------ | :-: | :--------------------: | :----------: | :-------------: |
| Balanced                 |  9  |       **100.0%**       |  **100.0%**  |   **100.0%**    |
| Statistical-Causal Heavy | 17  |         94.7%          |    94.7%     |      94.7%      |
| Causal-Heavy             | 14  |         72.7%          |  **75.0%**   |    **75.0%**    |

Statistical claims are the most volatile claim type. All systems perform perfectly on the Balanced set, degrade modestly on Statistical-Causal Heavy, and show significant degradation on Causal-Heavy (~25% error rate). On Causal-Heavy, HERALD (Full Pipeline) performs slightly worse — NLI produces some over-confident wrong exits on statistical claims that LLM-as-Judge avoids.

### Predictive

| Eval Set                 |  n  | HERALD (Full Pipeline) | LLM-as-Judge | HERALD (No NLI) |
| ------------------------ | :-: | :--------------------: | :----------: | :-------------: |
| Balanced                 |  8  |         88.9%          |    88.9%     |      88.9%      |
| Statistical-Causal Heavy |  1  |           —            |      —       |        —        |
| Causal-Heavy             |  3  |       **100.0%**       |  **100.0%**  |   **100.0%**    |

All three systems perform identically on predictive claims. Sample sizes are too small on Statistical-Causal Heavy and Causal-Heavy for meaningful comparison.

### Normative

| Eval Set                 |  n  | HERALD (Full Pipeline) | LLM-as-Judge | HERALD (No NLI) |
| ------------------------ | :-: | :--------------------: | :----------: | :-------------: |
| Balanced                 |  8  |         88.9%          |    88.9%     |      88.9%      |
| Statistical-Causal Heavy |  2  |           —            |      —       |        —        |
| Causal-Heavy             |  3  |       **100.0%**       |  **100.0%**  |   **100.0%**    |

All systems agree on normative claims. Sample sizes are too small to draw conclusions from Statistical-Causal Heavy and Causal-Heavy.

### Synthesis

| Eval Set                 |  n  | HERALD (Full Pipeline) | LLM-as-Judge | HERALD (No NLI) |
| ------------------------ | :-: | :--------------------: | :----------: | :-------------: |
| Balanced                 |  8  |         80.0%          |    80.0%     |      80.0%      |
| Statistical-Causal Heavy |  7  |       **100.0%**       |  **100.0%**  |        —        |
| Causal-Heavy             |  4  |           —            |      —       |        —        |

On the Balanced set all systems miss GT-042 (cross_source, false-valid). HERALD (No NLI) has one eval error on Statistical-Causal Heavy (GT-095, agent_inference returned uncertain). Causal-Heavy has 4 synthesis claims but no invalid ground truths among them, making F1 undefined.

---

## 6. Error Analysis

### Wrong claim counts

| Eval Set                 | HERALD (Full Pipeline) | LLM-as-Judge | HERALD (No NLI) |
| ------------------------ | :--------------------: | :----------: | :-------------: |
| Balanced                 |         **3**          |      5       |        5        |
| Statistical-Causal Heavy |         **2**          |      4       |        5        |
| Causal-Heavy             |           5            |      5       |      **4**      |

HERALD (Full Pipeline) produces fewer errors on the Balanced and Statistical-Causal Heavy sets. On the Causal-Heavy set, error counts are comparable across all systems.

### Dominant error type per system

| System                 | Dominant Error | Description                                                                                      |
| ---------------------- | :------------: | ------------------------------------------------------------------------------------------------ |
| HERALD (Full Pipeline) |  False Valid   | Misses invalid claims — overly lenient, especially on paraphrase and agent_inference derivations |
| LLM-as-Judge           | False Invalid  | Rejects valid claims — overly strict, disproportionately on paraphrase and direct_extraction     |
| HERALD (No NLI)        | False Invalid  | Same pattern as LLM-as-Judge                                                                     |

**Paraphrase-derivation claims are the most consistent error source across all systems and all eval sets** — they appear in the wrong-claims list of every system on every eval set.

### Agreement rate — HERALD (Full Pipeline) vs LLM-as-Judge

| Eval Set                 | Agreement Rate | Disagreements | HERALD wins | LLM-as-Judge wins |
| ------------------------ | :------------: | :-----------: | :---------: | :---------------: |
| Balanced                 |     96.0%      |       2       |    2 / 2    |       0 / 2       |
| Statistical-Causal Heavy |     92.5%      |       4       |    3 / 4    |       1 / 4       |
| Causal-Heavy             |     84.0%      |       8       |    5 / 8    |       3 / 8       |

Agreement is lowest on the Causal-Heavy set (84%), where statistical and causal claims produce the most divergence between HERALD (Full Pipeline) and LLM-as-Judge.

---

## 7. NLI Contribution — HERALD (Full Pipeline) vs HERALD (No NLI)

| Eval Set                 | HERALD F1 | No NLI F1 |   Delta   | Verdict              |
| ------------------------ | :-------: | :-------: | :-------: | -------------------- |
| Balanced                 |   94.3%   |   90.6%   | **+3.8%** | NLI helps            |
| Statistical-Causal Heavy |   94.4%   |   89.5%   | **+5.0%** | NLI helps            |
| Causal-Heavy             |   88.2%   |   90.0%   | **−1.8%** | NLI marginally hurts |

NLI contributes positively on 2 of 3 eval sets. The Causal-Heavy reversal (−1.8pp) is concentrated in statistical claims, where NLI exits with over-confident wrong verdicts that LLM Judge would have corrected. This suggests the NLI confidence threshold for statistical claims may need tuning when the eval set is skewed toward harder statistical cases.

---

## 8. Cost at Scale (1,000 claims/day)

| Eval Set                 | HERALD (Full Pipeline) Daily | LLM-as-Judge Daily | HERALD (No NLI) Daily |
| ------------------------ | :--------------------------: | :----------------: | :-------------------: |
| Balanced                 |            $0.60             |       $0.40        |         $0.50         |
| Statistical-Causal Heavy |            $0.40             |       $0.40        |         $0.40         |
| Causal-Heavy             |            $0.40             |       $0.40        |         $0.40         |

At current volumes, costs are low across all systems. The only material cost difference is on the Balanced set, where HERALD (Full Pipeline) runs $0.20/day more due to 8% Tier 3 escalation. Tier 3 escalation rate is the key cost driver for HERALD — when it stays near zero, all systems are cost-equivalent.

---

## 9. Conclusions

### Consistent findings across all three eval sets

1. **HERALD (Full Pipeline) achieves the highest or tied accuracy on 2 of 3 eval sets.** The margin ranges from +0.4pp (Causal-Heavy) to +4.4pp (Statistical-Causal Heavy).
2. **Paraphrase-derivation claims are the hardest for all systems.** They are the dominant error source in every system on every eval set, with no system handling them reliably.
3. **Tier 3 escalation is rare.** The multi-agent debate fired meaningfully only on the Balanced set (8%). On the heavier sets it was essentially unused, meaning HERALD (Full Pipeline) and LLM-as-Judge incurred identical API costs.
4. **NLI resolves ~47–48% of claims at Tier 1 on the two heavier eval sets**, acting as an effective early filter that improves accuracy without adding API cost.

### Where results varied

5. **The Causal-Heavy set is the anomaly.** HERALD (No NLI) outperforms HERALD (Full Pipeline) by 1.8pp F1, driven by NLI over-confidence on statistical claims. This is the only eval set where NLI acts as a liability rather than an asset.
6. **F1/$ winner is claim-mix dependent.** HERALD (Full Pipeline) wins on the Statistical-Causal Heavy set; LLM-as-Judge wins on the Balanced set (Tier 3 cost); HERALD (No NLI) wins on Causal-Heavy (NLI avoidance). No system dominates across all conditions.

### Routing recommendations

| Claim Type                         |       Recommended System        | Rationale                                                                       |
| ---------------------------------- | :-----------------------------: | ------------------------------------------------------------------------------- |
| Comparative                        |     HERALD (Full Pipeline)      | 100% F1 on all three eval sets; LLM-as-Judge produces systematic false-invalids |
| Causal                             | LLM-as-Judge or HERALD (No NLI) | HERALD (Full Pipeline) produces false-valids on heavier causal sets             |
| Statistical                        |   Investigate NLI thresholds    | All systems degrade on Causal-Heavy; NLI exits may need recalibration           |
| Predictive / Normative / Synthesis |               Any               | Systems perform identically; sample sizes too small to differentiate            |

---

## 10. Source Files

| Eval Set                 | Raw Results                                | Per-System Analysis                    |
| ------------------------ | ------------------------------------------ | -------------------------------------- |
| Balanced                 | `results/experiment-2026-04-21.json`       | `results/analysis-2026-04-21.md`       |
| Statistical-Causal Heavy | `results/experiment-eval2-2026-04-21.json` | `results/analysis-eval2-2026-04-21.md` |
| Causal-Heavy             | `results/experiment-eval3-2026-04-21.json` | `results/analysis-eval3-2026-04-21.md` |
