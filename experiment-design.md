# Experiment Design: HERALD vs. LLM-as-Judge

## Research Question

Does the HERALD multi-tier evaluation pipeline produce meaningfully better claim verdicts than a single LLM-as-Judge call, and is the quality improvement worth the added cost and latency?

---

## Background

HERALD is a 4-tier escalation pipeline:

```
Tier 1 (NLI, free/local) → Tier 2 (LLM Judge) → Tier 3 (Multi-Agent Debate) → Tier 4 (Human)
```

The hypothesis behind HERALD is that early, cheap tiers handle clear-cut cases and reserve expensive LLM calls for genuinely ambiguous claims. The null hypothesis is that a single Tier 2 LLM-as-Judge call achieves equivalent accuracy at lower cost.

This experiment tests that hypothesis directly on the existing ground-truth eval set (`data/eval-set.json`).

---

## Implementation

All three systems use the **TypeScript implementation** in `src/herald/` — the same codebase
the benchmark runs against. Model for Tier 2 and Tier 3: `gpt-4o-mini` via `OPENAI_API_KEY`.
This ensures experiment results are directly comparable to benchmark run history in
`docs/benchmark-notes/changelog.md`.

---

## Systems Under Comparison

### System A — HERALD (Full Pipeline)

The full pipeline as implemented in `src/herald/router.ts`.

- Routing: per `CLAIM_TYPE_CONFIG` in `src/types/claims.ts`
  - Statistical/Comparative: start Tier 1, NLI threshold 0.9
  - Causal: start Tier 1, NLI threshold 0.85
  - Predictive/Normative/Synthesis: skip Tier 1, start Tier 2
- Tier 1: DeBERTa-v3-large-mnli via local Python NLI backend (`http://localhost:8000`)
- Tier 2: `gpt-4o-mini` (`src/herald/tier2-llm-judge.ts`)
- Tier 3: 3× `gpt-4o-mini` personas + 1 judge synthesis (`src/herald/tier3-debate.ts`)
- Early exit whenever confidence threshold is met

### System B — LLM-as-Judge Baseline

Tier 2 only, applied to **all** claims regardless of type. No NLI pre-screening, no
multi-agent debate. Calls `evaluateWithLLMJudge()` in `src/herald/tier2-llm-judge.ts`
directly, bypassing the router.

- Same model (`gpt-4o-mini`), same prompt template, same output schema as System A's Tier 2
- No early exit logic — single API call per claim
- Cost: exactly 1 LLM call per claim

### System C — HERALD without Tier 1 (Ablation)

Router with NLI forced off for all claim types. Tests whether Tier 1 contributes accuracy
or just filters for cost savings. Calls `evaluateClaimNoNLI()` exported from
`scripts/run-experiment.ts` — this mirrors `evaluateClaim()` in the router but skips
the `evaluateWithNLI()` call unconditionally.

- Tier 2 + Tier 3 escalation intact
- Removes the NLI step entirely

---

## Dataset

**Source**: `data/eval-set.json`

Each entry is a `NotesLogEntry` (from `src/types/claims.ts`) with:
- `claim_id`, `claim_text`, `claim_type`, `derivation`
- `sources[]` with `relevant_chunk` (the premise fed to NLI/judge)
- `ground_truth_verdict`: `valid` | `invalid`
- `ground_truth_rationale`: human explanation of why

**Stratification requirements** — the eval set must include at minimum:

| Claim Type   | Valid | Invalid | Notes                                        |
|--------------|-------|---------|----------------------------------------------|
| Statistical  | 10    | 10      | Include unit mismatches and correct quotes   |
| Causal       | 10    | 10      | Include correlation-as-causation traps       |
| Comparative  | 8     | 8       | Include unfair comparison traps              |
| Predictive   | 8     | 8       | Include undisclosed model assumptions        |
| Normative    | 8     | 8       | Include single-viewpoint-as-consensus traps  |
| Synthesis    | 8     | 8       | Include logical gap traps ("SKEPTIC TRAP")   |
| **Total**    | **52**| **52**  | **104 claims minimum**                       |

Verify current eval set coverage before running. If underpopulated for any type, add
synthetic claims following the existing format.

**Split**: Use full dataset for evaluation (no train/test split — this is a benchmark,
not a trained model).

---

## Metrics

### Primary Metrics (Quality)

| Metric | Formula | Why It Matters |
|--------|---------|----------------|
| Accuracy | (TP + TN) / N | Overall correctness |
| Precision | TP / (TP + FP) | Cost of false accusations (marking valid claims invalid) |
| Recall | TP / (TP + FN) | Cost of missed invalids (letting bad claims through) |
| F1 | 2 × P × R / (P + R) | Harmonic balance of precision/recall |
| False Invalid Rate | FP / (FP + TN) | Valid claims wrongly rejected |
| False Valid Rate | FN / (FN + TP) | Invalid claims slipping through |

> Here "positive" = **invalid** (the thing we want to catch). A false positive is a valid
> claim marked invalid.

Report all metrics **overall** and **per claim type**.

### Secondary Metrics (Cost & Latency)

| Metric | Unit | Notes |
|--------|------|-------|
| Wall-clock latency per claim | ms | Measured end-to-end per system call |
| Tier distribution (System A, C) | % per tier | How often does each tier make the final call? |
| NLI early-exit rate (System A) | % | Claims resolved at Tier 1 |
| Estimated API calls per claim | count | System B: 1, System C: 1–4, System A: 1–5 |

Token tracking requires the NLI backend to be running and OpenAI usage metadata from
the `gpt-4o-mini` responses. Use current gpt-4o-mini pricing ($0.15/1M input,
$0.60/1M output tokens) for cost projections.

### Derived Metrics

- **Cost-adjusted F1**: F1 / (estimated cost per claim) — quality per dollar
- **Tier escalation rate by claim type**: What fraction of each claim type reaches Tier 3?
- **Agreement rate between systems**: Where do A and B agree? Where do they diverge?

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

# Verify NLI backend (optional)
curl http://localhost:8000/api/health
```

### Step 2 — Run the Experiment

```bash
npx tsx --env-file=.env scripts/run-experiment.ts \
  --eval-set data/eval-set.json \
  --systems A B C \
  --concurrency 3 \
  --output results/experiment-$(date +%Y-%m-%d).json
```

Run with `--concurrency 3` to stay under OpenAI rate limits. For System A with Tier 3,
each claim makes up to 4 parallel LLM calls, so effective QPS at concurrency 3 is ~12 at peak.

### Step 3 — Analyze Results

```bash
npx tsx --env-file=.env scripts/analyze-experiment.ts \
  --results results/experiment-YYYY-MM-DD.json \
  --output results/analysis-YYYY-MM-DD.md
```

The analysis script produces:
1. Confusion matrices per system (text format)
2. All primary metrics, overall and per claim type
3. Latency summary table
4. Tier distribution (Systems A and C)
5. Agreement/disagreement matrix between systems A and B
6. Decision criteria verdict (is HERALD worth the complexity?)

---

## Expected Outcomes & Hypotheses

### H1 — Accuracy: HERALD ≥ LLM-as-Judge

**Prediction**: HERALD achieves higher F1 than Tier 2 alone, especially on:
- Causal claims (Tier 3 Skeptic catches correlation-as-causation gaps)
- Synthesis claims (Tier 3 Methodologist catches logical leaps)
- Statistical claims (Tier 1 NLI efficiently handles clear entailment)

**Null**: No statistically meaningful difference in F1. If true, HERALD's added complexity
is not justified for accuracy.

### H2 — Cost: HERALD ≤ LLM-as-Judge on Simple Claims

**Prediction**: For statistical and comparative claims where Tier 1 exits early (~40–60%
estimated), HERALD costs less per claim than a direct Tier 2 call. For
predictive/normative/synthesis (which skip Tier 1 and often escalate to Tier 3), HERALD
costs more.

**Corollary**: HERALD's total cost advantage depends on the claim type mix in practice.

### H3 — Tier Distribution

**Prediction**:
- ~40% of statistical/comparative claims exit at Tier 1 (NLI confident)
- ~30% of all claims escalate to Tier 3 (LLM judge uncertain)
- <10% reach Tier 4 (human review)

### H4 — False Invalid Rate: HERALD = LLM-as-Judge or Lower

HERALD's Tier 3 Skeptic persona is explicitly designed to challenge claims, which could
increase false invalids. Conversely, the Judge synthesis should temper extreme skeptic
positions. The multi-agent design should lower false invalids vs. a single skeptic-biased
judge.

---

## Controls & Confounds

| Confound | Control |
|----------|---------|
| Model temperature variance | `temperature=0.2` for Tier 2, `temperature=0.3` for Tier 3 (existing defaults). Note these in results. |
| Prompt version drift | Pin `src/herald/prompts/` files to git commit hash at experiment start. Record hash in output JSON. |
| OpenAI model version | Note the exact model string (`gpt-4o-mini`) in results; gpt-4o-mini is a stable alias. |
| Eval set label quality | Flag any claim where all 3 systems disagree with ground truth — could indicate a mislabel. |
| Ordering effects | Randomize claim order before running. All systems process the same shuffled order. |
| Rate limiting / retries | Use the same retry logic as the benchmark (`evaluateWithRetry`). Log retry counts per claim. |
| NLI model warm-up | If NLI backend is running, call `/api/health` before starting and discard any errors on first claim. |

---

## Output Artifacts

```
results/
├── experiment-YYYY-MM-DD.json     # Raw results per claim per system
└── analysis-YYYY-MM-DD.md         # Computed metrics report
```

Raw result record per claim:

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
    "latency_ms": 8200
  },
  "system_b": {
    "verdict": "valid",
    "tier_reached": 2,
    "confidence": 0.71,
    "latency_ms": 2100
  },
  "system_c": {
    "verdict": "invalid",
    "tier_reached": 3,
    "confidence": 0.82,
    "latency_ms": 6100
  }
}
```

---

## Decision Criteria

Use experiment results to answer:

1. **Is HERALD worth the complexity?**
   - Yes, if: F1(A) > F1(B) by ≥ 3 percentage points AND cost-adjusted F1(A) ≥ F1(B)
   - Marginal, if: F1(A) > F1(B) by < 3pp but cost-adjusted F1(A) > F1(B)
   - No, if: F1(A) ≤ F1(B) and cost(A) ≥ cost(B)

2. **Is Tier 1 (NLI) pulling its weight?**
   - Compare System A vs. System C accuracy. If F1(A) ≈ F1(C), NLI adds cost (model load)
     without accuracy gain.
   - Check NLI early-exit rate: if < 20% of claims exit at Tier 1, the tier filters little.

3. **Which claim types benefit most from HERALD?**
   - Per-type F1 breakdown: if causal/synthesis show the largest A–B gap, the multi-agent
     design earns its cost for those types. Could justify a hybrid: HERALD only for high-risk
     types, Tier 2 only for statistical.

4. **What is the cost-per-claim at production scale?**
   - Project to 1,000 claims/day. At what point does Tier 3 cost dominate?

---

## Limitations

- **Eval set size**: ~104 claims is sufficient for directional conclusions but confidence
  intervals will be wide. Do not report results to more than 1 decimal place.
- **Ground truth quality**: Rationales were written by the team. Claims near decision
  boundaries may have contested labels. Flag any claim where all 3 systems disagree.
- **Single policy domain**: If the eval set is concentrated in one domain (e.g.,
  Sub-Saharan education policy), results may not generalize to other domains.
- **Model non-determinism**: `gpt-4o-mini` is not strictly deterministic even at low
  temperature. For key findings, run 3 independent trials and report mean ± std.
- **NLI backend dependency**: System A's Tier 1 requires the Python backend running
  separately. If unavailable, System A silently degrades to System C behavior for
  statistical/comparative/causal claims. Always verify NLI is active before running.
