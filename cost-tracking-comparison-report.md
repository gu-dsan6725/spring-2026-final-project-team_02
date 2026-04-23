# Cost Tracking Comparison: v1 vs. v2 Reports

**What changed:** `cross-dataset-comparison-report.md` (v1) tracked Tier 2
(gpt-4o-mini) costs only — Tier 3 (claude-haiku-4-5) usage was not captured
in `TierOutput.usage`. `cross-dataset-comparison-report-v2.md` (v2) fixes
this: `tier3-debate.ts` now populates `response.usage` and the analyzer applies
per-tier pricing (mini rates to T2 tokens, haiku rates to T3 tokens).

Single LLM Judge (System B) is **unaffected** — it never reaches Tier 3.

---

## Cost per Claim: v1 vs. v2

| System | Set | v1 Cost/Claim (T2 only) | v2 Cost/Claim (T2 + T3) | Underestimate |
|--------|-----|:-----------------------:|:------------------------:|:-------------:|
| Full HERALD       | Human Set | $0.000354 | $0.0006 | **−41%** |
| Full HERALD       | GenAI Set | $0.000353 | $0.0008 | **−56%** |
| Single LLM Judge  | Human Set | $0.000333 | $0.0003 | 0% |
| Single LLM Judge  | GenAI Set | $0.000335 | $0.0003 | 0% |
| No-NLI Ablation   | Human Set | $0.000333 | $0.0005 | **−33%** |
| No-NLI Ablation   | GenAI Set | $0.000335 | $0.0006 | **−44%** |

*v1 costs are expressed in the same unit ($) for comparison.*

---

## F1 per Dollar: v1 vs. v2

| System | Set | v1 F1/$ | v2 F1/$ | Change |
|--------|-----|:-------:|:-------:|:------:|
| Full HERALD      | Human Set | 2249 | 1411 | **−37%** |
| Full HERALD      | GenAI Set | 2652 | 1124 | **−58%** |
| Single LLM Judge | Human Set | 2431 | 2443 | ~0% |
| Single LLM Judge | GenAI Set | 2650 | 2616 | ~0% |
| No-NLI Ablation  | Human Set | 2419 | 1649 | **−32%** |
| No-NLI Ablation  | GenAI Set | 2704 | 1580 | **−42%** |

---

## What the Tier 3 Haiku Calls Actually Cost

| System | Set | Mean T3 Input Tokens | Mean T3 Output Tokens | T3 Cost/Claim | T3 as % of Total |
|--------|-----|---------------------:|----------------------:|:-------------:|:----------------:|
| Full HERALD     | Human Set | 130 | 31 | ~$0.0002 | ~38% |
| Full HERALD     | GenAI Set | 275 | 65 | ~$0.0005 | ~56% |
| No-NLI Ablation | Human Set |  84 | 23 | ~$0.0001 | ~27% |
| No-NLI Ablation | GenAI Set | 141 | 31 | ~$0.0002 | ~38% |

*T3 cost = (T3 input / 1M × $0.80) + (T3 output / 1M × $4.00).*

Tier 3 dominates HERALD's cost on the GenAI set because more claims escalate
(~12% on GenAI vs ~8% on Human), and GenAI source chunks are longer, producing
larger haiku prompts.

---

## Verdict Change

| Finding | v1 (T2 only) | v2 (T2 + T3) |
|---------|:------------:|:------------:|
| HERALD vs. Judge cost premium (Human) | +$0.000021/claim (+6%) | +$0.0003/claim (+100%) |
| HERALD vs. Judge cost premium (GenAI) | +$0.000018/claim (+5%) | +$0.0005/claim (+167%) |
| HERALD F1/$ vs. Judge F1/$ (Human) | HERALD ≈ Judge (2249 vs 2431) | Judge wins 2× (1411 vs 2443) |
| HERALD F1/$ vs. Judge F1/$ (GenAI) | HERALD ≈ Judge (2652 vs 2650) | Judge wins 2.3× (1124 vs 2616) |

**v1 made HERALD look cost-competitive with the Single LLM Judge — a near-tie
on F1/$ in both datasets. v2 reveals the true picture: the Single LLM Judge
is 1.7–2.3× more cost-efficient on F1/$. HERALD's accuracy advantage on the
GenAI set (+6.1pp F1) is real, but it comes at a genuine cost premium that v1
completely obscured by missing haiku charges.**

