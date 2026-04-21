# HERALD Benchmark Run 09

**Date/Time:** 2026-04-21T03:30:17.770Z
**Result file:** `results/benchmark-2026-04-21.json`
**Previous run:** Run 8 — `results/benchmark-2026-04-20.3.json` (90%, 45/50)
**Models:** Tier 2 — `gpt-4o-mini` (OpenAI); Tier 3 — `gpt-4o-mini` (OpenAI)
**Tier 1 NLI:** DOWN — Python backend unreachable; all claims fell back to Tier 2
**Eval set:** `data/eval-set.json` (50 claims, real API calls, concurrency 1)

**Changes before this run:** 6 prompt edits across 4 files targeting the 5 wrong claims
from Run 8. Details in changelog entry.

---

## Summary Scorecard

| Metric                     | Run 8   | Run 9   | Change   |
| -------------------------- | ------- | ------- | -------- |
| Accuracy                   | 90.0%   | 88.0%   | −2pp ⚠  |
| Correct claims             | 45/50   | 44/50   | −1       |
| Precision                  | 91.3%   | 90.9%   | −0.4pp   |
| Recall                     | 87.5%   | 83.3%   | −4.2pp   |
| F1                         | 89.4%   | 87.0%   | −2.4pp   |
| Skeptic false-invalid rate | 6%      | 10%     | +4pp ⚠  |
| Tier 1 claims              | 11      | 0       | −11      |
| Tier 3 claims              | 6       | 7       | +1       |

**Net result: regression by 1 claim.** The normative paraphrase carve-out fixed GT-008
(+1), but the synthesis unsourced-premises criterion introduced a new regression on GT-036
(−1) and GT-030 was newly exposed when Tier 1 went down (−1). With Tier 1 running and
GT-036 not regressed, this run would have been 90%.

---

## What Changed vs Run 8

Three simultaneous effects, only one positive:

### 1. GT-008 FIXED (+1)
The strengthened normative paraphrase carve-out in `CRITERIA_NORMATIVE` worked.
GT-008 (normative paraphrase "widely considered best practice") now exits Tier 2 as
valid with confidence 0.90, up from invalid at 0.85. The key additions that worked:
- Explicitly disabling criterion 1 (single-source rule) for paraphrase derivation
- Concrete example: "widely considered best practice" is acceptable for a UN-Water
  characterization of something as "a critical element"

### 2. GT-036 REGRESSION (−1) — synthesis unsourced-premises check too broad
GT-036 (synthesis, agent_inference, valid) was correct in Runs 5–8 and is now wrong.
The new unsourced-premises criterion in `CRITERIA_SYNTHESIS` introduced this regression.

**The claim:** "Simultaneous declines in agricultural extension worker density and increases
in pesticide-resistant crop pests suggest that smallholder productivity gains in West Africa
may plateau within the next decade."

**Sources:** (1) Extension worker-to-farmer ratios declined 1:1,500 → 1:3,000 (2010–2021).
(2) Pesticide-resistant fall armyworm and legume pod borer are growing threats.

**Why the regression:** The model is reading "may plateau within the next decade" as an
unsourced forward-looking claim, and the new criterion says "does the conclusion introduce
any institutional performance judgment that is NOT present in any cited source?" The model
correctly notes the sources don't use the word "plateau" and interprets this as an unsourced
premise. But this is **wrong** — the plateau inference is a valid logical consequence of the
two source-established trends (declining support + increasing pest threats), not an
independently injected fact.

**Root cause:** The unsourced-premises criterion doesn't distinguish between:
- **INVALID**: Introducing new factual context as a premise (e.g., "despite GDP growth"
  when no source discusses GDP; "programs are failing" when no source evaluates programs)
- **VALID**: Drawing a forward-looking inference from trends already established by the
  combined sources

The criterion examples (GDP growth, programs failing) were correctly targeted at GT-023
and GT-042, but the general framing swept up GT-036 as well.

### 3. GT-030 NEWLY EXPOSED (−1) — Tier 1 infrastructure dependency
GT-030 (causal paraphrase, valid) was handled by Tier 1 NLI in Runs 5–8 with confidence
0.997. Tier 1 is down in Run 9 (Python backend unreachable for all 50 claims), so GT-030
falls to Tier 2 where it exits invalid at confidence 0.85.

**The claim:** "Rainfall variability in the Horn of Africa has increased by 15% over the
past two decades, intensifying drought cycles."
**Source:** "coefficient of variation for rainfall increased by approximately 15%... coincided
with more frequent drought cycles"

The Tier 2 judge fires on "intensifying" vs. the source's "coincided with" — flagging causal
strength drift. The source uses correlational language; the claim uses "intensifying" which
implies contribution. Ground truth says valid (human evaluators accepted this as within the
bounds of a reasonable causal paraphrase). No paraphrase carve-out exists in `CRITERIA_CAUSAL`.

**This is a pre-existing Tier 2 weakness** that was masked by Tier 1 in prior runs.
The causal criteria have no paraphrase carve-out analogous to what normative and predictive
now have.

---

## By Claim Type

| Type        | Total | Run 8    | Run 9    | Change   |
| ----------- | ----- | -------- | -------- | -------- |
| statistical | 9     | 100%     | 100%     | —        |
| causal      | 9     | 100%     | 88.9%    | −11pp ⚠ |
| comparative | 8     | 100%     | 100%     | —        |
| predictive  | 8     | 87.5%    | 87.5%    | —        |
| normative   | 8     | 75.0%    | 87.5%    | +12.5pp ✓|
| synthesis   | 8     | 75.0%    | 62.5%    | −12.5pp ⚠|

**Normative improved** (+12.5pp) — GT-008 fixed.
**Causal degraded** (−11pp) — GT-030 exposed by Tier 1 outage.
**Synthesis degraded** (−12.5pp) — GT-036 regressed. Still two false-valid cross_source
claims (GT-023, GT-042) that were wrong in Run 8 and remain wrong.

---

## By Derivation Method

| Derivation        | Total | Run 8 | Run 9 | Change  |
| ----------------- | ----- | ----- | ----- | ------- |
| direct_extraction | 14    | 100%  | 100%  | —       |
| paraphrase        | 15    | 86.7% | 80.0% | −6.7pp  |
| cross_source      | 10    | 80.0% | 80.0% | —       |
| agent_inference   | 11    | 90.9% | 90.9% | —       |

**Paraphrase** remains the weakest derivation method (4 of 6 wrong claims are paraphrase).
GT-030 (causal paraphrase) joins GT-018, GT-034 as paraphrase false-invalids.

---

## Tier Distribution

| Tier   | Run 8 | Run 9 | Notes                                       |
| ------ | ----- | ----- | ------------------------------------------- |
| Tier 1 | 11    | 0     | NLI backend down this run                   |
| Tier 2 | 33    | 43    | +10 claims absorbed from Tier 1 outage      |
| Tier 3 | 6     | 7     | GT-034 now escalates to Tier 3              |
| Tier 4 | 0     | 0     | —                                           |

The Tier 1 outage redistributed 11 claims to Tier 2. Of those, 10 were handled correctly
by Tier 2 (same verdict as Tier 1 would have given), and 1 was not (GT-030). This is
actually a strong result for Tier 2 robustness under Tier 1 failure conditions.

---

## Diagnosis of Wrong Claims

### Paraphrase false-invalids (3 claims)

**GT-030** (causal, paraphrase, valid → invalid, Tier 2, conf 0.85)
New failure exposed by Tier 1 outage. Source says rainfall variability "coincided with"
more frequent drought cycles; claim says variability is "intensifying drought cycles."
CRITERIA_CAUSAL has no paraphrase carve-out. The causal criteria correctly flag
"coincided with → intensifying" as potential causal strength drift but the ground truth
accepts this as within-range for a causal paraphrase. Fix: add paraphrase carve-out to
CRITERIA_CAUSAL analogous to what predictive and normative now have.

**GT-018** (predictive, paraphrase, valid → invalid, Tier 3, conf 0.95)
Unchanged from Run 8. The new predictive paraphrase carve-outs added to all three persona
prompts did not help — all 3 personas still vote invalid unanimously at 0.95 confidence.
The claim says "cereals 15–20% above" but the source says "wheat ~18%." The personas are
likely firing on the "cereals" vs. "wheat" scope expansion (wheat is a cereal but the
source only data is for wheat). The carve-out added to the persona prompts mentions
"using a broader category name (e.g., cereals) for a specific crop (e.g., wheat)" but
this is in CRITERIA_PREDICTIVE (Tier 2 system prompt) not in the persona prompts.
The persona bullet updates were more general ("if the range encompasses source figures")
and apparently aren't specific enough.

**GT-034** (normative, paraphrase, valid → invalid, Tier 3, conf 0.95)
Changed tier from 2 → 3 (the carve-out made the Tier 2 judge uncertain rather than
confident-invalid), but the Tier 3 debate ends in unanimous invalid (3-0). The examples
added to CRITERIA_NORMATIVE (specific to Tier 2) aren't in the Tier 3 persona prompts.
The general carve-out language in persona normative bullets isn't strong enough — the
personas need the same concrete examples: "public expenditure reviews" as acceptable
attribution for "Education 2030 Framework for Action," "20%" acceptable from "15–20%."

### Synthesis false-valids (2 claims)

**GT-023** (synthesis, cross_source, invalid → valid, Tier 2, conf 0.9)
Unchanged. The "despite national GDP growth" phrase requires GDP data not present in any
source. The unsourced-premises criterion should catch this, but the model is not applying
it correctly — or the criterion is not specific enough to distinguish "GDP growth" as an
external premise. This claim also benefited from the general synthesis liberalization that
fixed GT-010/026/046, and remains a false valid.

**GT-042** (synthesis, cross_source, invalid → valid, Tier 2, conf 0.9)
Unchanged. The conclusion "programs are failing" evaluates program performance with no
source mentioning any programs. Same pattern as GT-023 — the unsourced-premises check
hasn't landed for this claim despite the criterion being designed for exactly this case.

### Synthesis regression

**GT-036** (synthesis, agent_inference, valid → invalid, Tier 2, conf 0.85)
New regression. The unsourced-premises check incorrectly caught a valid forward-looking
inference from two source-established trends. The criterion examples targeted GT-023/042
but swept up GT-036 because the wording ("any institutional performance judgment NOT in
any cited source") is too broad. "Productivity gains may plateau" is not an external fact
injected as a premise — it is the conclusion of the synthesis, inferred from the combined
source trends.

---

## Root Cause Pattern

The Session 9 failures all share a common theme: **the prompt criteria are not sufficiently
distinguishing between different types of "things not in the sources"**:

1. For synthesis: the unsourced-premises criterion conflates
   - **External facts used as premises** (GDP growth, program performance) — should be INVALID
   - **Forward-looking inferences from source trends** (productivity may plateau) — should be VALID

2. For paraphrase: the claim-type-specific carve-outs added to Tier 2 (judge-system.ts)
   are not propagated to the Tier 3 persona prompts. Claims that escalate to Tier 3
   lose the benefit of the specific examples (GT-034), and the general carve-out language
   in the persona bullet points is not specific enough to override unanimous invalid votes.

---

## Recommended Next Steps for Run 10

In order of expected impact:

### Priority 1: Fix GT-036 synthesis regression — CRITERIA_SYNTHESIS criterion 1

Rewrite to distinguish "unsourced external facts as premises" vs "inferred conclusions":

> An unsourced premise is a factual claim about the real world — a statistic, economic
> indicator, or institutional performance judgment — that the synthesis treats as an
> established given but that appears in none of the cited sources. This is different
> from the synthesis conclusion itself, which by definition is not stated in any single
> source. Ask: does the conclusion require the reader to accept an additional factual
> claim that no source establishes? If yes → INVALID. If the conclusion is solely an
> inference from trends and data the sources do establish → VALID.

### Priority 2: Add causal paraphrase carve-out — CRITERIA_CAUSAL

For paraphrase derivation, "contributing to" / "intensifying" / "exacerbating" are
acceptable paraphrase upgrades from "coincided with" / "associated with" when the
quantitative relationship in the source (e.g., a measured increase) provides inferential
support for the directional causal claim. Only flag invalid if the paraphrase asserts
strong, unidirectional causation from a purely correlational source.

### Priority 3: Propagate normative carve-out examples to persona prompts

The specific examples in CRITERIA_NORMATIVE (Tier 2) need to also appear in the
normative bullet of all three persona prompts (domain-expert, methodologist, skeptic):
- "public expenditure reviews" is acceptable attribution for "Education 2030 Framework"
- "20%" is acceptable as the headline from "15–20%"
This is needed because GT-034 now escalates to Tier 3 where personas lack these examples.

### Priority 4: Strengthen predictive paraphrase persona bullets for GT-018

The current persona-level carve-out is too vague. Need to add explicit text matching
what's in CRITERIA_PREDICTIVE: "using a broader category name (e.g., cereals) for a
specific crop (e.g., wheat) is acceptable when the projection is directionally applicable
to that broader category."

### Note on Tier 1 infrastructure

GT-030 is structurally sound when Tier 1 NLI is running (confidence 0.997). Adding a
CRITERIA_CAUSAL paraphrase carve-out will fix this when Tier 1 is down. This is the
correct resilience approach rather than depending on Tier 1 availability.

---

## Wrong Claims Table (6 wrong)

| Claim  | Type       | Derivation      | GT      | Pred    | Tier | Conf | Diagnosis                                                       |
| ------ | ---------- | --------------- | ------- | ------- | ---- | ---- | --------------------------------------------------------------- |
| GT-018 | predictive | paraphrase      | valid   | invalid | 3    | 0.95 | Persona carve-outs too vague; "cereals" vs "wheat" scope drift  |
| GT-023 | synthesis  | cross_source    | invalid | valid   | 2    | 0.90 | Unsourced-premises check not catching GDP premise               |
| GT-030 | causal     | paraphrase      | valid   | invalid | 2    | 0.85 | No causal paraphrase carve-out; exposed by Tier 1 outage        |
| GT-034 | normative  | paraphrase      | valid   | invalid | 3    | 0.95 | Persona prompts lack normative carve-out examples; T3 unanimous |
| GT-036 | synthesis  | agent_inference | valid   | invalid | 2    | 0.85 | Unsourced-premises criterion too broad; caught valid inference  |
| GT-042 | synthesis  | cross_source    | invalid | valid   | 2    | 0.90 | "Programs are failing" unsourced premise not caught             |
