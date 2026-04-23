# Experiment Design: HERALD vs. LLM-as-Judge

## Research Question

Across the six claim types, how does HERALD's multi-tier pipeline compare to a single
LLM-as-Judge call on **two dimensions simultaneously**: accuracy (F1, precision, recall) and
cost (API calls, tokens, USD per claim)? Which system delivers more accuracy per dollar —
and does that answer vary by claim type?

The practical decision this experiment informs: for each claim type, should a production
deployment use the full HERALD pipeline, the Tier 2-only baseline, or a hybrid (HERALD
only for high-risk types)?

---

## Background

HERALD is a 4-tier escalation pipeline:

```
Tier 1 (NLI, free/local) → Tier 2 (LLM Judge) → Tier 3 (Senior Reviewer) → Tier 4 (Human)
```

The hypothesis behind HERALD is that early, cheap tiers handle clear-cut cases and reserve
expensive LLM calls for genuinely ambiguous claims. The null hypothesis is that a single
Tier 2 LLM-as-Judge call achieves equivalent accuracy at comparable or lower cost.

This experiment tests that hypothesis on the ground-truth eval set (`data/eval-set.json`),
measuring both accuracy and cost at the same time — not treating cost as a secondary concern
to check after the accuracy comparison is done.

---

## Implementation

All three systems use the **TypeScript implementation** in `src/herald/` — the same codebase
the benchmark runs against.

**Models:**
- Tier 2: `gpt-4o-mini` via `OPENAI_API_KEY`
- Tier 3: `claude-haiku-4-5` via `ANTHROPIC_API_KEY`

Token usage is captured from `response.usage` at Tier 2 and propagated through
`TierOutput.usage` into the per-claim result record. **Tier 3 token usage is not currently
tracked** — `tier3-debate.ts` does not populate `TierOutput.usage`. Cost statistics exclude
Tier 3 tokens; see Limitations.

---

## Systems Under Comparison

### System A — HERALD (Full Pipeline)

The full pipeline as implemented in `src/herald/router.ts`.

- **Routing**: per `CLAIM_TYPE_CONFIG` in `src/types/claims.ts`
  - Statistical/Comparative: start Tier 1, NLI threshold **0.99**
  - Causal: start Tier 1, NLI threshold **0.94**
  - Predictive/Normative/Synthesis: skip Tier 1, start Tier 2
- **Tier 1**: DeBERTa-v3-large-mnli via local Python NLI backend (`http://localhost:8000`)
  - Uses sliding-window sentence decomposition per source chunk
  - Paraphrase claims use a higher contradiction threshold (0.95 vs 0.85) and canonical
    hypothesis normalization to reduce false contradictions from surface wording differences
  - Causal claims with hedging mismatch (hedged source, strong causal claim) are escalated
    regardless of entailment score
  - At a 0.99 entailment threshold, Tier 1 primarily functions as a **contradiction filter**:
    most claims escalate to Tier 2, but clear contradictions still exit early as "invalid"
- **Tier 2**: `gpt-4o-mini` (`src/herald/tier2-llm-judge.ts`) — 1 API call
  - Exit threshold: confidence **> 0.80** → confident verdict
  - Escalation zone: confidence **0.6–0.80** → uncertain, escalate to Tier 3
  - High-priority escalation: confidence **< 0.6** → uncertain, escalate to Tier 3 (flagged)
  - NLI context reframed as "supplementary scores" so the judge evaluates independently
- **Tier 3**: `claude-haiku-4-5` (`src/herald/tier3-debate.ts`) — **1 API call** (single Senior
  Reviewer, not the former 3-persona debate)
  - Runs only when Tier 2 returns 'uncertain' (confidence ≤ 0.80). The previous derivation
    override that forced `agent_inference`/`cross_source` claims to Tier 3 was removed: data
    showed Tier 3 was overriding correct Tier 2 verdicts more often than catching errors
  - Explicit calibration bias toward VALID for close calls: uncertain → UNCERTAIN, not INVALID
  - Exit: confidence **> 0.80** → final verdict; otherwise escalates to Tier 4
- **Expected API calls per claim**: 0–2 (T2: 1 call; T3: 1 call if escalated; T1 is local)

### System B — LLM-as-Judge Baseline

Tier 2 only, applied to **all** claims regardless of type. No NLI pre-screening, no
Senior Reviewer escalation. Calls `evaluateWithLLMJudge()` in `src/herald/tier2-llm-judge.ts`
directly, bypassing the router.

- Same model (`gpt-4o-mini`), same prompt template, same output schema as System A's Tier 2
- No early exit logic — exactly **1 API call per claim**
- When Tier 2 returns 'uncertain' (confidence ≤ 0.80), verdict is mapped to **'invalid'**
  (no Tier 3 to escalate to in this baseline)
- **Expected cost**: 1 API call per claim (constant, predictable)

### System C — HERALD without Tier 1 (Ablation)

Router with NLI forced off for all claim types. Tests whether Tier 1 contributes accuracy
or just filters for cost savings. Calls `evaluateClaimNoNLI()` in
`scripts/run-experiment.ts` — mirrors `evaluateClaim()` but skips `evaluateWithNLI()`
unconditionally.

- Tier 2 (`gpt-4o-mini`) + Tier 3 (`claude-haiku-4-5`) escalation intact; same thresholds as System A
- Removes the NLI step entirely
- **Expected API calls per claim**: 1–2 (always Tier 2; Tier 3 if uncertain)

---

## Dataset

**Source**: `data/eval-set.json`

Each entry is a `NotesLogEntry` (from `src/types/claims.ts`) with:

- `claim_id`, `claim_text`, `claim_type`, `derivation`
- `sources[]` with `relevant_chunk` (the premise fed to NLI/judge)
- `ground_truth_verdict`: `valid` | `invalid`
- `ground_truth_rationale`: human explanation of why

**Stratification requirements** — the eval set must include at minimum:

| Claim Type  | Valid  | Invalid | Notes                                       |
| ----------- | ------ | ------- | ------------------------------------------- |
| Statistical | 10     | 10      | Include unit mismatches and correct quotes  |
| Causal      | 10     | 10      | Include correlation-as-causation traps      |
| Comparative | 8      | 8       | Include unfair comparison traps             |
| Predictive  | 8      | 8       | Include undisclosed model assumptions       |
| Normative   | 8      | 8       | Include single-viewpoint-as-consensus traps |
| Synthesis   | 8      | 8       | Include logical gap traps ("SKEPTIC TRAP")  |
| **Total**   | **52** | **52**  | **104 claims minimum**                      |

Verify current eval set coverage before running. If underpopulated for any type, add
synthetic claims following the existing format.

---

## Metrics

Both accuracy and cost are **primary** metrics. Neither is secondary or a tie-breaker.
The experiment produces a cost-performance profile for each system across all claim types.

### Accuracy Metrics

| Metric             | Formula             | Why It Matters                                            |
| ------------------ | ------------------- | --------------------------------------------------------- |
| Accuracy           | (TP + TN) / N       | Overall correctness                                       |
| Precision          | TP / (TP + FP)      | Cost of false accusations (valid claims wrongly rejected) |
| Recall             | TP / (TP + FN)      | Cost of missed invalids (bad claims slipping through)     |
| F1                 | 2 × P × R / (P + R) | Harmonic balance of precision/recall                      |
| False Invalid Rate | FP / (FP + TN)      | Valid claims wrongly rejected                             |
| False Valid Rate   | FN / (FN + TP)      | Invalid claims slipping through                           |

> "Positive" = **invalid** (the thing we want to catch). A false positive is a valid claim
> marked invalid.

Report all accuracy metrics **overall** and **per claim type**.

### Cost Metrics

| Metric                     | Unit   | Captured From                                              |
| -------------------------- | ------ | ---------------------------------------------------------- |
| Input tokens per claim     | tokens | `response.usage.prompt_tokens` at Tier 2                   |
| Output tokens per claim    | tokens | `response.usage.completion_tokens` at Tier 2               |
| API calls per claim        | count  | 1 per Tier 2 call; 1 per Tier 3 call (Senior Reviewer)    |
| Estimated cost per claim   | USD    | Tier 2 tokens × gpt-4o-mini rates (see below)             |
| Daily cost at 1,000 claims | USD    | mean cost per claim × 1,000                               |

**Pricing (gpt-4o-mini, applied to tracked Tier 2 tokens):**
- Input: `$0.15 / 1M tokens`
- Output: `$0.60 / 1M tokens`

**Pricing (claude-haiku-4-5, Tier 3 — not tracked; see Limitations):**
- Input: `$0.80 / 1M tokens`
- Output: `$4.00 / 1M tokens`

Token counts come from `TierOutput.usage`, which is populated by `evaluateWithLLMJudge`
(Tier 2) from the OpenAI response's `usage` field and aggregated in `run-experiment.ts`
via `aggregateUsage()`. Tier 3 usage is not yet populated — cost statistics are Tier 2 only.

### Combined Metric

**F1 per dollar** = F1 / (estimated cost per claim)

This is the primary decision metric. It collapses the cost-performance tradeoff into a
single number that answers: "how much accuracy does each dollar buy?"

Report F1/$ overall and per claim type.

---

## Procedure

### Step 1 — Environment Setup

```bash
# Required
export OPENAI_API_KEY=sk-...       # for Tier 2 (gpt-4o-mini)
export ANTHROPIC_API_KEY=sk-ant-...  # for Tier 3 (claude-haiku-4-5)

# Optional: start Python NLI backend for Tier 1 (System A only)
# Without this, System A silently falls back to Tier 2 for all claims
cd backend && uv sync --extra nli
uv run uvicorn policy_memo_agent.api.app:create_app --factory --reload --port 8000 &
cd ..

# Verify NLI backend
curl http://localhost:8000/api/health
```

### Step 2 — Run the Experiment

```bash
npx tsx --env-file=.env scripts/run-experiment.ts \
  --eval-set data/eval-set.json \
  --systems A,B,C \
  --concurrency 3 \
  --output results/experiment-$(date +%Y-%m-%d).json
```

Run with `--concurrency 1` to stay under rate limits. For System A with Tier 3,
each escalated claim makes 2 sequential LLM calls (mini + haiku), so effective QPS at
concurrency 1 is ~2 at peak.

### Step 3 — Analyze Results

```bash
npx tsx --env-file=.env scripts/analyze-experiment.ts \
  --results results/experiment-YYYY-MM-DD.json \
  --output results/analysis-YYYY-MM-DD.md
```

The analysis script produces:

1. Overall accuracy metrics (Accuracy, F1, Precision, Recall, FIR, FVR) per system
2. Per claim type accuracy breakdown
3. Tier distribution (Systems A and C)
4. Latency summary (mean, median, p95)
5. **Cost analysis**: tokens per claim, USD per claim by system and claim type, F1/$, daily cost projections
6. Agreement / disagreement matrix (System A vs B)
7. Wrong claims table per system

---

## Output Schema

### Per-Claim Record

```json
{
  "claim_id": "GT-003",
  "claim_type": "causal",
  "derivation": "cross_source",
  "ground_truth": "invalid",
  "is_skeptic_trap": false,
  "system_a": {
    "verdict": "invalid",
    "tier_reached": 3,
    "confidence": 0.87,
    "latency_ms": 4200,
    "input_tokens": 1840,
    "output_tokens": 210,
    "api_calls": 2
  },
  "system_b": {
    "verdict": "invalid",
    "tier_reached": 2,
    "confidence": 0.71,
    "latency_ms": 1200,
    "input_tokens": 820,
    "output_tokens": 120,
    "api_calls": 1
  },
  "system_c": {
    "verdict": "invalid",
    "tier_reached": 3,
    "confidence": 0.82,
    "latency_ms": 3800,
    "input_tokens": 1840,
    "output_tokens": 210,
    "api_calls": 2
  }
}
```

*Note: `input_tokens`, `output_tokens`, and `api_calls` reflect Tier 2 usage only.
Tier 3 (haiku) usage is not yet captured in `TierOutput.usage`.*

### Top-Level Experiment File

```json
{
  "run_timestamp": "...",
  "git_commit": "...",
  "eval_set_path": "data/eval-set.json",
  "systems_run": ["A", "B", "C"],
  "dry_run": false,
  "total_claims": 104,
  "tier2_model": "gpt-4o-mini",
  "tier3_model": "claude-haiku-4-5",
  "tier2_pricing": { "input_per_million": 0.15, "output_per_million": 0.60 },
  "tier3_pricing": { "input_per_million": 0.80, "output_per_million": 4.00 },
  "per_claim_results": [...]
}
```

---

## Hypotheses

### H1 — Accuracy: HERALD ≥ LLM-as-Judge

**Prediction**: HERALD achieves higher F1 than Tier 2 alone, especially on:

- Causal claims (NLI catches clear hedging mismatches at Tier 1; Tier 3 Senior Reviewer
  can make definitive calls on ambiguous cases that Tier 2 flags as uncertain)
- Synthesis claims (Tier 3 Senior Reviewer, with explicit valid-bias, may reduce the false
  valid rate by requiring a concrete, quotable error before marking invalid)
- Statistical claims (Tier 1 contradiction detection catches direct misquotes)

**Null**: No meaningful difference in F1. If true, HERALD's added complexity is not
justified for accuracy.

**Note on Tier 3 design change**: The Senior Reviewer has explicit calibration bias toward
VALID for close calls (when uncertain between INVALID and UNCERTAIN → choose UNCERTAIN;
when uncertain between VALID and UNCERTAIN → choose VALID). This should reduce false invalid
rates compared to the former multi-agent debate where the Skeptic persona biased toward
invalid verdicts.

### H2 — Cost: varies by claim type and tier distribution

**Question**: How does the cost per claim compare across the three systems, and does
that relationship hold consistently across all six claim types or does it reverse for
some types? The number of API calls each system makes depends on claim routing and
escalation behavior, which are empirical outcomes — not assumed in advance.

**Key question from H2**: For each claim type, which system produces the better
F1/$ ratio, and by how much? The F1/$ metric answers this directly.

**Cost structure to expect**: Since T2 is now `gpt-4o-mini` (~10× cheaper than `gpt-4o`),
the absolute cost differences between systems are much smaller than in prior runs. System A
can be cheaper than B if NLI handles enough claims; System A can be more expensive if many
claims reach Tier 3 (haiku adds ~$0.80–$4.00/1M). The Tier 3 usage gap (not tracked) means
cost comparisons are conservative estimates.

### H3 — Tier Distribution

**Prediction** (updated for new NLI thresholds):

- Tier 1 at 0.99 entailment threshold will exit as "valid" for very few claims — the bar
  is near-certain entailment. Expect **<10%** of statistical/comparative claims to exit at
  Tier 1 as valid; contradiction exits remain possible at the 0.85/0.95 threshold
- **~85-90%** of statistical/comparative/causal claims escalate from Tier 1 to Tier 2
- **~20-35%** of all claims escalate to Tier 3 (T2 confidence ≤ 0.80)
- **<5%** reach Tier 4 (human review)

### H4 — A Claim-Type Hybrid May Be Optimal

**Question**: Does the per-type F1/$ breakdown reveal that different systems are
cost-efficient for different claim types, and if so, which routing policy would
maximize accuracy per dollar across a realistic claim mix? The per-type F1/$
breakdown will determine whether a hybrid makes sense and, if so, which types
belong in each system.

---

## Controls & Confounds

| Confound                   | Control                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Model temperature variance | `temperature=0.2` for Tier 2 (gpt-4o-mini), `temperature=0.1` for Tier 3 (haiku). Record in results. |
| Prompt version drift       | Pin `src/herald/prompts/` files to git commit hash at experiment start. Hash recorded in output JSON. |
| Model version              | `gpt-4o-mini` and `claude-haiku-4-5` are stable IDs. Record both in output JSON.                     |
| Eval set label quality     | Flag any claim where all 3 systems disagree with ground truth — could indicate a mislabel.            |
| Ordering effects           | Randomize claim order before running. All systems process the same shuffled order.                    |
| Rate limiting / retries    | Use the same `withRetry` logic as the benchmark. Retry count logged per claim.                        |
| NLI model warm-up          | Call `/api/health` before starting. Discard errors on first claim only.                               |
| Token count accuracy       | Tier 2 counts come from `response.usage` (billed tokens). Tier 3 counts not tracked (see Limitations). |

---

## Decision Criteria

Use experiment results to answer:

1. **Which system is better overall?**
   - HERALD wins if: F1(A) > F1(B) AND F1/$(A) ≥ F1/$(B)
   - HERALD wins on accuracy only if: F1(A) > F1(B) by ≥ 3pp AND F1/$(A) < F1/$(B)
     → Use HERALD only when accuracy is critical and cost is not a constraint
   - LLM-as-Judge wins if: F1(A) ≤ F1(B) OR F1/$(A) < F1/$(B) with no F1 gain

2. **Which claim types justify HERALD?**
   - Compute per-type F1/$ for A vs B. For claim types where F1/$(A) > F1/$(B), HERALD
     is the right choice. For types where F1/$(A) < F1/$(B), use Tier 2 only.
   - This produces a recommended routing policy: "Use HERALD for [X, Y] types, Tier 2 for [Z, W] types."

3. **Does Tier 1 NLI pull its weight?**
   - Compare System A vs System C accuracy and cost. Given the 0.99 threshold, Tier 1
     contributes primarily via contradiction detection. If F1(A) ≈ F1(C) and NLI isn't
     filtering any T2 calls, NLI adds infrastructure cost with no benefit.
   - If F1(A) > F1(C), the contradiction-detection path is catching errors Tier 2 misses.

4. **What is the production cost envelope?**
   - At 1,000 claims/day, what is the daily API bill for each system?
   - At what Tier 3 escalation rate does System A's daily cost exceed 2× System B's?

---

## Limitations

- **Eval set size**: ~104 claims is sufficient for directional conclusions but confidence
  intervals will be wide. Do not report results to more than 1 decimal place.
- **Ground truth quality**: Rationales were written by the team. Claims near decision
  boundaries may have contested labels. Flag any claim where all 3 systems disagree.
- **Single policy domain**: If the eval set is concentrated in one domain, results may
  not generalize to other domains.
- **Model non-determinism**: Neither `gpt-4o-mini` nor `claude-haiku-4-5` is strictly
  deterministic even at low temperature. For key findings, run 3 independent trials and
  report mean ± std.
- **NLI backend dependency**: System A's Tier 1 requires the Python backend running
  separately. If unavailable, System A silently degrades to System C behavior for
  statistical/comparative/causal claims. Always verify NLI is active before running.
- **Tier 3 usage not tracked**: `tier3-debate.ts` does not populate `TierOutput.usage`
  for the `claude-haiku-4-5` call. Tier 3 token costs are excluded from cost statistics
  and the `mean_cost_usd` is understated for claims reaching Tier 3. At haiku pricing
  ($0.80/1M input, $4.00/1M output), a typical Tier 3 call adds ~$0.0010–$0.0020 per claim.
  This gap matters most if Tier 3 escalation rate is high (>30%).
- **Dual-model cost calculation**: Token tracking (`input_tokens`, `output_tokens` in
  SystemResult) reflects Tier 2 (gpt-4o-mini) only. The analyzer applies gpt-4o-mini
  pricing to all tracked tokens. F1/$ comparisons between systems are directionally
  correct but understated for claims reaching Tier 3.
