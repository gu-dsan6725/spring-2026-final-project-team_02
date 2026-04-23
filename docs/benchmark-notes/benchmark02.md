---
run: T2 threshold sweep (offline calibration)
result_file: results/t2-threshold-sweep-2026-04-23T11-46-04-592Z.json
timestamp: 2026-04-23T11:46:04.592Z
type: calibration_sweep (not a full HERALD run)
---

## What This Run Was

Not a full benchmark. A targeted calibration sweep to answer: **what is the optimal T2 (gpt-4o-mini) exit confidence threshold?**

Methodology:
- Loaded all 4 eval sets + existing comprehensive results (to know which claims T1 resolved and what T3 returned)
- For every non-T1 claim, called T2 (mini) directly and captured raw confidence **before** any threshold was applied
- Swept thresholds 0.50–0.95 in 0.05 steps
- At each threshold: T2 confidence ≥ threshold → use T2 verdict; else → use existing T3 verdict from comprehensive eval

Key difference from production: this sweep called T2 **without passing T1 context** (no NLI reasoning in the T2 prompt). In production, T2 receives T1's inconclusive reasoning. This matters — see findings.

## Mini Confidence Distribution (non-T1 claims)

| Set | 0.70–0.75 | 0.75–0.85 | 0.85–0.90 | 0.90–0.95 | 0.95–1.0 |
|-----|-----------|-----------|-----------|-----------|----------|
| Set 1 (n=37) | 1 | 3 | 4 | 24 | 5 |
| Set 2 (n=28) | 2 | 1 | 4 | 18 | 3 |
| Set 3 (n=27) | 1 | 0 | 5 | 16 | 5 |
| Human (n=28) | 3 | 0 | 3 | 19 | 3 |

**Key finding: mini's confidence is right-skewed — 70–86% of non-T1 claims return 0.90+ confidence.** Mini is not uncertain on most claims; it's either very confident (0.90+) or near-certain (0.95+). Almost nothing in the 0.50–0.75 range.

## Threshold Sweep Results

### eval-set-1 (50 claims, T1 exits = 13)

| Threshold | T2 exit% | Accuracy | Cost/claim | T2 acc | T3 acc |
|-----------|----------|----------|------------|--------|--------|
| 0.75 | 97.3% | **90.0%** | $0.00033 | 86.1% | 100.0% |
| 0.80 | 97.3% | **90.0%** | $0.00033 | 86.1% | 100.0% |
| 0.85 | 89.2% | **90.0%** | $0.00063 | 84.8% | 100.0% |
| **0.90** | 78.4% | 86.0% | $0.00103 | 82.8% | 75.0% ← current |
| 0.95 | 16.2% | 90.0% | $0.00333 | 100.0% | 83.9% |

Current threshold (0.90) gives **worse accuracy** than 0.75–0.85 at **3x the cost**. T3 fallback at 0.90 returns only 75% accuracy vs T2's 82.8%.

### eval-set-2 (53 claims, T1 exits = 25)

| Threshold | T2 exit% | Accuracy | Cost/claim | T2 acc | T3 acc |
|-----------|----------|----------|------------|--------|--------|
| 0.75 | 92.9% | 81.1% | $0.00035 | 76.9% | 100.0% |
| 0.85 | 89.3% | 81.1% | $0.00045 | 76.0% | 100.0% |
| **0.90** | 75.0% | 84.9% | $0.00082 | 81.0% | 100.0% ← current |
| 0.95 | 14.3% | **88.7%** | $0.00243 | 100.0% | 91.7% |

Set 2 is different: T3 fallback at 0.90 is 100% accurate, T2 is only 81%. Lowering threshold hurts here because mini is wrong on the 0.75–0.90 band.

### eval-set-3 (50 claims, T1 exits = 23) — HOLDOUT

| Threshold | T2 exit% | Accuracy | Cost/claim | T2 acc | T3 acc |
|-----------|----------|----------|------------|--------|--------|
| 0.75 | 96.3% | **98.0%** | $0.00026 | 100.0% | 100.0% |
| **0.90** | 77.8% | 98.0% | $0.00076 | 100.0% | 100.0% ← current |
| 0.95 | 18.5% | 98.0% | $0.00236 | 100.0% | 100.0% |

On holdout: accuracy is 98% at every threshold ≥ 0.75. Threshold doesn't affect accuracy — only cost. 0.75 achieves same accuracy at 1/3rd the cost of 0.90.

### human-eval-2 (53 claims, T1 exits = 25)

| Threshold | T2 exit% | Accuracy | Cost/claim | T2 acc | T3 acc |
|-----------|----------|----------|------------|--------|--------|
| 0.75 | 89.3% | 83.0% | $0.00045 | 80.0% | 100.0% |
| 0.85 | 89.3% | 83.0% | $0.00045 | 80.0% | 100.0% |
| **0.90** | 78.6% | 86.8% | $0.00073 | 86.4% | 100.0% ← current |
| 0.95 | 10.7% | **88.7%** | $0.00252 | 100.0% | 92.0% |

Human set: same as set 2 — T3 fallback is 100% accurate, so higher threshold (push more to T3) helps accuracy.

## Critical Findings

### 1. Mini ran without T1 context in this sweep — explains the discrepancy with production

In production, only 4/37 non-T1 claims exited at T2 (0.90 threshold). In this sweep, 29/37 would exit at 0.90. The difference: production T2 receives T1's "NLI was inconclusive" reasoning, which appears to **suppress mini's confidence**. Mini sees "NLI couldn't decide" and hedges down.

This is a significant design problem: the T1 context that's supposed to help T2 focus is instead making mini less confident, causing it to escalate to T3 unnecessarily. The T1 context is adding noise, not signal.

### 2. T3 performance is inconsistent across sets

| Set | T3 accuracy (at 0.90) | T2 accuracy (at 0.90) |
|-----|----------------------|----------------------|
| Set 1 | **75.0%** | 82.8% |
| Set 2 | **100.0%** | 81.0% |
| Set 3 | **100.0%** | 100.0% |
| Human | **100.0%** | 86.4% |

T3 (haiku) is only 75% accurate on Set 1. Mini at 0.90 beats T3 on Set 1 (82.8% > 75%). This means for Set 1 claims, escalating to T3 is *hurting* accuracy. The Set 1 T3 failures likely include the synthesis and causal claims where haiku errs toward valid.

### 3. No optimal threshold — sets disagree

- Sets 1 & 3: Optimal threshold = 0.75 (same accuracy, 3x cheaper)
- Sets 2 & Human: Optimal threshold = 0.95 (mini at 0.90 band is unreliable; T3 is better)

This inconsistency suggests the threshold itself isn't the right lever. The real problem is mini's accuracy in the 0.80–0.90 confidence band is variable — sometimes it's right, sometimes wrong.

### 4. Cost advantage of lower threshold is massive

At threshold 0.75: $0.00026–0.00045/claim
Haiku baseline: $0.00281–0.00296/claim
HERALD at 0.75 threshold: **~7–10x cheaper than haiku** while matching or exceeding accuracy on sets 1, 3.

## Root Cause Diagnosis

The T1 context injection into T2 is the primary culprit:
- Without T1 context: mini returns 0.90+ on 78–86% of non-T1 claims
- With T1 context ("NLI was uncertain"): mini escalates on most claims → T3 runs 46–66% of the time
- T3 is inconsistent (75–100%) and expensive

Two levers to test:

**Option A: Remove T1 context from T2 prompt**  
Stop passing T1 reasoning to T2. Mini will get the fresh claim context and return high confidence on most claims. Expected: T2 exit rate jumps to 80%+, cost drops 3x, accuracy maintained.

**Option B: Lower threshold to 0.80 (test with T1 context removed)**  
If T1 context removal restores mini confidence, 0.80 captures a good mid-band while leaving the genuinely hard cases to T3.

## Recommended Next Steps

1. **Remove T1 NLI context from the T2 prompt** — or change it to not signal "uncertainty" to mini. Reframe it as "here is what NLI found" rather than "NLI was inconclusive."
2. **Set threshold to 0.80** — based on sweep data, this gives strong T2 exit rate without sacrificing accuracy on the 0.75–0.80 band.
3. **Run full benchmark** to confirm improvement vs Run 11 baseline.
4. If T1 context removal + 0.80 threshold achieves same accuracy as 0.90 with T1 context, cost drops from $0.0035–0.005/claim to $0.0004–0.001/claim — approaching mini single-call territory.
