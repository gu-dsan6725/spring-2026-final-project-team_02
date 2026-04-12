# Tier Routing Improvements — Run 05 → Run 06

**Branch:** `feature/improve-tier1-thresholds-reformulation`
**Date:** 2026-04-12

## Background

Analysis of run 05 (306 cases, gov_report_v2 filtered dataset) revealed that
**79% of all errors (27/34) came from Tier 1 resolving with high confidence on
cases it got wrong**. The dominant failure mode: NLI assigns 0.97–0.99
entailment to numerically invalid claims because the sentence *structure* closely
matches the source while an embedded number or date is wrong.

Example from run 05:
- **Source:** "The Commercial Space Launch Act Amendments of **1988**…"
- **Output:** "…Act Amendments of **1984**…"
- **T1 entailment score:** 0.993 → resolved as VALID

NLI cannot compare numbers; it measures textual entailment. This class of error
requires an LLM that can do explicit value-by-value cross-checking.

Full error breakdown:

| Error type | Count | Root cause |
|---|---|---|
| T1 false negatives (invalid → valid) | 27 | NLI surface-level entailment |
| False positives (valid → invalid) | 6 | T2 over-strict on causal/retrieval |
| T2/T3 errors | 7 | Model bias, T3 anchored on T2 verdict |

---

## Fix 1 — Wire `skip_nli` routing into `escalation.py`

**File:** `src/herald/pipeline/escalation.py`

**Problem:** The `checkpoint_routing.skip_nli` list in `default.yaml` was never
read by `HeraldPipeline`. T1 resolved every checkpoint type unconditionally.

**Change:** `HeraldPipeline.__init__` now accepts `skip_nli_types: set[str]`.
Inside `validate()`, if the checkpoint type is in `skip_nli_types`, T1 still
runs (its raw scores remain useful signal for T2/T3) but its verdict is
suppressed — the case always escalates to T2.

`build_pipeline()` reads `config["checkpoint_routing"]["skip_nli"]` and passes
it through.

**Config (unchanged — already defined):**
```yaml
checkpoint_routing:
  skip_nli: ["causal", "epistemic"]
```

**Expected impact:** ~8 of the 27 T1 false negatives were causal cases. These
now route to T2 where the LLM can assess causal attribution strength.

---

## Fix 2 — Numerical verification block in T2 judge prompt

**File:** `src/herald/tier2/judge.py`

**Problem:** The T2 judge prompt says "check carefully for wrong numbers" but
does not force the model to enumerate and cross-check each value before issuing
a verdict. Models skip this step unless explicitly prompted.

**Change:** Added `_NUMERICAL_VERIFICATION_BLOCK`, a structured pre-verdict
checklist injected into `JUDGE_TEMPLATE` when `checkpoint_type` is `numerical`
or `synthesis`. The block instructs the model to:

1. Extract every number, date, year, percentage, and statistic from the output.
2. Locate each one in the source context.
3. Flag INVALID if any value does not match exactly.

The block is empty string for other checkpoint types, so the prompt is
unchanged for retrieval, claim_extraction, and causal.

**Why synthesis too:** Synthesis outputs often embed specific figures from
the source in summarised form. The same NLI blind spot applies.

---

## Fix 3 — Wire `prefer_debate` routing into `escalation.py`

**File:** `src/herald/pipeline/escalation.py`

**Problem:** Same as Fix 1 — `checkpoint_routing.prefer_debate` was defined in
config but never consulted. T2 resolved causal and synthesis cases with no
chance for adversarial review.

**Change:** `HeraldPipeline.__init__` now accepts `prefer_debate_types: set[str]`.
Inside `validate()`, after T2 reaches a confident (non-UNCERTAIN) verdict, if the
checkpoint type is in `prefer_debate_types`, the case skips the T2 resolution
step and falls through to T3 debate instead.

**Why this helps for causal/synthesis:** The T2 `JUDGE_SYSTEM` prompt defaults
to INVALID-bias ("default to INVALID if unsure"). This is correct for numerical
cases but causes false positives on causal claims that are valid inferences from
the source. The Tier 3 debate structure (independent advocate + critic + judge)
reduces this false-positive rate without hurting invalid recall.

**Config (unchanged — already defined):**
```yaml
checkpoint_routing:
  prefer_debate: ["causal", "synthesis"]
```

**Note:** `prefer_debate` applies even when Tier 2.5 counterfactual probe is
enabled. The probe runs on the confident T2 verdict, but for `prefer_debate`
types the escalation to T3 happens regardless of the probe result.

---

## Fix 4 — Remove T2 verdict anchor from T3 advocate/critic prompts

**File:** `src/herald/tier3/debate.py`

**Problem:** `ADVOCATE_PROMPT` and `CRITIC_PROMPT` both included:
```
## Prior Analysis
Tier 2 Judge: {tier2_reasoning}
```

This caused all three debate agents (advocate, critic, judge) to anchor on the
T2 verdict before forming their own views. When T2 was wrong, T3 inherited the
error instead of correcting it — directly contradicting the purpose of debate.

**Change:**
- `ADVOCATE_PROMPT` and `CRITIC_PROMPT` now receive only T1 NLI signal and the
  source. No T2 verdict, no T2 reasoning.
- `DEBATE_JUDGE_PROMPT` receives T2 reasoning as one additional input (after
  the two independent arguments) under the label:
  `## Prior Tier 2 Analysis (one input among many — do not treat as authoritative)`
- The `advocate_ctx` dict passed to advocate/critic no longer contains
  `tier2_reasoning`. The judge call still receives it via `tier2_result.reasoning`.

**Before:** T1 scores + T2 verdict + T2 reasoning → advocate, critic, judge  
**After:**  T1 scores only → advocate, critic; T1 + both arguments + T2 reasoning → judge

---

## Fix 5 — Per-type T1 threshold overrides in config

**File:** `configs/default.yaml`

**Problem:** With Fix 1, `numerical` and `synthesis` types that are NOT in
`skip_nli` still faced only the global T1 threshold (0.70). Cases with
entailment scores of 0.71–0.84 were resolving at T1 when they should be
escalating. A stricter bar forces more of these borderline cases to T2.

**Change:** Added `T1_by_type` sub-map under `thresholds`:

```yaml
thresholds:
  T1: 0.70
  T2: 0.80
  T1_by_type:
    numerical: 0.85
    synthesis: 0.85
```

`build_pipeline()` reads `T1_by_type` and passes it to `HeraldPipeline` as
`t1_thresholds_by_type: dict[str, float]`. Inside `validate()`, the per-type
threshold is looked up before calling `tier1.classify()`:

```python
t1_threshold = self.t1_thresholds_by_type.get(cp_type, self.t1)
t1 = self.tier1.classify(checkpoint, threshold=t1_threshold)
```

**Note on interaction with Fix 1:** For types in `skip_nli` (causal, epistemic),
the threshold value is irrelevant — T1's verdict is suppressed regardless.
`T1_by_type` is therefore only meaningful for types not in `skip_nli`.

---

## Interaction between fixes

The five fixes compose as follows for each checkpoint type:

| Type | Fix 1 (skip_nli) | Fix 5 (T1 threshold) | Fix 3 (prefer_debate) | Fix 2 (num block) |
|---|---|---|---|---|
| `retrieval` | No | Global 0.70 | No | No |
| `claim_extraction` | No | Global 0.70 | No | No |
| `numerical` | No | **0.85** | No | **Yes** |
| `synthesis` | No | **0.85** | **Yes → T3** | **Yes** |
| `causal` | **Yes → T2** | n/a | **Yes → T3** | No |
| `epistemic` | **Yes → T2** | n/a | No | No |

For `synthesis`: T1 threshold is raised to 0.85 AND any T2 verdict escalates to
T3 AND the numerical block is injected into T2. This is the most defended path.

For `causal`: T1 never resolves, T2 always escalates to T3. Two independent
layers of protection against the overconfident-invalid error pattern.

---

## Expected improvements vs run 05

| Metric | Run 05 | Expected direction |
|---|---|---|
| Overall accuracy | 88.9% | +3–5pp |
| `label_invalid` recall | 81.7% | +5–8pp (main target) |
| `cp_numerical` accuracy | 90.0% | +3–5pp |
| `cp_causal` accuracy | 82.6% | +2–4pp |
| `cp_synthesis` accuracy | 87.8% | +2–4pp |
| T1 resolution rate | 69.0% | −10–15pp (more escalation) |
| T2/T3 call volume | ↑ | Higher API usage |

The primary trade-off is cost: more cases will reach T2 and T3, consuming more
API quota. On the Gemini free tier (1M tokens/day) this is acceptable for the
306-case eval set but should be monitored for larger batches.
