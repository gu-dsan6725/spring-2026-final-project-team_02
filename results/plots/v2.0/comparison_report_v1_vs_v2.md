# HERALD Run Comparison: v1 (Llama) vs v2.0 (Gemma)

## Scope

- v1 source of truth: `data/test_sets/trial_cases.json`, `results/trial_run_results.json`, `results/trial_evaluation.json`
- v2 source of truth: `data/test_sets/gov_report_v2_100.json`, `results/govreport_v2_100_results.json`, `results/govreport_v2_eval.json`
- Important caveat: this is a comparison of the saved evaluation runs, not a perfectly matched rerun on the exact same case set.
- The v1 evaluation used `438` cases. The v2 evaluation used a standardized `100`-case subset.
- Retrieval appears only in v2, so it has no direct v1 counterpart.

## Headline Changes

- Overall accuracy improved from **45.0%** to **58.0%** (+13.0 pp).
- Invalid-case accuracy improved from **36.3%** to **81.2%** (+44.9 pp).
- Valid-case accuracy decreased from **98.6%** to **94.1%** (-4.5 pp).
- Ambiguous-case accuracy stayed at **0.0%** in both runs.
- Tier 1 resolution increased from **40.4%** to **54.0%**.
- Tier 2 resolution dropped from **50.0%** to **22.0%**.
- Tier 3 resolution increased from **9.4%** to **24.0%**.
- Human review fell from **0.2%** to **0.0%**.

## Overall Metrics

| Metric | v1 Llama | v2 Gemma | Change |
|---|---:|---:|---:|
| Cases evaluated | 438 | 100 | n/a |
| Overall accuracy | 45.0% | 58.0% | +13.0 pp |
| Cost per case | 0.0114 | 0.0000 | -0.0114 |
| Human review rate | 0.2% | 0.0% | -0.2 pp |

## Per-Label Accuracy

| Label | v1 Llama | v2 Gemma | Change |
|---|---:|---:|---:|
| valid | 98.6% | 94.1% | -4.5 pp |
| invalid | 36.3% | 81.2% | +44.9 pp |
| ambiguous | 0.0% | 0.0% | +0.0 pp |

## Checkpoint Accuracy

| Checkpoint | v1 Llama | v2 Gemma | Change | Notes |
|---|---:|---:|---:|---|
| claim_extraction | 45.7% | 61.5% | +15.8 pp |  |
| numerical | 44.2% | 60.0% | +15.8 pp |  |
| synthesis | 43.8% | 58.6% | +14.9 pp |  |
| causal | 50.0% | 62.5% | +12.5 pp |  |
| retrieval | n/a | 28.6% | n/a | New in v2 |

## Tier Accuracy

| Resolving Tier | v1 Llama | v2 Gemma | Change |
|---|---:|---:|---:|
| Tier 1 | 65.5% | 79.6% | +14.1 pp |
| Tier 2 | 34.7% | 54.5% | +19.8 pp |
| Tier 3 | 12.2% | 12.5% | +0.3 pp |
| Tier 4 | 0.0% | n/a | n/a |

## Escalation Rate

| Tier | v1 Llama | v2 Gemma | Change |
|---|---:|---:|---:|
| Tier 1 | 40.4% | 54.0% | +13.6 pp |
| Tier 2 | 50.0% | 22.0% | -28.0 pp |
| Tier 3 | 9.4% | 24.0% | +14.6 pp |
| Tier 4 | 0.2% | 0.0% | -0.2 pp |

## Verdict Distribution

| Verdict | v1 Llama | v2 Gemma |
|---|---:|---:|
| valid | 368/438 (84.0%) | 64/100 (64.0%) |
| invalid | 69/438 (15.8%) | 36/100 (36.0%) |
| uncertain | 1/438 (0.2%) | 0/100 (0.0%) |

## Dataset Composition Caveats

| Dimension | v1 Llama | v2 Gemma |
|---|---:|---:|
| Total cases | 438 | 100 |
| claim_extraction | 105 | 26 |
| numerical | 147 | 30 |
| synthesis | 144 | 29 |
| causal | 42 | 8 |
| retrieval | 0 | 7 |

## Interpretation

- The biggest real improvement is invalid-claim detection: Gemma is far less likely to incorrectly validate a bad claim.
- The biggest unresolved issue is still ambiguity: both runs score `0.0%` on ambiguous cases because the system almost never produces `uncertain`.
- Tier 1 remains the strongest resolver in both runs, which means upper-tier escalation is still underperforming its intended role.
- Tier 3 debate remains a major weakness. Its accuracy barely changed and is still too low to justify confidence in debate-driven resolution.
- Because the saved v2 evaluation uses a 100-case standardized subset while v1 used 438 cases, the direction of change is useful, but exact magnitude should be interpreted with that sampling caveat in mind.
