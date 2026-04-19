# HERALD Benchmark Run 01

**Date/Time:** 2026-04-19T15:48:50.940Z
**Changes from previous run:** N/A — this is the baseline run. No pipeline modifications prior to this benchmark.
**Models:** Tier 2 — `gpt-4o-mini` (OpenAI); Tier 3 — `gpt-4o-mini` (OpenAI)
**Eval set:** `data/eval-set.json` (50 claims, all types, real API calls, concurrency 1)

---

## Summary Scorecard

| Metric                                     | Value     |
| ------------------------------------------ | --------- |
| Total claims                               | 50        |
| Strict accuracy (exact verdict match)      | 70.0%     |
| **Operational accuracy (bucket match)**    | **82.0%** |
| Hard error rate (valid ↔ needs-action)     | 18.0% ⚠   |
| Soft error rate (invalid ↔ needs_revision) | 12.0%     |
| Precision                                  | 94.1%     |
| Recall                                     | 66.7%     |
| F1                                         | 78.0%     |
| Skeptic false-invalid rate                 | 2.0% ✓    |

**Operational accuracy (82%)** is the headline metric — it measures whether HERALD made the right _action_ call (flag the claim or pass it), regardless of whether it chose `invalid` vs `needs_revision` within the flagged bucket. The gap between 82% and the strict 70% is entirely explained by soft errors (invalid ↔ needs_revision confusion), which are low-consequence because revision is still triggered either way.

---

## The Primary Problem: Low Recall

Precision is 94.1% — when HERALD flags a claim, it's almost always right. But Recall is only 66.7% — HERALD is missing **1 in 3 genuinely bad claims**, letting them pass as `valid`. This is the wrong direction for a claim evaluation framework where false negatives (bad claims entering a policy memo) are more costly than false positives.

The 18% hard error rate (above the 15% threshold) reflects this: 9 out of 50 claims that should have been flagged were passed as valid.

---

## By Claim Type

| Type          | Total | Strict Acc | Bucket Acc | Hard Err  | Soft Err | F1       | Assessment                                   |
| ------------- | ----- | ---------- | ---------- | --------- | -------- | -------- | -------------------------------------------- |
| comparative   | 8     | 75.0%      | **100.0%** | 0.0%      | 25.0%    | 1.0      | Excellent — bucket-perfect, soft errors only |
| statistical   | 9     | 77.8%      | 88.9%      | 11.1%     | 11.1%    | 88.9%    | Good                                         |
| causal        | 9     | 77.8%      | 88.9%      | 11.1%     | 11.1%    | 80.0%    | Good                                         |
| predictive    | 8     | 75.0%      | 87.5%      | 12.5%     | 12.5%    | 85.7%    | Acceptable                                   |
| normative     | 8     | 62.5%      | 75.0%      | **25.0%** | 12.5%    | 66.7%    | Weak — 1 in 4 claims mis-routed              |
| **synthesis** | 8     | **50.0%**  | **50.0%**  | **50.0%** | 0.0%     | **0.50** | **Critical failure**                         |

### Synthesis — Critical (50% hard error rate, F1 = 0.50)

Half of all synthesis claims that should have been flagged were passed as `valid`. Synthesis claims by definition require Tier 2+ (no single source entails them), so this is a prompt-level failure, not a routing issue. The `CRITERIA_SYNTHESIS` prompt in [src/herald/prompts/judge-system.ts](../../src/herald/prompts/judge-system.ts) covers the right dimensions (logical validity, alternative explanations, population overlap, temporal consistency) but the model is not applying them with sufficient rigor — it is likely being too deferential to the agent's `reasoning` field rather than independently stress-testing the inference.

**Root cause hypothesis:** The judge prompt instructs the model to evaluate "only what the provided source material supports" but does not give explicit instruction to be skeptical of `agent_inference`-derived synthesis claims. The `BASE_INSTRUCTIONS` says "High-risk derivation methods (cross_source, agent_inference) warrant heightened scrutiny" but this is a soft nudge, not a hard directive.

### Normative — Weak (75% bucket accuracy, 25% hard error rate)

The normative criteria prompt (criterion 1: "Genuine consensus vs. one viewpoint") is the right check, but the judge is passing normative claims where the source is a single institution without flagging the consensus problem. The 25% hard error rate means the model is not consistently applying the consensus test.

---

## By Derivation Method

| Derivation        | Total | Bucket Acc | Hard Err | F1      | Assessment                         |
| ----------------- | ----- | ---------- | -------- | ------- | ---------------------------------- |
| direct_extraction | 14    | **100%**   | 0.0%     | 1.0     | Perfect — as expected              |
| paraphrase        | 15    | 73.3%      | 26.7%    | 66.7%   | Concerning                         |
| cross_source      | 10    | 70.0%      | 30.0%    | 66.7%   | Concerning                         |
| agent_inference   | 11    | 81.8%      | 18.2%    | **0.0** | Bucket OK, verdict labeling broken |

The most revealing signal: `direct_extraction` is perfect. Everything that breaks is in paraphrase, cross-source, and agent_inference — the higher-risk derivation methods. This is not surprising, but the `paraphrase` performance (26.7% hard error rate) is unexpectedly bad for what should be a low-risk derivation. This suggests the judge isn't catching paraphrase distortions — cases where the agent changed the meaning slightly while restating a claim.

`agent_inference` has F1 = 0.0 with 0% precision and recall despite 81.8% bucket accuracy. This means it's correctly flagging agent_inference claims as "needs-action" but using the wrong verdict label (likely calling `needs_revision` when ground truth is `invalid` or vice versa). Soft errors, not hard — but the 18.2% hard error rate in that group means some valid agent_inference claims are being incorrectly flagged.

---

## Tier Distribution

| Tier               | Claims | %   |
| ------------------ | ------ | --- |
| Tier 1 (NLI)       | 0      | 0%  |
| Tier 2 (LLM Judge) | 32     | 64% |
| Tier 3 (Debate)    | 18     | 36% |
| Tier 4 (Human)     | 0      | 0%  |

**Tier 1 is silent — this is a bug, not a calibration issue.** Statistical (9 claims) and comparative (8 claims) and causal (9 claims) should all enter at Tier 1 per the routing table. 26 claims should have hit Tier 1, but 0 did. Looking at [src/herald/tier1-nli.ts](../../src/herald/tier1-nli.ts), Tier 1 calls `http://localhost:8000/api/herald/nli/batch` — the Python backend with the DeBERTa NLI model. That service was not running during this benchmark, so all Tier 1 attempts threw an error and the router's fallback sent them directly to Tier 2. The `logWarn` in [src/herald/router.ts:93](../../src/herald/router.ts) captured this but it didn't surface in the benchmark output.

This means every claim in this benchmark was evaluated by `gpt-4o-mini` at Tier 2, with 36% escalating to Tier 3. There is no NLI baseline yet.

The 36% Tier 3 escalation rate (18 claims) reflects claims where Tier 2 returned confidence between 0.6–0.85 — the "uncertain" band that triggers the multi-agent debate. This is within a reasonable range (CLAUDE.md targets escalation only for genuinely ambiguous claims).

---

## Diagnosis Summary

| Problem                     | Severity       | Location                                                                               |
| --------------------------- | -------------- | -------------------------------------------------------------------------------------- |
| Tier 1 NLI not running      | Infrastructure | Python backend not started; `http://localhost:8000` unreachable                        |
| Synthesis F1 = 0.50         | Critical       | `CRITERIA_SYNTHESIS` prompt too permissive; judge is deferential to agent reasoning    |
| Normative 25% hard error    | High           | `CRITERIA_NORMATIVE` consensus check not firm enough in prompt                         |
| Paraphrase 26.7% hard error | Medium         | Judge not catching meaning drift in paraphrased claims                                 |
| Overall Recall = 66.7%      | High           | Systemic — judge is biased toward `valid`; confidence thresholds may be too permissive |

---

## Recommended Next Steps (for Benchmark 02)

These are the changes to attempt before the next benchmark run, in priority order:

1. **Start the Python NLI backend** before running. This will exercise Tier 1 for statistical, comparative, and causal claims, potentially improving recall on those types without additional LLM cost.

2. **Tighten the synthesis judge prompt.** In `CRITERIA_SYNTHESIS`, add an explicit directive: for `agent_inference` derivation, the default posture should be skeptical — require the judge to identify and explicitly refute alternative explanations before returning `valid`. The current soft nudge in `BASE_INSTRUCTIONS` is insufficient.

3. **Tighten the normative judge prompt.** In `CRITERIA_NORMATIVE` criterion 1, add: if the sole source is a single NGO, think tank, or non-intergovernmental body, the consensus criterion is not satisfied and the claim should be `needs_revision` at minimum.

4. **Consider lowering the Tier 2 exit threshold** from 0.85 to 0.80 to reduce false negatives. The current high precision (94.1%) suggests the model is over-confident when it says `valid` — pushing more borderline cases to Tier 3 may improve recall at acceptable precision cost.

5. **Investigate the paraphrase hard error pattern** by reviewing the per-claim results in `results/benchmark-2026-04-19.json` — filter for `derivation: "paraphrase"` and `error_type: "hard"` to identify what the judge is missing.
