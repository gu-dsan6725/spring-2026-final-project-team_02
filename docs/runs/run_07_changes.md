# Run 07 Changes

**Date:** 2026-04-12
**Branch:** `feature/improve-tier1-thresholds-reformulation`
**Dataset:** `data/test_sets/gov_report_v2_filtered.json` (306 cases)
**Baseline:** Run 06 — 83.0% overall accuracy (254/306)

---

## Why this run exists

Run 06 applied five routing improvements (see [docs/tier-routing-improvements.md](../tier-routing-improvements.md))
but overall accuracy dropped from 88.9% to 83.0%. The post-run diagnosis identified
one root cause: the `prefer_debate` routing rule was forcing **all** causal and
synthesis cases to Tier 3 unconditionally, even when Tier 2 was highly confident
and correct. Tier 3 accuracy at that volume (92 cases, up from 20) was only 66.3%,
far below Tier 2's 95.3%. `cp_causal` collapsed from 82.6% to 58.7%.

Run 07 fixes this by making `prefer_debate` escalation **conditional on Tier 2
confidence**, keeping the adversarial framing benefit for genuinely ambiguous cases
without routing easy, high-confidence cases to a noisier resolver.

---

## Changes applied

### 1. `src/herald/pipeline/escalation.py` — Conditional `prefer_debate` escalation

**What changed:** The `prefer_debate` block inside `validate()` was refactored.
Previously it unconditionally forwarded any confident T2 verdict for causal/synthesis
types to Tier 3. Now it only escalates to T3 when T2 confidence is **below 0.92**.

**Before (run 06 behaviour):**
```python
if cp_type in self.prefer_debate_types:
    # Always fall through to Tier 3, regardless of T2 confidence
```

**After (run 07 behaviour):**
```python
HIGH_CONFIDENCE_BAR = 0.92
if cp_type in self.prefer_debate_types and t2.confidence < HIGH_CONFIDENCE_BAR:
    # Escalate to T3 — T2 is ambiguous enough that debate adds value
else:
    # T2 confidence >= 0.92: verdict is reliable, resolve at T2
    packet.resolved_at_tier = 2
    packet.final_verdict = t2.verdict
    return packet
```

**Rationale:** The 0.92 threshold was chosen based on run 06 T2 accuracy data.
T2 resolved 43 cases in run 06 at 95.3% accuracy. The cases T2 got wrong were
predominantly in the 0.80–0.91 confidence range. At ≥ 0.92, T2 was essentially
always correct. Sending those cases to Tier 3 (66.3% accurate in run 06) was a
net negative.

**Also in this change:** The Tier 2.5 counterfactual probe is now always run
before the `prefer_debate` check (it was previously skipped for `prefer_debate`
types). If the probe fires (disconfirming evidence found), the case escalates to
T3 regardless of confidence level.

**File:** [src/herald/pipeline/escalation.py](../../src/herald/pipeline/escalation.py)

---

## What was NOT changed in run 07

All other changes from run 06 (Fixes 1–5 from `docs/tier-routing-improvements.md`)
remain in place:

| Fix | Status | Description |
|---|---|---|
| Fix 1: `skip_nli` routing | Active | causal, epistemic always escalate past T1 |
| Fix 2: Numerical verification block in T2 | Active | Injected for numerical + synthesis types |
| Fix 3: `prefer_debate` routing | **Modified** — now conditional on T2 conf < 0.92 |
| Fix 4: T2 anchor removed from T3 advocate/critic | Active | Advocate and critic see only T1 signal |
| Fix 5: Per-type T1 thresholds | Active | numerical: 0.85, synthesis: 0.85 |

---

## Expected impact vs run 06

| Metric | Run 06 | Expected direction |
|---|---|---|
| Overall accuracy | 83.0% | +4–6pp (back toward 88–89%) |
| `cp_causal` accuracy | 58.7% | +15–20pp (main recovery target) |
| `cp_synthesis` accuracy | 82.7% | +3–5pp |
| `label_valid` recall | 85.6% | +8–10pp |
| T3 escalation rate | 30.1% (92 cases) | Down to ~10–15% |
| T2 escalation rate | 14.1% (43 cases) | Up to ~20–25% |

The primary goal is recovering the valid-recall collapse (85.6% → target ~95%)
while preserving the invalid-recall gains from the T1 routing changes.

---

## Commands used

```bash
uv run herald-run \
  --input data/test_sets/gov_report_v2_filtered.json \
  --config configs/default.yaml \
  --output results/runs/run_07_govreport_v2/results.json \
  --verbose

uv run herald-eval \
  --results results/runs/run_07_govreport_v2/results.json \
  --ground-truth data/test_sets/gov_report_v2_filtered.json \
  --output results/evaluation/run_07_govreport_v2_eval.json
```
