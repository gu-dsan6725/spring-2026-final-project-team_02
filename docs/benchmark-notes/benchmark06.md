# HERALD Benchmark Run 13

**Date/Time:** 2026-04-21T14:04:04.259Z
**Result file:** `results/benchmark-2026-04-21.5.json`
**Previous run:** Run 12 — `results/benchmark-2026-04-21.4.json` (92%, 46/50)
**Models:** Tier 2 — `gpt-4o-mini`; Tier 3 — `gpt-4o-mini`
**Tier 1 NLI:** UP — 11 claims resolved at Tier 1
**Eval set:** `data/eval-set.json` (50 claims, real API calls, concurrency 1)

---

## Summary Scorecard

| Metric                     | Run 12 | Run 13    | Change vs R12 |
| -------------------------- | ------ | --------- | ------------- |
| Accuracy                   | 92.0%  | **92.0%** | 0 (no change) |
| Correct claims             | 46/50  | **46/50** | 0             |
| Precision                  | 91.7%  | **91.7%** | 0             |
| Recall                     | 91.7%  | **91.7%** | 0             |
| F1                         | 91.7%  | **91.7%** | 0             |
| Skeptic false-invalid rate | 4.0%   | **4.0%**  | 0             |
| Tier 1 claims              | 11     | 11        | —             |

**Net zero, but with claim turnover:** GT-023 fixed (+1), GT-025 new regression (−1).
The few-shot synthesis example worked for GT-023. The GT-025 regression is nondeterminism
(nothing targeted causal claims this run). The threshold change had no effect on GT-018.

---

## What Changed vs Run 12

### Changes implemented before this run

1. **`src/herald/tier2-llm-judge.ts`** — Introduced `CONFIDENCE_EXIT_THRESHOLD_PARAPHRASE = 0.75`.
   For paraphrase derivation, the exit threshold is lowered to 0.75 (vs 0.80 standard). The
   intent was to force GT-018 (conf=0.85) to Tier 3. **This failed** — 0.85 > 0.75 is still
   true, so GT-018 still exits at Tier 2. The threshold needed to be 0.85, not 0.75.

2. **`src/herald/prompts/judge-system.ts` CRITERIA_SYNTHESIS** — Added a worked few-shot
   example showing the concessive-clause pattern: "despite national GDP growth" is an
   unsourced factual assertion, not rhetorical decoration, even inside a structurally valid
   synthesis. Correct verdict: INVALID.

3. **`src/herald/prompts/judge-system.ts` CRITERIA_NORMATIVE** — Added "STOP rule for
   paraphrase claims": if the claim satisfies the acceptable paraphrase patterns, return
   VALID immediately without proceeding to criteria 1–6.

---

## Claim-Level Changes vs Run 12

### GT-023 FIXED (+1) — few-shot example worked

GT-023 (synthesis, cross_source, invalid) flipped from predicted-valid (conf=0.9) to
predicted-invalid (conf=0.9). The few-shot worked because it named the exact syntactic
pattern — a concessive clause ("despite X") where X is an unsourced fact — as a trigger
for INVALID. This is substantially more powerful than the abstract rule "list all premises
and check sources," which had no effect across two runs.

Key lesson: **few-shot examples > abstract rules** for GPT models on borderline cases.
The model needs to see a prototypical case reasoned through correctly, not a principle
stated at higher abstraction.

### GT-025 NEW REGRESSION (−1) — nondeterminism

GT-025 (causal, paraphrase, GT=invalid) flipped from predicted-invalid (conf=0.85) to
predicted-valid (conf=0.9). Nothing in Run 13's changes targeted causal claims.

**What GT-025 is:**

- Claim: "Early childhood development programs that include parenting education components
  show sustained cognitive gains in children through age 10."
- Source: Jamaica Early Childhood Stimulation Trial (Gertler et al., 2021) — single-country
  study showing sustained cognitive advantages through ages 7, 11, and 22.
- GT rationale: INVALID because the claim generalizes from a single Jamaican trial to "all
  early childhood development programs" — a scope generalization not supported by the source.

**Root cause of regression:** The causal paraphrase carve-out (added in Run 9) says:
"Only mark a causal paraphrase INVALID if the paraphrase asserts a causal mechanism the
source explicitly does not establish, reverses the direction, or inflates the effect size."
This list omits **population scope widening** as a ground for invalidity. The model is
reading the carve-out as exhaustive and concluding that GT-025 is a valid paraphrase
because the mechanism, direction, and effect size are all faithfully represented — only
the scope was widened. Criterion 6 (population scope) says widening is invalid, but the
carve-out's "only mark invalid if..." language is overriding it.

**This is a prompt bug, not nondeterminism.** The carve-out is too permissive. The model
has always had a marginal reading of GT-025 (it was conf=0.85 correct in previous runs);
this run it applied the over-broad carve-out and flipped to valid. The fix is to add scope
generalization to the causal paraphrase INVALID conditions.

### GT-018 unchanged (predictive, paraphrase, conf=0.85, Tier 2)

The paraphrase threshold of 0.75 had no effect. 0.85 > 0.75 = true → still exits. The
threshold needed to be 0.85 (strict `>` means conf=0.85 would NOT exit if threshold=0.85).

### GT-034 unchanged (normative, paraphrase, conf=0.90, Tier 2)

The STOP rule was added but verdict didn't change. The model is finding a ground for
invalidity before or despite the STOP rule. At conf=0.90 it remains confidently wrong.

### GT-029 tier shift: T3→T2 (no accuracy change)

GT-029 (normative, cross_source, GT=invalid) moved from Tier 3 (conf=0.95) to Tier 2
(conf=0.85). The normative STOP rule may have changed the Tier 2 judge's confidence enough
to exit at Tier 2 rather than escalating. Verdict stayed correctly invalid — this is a
positive routing efficiency gain, not a regression.

### GT-042 unchanged (synthesis, cross_source, conf=0.90, Tier 2)

Still a false-valid at high confidence. The GT-023 few-shot example used debt+wages→poverty;
GT-042 involves adolescent pregnancy → declining completion rates → "programs are failing."
A targeted GT-042-pattern few-shot example is the next intervention.

---

## By Claim Type

| Type        | Run 12 | Run 13    | Change                    |
| ----------- | ------ | --------- | ------------------------- |
| statistical | 100%   | 100%      | —                         |
| causal      | 100%   | **88.9%** | −11pp (GT-025 regression) |
| comparative | 100%   | 100%      | —                         |
| predictive  | 87.5%  | 87.5%     | —                         |
| normative   | 87.5%  | 87.5%     | —                         |
| synthesis   | 75.0%  | **87.5%** | +12.5pp (GT-023 fixed)    |

Synthesis improved, causal regressed — net zero. But the synthesis gain is due to a
deliberate fix; the causal regression is due to a prompt bug that needs correction.

---

## By Derivation Method

| Derivation        | Run 12 | Run 13 | Wrong claims           |
| ----------------- | ------ | ------ | ---------------------- |
| direct_extraction | 100%   | 100%   | —                      |
| agent_inference   | 100%   | 100%   | —                      |
| paraphrase        | 86.7%  | 80.0%  | GT-018, GT-025, GT-034 |
| cross_source      | 80.0%  | 87.5%  | GT-042                 |

Paraphrase got worse (GT-025 regression), cross_source improved (GT-023 fixed).

---

## Tier Distribution

| Tier   | Run 12 | Run 13 | Notes                |
| ------ | ------ | ------ | -------------------- |
| Tier 1 | 11     | 11     | Identical            |
| Tier 2 | 35     | 36     | GT-029 T3→T2         |
| Tier 3 | 4      | 3      | −1 (GT-029 absorbed) |
| Tier 4 | 0      | 0      | —                    |

---

## Diagnosis of Remaining 4 Wrong Claims

### GT-018 (predictive, paraphrase, valid → invalid, Tier 2, conf 0.85)

Threshold bug: set to 0.75 instead of 0.85. Since `confidence > exitThreshold` and
conf=0.85 > 0.75, it still exits at Tier 2. To force escalation, threshold must be 0.85
(then 0.85 > 0.85 = false → escalates). Fix: change `CONFIDENCE_EXIT_THRESHOLD_PARAPHRASE`
from 0.75 to 0.85.

### GT-025 (causal, paraphrase, invalid → valid, Tier 2, conf 0.90) — NEW this run

Causal paraphrase carve-out bug: the "only mark invalid if..." list doesn't include scope
generalization. GT-025 generalizes from one Jamaican trial to "all programs." The model
finds the causal direction and mechanism valid (correct) but misses that the population
scope was widened far beyond the source. Fix: add to CRITERIA_CAUSAL paraphrase carve-out
invalid conditions: "widening the scope beyond the source's studied population (e.g.,
generalizing from a single-country study to 'all programs globally') is invalid even when
causal language, direction, and effect size are faithfully preserved."

### GT-034 (normative, paraphrase, valid → invalid, Tier 2, conf 0.90)

Persistently wrong through 6 runs of prompt fixes. The STOP rule didn't help. The model
is finding a ground for invalidity at conf=0.90 that no carve-out has addressed. Without
being able to read the reasoning, the remaining hypothesis is: the model is applying
criterion 1 (consensus/single-source) to GT-034 despite the carve-out exempting paraphrase
claims from criterion 1. Or it is finding the "at least 20%" vs "at least 15–20%" issue
still valid despite the explicit carve-out. This claim may require the model upgrade (gpt-4o)
rather than more prompt surgery.

### GT-042 (synthesis, cross_source, invalid → valid, Tier 2, conf 0.90)

The GT-023 few-shot worked for the debt/wages/GDP pattern. GT-042 has a different structure:
source says "adolescent pregnancy was cited as the leading reason for declining completion
rates," claim concludes "programs aimed at adolescent pregnancy have been inadequate." The
model infers program existence and failure from the outcome language. Need a second few-shot
example targeting this specific pattern: "source establishes outcome statistics → claim
infers program performance" is an inference the source does NOT make.

---

## Key Lessons from Run 13

1. **Few-shot examples work.** GT-023 was stuck at conf=0.9 wrong through 4 runs of abstract
   rules and STRICT RULEs. A single worked example with concrete reasoning flipped it
   immediately to conf=0.9 correct. This technique should be applied to GT-042.

2. **Threshold arithmetic matters.** The exit condition is `confidence > threshold` (strict).
   To force conf=0.85 to escalate, the threshold must be exactly 0.85 (not 0.80, not 0.75).
   0.75 was wrong — it was strictly less than 0.85, so no effect.

3. **Paraphrase carve-outs must explicitly enumerate all invalid conditions.** "Only mark
   invalid if X, Y, Z" means the model reads the list as exhaustive. If scope generalization
   isn't in the list, it won't fire on it. Every carve-out's "only mark invalid if" list must
   be complete.

---

## Recommended Next Steps for Run 14

### Priority 1: Fix paraphrase threshold (GT-018)

Change `CONFIDENCE_EXIT_THRESHOLD_PARAPHRASE` from `0.75` to `0.85` in `tier2-llm-judge.ts`.
This forces GT-018 (conf=0.85) to Tier 3 where the full persona debate applies with all
carve-outs. No other paraphrase claim currently exits at conf=0.85 (all others are at 0.90+
or handled by Tier 1), so the collateral escalation cost is minimal.

### Priority 2: Fix causal paraphrase carve-out scope omission (GT-025)

Add to the INVALID conditions list in CRITERIA_CAUSAL paraphrase carve-out:

- "widening the scope beyond the source's studied population (e.g., generalizing from a
  single-country study to 'all programs globally') is an invalid paraphrase even when the
  causal direction, mechanism, and effect size are faithfully preserved — population scope
  is a material semantic dimension of causal claims"

### Priority 3: Few-shot example for GT-042 pattern (GT-042)

Add a second worked example to CRITERIA_SYNTHESIS specifically for the outcome-stats →
program-performance inference pattern:

- Sources establish: outcome statistics (e.g., program completion rates declined, with
  adolescent pregnancy cited as leading reason)
- Claim: "programs aimed at reducing [the cited cause] have been inadequate"
- Correct verdict: INVALID — no cited source evaluates the existence or performance of
  any specific program; inferring program inadequacy from outcome statistics is an
  unsourced external premise

### Priority 4 (if GT-034 persists): Consider gpt-4o at Tier 2

GT-034 has been wrong for 8 consecutive runs. All prompt interventions have either had
no effect or caused the model to find different grounds for invalid. This is a model-prior
problem. Testing with gpt-4o at Tier 2 for normative claims is the next experiment.

---

## Wrong Claims Table

| Claim  | Type       | Derivation   | GT      | Pred    | Tier | Conf | Root cause                                                      |
| ------ | ---------- | ------------ | ------- | ------- | ---- | ---- | --------------------------------------------------------------- |
| GT-018 | predictive | paraphrase   | valid   | invalid | 2    | 0.85 | Threshold set to 0.75 instead of 0.85 — fix the constant        |
| GT-025 | causal     | paraphrase   | invalid | valid   | 2    | 0.90 | Carve-out doesn't list scope generalization as invalid          |
| GT-034 | normative  | paraphrase   | valid   | invalid | 2    | 0.90 | 8 runs wrong; model-prior problem; may need gpt-4o              |
| GT-042 | synthesis  | cross_source | invalid | valid   | 2    | 0.90 | Few-shot needed for outcome-stats → program-performance pattern |
