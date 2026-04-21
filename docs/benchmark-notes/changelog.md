# HERALD Benchmark Changelog

This file is the running log of every benchmark run, what changed before it, and what the
results revealed. **Update this file every time you run the benchmark.** See CLAUDE.md for
the rule that enforces this.

The benchmark command is:

```bash
npx tsx --env-file=.env scripts/run-herald-benchmark.ts --concurrency 1
```

Results are written to `results/` with a timestamp-based filename. Always record the exact
filename here.

---

## How to Read This Log

Each entry has:

- **Result file** — the JSON in `results/`
- **Accuracy** — the headline metric (exact verdict match, valid vs invalid)
- **Changes before this run** — what was modified in the code/prompts since the previous run
- **What the results revealed** — diagnosis, patterns, remaining errors
- **Wrong claims** — the specific claim IDs still failing and why

---

## Run History

---

### Run 0 — Broken baseline

**Result file:** `results/benchmark-2026-04-17.json`
**Timestamp:** 2026-04-17T19:41:18Z
**Accuracy:** 0% (pipeline broken — all verdicts 0/null)
**Changes before this run:** Initial pipeline setup. First attempt to run the benchmark.
**What happened:** The benchmark runner itself had bugs — all accuracy metrics came back as 0. The evaluation pipeline was not yet functional. This run was used to validate that the
benchmark harness could execute without crashing, not to measure HERALD accuracy.

---

### Run 0b — Dry run validation

**Result file:** `results/benchmark-2026-04-18.json`
**Timestamp:** 2026-04-18T14:39:39Z
**Accuracy:** 100% (dry run — deterministic mock verdicts, not real API calls)
**Changes before this run:** `--dry-run` flag added to benchmark runner. No pipeline changes.
**What happened:** Dry run uses deterministic mock verdicts that always match ground truth.
This confirmed the benchmark harness, scoring logic, and output format were all working
correctly. Not a real evaluation — the 100% is meaningless as a HERALD accuracy number.

---

### Run 1 — First real baseline

**Result file:** `results/benchmark-2026-04-19.1.json`
**Timestamp:** 2026-04-19T15:48:50Z
**Accuracy: 70%** (35/50)

#### Changes before this run

- First real API run (no dry run)
- 3-verdict schema in use: `valid` / `needs_revision` / `invalid`
- Tier 1 NLI was supposed to run but the Python backend was not started — all 26 Tier 1
  claims fell back to Tier 2 silently via the router's error handler
- Models: Tier 2 and Tier 3 both using `gpt-4o-mini`

#### What the results revealed

The 70% accuracy figure is misleading because of the 3-verdict schema. "Bucket accuracy"
(valid vs needs-action, regardless of whether the action verdict was `invalid` or
`needs_revision`) was 82%. The 12% gap between strict accuracy and bucket accuracy is all
soft errors — claims where HERALD correctly identified a problem but used the wrong label.

**Synthesis was the critical failure:** 50% accuracy, F1 = 0.50. Half of all synthesis
claims that should have been flagged were passed as `valid`. The `CRITERIA_SYNTHESIS` prompt
in `judge-system.ts` was too permissive — the model deferred to the agent's `reasoning`
field rather than independently stress-testing the inference.

**Normative was weak:** 62.5% accuracy, 25% hard error rate. The consensus check in
`CRITERIA_NORMATIVE` was not firm enough — the model was passing claims sourced from single
institutions without flagging the consensus problem.

**Tier 1 silent:** 0 claims resolved at Tier 1. Python NLI backend was not running. All
claims hit Tier 2 or Tier 3.

**Paraphrase derivation underperforming:** 26.7% hard error rate — worse than expected for
what should be a low-risk derivation method.

#### Wrong claims (15 wrong)

All synthesis and normative failures, plus several paraphrase claims where the judge missed
meaning drift. See `docs/benchmark-notes/benchmark01.md` for full per-claim breakdown.

---

### Run 2 — Regression after prompt changes

**Result file:** `results/benchmark-2026-04-19.2.json`
**Timestamp:** 2026-04-19T17:28:23Z
**Accuracy: 54%** (27/50) ← regression

#### Changes before this run

Prompt tightening attempt based on Run 1 diagnosis:

- `CRITERIA_SYNTHESIS` made more skeptical (added "default posture must be skeptical")
- `CRITERIA_NORMATIVE` tightened with single-source rule

#### What the results revealed

Accuracy dropped from 70% to 54% — a significant regression. The tightened synthesis
prompt made the model over-refuse valid synthesis claims while not improving on the invalid
ones. The "default posture must be skeptical" instruction was too broad — it made the model
reject well-reasoned synthesis claims along with bad ones.

The 3-verdict schema continued to create soft-error confusion. Bucket accuracy was 64%,
meaning even the "directionally correct" rate dropped. Tier 1 still silent (backend still
not running).

---

### Run 3 — Minor recovery, still regressed

**Result file:** `results/benchmark-2026-04-19.3.json`
**Timestamp:** 2026-04-19T18:59:25Z
**Accuracy: 56%** (28/50)

#### Changes before this run

Minor prompt adjustments attempting to recover from Run 2 regression. Exact changes not
recorded — small tweaks to synthesis and normative criteria wording.

#### What the results revealed

Marginal improvement from 54% → 56%. The regression from Run 1's 70% persisted. The
over-skeptical synthesis posture was still dominating. The 3-verdict schema soft errors
(36 hard errors + 8 soft errors = 44 wrong) continued to suppress both accuracy numbers.
Recognized that the tightening approach for synthesis was making things worse, not better.

---

### Run 4 — Binary schema, but runtime crashes

**Result file:** `results/benchmark-2026-04-19.4.json`
**Timestamp:** 2026-04-19T20:45:16Z
**Accuracy: 66%** (33/50)

#### Changes before this run

- **Dropped `needs_revision` verdict** — reverted to binary schema: `valid` or `invalid` only
- Verdict parsing updated to map `needs_revision` → `invalid`
- Attempted to re-enable Tier 1 NLI (Python backend start attempted)

#### What the results revealed

Accuracy jumped from 56% to 66% purely from dropping the 3-verdict schema. Removing the
soft-error category eliminated 8 previously-wrong-but-directionally-correct verdicts.

**Critical bug discovered:** 9 claims failed with a runtime error:
`"Cannot read properties of null (reading 'length')"`. Every single one of the 9 crashed
claims had ground truth `valid` — they were scored as `uncertain` with 0 confidence and
counted as wrong. This bug was selectively destroying the valid-detection path.

Tier 1 distribution showed 0 claims — the NLI backend restart attempt failed or the service
was still unreachable.

**Skeptic false-invalid rate:** 16% — the Skeptic persona was over-firing on valid claims.

#### Wrong claims (17 wrong)

9 were runtime crashes (all valid claims). The remaining 8 were genuine evaluation errors,
all in synthesis and normative categories.

---

### Run 5 — Breakthrough: 84% ← major jump

**Result file:** `results/benchmark-2026-04-19.5.json`
**Timestamp:** 2026-04-20T00:27:45Z
**Accuracy: 84%** (42/50) ← best result to date

#### Changes before this run — three things landed simultaneously

**1. Null-read bug fixed**
The `"Cannot read properties of null (reading 'length')"` crash in the response parsing
path was fixed. This recovered 9 claims that were all ground truth `valid` and had been
scoring as wrong. This single fix was worth approximately 18 percentage points of accuracy.

**2. Tier 1 NLI re-enabled and working**
The Python NLI backend (DeBERTa-v3-large-mnli) was successfully started. 11 claims were
resolved at Tier 1 with very high confidence (0.976–0.9999), all correctly. These were
mostly `direct_extraction` statistical and causal claims that NLI handles trivially. This
freed Tier 2 and 3 capacity and removed 11 easy claims from the LLM evaluation path.

**3. Binary verdict schema confirmed**
`needs_revision` fully removed from all verdict outputs. Clean binary: valid or invalid.

#### What the results revealed

Statistical, causal, and comparative claims all hit 100% accuracy — the combination of Tier
1 NLI and the bug fix resolved every claim in these categories correctly.

**Synthesis remained the critical failure:** 37.5% accuracy (3/8 correct), F1 = 0.0. All
5 wrong synthesis claims were false invalids — valid synthesis claims being rejected. The
system never correctly identified a valid synthesis claim that reached Tier 3. This is a
systematic category error, not a calibration issue.

**Normative still weak:** 75% accuracy. GT-008 and GT-034 are both paraphrase normative
claims with valid ground truth that the Tier 2 judge marked invalid — penalizing restatement
rather than evaluating semantic fidelity.

**Skeptic false-invalid rate stayed at 16%** — 8 claims are valid but marked invalid, and
the Skeptic's adversarial framing is contributing to Tier 3 false invalids on synthesis.

#### Wrong claims (8 wrong)

| Claim  | Type       | Derivation      | Error                                     |
| ------ | ---------- | --------------- | ----------------------------------------- |
| GT-008 | normative  | paraphrase      | Valid paraphrase marked invalid at Tier 2 |
| GT-010 | synthesis  | cross_source    | Valid synthesis rejected at Tier 3        |
| GT-018 | predictive | paraphrase      | Valid prediction marked invalid at Tier 3 |
| GT-026 | synthesis  | cross_source    | Valid synthesis rejected at Tier 3        |
| GT-034 | normative  | paraphrase      | Valid paraphrase marked invalid at Tier 2 |
| GT-036 | synthesis  | agent_inference | Valid synthesis rejected at Tier 3        |
| GT-046 | synthesis  | cross_source    | Valid synthesis rejected at Tier 3        |
| GT-049 | synthesis  | agent_inference | Valid synthesis rejected at Tier 3        |

---

### Run 6 — Prompt fixes in wrong codebase

**Result file:** `results/benchmark-2026-04-20.json`
**Timestamp:** 2026-04-20T23:49:23Z
**Accuracy: 84%** (42/50) — no change

#### Changes before this run

- Priority 1: Added synthesis validity standard to `judge_synthesis.py` (Python backend)
- Priority 2: Added normative paraphrase carve-out to `judge_system.py` (Python backend)

#### What the results revealed

No change from Run 5. The prompt changes were applied to the **Python backend** files in
`backend/src/policy_memo_agent/herald/prompts/`. The benchmark runner calls the **TypeScript**
implementation in `src/herald/`. These are two separate codebases. Python prompt changes have
no effect on the benchmark.

Key lesson: always verify which codebase the benchmark runner uses before applying fixes.
The TS files are under `src/herald/prompts/`. The Python files under
`backend/src/policy_memo_agent/herald/prompts/` are for the FastAPI server, not the benchmark.

---

### Run 7 — TS fixes applied, still 84%

**Result file:** `results/benchmark-2026-04-20.2.json`
**Timestamp:** 2026-04-21T00:23:38Z
**Accuracy: 84%** (42/50) — no change in accuracy, but behavior changed

#### Changes before this run

All prompt changes ported to the TypeScript codebase:

- `src/herald/prompts/judge-synthesis.ts`: Added CRITICAL synthesis standard block and
  Skeptic-sole-dissenter rule
- `src/herald/prompts/judge-system.ts`: Added normative paraphrase carve-out to
  `CRITERIA_NORMATIVE`; `getJudgePrompt()` now accepts `policyTopic`
- `src/herald/tier2-llm-judge.ts`: Added `policyTopic` and `memoSummary` params
- `src/herald/router.ts`: Threaded `policyTopic` and `memoSummary` through `evaluateClaim()`

#### What the results revealed

Accuracy unchanged at 84%, but the tier distribution shifted: Tier 3 went from 11 → 15
claims (Tier 2 went from 28 → 24). Three normative claims (GT-008, GT-021, GT-029) moved
from Tier 2 → Tier 3. This means the normative paraphrase fix made the Tier 2 judge _less
confident_ (dropping below the 0.8 exit threshold) rather than flipping it to valid. The
fix introduced uncertainty but not enough to change verdicts — Tier 3 debate then confirmed
invalid for all three.

**Root cause identified:** The prompt fixes were only at the Judge/criteria level. The three
Tier 3 **personas** (Domain Expert, Methodologist, Skeptic) still had the old standards:

- Synthesis: Skeptic bullet still said "could the same evidence support the opposite
  conclusion?" — this is exactly the theoretical-alternative framing that drives false invalids
- Synthesis: `CRITERIA_SYNTHESIS` in `judge-system.ts` still had "default posture must be
  skeptical / burden of proof on the claim" — this was fighting the judge-synthesis fix at
  Tier 2 before claims even reached Tier 3
- Normative: All three personas lacked the paraphrase carve-out, so GT-008 escalated to
  Tier 3 and was confirmed invalid there

The synthesis judge fix only helps in 2-1 splits. If all three personas say invalid, the
Judge has nothing to override. Fixes must be consistent across all prompts in the pipeline.

#### Pending changes (applied after this run, not yet benchmarked)

- `src/herald/prompts/judge-system.ts` `CRITERIA_SYNTHESIS`: Replaced "default posture
  skeptical / burden of proof" with correct logical-soundness standard; removed mandatory
  alternative-explanation step; reframed population/temporal criteria as material-only
- `src/herald/prompts/skeptic.ts`: Added IMPORTANT constraint to synthesis bullet
- `src/herald/prompts/domain-expert.ts`: Updated synthesis and normative bullets
- `src/herald/prompts/methodologist.ts`: Updated synthesis and normative bullets

---

## Lingering Questions and Open Directions

These are open research questions to guide future improvements. These should be tested
empirically — hypothesize, implement, benchmark, measure.

### 1. Should we penalize false negatives more than false positives?

The current metric is symmetric accuracy: every wrong verdict costs equally, whether it
is a false invalid (valid claim marked invalid — over-zealous) or a false negative (invalid
claim marked valid — under-zealous).

**The argument for asymmetric penalization:** In a policy memo context, the cost of a
false negative (letting a bad claim through into a published document) is higher than the
cost of a false positive (flagging a valid claim for review). A bad claim that reaches a
policymaker is a real-world harm. A valid claim that gets flagged just means extra human
review.

**Suggested metric to add:**

- `false_negative_rate` = invalid claims marked valid / total invalid claims (claims that
  should be caught, weren't)
- `false_positive_rate` = valid claims marked invalid / total valid claims (over-flagging)
- A weighted F-score (e.g. F2, which weights recall twice as heavily as precision) would
  capture this asymmetry: `F2 = 5 * precision * recall / (4 * precision + recall)`

**Current numbers (Run 5–7):**

- Precision: 100% (never marks a bad claim as valid... wait, this is inverted — see note)
- Recall: 66.7% (catches 2/3 of bad claims)

Note: in the current benchmark, "valid" predictions are claims HERALD passes and "invalid"
predictions are claims HERALD flags. Precision = when HERALD flags, it's right. Recall =
HERALD catches all the bad ones. The 16% error rate is entirely false invalids (valid claims
marked invalid), not false negatives. So the current system errs toward over-flagging valid
claims rather than letting bad claims through. Whether this is acceptable depends on how
much human review capacity exists downstream.

### 2. Confidence score calibration

The current confidence thresholds:

- Tier 2 exit: confidence > 0.80 → exit; ≤ 0.80 → escalate to Tier 3
- Tier 3 exit: judge confidence > 0.80 → exit; ≤ 0.80 → escalate to Tier 4

**Questions to investigate:**

- Are the wrong claims wrong with high confidence or low confidence? If the 8 remaining
  errors all have confidence 0.9+, that means the model is confidently wrong — a prompt
  problem. If they cluster around 0.8–0.85, lowering the exit threshold might help.
- Is there a confidence range where the model is systematically miscalibrated? E.g., claims
  with confidence 0.85–0.90 might be wrong more often than claims with confidence 0.95+.
- Should synthesis claims have a _lower_ exit threshold at Tier 2 (e.g. 0.85 instead of
  0.80) to force more synthesis claims into Tier 3 debate?

From Run 5–7 data: the 8 wrong claims all have `confidence: 0.95` at the tier where they
exit. This means the model is confidently wrong — threshold tuning alone will not fix this.
The problem is the prompt instructions, not the calibration cutoffs.

### 3. Topic-aware evaluation (not yet benchmarked)

`policyTopic` and `memoSummary` are now wired through the pipeline but the benchmark runner
does not pass them. The eval set claims are from a maternal/reproductive health + education +
HIV topic space. Running the benchmark with:

```
policyTopic = "maternal and child health policy in sub-Saharan Africa"
memoSummary = "This memo examines barriers to skilled birth attendance..."
```

...would test whether domain-calibrated evaluation changes accuracy. This is the next
experiment to run after the synthesis/normative prompt fixes stabilize.

---

## Files Reference

| File                                            | Purpose                                    |
| ----------------------------------------------- | ------------------------------------------ |
| `data/eval-set.json`                            | 50-claim ground truth eval set             |
| `src/herald/router.ts`                          | Tier routing and pipeline orchestration    |
| `src/herald/tier1-nli.ts`                       | NLI evaluation (calls Python backend)      |
| `src/herald/tier2-llm-judge.ts`                 | LLM-as-Judge (gpt-4o-mini)                 |
| `src/herald/tier3-debate.ts`                    | Multi-agent debate (3 personas + judge)    |
| `src/herald/prompts/judge-system.ts`            | Per-claim-type criteria for Tier 2         |
| `src/herald/prompts/judge-synthesis.ts`         | Judge synthesis prompt for Tier 3          |
| `src/herald/prompts/domain-expert.ts`           | Domain Expert persona                      |
| `src/herald/prompts/methodologist.ts`           | Methodologist persona                      |
| `src/herald/prompts/skeptic.ts`                 | Skeptic persona                            |
| `backend/src/policy_memo_agent/herald/prompts/` | Python equivalents — NOT used by benchmark |
