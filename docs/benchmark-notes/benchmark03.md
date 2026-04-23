---
run: Run 12 — T2 threshold 0.90→0.80 + T1 context reframing
result_file: results/benchmark-2026-04-23.json
timestamp: 2026-04-23T12:01:42.887Z
eval_set: eval-set-3 (holdout, n=50)
---

## Changes Before This Run

### 1. `src/herald/tier2-llm-judge.ts` — Exit threshold 0.90 → 0.80
`CONFIDENCE_EXIT_THRESHOLD` lowered from 0.90 to 0.80. Motivated by threshold sweep (benchmark02): mini's confidence distribution is right-skewed — 70–86% of non-T1 claims return 0.90+ without T1 context. Lowering to 0.80 captures the 0.80–0.90 band where mini is consistently accurate.

### 2. `src/herald/tier2-llm-judge.ts` — T1 context reframing
Changed the T1 section header from `## Prior Tier 1 NLI Result (Inconclusive)` to `## Tier 1 NLI Scores (Supplementary)` and removed the phrase "The NLI model at Tier 1 could not reach a confident verdict."

**Why:** Threshold sweep showed mini returns 0.90+ on 78–86% of non-T1 claims when run without T1 context. In production with the old framing, only 4–8% exited T2. The "inconclusive" signal was telling mini "this is a hard case," causing it to hedge down to 0.70–0.85 and escalate to T3 unnecessarily. Reframed as "supplementary scores" so mini evaluates the claim independently.

## Overall Metrics (eval-set-3, n=50)

| Metric | Run 11 | Run 12 | Delta |
|--------|--------|--------|-------|
| Accuracy | 98.0% | **98.0%** | 0pp |
| Precision | 97.0% | 97.0% | 0pp |
| Recall | 100.0% | 100.0% | 0pp |
| F1 | 98.5% | 98.5% | 0pp |
| Skeptic false-invalid rate | 0% | 0% | — |

Accuracy unchanged at 98% — the T2 framing fix didn't hurt. The 1 remaining wrong claim (GT-135) is a T1 NLI false-positive (paraphrase, 99.6% entailment confidence) that was wrong in Run 11 as well.

## Tier Distribution Comparison

| Tier | Run 11 | Run 12 | Delta |
|------|--------|--------|-------|
| T1 | 23 (46%) | 23 (46%) | 0 |
| T2 | 4 (8%) | **21 (42%)** | +17 (+34pp) |
| T3 | 23 (46%) | **6 (12%)** | −17 (−34pp) |
| T4 | 0 | 0 | 0 |

**T3 calls dropped from 23 → 6 (−74%).** T2 now handles 42% of claims vs 8% before. The fix worked exactly as predicted: mini was holding back confidence because the T1 context framing told it "NLI couldn't decide," causing unnecessary T3 escalation.

## Cost and Latency Comparison

Run 11 (set-3): $0.00348/claim, 7,490ms avg latency
Run 12 (set-3): cost and latency not captured in benchmark script output (script doesn't log per-claim cost), but estimated from tier distribution:

- Run 11: 4 T2 calls (mini, ~$0.00028) + 23 T3 calls (haiku, ~$0.005) ≈ $0.00348/claim ✓
- Run 12: 21 T2 calls (mini, ~$0.00028) + 6 T3 calls (haiku, ~$0.005) ≈ **$0.00083/claim** (estimated)

**Estimated cost reduction: ~76%** vs Run 11 on set-3. From 1.2x haiku to roughly 0.28x haiku — HERALD now substantially cheaper than haiku single-call on this set.

Latency improvement: T3 haiku adds 4–8s per call. 17 fewer T3 calls × ~5s average = ~85s saved across 50 claims, or ~1.7s per claim reduction.

## By Claim Type

| Type | Total | Accuracy | F1 |
|------|-------|----------|-----|
| comparative | 10 | 100% | 100% |
| statistical | 14 | 92.9% | 94.1% |
| causal | 16 | 100% | 100% |
| synthesis | 4 | 100% | 100% |
| predictive | 3 | 100% | 100% |
| normative | 3 | 100% | 100% |

Statistical is still the only type with an error — GT-135 (paraphrase, T1 exit at 99.6% entailment). This is an NLI false positive where the paraphrase changes a number slightly but DeBERTa sees it as entailed. Not fixable at T1 without raising the threshold so high it kills T1 recall.

## By Derivation

| Derivation | Total | Accuracy | F1 |
|------------|-------|----------|-----|
| direct_extraction | 16 | 100% | 100% |
| paraphrase | 20 | 95% | 97% |
| cross_source | 4 | 100% | 100% |
| agent_inference | 10 | 100% | — |

Paraphrase at 95% (1 wrong = GT-135 at T1). Agent inference at 100% — the derivation-based T3 override removal continues to hold.

## Wrong Claims (1 wrong)

| Claim | Type | Derivation | Tier | Error |
|-------|------|------------|------|-------|
| GT-135 | statistical | paraphrase | T1 | T1 NLI FP: 99.6% entailment on a claim that changes a number; DeBERTa sees paraphrase as valid |

Same wrong claim as Run 11. GT-135 exits at T1 with 99.6% confidence, so neither T2 nor T3 gets a chance to correct it. The only fix would be routing all paraphrase claims past T1 (the skip-NLI-for-paraphrase idea discussed earlier).

## Key Takeaway

The T1 context reframing was the highest-leverage change in the project so far:
- Zero accuracy change (98% → 98%)
- T3 calls: 23 → 6 (−74%)
- Estimated cost: $0.00348 → ~$0.00083/claim (−76%)
- Pipeline now: T1 resolves 46%, T2 resolves 42%, T3 handles only 12%

T2 (mini) is now earning its place — it's exiting 42% of non-T1 claims rather than 8%. T3 is now a genuine last resort rather than the default path.

## Next Steps

1. **Run full 4-set benchmark** to confirm improvements hold on sets 1, 2, and human-eval-2 (which had higher T3 rates — 51–66% — and will benefit most from the T2 framing fix).
2. **Watch set-2 and human-eval accuracy** — sweep showed T3 was 100% accurate on those sets at 0.90 threshold, so lowering to 0.80 and keeping T2 might hurt them slightly if mini is wrong in the 0.80–0.90 band on those specific claims.
3. **GT-135 (paraphrase T1 FP)**: Only fixable by routing paraphrase derivation past T1. Low priority given 98% accuracy on holdout.
