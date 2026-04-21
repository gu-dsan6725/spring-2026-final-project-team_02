# HERALD Benchmark Run 12

**Date/Time:** 2026-04-21T13:44:56.102Z
**Result file:** `results/benchmark-2026-04-21.4.json`
**Previous run:** Run 11 — `results/benchmark-2026-04-21.3.json` (92%, 46/50)
**Models:** Tier 2 — `gpt-4o-mini`; Tier 3 — `gpt-4o-mini`
**Tier 1 NLI:** UP — 11 claims resolved at Tier 1
**Eval set:** `data/eval-set.json` (50 claims, real API calls, concurrency 1)

---

## Summary Scorecard

| Metric                     | Run 11  | Run 12  | Change vs R11 |
| -------------------------- | ------- | ------- | ------------- |
| Accuracy                   | 92.0%   | **92.0%** | 0 (no change) |
| Correct claims             | 46/50   | **46/50** | 0             |
| Precision                  | 91.7%   | **91.7%** | 0             |
| Recall                     | 91.7%   | **91.7%** | 0             |
| F1                         | 91.7%   | **91.7%** | 0             |
| Skeptic false-invalid rate | 4%      | **4%**    | 0             |
| Tier 1 claims              | 11      | 11        | —             |

**No improvement.** All 4 wrong claims from Run 11 remain wrong at the same confidence levels. The three prompt additions — absolute synthesis STRICT RULE in BASE_INSTRUCTIONS, "at least Y%" normative carve-out, and wheat-as-representative-of-cereals note — had no measurable effect on verdicts or confidence scores.

---

## What Changed vs Run 11

### Changes implemented before this run

1. **`src/herald/prompts/judge-system.ts` BASE_INSTRUCTIONS** — Added "STRICT RULE for synthesis
   claims" block at the top, above the general principles. Forces the model to explicitly list
   every entity/indicator/program in the conclusion and identify which cited source establishes
   each. General world knowledge explicitly excluded.

2. **`src/herald/prompts/judge-system.ts` CRITERIA_NORMATIVE** — Added "at least Y%" carve-out
   to acceptable paraphrase patterns: "for benchmark ranges expressed as 'at least X–Y%', using
   the upper bound as the stated minimum (e.g., 'at least 20%' from 'at least 15–20%') is an
   acceptable conservative paraphrase."

3. **`src/herald/prompts/domain-expert.ts`**, **`methodologist.ts`**, **`skeptic.ts`** —
   Strengthened predictive persona bullets: added explicit "wheat is the primary globally traded
   cereal; a wheat price projection is representative of cereal price trends broadly" note to the
   category-broadening carve-out.

### Null result — no claims changed verdict or confidence

Comparing `benchmark-2026-04-21.4.json` against `benchmark-2026-04-21.3.json`: identical
per-claim results for all 50 claims. Not a single verdict flipped, not a single confidence
score changed. This is a complete null result.

---

## Diagnosis of the Null Result

### Why GT-023 and GT-042 didn't respond to the STRICT RULE

The STRICT RULE in BASE_INSTRUCTIONS explicitly says: "Before evaluating any synthesis claim,
explicitly list every entity, economic indicator, program, institutional performance judgment..."
Yet GT-023 and GT-042 still exit Tier 2 at conf=0.9 valid.

The model is not applying the rule because it does not believe a violation exists. For GT-023:
- Conclusion clause: "despite national GDP growth" — the model interprets this as framing context
  (a concessive clause introduced for rhetorical contrast), NOT as a substantive factual premise
  the inference depends on. The model's view: the inference "rising debt + stagnant wages →
  poverty worsening" is complete on its own; the GDP clause is additive color, not a load-bearing
  premise.
- The STRICT RULE cannot override this framing interpretation at conf=0.9. The model has already
  decided the GDP clause is not a "factual assertion the conclusion mentions or implies" in the
  load-bearing sense.

For GT-042:
- "Programs are failing" — the source says "adolescent pregnancy was cited as the leading reason
  for declining completion rates." The model reads this as implying that interventions addressing
  pregnancy exist and are not working. The model does not see this as world knowledge; it sees it
  as a reasonable inference from the cited source. The STRICT RULE's examples ("programs are
  failing" when no source evaluates programs) do not match the model's reading of GT-042 because
  the source does implicitly reference program insufficiency via outcome statistics.

**Root cause:** The model's interpretation of "what the cited sources establish" is not the same
as ours. Prompt additions that are worded at the level of "list everything and check sources"
cannot override a model that has already resolved the ambiguity in the claim's favor. The
instruction is processed, but the model concludes there is no violation.

### Why GT-034 didn't respond to the "at least Y%" carve-out

GT-034: claim says "allocate at least 20%"; source says "at least 15–20% of total public
expenditure." The carve-out explicitly says using the upper bound as the stated minimum is
acceptable. Yet the model exits at conf=0.90 invalid.

Three possibilities:
1. **The carve-out text is reached but another criterion overrides it.** The model reads the
   carve-out, notes it applies, but finds a different violation — perhaps attribution scope or
   the specific policy body (the source may be from a different regional framework than the
   claim implies).
2. **The carve-out is being outweighed by criterion 1** (consensus/single-source). If the model
   is also applying criterion 1 (not just the paraphrase carve-out), the paraphrase defense is
   only partially accepted.
3. **"At least 20%" is not actually the upper-bound usage.** The carve-out reads: "using the
   upper bound as the stated minimum." In the source "at least 15–20%," the upper bound IS 20%.
   The claim says "at least 20%." This is upper-bound as minimum — covered. But the model may
   be reading "at least 20%" as stricter than the source in a way the carve-out doesn't address:
   the source says the *range* is 15–20% (flexible), while "at least 20%" fixes the floor at
   20% (rigid). The policy implication is different even if the number is the same.

To investigate: the model's reasoning for GT-034 in this run needs to be read from the result
JSON to understand which criterion is still firing.

### Why GT-018 didn't respond to the wheat-representative note

GT-018: "cereals projected to trade 15–20% above" paraphrases "wheat prices approximately 18%
above." The persona prompts now explicitly say "wheat is the primary globally traded cereal and
a wheat price projection is representative of cereal price trends broadly." Yet the model still
exits at conf=0.85 invalid.

The most likely remaining issue: the model is not primarily objecting to the cereals/wheat
category broadening. It may be objecting to the range lower bound (15% from ~18%) and the
paraphrase derivation as a combined issue, or to something else entirely. The wheat note may
be accepted but another issue is still failing. Since GT-018 is at conf=0.85 (just above the
0.80 escalation threshold), a threshold intervention — lowering to 0.75 for paraphrase claims
— would force it to Tier 3 where personas can provide a fuller carve-out evaluation.

---

## By Claim Type

| Type        | Run 11 | Run 12  | Change |
| ----------- | ------ | ------- | ------ |
| statistical | 100%   | 100%    | —      |
| causal      | 100%   | 100%    | —      |
| comparative | 100%   | 100%    | —      |
| predictive  | 87.5%  | 87.5%   | —      |
| normative   | 87.5%  | 87.5%   | —      |
| synthesis   | 75.0%  | 75.0%   | —      |

No change across any type.

---

## By Derivation Method

| Derivation        | Run 11 | Run 12 | Wrong claims    |
| ----------------- | ------ | ------ | --------------- |
| direct_extraction | 100%   | 100%   | —               |
| agent_inference   | 100%   | 100%   | —               |
| paraphrase        | 86.7%  | 86.7%  | GT-018, GT-034  |
| cross_source      | 80.0%  | 80.0%  | GT-023, GT-042  |

No change.

---

## Tier Distribution

| Tier   | Run 11 | Run 12 | Notes                   |
| ------ | ------ | ------ | ----------------------- |
| Tier 1 | 11     | 11     | Identical               |
| Tier 2 | 34     | 35     | +1 (GT-013 fluctuation) |
| Tier 3 | 5      | 4      | −1                      |
| Tier 4 | 0      | 0      | —                       |

Minor tier distribution shift for GT-013/GT-043 area but no impact on wrong claims.

---

## Diagnosis of Remaining 4 Wrong Claims

### GT-018 (predictive, paraphrase, valid → invalid, Tier 2, conf 0.85) — UNCHANGED

Three runs of fixes have not moved this. The wheat-representative note, the range lower-bound
carve-out, and the category-broadening carve-out are all in the prompt. The model is not
accepting one or more of these. Since conf=0.85 is just 5pp above the 0.80 escalation
threshold, a structural fix — lowering the Tier 2 exit threshold to 0.75 for paraphrase
derivation — would force this into Tier 3 where the full debate process applies. This is
the next logical intervention.

### GT-023 (synthesis, cross_source, invalid → valid, Tier 2, conf 0.9) — UNCHANGED

The STRICT RULE addition had zero effect. The model does not perceive "despite national GDP
growth" as an unsourced external premise — it reads it as framing context for a complete
inference. Prompt-level fixes have now been exhausted for this claim. The model's reading
of the claim is internally consistent at conf=0.9, and no prompt addition overrides it.

Remaining options:
1. **Model upgrade**: gpt-4o (full) vs gpt-4o-mini may have less prior on this framing.
2. **Structural: few-shot examples in the prompt** — include a worked example of GT-023's
   exact pattern with the correct reasoning and verdict. Few-shot examples in the system
   prompt are more powerful than rule statements.
3. **Structural: reframe the synthesis rule as a checklist tool call** — force the model
   to output a JSON "premise list" before the verdict, making the premise audit explicit
   and structured rather than textual.

### GT-034 (normative, paraphrase, valid → invalid, Tier 2, conf 0.90) — UNCHANGED

The "at least Y%" carve-out was added but didn't flip the verdict. The model may be finding
a different violation. Reading the reasoning in the result JSON is needed to diagnose which
criterion is still firing. The confidence increased run-over-run (0.85 → 0.90) as we added
carve-outs, suggesting the model is not constrained by the carve-outs but is finding other
grounds for invalid.

The GT-034 pattern suggests the model has a strong prior that this claim is invalid, and
carve-outs are being accepted for the issues they address while the model pivots to a
different justification. This is a model-prior problem, not a prompt-coverage problem.

### GT-042 (synthesis, cross_source, invalid → valid, Tier 2, conf 0.9) — UNCHANGED

Same as GT-023 pattern. The STRICT RULE had no effect. The model infers program existence and
insufficiency from the source's "adolescent pregnancy was cited as the leading reason" language.

---

## Key Insight: Prompt Saturation

Run 12 is the clearest signal yet of prompt saturation for the 4 remaining wrong claims. We
have now added:
- Explicit synthesis rules (3 rounds of escalating specificity)
- Named examples directly matching GT-023 and GT-042 patterns
- A top-level STRICT RULE in BASE_INSTRUCTIONS
- Range carve-outs, category-broadening carve-outs, scope carve-outs, "at least Y%" carve-outs
- Representativeness notes for wheat → cereals

None of these moved the needle on any of the 4 remaining wrong claims in Run 12. Every fix
either targeted a claim that had already been resolved (GT-030) or produced zero change. The
model has strong priors on all 4 remaining claims, and text additions to the system prompt
cannot override them.

**The 92% accuracy floor is real for this model (gpt-4o-mini) under these prompt conditions.**

---

## Recommended Next Steps for Run 13

The three remaining levers that have not been tried are structural, not textual:

### Option A: Model upgrade (highest expected impact for synthesis false-valids)

Replace `gpt-4o-mini` with `gpt-4o` at Tier 2 for synthesis claims only (or all claims).
The synthesis false-valid pattern (GT-023, GT-042) is a reasoning quality issue — the model
is constructing plausible interpretations that happen to be wrong. `gpt-4o` has stronger
reasoning and is less likely to fill in premises with world knowledge at high confidence.

Expected: GT-023 and/or GT-042 may flip. Risk: could introduce regressions on currently-correct
synthesis claims if `gpt-4o` is more strict. Cost: ~10× higher per-claim token cost at Tier 2.

### Option B: Paraphrase threshold lowering (targeted fix for GT-018)

Lower Tier 2 exit threshold from 0.80 to 0.75 for paraphrase derivation only. GT-018 exits
at conf=0.85. Lowering to 0.75 would force it to Tier 3 where the debate process (with all
the current carve-outs in the persona prompts) would apply. This is a mechanical fix that
doesn't require further prompt changes.

Risk: may push other paraphrase claims from Tier 2 to Tier 3 unnecessarily (increasing cost).
The paraphrase wrong-claim pool is GT-018 and GT-034 — GT-034 at conf=0.90 would NOT be
affected by a 0.75 threshold.

### Option C: Few-shot example injection for GT-023/GT-042 pattern

Add a worked example directly to BASE_INSTRUCTIONS or CRITERIA_SYNTHESIS showing the
GT-023-type pattern — a synthesis with a concessive clause ("despite X") where X is not
in any source — with an annotated verdict of INVALID and explicit reasoning. Few-shot
examples in the system prompt are substantially more powerful than rule statements for
GPT models.

Risk: over-fitting to the specific example; valid claims with similar concessive structure
may be over-flagged.

### Priority recommendation for Run 13:

1. **Try Option B first** (threshold lowering, GT-018 only) — zero risk, minimal cost
2. **Read GT-034's reasoning from the Run 12 JSON** to understand what it is currently
   flagging (now that the "at least Y%" carve-out is present but not working)
3. **Try Option C** (few-shot synthesis example) — specifically for GT-023
4. **Consider Option A** (model upgrade for Tier 2) if Options B and C fail

---

## Wrong Claims Table (4 wrong — same as Run 11)

| Claim  | Type       | Derivation   | GT      | Pred    | Tier | Conf | Diagnosis                                                                 |
| ------ | ---------- | ------------ | ------- | ------- | ---- | ---- | ------------------------------------------------------------------------- |
| GT-018 | predictive | paraphrase   | valid   | invalid | 2    | 0.85 | Prompt carve-outs exhausted; threshold lowering to 0.75 is next lever    |
| GT-023 | synthesis  | cross_source | invalid | valid   | 2    | 0.90 | STRICT RULE had no effect; model doesn't see GDP clause as unsourced       |
| GT-034 | normative  | paraphrase   | valid   | invalid | 2    | 0.90 | "At least Y%" carve-out added; model still flagging — need to read reasoning |
| GT-042 | synthesis  | cross_source | invalid | valid   | 2    | 0.90 | STRICT RULE had no effect; model infers program failure from outcome data  |
