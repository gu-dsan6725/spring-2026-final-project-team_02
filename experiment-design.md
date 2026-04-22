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
Tier 1 (NLI, free/local) → Tier 2 (LLM Judge) → Tier 3 (Multi-Agent Debate) → Tier 4 (Human)
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
the benchmark runs against. Model for Tier 2 and Tier 3: `gpt-4o` via `OPENAI_API_KEY`.
Token usage is captured from `response.usage` at each tier and propagated through
`TierOutput.usage` into the per-claim result record.

---

## Systems Under Comparison

### System A — HERALD (Full Pipeline)

The full pipeline as implemented in `src/herald/router.ts`.

- Routing: per `CLAIM_TYPE_CONFIG` in `src/types/claims.ts`
  - Statistical/Comparative: start Tier 1, NLI threshold 0.9
  - Causal: start Tier 1, NLI threshold 0.85
  - Predictive/Normative/Synthesis: skip Tier 1, start Tier 2
- Tier 1: DeBERTa-v3-large-mnli via local Python NLI backend (`http://localhost:8000`)
- Tier 2: `gpt-4o` (`src/herald/tier2-llm-judge.ts`) — 1 API call
- Tier 3: 3× `gpt-4o` personas + 1 judge synthesis (`src/herald/tier3-debate.ts`) — 4 API calls
- Early exit whenever confidence threshold is met
- **Expected cost range**: 0–5 API calls per claim depending on tier reached

### System B — LLM-as-Judge Baseline

Tier 2 only, applied to **all** claims regardless of type. No NLI pre-screening, no
multi-agent debate. Calls `evaluateWithLLMJudge()` in `src/herald/tier2-llm-judge.ts`
directly, bypassing the router.

- Same model (`gpt-4o`), same prompt template, same output schema as System A's Tier 2
- No early exit logic — exactly 1 API call per claim
- **Expected cost**: 1 API call per claim (constant, predictable)

### System C — HERALD without Tier 1 (Ablation)

Router with NLI forced off for all claim types. Tests whether Tier 1 contributes accuracy
or just filters for cost savings. Calls `evaluateClaimNoNLI()` in
`scripts/run-experiment.ts` — mirrors `evaluateClaim()` but skips `evaluateWithNLI()`
unconditionally.

- Tier 2 + Tier 3 escalation intact
- Removes the NLI step entirely
- **Expected cost range**: variable, depending on how often Tier 3 is reached

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

| Metric                     | Unit   | Captured From                                             |
| -------------------------- | ------ | --------------------------------------------------------- |
| Input tokens per claim     | tokens | `response.usage.prompt_tokens` at each tier               |
| Output tokens per claim    | tokens | `response.usage.completion_tokens` at each tier           |
| API calls per claim        | count  | 1 per Tier 2 call; 4 per Tier 3 call (3 personas + judge) |
| Estimated cost per claim   | USD    | `(input/1M × $2.50) + (output/1M × $10.00)`               |
| Daily cost at 1,000 claims | USD    | mean cost per claim × 1,000                               |

Token counts come from `TierOutput.usage`, which is populated by `evaluateWithLLMJudge`
and `evaluateWithDebate` from the OpenAI response's `usage` field and aggregated in
`run-experiment.ts` via `aggregateUsage()`.

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
export OPENAI_API_KEY=sk-...

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

Run with `--concurrency 1` to stay under OpenAI rate limits for `gpt-4o`. For System A with Tier 3,
each claim makes up to 4 sequential LLM calls, so effective QPS at concurrency 1 is ~4 at peak.

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
    "latency_ms": 8200,
    "input_tokens": 4210,
    "output_tokens": 380,
    "api_calls": 5
  },
  "system_b": {
    "verdict": "valid",
    "tier_reached": 2,
    "confidence": 0.71,
    "latency_ms": 2100,
    "input_tokens": 820,
    "output_tokens": 210,
    "api_calls": 1
  },
  "system_c": {
    "verdict": "invalid",
    "tier_reached": 3,
    "confidence": 0.82,
    "latency_ms": 6100,
    "input_tokens": 4100,
    "output_tokens": 365,
    "api_calls": 5
  }
}
```

### Top-Level Experiment File

```json
{
  "run_timestamp": "...",
  "git_commit": "...",
  "eval_set_path": "data/eval-set.json",
  "systems_run": ["A", "B", "C"],
  "dry_run": false,
  "total_claims": 104,
  "model": "gpt-4o",
  "pricing": { "input_per_million": 2.50, "output_per_million": 10.00 },
  "per_claim_results": [...]
}
```

The `model` and `pricing` fields are written by `run-experiment.ts` so the analyzer can
compute costs without any hardcoded constants.

---

## Hypotheses

### H1 — Accuracy: HERALD ≥ LLM-as-Judge

**Prediction**: HERALD achieves higher F1 than Tier 2 alone, especially on:

- Causal claims (Tier 3 Skeptic catches correlation-as-causation gaps)
- Synthesis claims (Tier 3 Methodologist catches logical leaps)
- Statistical claims (Tier 1 NLI efficiently handles clear entailment)

**Null**: No meaningful difference in F1. If true, HERALD's added complexity is not
justified for accuracy.

### H2 — Cost: varies by claim type and tier distribution

**Question**: How does the cost per claim compare across the three systems, and does
that relationship hold consistently across all six claim types or does it reverse for
some types? The number of API calls each system makes depends on claim routing and
escalation behavior, which are empirical outcomes — not assumed in advance.

**Key question from H2**: For each claim type, which system produces the better
F1/$ ratio, and by how much? The F1/$ metric answers this directly.

### H3 — Tier Distribution

**Prediction**:

- ~40% of statistical/comparative claims exit at Tier 1 (NLI confident)
- ~30% of all claims escalate to Tier 3 (LLM judge uncertain)
- <10% reach Tier 4 (human review)

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
| Model temperature variance | `temperature=0.2` for Tier 2, `temperature=0.3` for Tier 3 (existing defaults). Record in results.    |
| Prompt version drift       | Pin `src/herald/prompts/` files to git commit hash at experiment start. Hash recorded in output JSON. |
| OpenAI model version       | `gpt-4o` is a stable alias. Record exact model string in output JSON.                                 |
| Eval set label quality     | Flag any claim where all 3 systems disagree with ground truth — could indicate a mislabel.            |
| Ordering effects           | Randomize claim order before running. All systems process the same shuffled order.                    |
| Rate limiting / retries    | Use the same `withRetry` logic as the benchmark. Retry count logged per claim.                        |
| NLI model warm-up          | Call `/api/health` before starting. Discard errors on first claim only.                               |
| Token count accuracy       | Counts come from `response.usage` (billed tokens), not estimates. Cost calculations are exact.        |

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
   - Compare System A vs System C accuracy and cost. If F1(A) ≈ F1(C) and cost(A) < cost(C)
     (due to NLI saving Tier 2 calls), NLI is valuable for cost but not accuracy.
   - If F1(A) ≈ F1(C) and cost(A) ≥ cost(C), NLI adds infrastructure overhead with no benefit.

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
- **Model non-determinism**: `gpt-4o` is not strictly deterministic even at low
  temperature. For key findings, run 3 independent trials and report mean ± std.
- **NLI backend dependency**: System A's Tier 1 requires the Python backend running
  separately. If unavailable, System A silently degrades to System C behavior for
  statistical/comparative/causal claims. Always verify NLI is active before running.
- **Token count completeness**: Token tracking depends on `response.usage` being populated
  by the OpenAI API. If the API returns null usage (rarely happens), affected claims will
  show zero tokens and be excluded from cost statistics. The analyzer logs `n` (number of
  claims with token data) in each cost row.
