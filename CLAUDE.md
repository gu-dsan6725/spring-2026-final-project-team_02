# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**HERALD** (Hierarchical Escalation for Reliable Agentic LLM Decision-making) is a four-tier validation framework for LLM outputs in agentic pipelines. It routes each checkpoint output through tiers of increasing cost/capability, stopping as soon as a tier resolves with sufficient confidence:

```
Checkpoint Output → Tier 1 (NLI) → Tier 2 (LLM Judge) → Tier 3 (Debate) → Tier 4 (Human)
```

**Package manager:** `uv`. **LLM provider:** Gemini (default, 1M tokens/day free) or Groq.

## Setup

```bash
uv sync
cp .env.example .env
# Add GEMINI_API_KEY or GROQ_API_KEY to .env
```

## Commands

### Run the pipeline
```bash
uv run herald-run --input data/test_sets/gov_report_v2_100_filtered.json --config configs/default.yaml --output results/run_results.json --verbose

# Resume after a rate-limit interruption:
uv run herald-run ... --resume
```

### Evaluate results
```bash
uv run herald-eval --results results/run_results.json --ground-truth data/test_sets/gov_report_v2_100_filtered.json --output results/evaluation.json
```

### Run notebooks/scripts
```bash
uv run python notebooks/threshold_sweep.py --input data/test_sets/gov_report_v2_100_filtered.json --output results/threshold_sweep.json --t1-values 0.60 0.70 0.80 0.90 --t2-values 0.60 0.70 0.80 0.90

uv run python notebooks/baseline_comparison.py --input ... --results ... --output results/baseline_comparison.json

uv run python notebooks/generate_plots.py --sweep results/threshold_sweep.json --results results/run_results.json --ground-truth data/test_sets/... --baseline results/baseline_comparison.json --output results/plots/
```

### Run tests
```bash
uv run pytest                        # all tests
uv run pytest tests/test_pipeline.py # single file
uv run pytest -k "test_name"         # single test
```

## Architecture

### Core data flow (`src/herald/core/types.py`)
- `CheckpointOutput` — input: the LLM text to validate, its source context, checkpoint type (retrieval, claim_extraction, synthesis, numerical, causal), and optional query
- `EscalationPacket` — accumulates results from each tier; holds `tier1_result` (TierResult), `tier2_result` (TierResult), `tier3_result` (DebateResult), `resolved_at_tier`, and `final_verdict` (Verdict: valid/invalid/uncertain)

### Tier implementations
- **Tier 1** (`src/herald/tier1/classifier.py`): Local DeBERTa NLI (`cross-encoder/nli-deberta-v3-large`). Classifies entailment score; resolves if confidence ≥ T1 threshold (default 0.70).
- **Tier 2** (`src/herald/tier2/judge.py`): LLM-as-judge via `get_llm_client(config)`. Resolves if confidence ≥ T2 threshold (default 0.80).
- **Tier 3** (`src/herald/tier3/debate.py`): Multi-agent debate — advocate argues valid, critic argues invalid, judge synthesizes. Uses 3 LLM calls per case.
- **Tier 4** (`src/herald/tier4/human_review.py`): Saves a structured review packet to disk; verdict stays `UNCERTAIN`.

### LLM abstraction (`src/herald/core/llm.py`)
`get_llm_client(config)` returns either `GeminiClient` or `GroqClient` based on `config["provider"]`. Both expose `client.complete(prompt, system, json_mode, temperature)`. Gemini models in the `_NO_SYSTEM_MODELS` set don't support `system_instruction` or JSON mode — the client merges system into the prompt automatically and regex-extracts JSON from the response.

### Orchestration (`src/herald/pipeline/escalation.py`)
`HeraldPipeline.validate()` runs tiers sequentially, returning early when any tier yields a non-UNCERTAIN verdict. `build_pipeline(config)` constructs the pipeline from `configs/default.yaml`.

### Config (`configs/default.yaml`)
Controls provider, model names for Tiers 2/3, Tier 1 device (`cpu`/`cuda`/`mps`), and thresholds T1/T2. Tier 2 and 3 share the same model.

## Slash Commands (`.claude/commands/`)

Type `/` in Claude Code to access these project commands:

| Command | What it does |
|---|---|
| `/run-pipeline [input_file]` | Run herald-run on the default or specified test set |
| `/eval-results [results_file]` | Evaluate results against ground truth |
| `/test [args]` | Run pytest (accepts file path or `-k pattern`) |
| `/add-test-case` | Guided flow to add a labeled case to a test set |
| `/review-prompts [tier2\|tier3]` | Audit and propose improvements to LLM prompts |
| `/sweep-thresholds [input_file]` | Run threshold sweep and generate plots |

## Collaboration Notes

### Branch convention
- `main` — stable
- `dev` — integration
- `<initials>-<feature>` — personal branches (e.g., `ani-dev`)

### Prompt changes are high-impact
The system prompts in `src/herald/tier2/judge.py` (`JUDGE_SYSTEM`, `JUDGE_TEMPLATE`) and `src/herald/tier3/debate.py` (`ADVOCATE_PROMPT`, `CRITIC_PROMPT`, `DEBATE_JUDGE_PROMPT`) control verdict logic. Small wording changes shift escalation rates significantly. Always validate on a held-out set before merging. Use `/review-prompts` to get a structured audit.

### Adding test cases
Each case in `data/test_sets/` needs: `checkpoint_type`, `output_text`, `source_context`, `query` (optional), `label` (`valid`/`invalid`/`ambiguous`). Check `docs/validity_definitions.md` before assigning a label.

### Before opening a PR
1. `uv run pytest` — all tests must pass
2. Sanity-run the pipeline on `data/test_sets/sample_cases.json`
3. If you changed a prompt, document before/after and motivation in the PR

## Known Issues / Active Concerns
- **Groq 429 rate limits:** Switch to `provider: "gemini"` (default) or add `--resume` on reruns.
- **Gemma models** (e.g., `gemma-3-27b-it`) don't support system prompts or native JSON mode — handled transparently in `GeminiClient`, but JSON parsing relies on regex extraction and may be fragile.
- Results are saved incrementally after every case so runs can be resumed safely.
