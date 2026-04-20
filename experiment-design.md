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

## Systems Under Comparison

### System A — HERALD (Full Pipeline)

The existing production pipeline as implemented in `backend/src/policy_memo_agent/herald/router.py`.

- Routing: per `HERALD_ROUTING_TABLE` in `models/claims.py`
  - Statistical/Comparative: start Tier 1, threshold 0.9
  - Causal: start Tier 1, threshold 0.85
  - Predictive/Normative/Synthesis: skip Tier 1, start Tier 2
- Tier 1: DeBERTa-v3-large-mnli (local, zero API cost)
- Tier 2: Claude Sonnet (`tier2_judge.py`) — 4-dimension evaluation
- Tier 3: 3× Claude Sonnet personas + 1 judge synthesis (`tier3_debate.py`)
- Early exit whenever confidence threshold is met

### System B — LLM-as-Judge Baseline

Tier 2 only, applied to **all** claims regardless of type. No NLI pre-screening, no multi-agent debate. Implemented by calling `tier2_judge.py` directly, bypassing the router.

- Same model (Claude Sonnet), same prompt template, same output schema
- No early exit logic — single call per claim
- Cost: exactly 1 LLM call per claim

### System C — HERALD without Tier 1 (Ablation)

Router with `skip_nli=True` forced for all claim types. Tests whether Tier 1 contributes accuracy or just filters for cost savings.

- Tier 2 + Tier 3 escalation intact
- Removes the NLI step entirely

---

## Dataset

**Source**: `data/eval-set.json`

Each entry is a `NotesLogEntry` with:
- `claim_id`, `claim_text`, `claim_type`, `derivation`
- `sources[]` with `relevant_chunk` (the premise fed to NLI/judge)
- `ground_truth_verdict`: `valid` | `invalid`
- `rationale`: human explanation of why

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

Verify current eval set coverage before running. If underpopulated for any type, add synthetic claims following the existing format.

**Split**: Use full dataset for evaluation (no train/test split — this is a benchmark, not a trained model).

---

## Metrics

### Primary Metrics (Quality)

| Metric | Formula | Why It Matters |
|--------|---------|----------------|
| Accuracy | (TP + TN) / N | Overall correctness |
| Precision | TP / (TP + FP) | Cost of false accusations (marking valid claims invalid) |
| Recall | TP / (TP + FN) | Cost of missed invalids (letting bad claims through) |
| F1 | 2 × P × R / (P + R) | Harmonic balance of precision/recall |
| False Invalid Rate | FP / (FP + TN) | Skeptic trap detection — valid claims wrongly rejected |
| False Valid Rate | FN / (FN + TP) | Miss rate — invalid claims slipping through |

> Here "positive" = **invalid** (the thing we want to catch). A false positive is a valid claim marked invalid.

Report all metrics **overall** and **per claim type**.

### Secondary Metrics (Cost & Latency)

| Metric | Unit | Notes |
|--------|------|-------|
| Input tokens per claim | tokens | Measured via Anthropic API response metadata |
| Output tokens per claim | tokens | Measured via Anthropic API response metadata |
| Estimated cost per claim | USD | Use current Sonnet pricing at time of experiment |
| Total cost per 100 claims | USD | Projected from per-claim average |
| Wall-clock latency per claim | seconds | End-to-end including NLI inference |
| Tier distribution (HERALD only) | % per tier | How often does each tier make the final call? |
| NLI early-exit rate (HERALD only) | % | Claims resolved at Tier 1 |

### Derived Metrics

- **Cost-adjusted F1**: F1 / (cost per claim) — quality per dollar
- **Tier escalation rate by claim type**: What fraction of each claim type reaches Tier 3?
- **Agreement rate between systems**: Where do A and B agree? Where do they diverge?

---

## Procedure

### Step 1 — Environment Setup

```bash
cd backend
uv sync --group dev

# Verify NLI model is loadable
uv run python -c "from policy_memo_agent.services.nli_service import NLIService; s = NLIService(); import asyncio; asyncio.run(s.load()); print('NLI ready')"

# Set required env vars
export ANTHROPIC_API_KEY=...
export BRAINTRUST_API_KEY=...
```

### Step 2 — Implement the Evaluation Runner

Create `scripts/run_experiment.py` (Python, mirrors the existing TypeScript benchmark):

```python
# Pseudocode — implement in backend/scripts/run_experiment.py
for claim in eval_set:
    # System A: full HERALD
    result_a = await evaluate_claim(claim, nli_service, anthropic_client)  # router.py
    
    # System B: Tier 2 only (bypass router)
    result_b = await run_tier2_judge(claim, anthropic_client)               # tier2_judge.py directly
    
    # System C: HERALD, no Tier 1
    result_c = await evaluate_claim_no_nli(claim, anthropic_client)         # router with skip_nli=True

    record_result(claim_id, ground_truth, result_a, result_b, result_c, token_counts, latency)
```

Token counts: extract from `anthropic.types.Usage` returned in each API response.

Braintrust tracing is already wired — every LLM call is auto-logged. Set `experiment_name` to `herald-vs-judge-YYYY-MM-DD` so runs are identifiable in the dashboard.

### Step 3 — Run the Experiment

```bash
uv run python scripts/run_experiment.py \
  --eval-set data/eval-set.json \
  --systems A B C \
  --concurrency 5 \
  --output results/experiment-$(date +%Y-%m-%d).json
```

Run with `--concurrency 5` to stay under Anthropic rate limits. For Tier 3, each claim makes 4 parallel LLM calls, so effective QPS is 5 × 4 = 20 at peak.

### Step 4 — Compute Metrics

```bash
uv run python scripts/analyze_experiment.py \
  --results results/experiment-YYYY-MM-DD.json \
  --output results/analysis-YYYY-MM-DD.md
```

Analysis script should produce:
1. Confusion matrices per system
2. All primary metrics, overall and per claim type
3. Cost summary table
4. Tier distribution chart (HERALD only)
5. Agreement/disagreement matrix between systems A and B

---

## Expected Outcomes & Hypotheses

### H1 — Accuracy: HERALD ≥ LLM-as-Judge

**Prediction**: HERALD achieves higher F1 than Tier 2 alone, especially on:
- Causal claims (Tier 3 Skeptic catches correlation-as-causation gaps)
- Synthesis claims (Tier 3 Methodologist catches logical leaps)
- Statistical claims (Tier 1 NLI efficiently handles clear entailment)

**Null**: No statistically meaningful difference in F1. If true, HERALD's added complexity is not justified for accuracy.

### H2 — Cost: HERALD ≤ LLM-as-Judge on Simple Claims

**Prediction**: For statistical and comparative claims where Tier 1 exits early (~40–60% estimated), HERALD costs less per claim than a direct Tier 2 call. For predictive/normative/synthesis (which skip Tier 1 and often escalate to Tier 3), HERALD costs more.

**Corollary**: HERALD's total cost advantage depends on the claim type mix in practice.

### H3 — Tier Distribution

**Prediction**: 
- ~40% of statistical/comparative claims exit at Tier 1 (NLI confident)
- ~30% of all claims escalate to Tier 3 (LLM judge uncertain)
- <10% reach Tier 4 (human review)

### H4 — False Invalid Rate: HERALD = LLM-as-Judge or Lower

HERALD's Tier 3 Skeptic persona is explicitly designed to challenge claims, which could increase false invalids. Conversely, the Judge synthesis could temper extreme skeptic positions. The multi-agent design should lower false invalids vs. a single skeptic-biased judge.

---

## Controls & Confounds

| Confound | Control |
|----------|---------|
| Model temperature variance | Set temperature=0 for all LLM calls during experiment. Record if not already default. |
| Prompt version drift | Pin `judge_system.py`, `domain_expert.py`, `methodologist.py`, `skeptic.py`, `judge_synthesis.py` to git commit hash at experiment start |
| Anthropic API version | Pin `anthropic` SDK version in `pyproject.toml` lock; note model version string in results |
| Eval set label quality | Two-person review of any claim where all 3 systems disagree with ground truth — could indicate mislabel |
| Ordering effects | Randomize claim order before running. Systems process the same shuffled order. |
| Rate limiting / retries | Wrap all API calls in retry logic (already implemented). Log retry counts per claim as metadata. |
| NLI model warm-up | Load NLI model once before experiment begins; discard first 3 predictions as warm-up |

---

## Output Artifacts

```
results/
├── experiment-YYYY-MM-DD.json         # Raw results per claim per system
├── analysis-YYYY-MM-DD.md             # Computed metrics report
└── confusion-matrices-YYYY-MM-DD.png  # Visual confusion matrices
```

Raw result record per claim:

```json
{
  "claim_id": "GT-003",
  "claim_type": "causal",
  "ground_truth": "invalid",
  "system_a": {
    "verdict": "invalid",
    "tier_reached": 3,
    "confidence": 0.87,
    "input_tokens": 1240,
    "output_tokens": 310,
    "latency_ms": 8200
  },
  "system_b": {
    "verdict": "valid",
    "tier_reached": 2,
    "confidence": 0.71,
    "input_tokens": 890,
    "output_tokens": 220,
    "latency_ms": 2100
  },
  "system_c": {
    "verdict": "invalid",
    "tier_reached": 3,
    "confidence": 0.82,
    "input_tokens": 1240,
    "output_tokens": 310,
    "latency_ms": 6100
  }
}
```

---

## Decision Criteria

Use experiment results to answer:

1. **Is HERALD worth the complexity?**
   - Yes, if: F1(A) > F1(B) by ≥ 3 percentage points AND cost-adjusted F1(A) ≥ cost-adjusted F1(B)
   - Marginal, if: F1(A) > F1(B) by < 3 pp but cost-adjusted F1(A) > F1(B)
   - No, if: F1(A) ≤ F1(B) and cost(A) ≥ cost(B)

2. **Is Tier 1 (NLI) pulling its weight?**
   - Compare System A vs. System C accuracy. If F1(A) ≈ F1(C), NLI adds cost (model load) without accuracy gain. 
   - Check NLI early-exit rate: if < 20% of claims exit at Tier 1, the tier filters little.

3. **Which claim types benefit most from HERALD?**
   - Per-type F1 breakdown: if causal/synthesis show the largest A–B gap, the multi-agent design earns its cost for those types. Could justify a hybrid: HERALD only for high-risk types, Tier 2 only for statistical.

4. **What is the cost-per-claim at production scale?**
   - Project to 1,000 claims/day. At what point does Tier 3 cost dominate? Use to set `MAX_REVISION_ATTEMPTS` and escalation thresholds.

---

## Limitations

- **Eval set size**: ~104 claims is sufficient for directional conclusions but confidence intervals will be wide. Do not report results to more than 1 decimal place.
- **Ground truth quality**: Rationales were written by the team. Claims near decision boundaries may have contested labels. Flag any claim where all 3 systems disagree with ground truth.
- **Single policy domain**: If the eval set is concentrated in one domain (e.g., Sub-Saharan education policy), results may not generalize to other domains.
- **Model non-determinism**: Even at temperature=0, Anthropic models are not strictly deterministic. For key findings, run 3 independent trials and report mean ± std.
- **Sonnet version dependency**: Results are valid only for the Sonnet version used. Pin the model ID (e.g., `claude-sonnet-4-6`) and note if Anthropic updates the underlying model.
