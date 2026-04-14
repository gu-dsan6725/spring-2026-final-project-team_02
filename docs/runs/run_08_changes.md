# Run 08 Changes

**Date:** 2026-04-12
**Branch:** `feature/improve-tier1-thresholds-reformulation`
**Dataset:** `data/test_sets/gov_report_v2_filtered.json` (306 cases)
**Baseline:** Run 07 — TBD (same code as run 07 plus the 5 improvements below)

---

## Why this run exists

This run incorporates a batch of infrastructure and accuracy improvements
identified through analysis of runs 04–07. The changes fall into five areas:

1. **Numeric mismatch guard** — directly addresses the dominant T1 error class
   (27 false negatives from run 05 where NLI scored wrong numbers as valid)
2. **DeBERTa fine-tuning scaffold** — tooling to generate training data for
   future model retraining; not active in this run's model weights
3. **OTel + Braintrust observability** — per-tier latency tracing and
   experiment tracking so future runs are compared systematically
4. **Per-tier model config** — T2 and T3 can now use different models
5. **FastMCP server** — exposes HERALD as an MCP tool for external agents

---

## Changes applied

### 1. `src/herald/tier1/classifier.py` — Numeric mismatch guard

**Problem:** DeBERTa assigns 0.97–0.99 entailment to claims with wrong
numbers/dates because it measures textual structure, not factual precision.
27 of the 34 run 05 errors were T1 false negatives of exactly this form.

**Change:** Added `_extract_numbers()` and `_numeric_mismatch()` helper
functions at module level. The `classify()` method now runs a post-NLI guard:
if the verdict is a confident VALID (entailment ≥ 0.80) for a `numerical`,
`synthesis`, or `causal` checkpoint type, it extracts all numeric tokens from
the claim and checks whether each one appears in the source. If any claim
number is absent from the source, the verdict is downgraded to UNCERTAIN,
forcing escalation to Tier 2 where the numerical verification block
(added in run 06) performs explicit value-by-value checking.

**Constant `_IGNORE`** excludes common non-factual numbers (1, 2, 3, 4, 5,
10, 100) to avoid false positives on ordinal references like "three
principles" or "all 100 percent".

The guard result is recorded in `raw_scores["numeric_guard_fired"]` and
appended to the reasoning string for auditability.

**Expected impact:** Catches the "1988 vs 1984" class of errors at T1.
Increases T2 call volume slightly for numerical/synthesis/causal types but
those calls are now equipped with the numerical verification block.

**File:** [src/herald/tier1/classifier.py](../../src/herald/tier1/classifier.py)

---

### 2. `notebooks/generate_training_data.py` — DeBERTa fine-tuning data pipeline

**New file.** Combines three data sources into a single training JSON for
`notebooks/finetune_tier1.py`:

| Source | Description | Expected count |
|---|---|---|
| Labeled test set | 306 cases from `gov_report_v2_filtered.json` | 306 |
| Hard negatives | Cases where T1 was confident (≥ 0.85) but wrong | ~27–88 |
| Synthetic perturbations | Valid cases with one number mutated to wrong value | ~100–200 |

The `--synthetic-augment` flag enables source 3. The `--results` flag points
to any run's results JSON for source 2.

**This script does not change model weights in run 08.** It produces training
data for a future fine-tuning run. After running the script, use:
```bash
uv run python notebooks/finetune_tier1.py \
  --data data/training/tier1_training_data.json \
  --output models/deberta-finetuned-herald
# Then update configs/default.yaml: tier1.model_name → models/deberta-finetuned-herald
```

**File:** [notebooks/generate_training_data.py](../../notebooks/generate_training_data.py)

---

### 3. `src/herald/core/telemetry.py` — OTel + Braintrust observability

**New file.** Two independent observability mechanisms:

**OpenTelemetry (OTel):**
- `configure_otel()` — called at pipeline import time; sets up a
  `TracerProvider`. If `OTEL_EXPORTER_OTLP_ENDPOINT` is set, spans are
  exported to that endpoint (e.g. Jaeger, Honeycomb, Datadog). If not set,
  tracing is a silent no-op (no overhead).
- `get_tracer()` — returns an OTel tracer or a no-op shim if
  `opentelemetry-sdk` is not installed.
- `timed_span()` — context manager that wraps a block in a span and
  records duration in ms.

**Wired into `escalation.py`:**
- Root span `herald.validate` wraps the entire `_validate_inner()` call.
- Child spans `herald.tier1`, `herald.tier2`, `herald.tier3` record
  verdict, confidence, and duration per tier.
- `numeric_guard_fired` is recorded as a T1 span attribute.
- Final `resolved_at_tier` and `final_verdict` are set on the root span.

**Braintrust:**
- `BraintrustLogger` — logs each eval case as an experiment row (input,
  output, expected, scores). Falls back silently if `BRAINTRUST_API_KEY`
  is not set or `braintrust` is not installed.

**Wired into `evaluate.py`:**
- `BraintrustLogger` is instantiated with the experiment name (defaults to
  the stem of `--output`, e.g. `run_08_govreport_v2_eval`).
- Every case is logged as a row during the accuracy loop.
- `bt.flush()` is called at the end to push all rows.
- `--experiment NAME` flag lets you override the experiment name.

**To activate:**
```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318   # OTel collector
export BRAINTRUST_API_KEY=your_key_here                    # braintrust.dev
# Install optional deps if needed:
uv add opentelemetry-sdk opentelemetry-exporter-otlp-proto-http braintrust
```

**Files:**
- [src/herald/core/telemetry.py](../../src/herald/core/telemetry.py) *(new)*
- [src/herald/pipeline/escalation.py](../../src/herald/pipeline/escalation.py) *(OTel wired in)*
- [src/herald/evaluation/evaluate.py](../../src/herald/evaluation/evaluate.py) *(Braintrust wired in)*

---

### 4. `src/herald/core/llm.py` + `configs/default.yaml` — Per-tier model config

**Problem:** `get_llm_client(config)` always read `config["tier2"]["model"]`
regardless of which tier was requesting a client. T2 and T3 were forced to
use the same model.

**Change to `llm.py`:** `get_llm_client(config, tier=2)` now accepts a `tier`
argument. It reads `config["tier{tier}"]["model"]` and falls back to
`config["tier2"]["model"]` if not set. This means adding `tier3.model` to
the config is all that's needed to give T3 a different (stronger) model.

**Change to `judge.py`:** `LLMJudge.__init__` now calls
`get_llm_client(config, tier=2)` and reads `self.model` from the client.

**Change to `debate.py`:** `MultiAgentDebate.__init__` now calls
`get_llm_client(config, tier=3)`.

**Config comments updated** to document the model options per tier including
the stronger `gemini-2.5-pro-preview-03-25` option for T3 debates on hard cases.

**To use a stronger T3 model:**
```yaml
# configs/default.yaml
tier3:
  model: "gemini-2.5-pro-preview-03-25"  # stronger reasoning for hard debates
```

**Files:**
- [src/herald/core/llm.py](../../src/herald/core/llm.py)
- [src/herald/tier2/judge.py](../../src/herald/tier2/judge.py)
- [src/herald/tier3/debate.py](../../src/herald/tier3/debate.py)
- [configs/default.yaml](../../configs/default.yaml)

---

### 5. `src/herald/mcp/server.py` — FastMCP server

**New file.** Exposes HERALD as an MCP service any MCP-compatible client
(Claude Desktop, Claude Agent SDK, LangGraph) can call without importing
HERALD as a Python library.

**Tools:**
| Tool | Description |
|---|---|
| `validate_checkpoint` | Full 4-tier pipeline on a single output |
| `validate_batch` | Validate a list of outputs against the same source |
| `explain_verdict` | Plain-language breakdown of a prior result by ID |

**Resources:**
| URI | Description |
|---|---|
| `herald://results/{run_id}` | JSON results for a named run |
| `herald://evaluations/{eval_id}` | Eval metrics for a named eval |

The pipeline is loaded once at server startup (DeBERTa model load takes
several seconds) and reused across all tool calls.

**Start the server:**
```bash
# Requires: uv add mcp
uv run herald-mcp                          # default: port 8000, streamable-http
uv run herald-mcp --port 9000              # custom port
uv run herald-mcp --transport stdio       # for Claude Desktop stdio mode
```

**Connect from Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "herald": { "url": "http://localhost:8000/mcp" }
  }
}
```

**`pyproject.toml`** updated with `herald-mcp = "herald.mcp.server:main"` entry point.

**Files:**
- [src/herald/mcp/server.py](../../src/herald/mcp/server.py) *(new)*
- [src/herald/mcp/__init__.py](../../src/herald/mcp/__init__.py) *(new)*
- [pyproject.toml](../../pyproject.toml)

---

## What was NOT changed in run 08

All routing changes from runs 06–07 remain active:

| Component | Status |
|---|---|
| `skip_nli` routing (causal, epistemic → always T2) | Active |
| `prefer_debate` conditional escalation (T2 conf < 0.92) | Active |
| Numerical verification block in T2 prompt | Active |
| T2 anchor removed from T3 advocate/critic | Active |
| Per-type T1 thresholds (numerical: 0.85, synthesis: 0.85) | Active |

Items 6 (Tier 3 asyncio parallelism) and 7 (Mem0 memory) are deferred to a future run.

---

## Expected impact vs run 07

| Metric | Expected direction | Reason |
|---|---|---|
| Overall accuracy | +2–4pp | Numeric guard catches ~20 T1 false negatives |
| `label_invalid` recall | +5–8pp | Primary target — guard fires on wrong-number invalids |
| `cp_numerical` accuracy | +3–5pp | Guard + T2 numerical block working together |
| `cp_synthesis` accuracy | +2–3pp | Guard fires for synthesis too |
| T1 resolution rate | -3–5pp | More cases escalate due to guard |
| T2/T3 call volume | Slightly higher | Guard → more T2 calls for numerical/synthesis |

OTel and Braintrust are additive — no accuracy impact, but every subsequent
run will have per-tier latency data and tracked experiment rows.

---

## Commands

```bash
uv run herald-run \
  --input data/test_sets/gov_report_v2_filtered.json \
  --config configs/default.yaml \
  --output results/runs/run_08_govreport_v2/results.json \
  --verbose

# If interrupted by rate limits:
uv run herald-run \
  --input data/test_sets/gov_report_v2_filtered.json \
  --config configs/default.yaml \
  --output results/runs/run_08_govreport_v2/results.json \
  --verbose --resume

uv run herald-eval \
  --results results/runs/run_08_govreport_v2/results.json \
  --ground-truth data/test_sets/gov_report_v2_filtered.json \
  --output results/evaluation/run_08_govreport_v2_eval.json \
  --experiment run_08_govreport_v2
```
