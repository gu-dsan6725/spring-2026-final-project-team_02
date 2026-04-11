# HERALD: Hierarchical Escalation for Reliable Agentic LLM Decision-making

## Overview

HERALD is a four-tier validation framework designed to verify the outputs of LLM-powered research agents — specifically agents that synthesize, extract, and reason over economics documents. Rather than trusting a single model to self-assess its own outputs, HERALD routes each claim through a progressive escalation ladder of increasingly powerful (and expensive) validators, stopping as soon as sufficient confidence is achieved.

The core design principle is **cost-aware accuracy**: cheap validators run first; expensive ones only activate when cheaper ones fail to reach a confident decision. This allows a research pipeline to achieve high accuracy while spending a fraction of what a naive "always use the strongest model" approach would cost.

---

## Motivation and Use Case

Large language models are increasingly deployed in **agentic research pipelines** — multi-step workflows where an LLM retrieves documents, extracts claims, synthesizes findings, and generates reports. Each step in such a pipeline introduces potential failure modes:

- Retrieved documents may be off-topic
- Extracted numbers may be hallucinated or subtly wrong
- Synthesized summaries may omit, distort, or exaggerate
- Causal language may overstate what evidence actually supports

HERALD attaches to these pipelines as a **validation layer**, intercepting each agent output before it propagates downstream. A failed checkpoint halts the pipeline, triggers escalation, and prevents compounded errors from corrupting a final report.

**Example use case:** An agent answers the question *"What is the relationship between interest rates and housing starts in the United States, 2010–2020?"* HERALD validates each intermediate step — was the retrieved document relevant? Does the extracted statistic match the source? Does the synthesis accurately represent all claims? Does the causal framing match what the data actually supports?

---

## Five Checkpoint Types

HERALD defines five structured checkpoint types, each targeting a distinct failure mode in agentic research:

| Checkpoint | What It Validates |
|---|---|
| **CP1 — Retrieval** | Is the retrieved document topically relevant to the query? |
| **CP2 — Claim Extraction** | Is the extracted claim directly entailed by the source? Are numbers exact? |
| **CP3 — Synthesis** | Does the summary faithfully represent all source claims without distortion or omission? |
| **CP4 — Numerical** | Do numbers match the source within rounding tolerance? Is the direction correct? |
| **CP5 — Causal** | Does causal language overstate what the source's evidence actually supports? |

Each checkpoint output is assigned one of three verdicts:

- **VALID** — Fully warranted by the source context
- **INVALID** — Contains errors, fabrications, or unsupported assertions
- **UNCERTAIN** — Reasonable inference that exceeds the source but may be defensible; triggers escalation to the next tier

---

## Four-Tier Architecture

```
CheckpointOutput
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ TIER 1 — NLI Classifier (DeBERTa-v3-large)                         │
│ Frames validation as NLI: source = premise, output = hypothesis     │
│ Cost: $0 (local inference)  ·  Threshold: confidence ≥ 0.70        │
│                                                                     │
│  ──► Confident verdict? → RETURN result                             │
│  ──► Below threshold?   → escalate to Tier 2                       │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ TIER 2 — LLM Judge (configurable: Groq / Gemini / OpenAI)          │
│ Structured prompt with strict "one error = INVALID" rule            │
│ Receives Tier 1 NLI scores as context                               │
│ Confidence calibration via sigmoid stretch                          │
│ Cost: varies  ·  Threshold: confidence ≥ 0.80                      │
│                                                                     │
│  ──► Confident verdict? → RETURN result                             │
│  ──► Below threshold?   → escalate to Tier 3                       │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ TIER 3 — Multi-Agent Debate (3 sequential LLM calls)               │
│ Advocate (temp=0.3) argues VALID                                    │
│ Critic (temp=0.3) argues INVALID                                    │
│ Judge (temp=0.1) decides on evidence alone                          │
│ Temperature differentiation ensures meaningful disagreement         │
│ Cost: 3× LLM calls  ·  Threshold: judge confidence ≥ 0.50         │
│                                                                     │
│  ──► Confident verdict? → RETURN result                             │
│  ──► Still uncertain?   → escalate to Tier 4                       │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ TIER 4 — Human Review (structured packet)                           │
│ Assembles full audit trail from all prior tiers                     │
│ Generates tailored question framing based on uncertainty source     │
│ Outputs JSON packet for human adjudication                          │
│ Cost: ~$5/case (human labor)                                        │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
 EscalationPacket (verdict + confidence + per-tier audit trail)
```

Each tier produces a `TierResult` that becomes part of the final `EscalationPacket`, providing a full audit trail regardless of where escalation stopped.

---

## Technical Innovations

### 1. NLI-as-Validation (Tier 1)
Rather than designing a task-specific classifier, HERALD repurposes **Natural Language Inference** as a validation primitive. The source document is cast as the NLI *premise* and the agent's output as the *hypothesis*. Entailment → VALID, contradiction → INVALID, neutral → uncertain. Using DeBERTa-v3-large (cross-encoder architecture), Tier 1 runs entirely locally at zero API cost, handling the majority of clear-cut cases.

Feasibility experiments confirmed a **0.545 mean entailment gap** between valid and invalid cases, validating that Tier 1 carries genuine signal before any training.

### 2. Confidence Calibration
LLM judges notoriously produce compressed confidence scores (e.g., all outputs between 0.6–0.8). Tier 2 applies a **sigmoid stretch calibration** that maps compressed judge outputs to the full 0–1 range, enabling meaningful threshold comparisons across tiers.

### 3. Temperature-Differentiated Debate (Tier 3)
Early experiments with uniform temperature produced identical advocate/critic arguments. HERALD uses **asymmetric temperature**: advocate and critic at 0.3 (explorative), judge at 0.1 (conservative). This ensures genuine dialectical tension rather than superficial agreement, making Tier 3 a meaningful signal rather than a rubber stamp.

### 4. Multi-Source NLI Aggregation
For checkpoints involving multiple source documents (CP1/CP3), Tier 1 runs NLI inference against each source independently and aggregates via configurable strategies: `max_entailment`, `max_contradiction`, or `mean`. This handles the realistic scenario where a synthesis spans multiple retrieved passages.

### 5. Provider Abstraction
All LLM calls (Tiers 2 and 3) go through a unified `LLMClient` interface with backends for Groq, Google Gemini, and OpenAI. Providers can be swapped at runtime via CLI flag or config file with no code changes. This enables cost and latency comparisons across providers on the same workload.

### 6. Resume-Safe Execution
The pipeline runner writes results atomically with per-case JSON appends, enabling interrupted runs to resume mid-dataset without data loss. This is critical for long runs against large test sets with rate-limited APIs.

---

## Repository Structure

```
project/
├── src/herald/
│   ├── core/
│   │   ├── types.py          # Data types: CheckpointOutput, EscalationPacket, TierResult, etc.
│   │   ├── config.py         # YAML config loader with env var injection and CLI overrides
│   │   └── llm.py            # Unified LLM provider abstraction (Groq / Gemini / OpenAI)
│   ├── pipeline/
│   │   ├── escalation.py     # HeraldPipeline: routes cases through tiers with threshold logic
│   │   └── run.py            # CLI entry point with resume capability and summary stats
│   ├── tier1/
│   │   └── classifier.py     # DeBERTa-v3-large NLI classifier with multi-source aggregation
│   ├── tier2/
│   │   └── judge.py          # LLM judge with confidence calibration and retry logic
│   ├── tier3/
│   │   └── debate.py         # Multi-agent debate (advocate / critic / judge)
│   ├── tier4/
│   │   └── human_review.py   # Structured review packet generation
│   └── evaluation/
│       └── evaluate.py       # Accuracy, escalation rates, cost metrics, baseline comparison
├── notebooks/
│   ├── threshold_sweep.py    # Sweeps T1/T2 thresholds across cost-accuracy tradeoff space
│   ├── baseline_comparison.py
│   ├── calibration_analysis.py
│   ├── generate_plots.py
│   ├── demo_agent.py         # End-to-end simulation with optional error injection
│   └── ...                   # 10+ additional analysis/utility notebooks
├── configs/
│   ├── default.yaml          # Provider, model, and threshold configuration
│   └── trial.yaml
├── data/
│   ├── test_sets/            # Hand-labeled and generated test cases (10–438 cases)
│   └── weak_labels/          # LLM-generated labels for DeBERTa fine-tuning
├── results/
│   ├── run_results.json
│   ├── evaluation.json
│   ├── baseline_comparison.json
│   ├── human_review/         # Structured Tier 4 review packets
│   └── plots/                # Generated visualizations
├── docs/
│   ├── validity_definitions.md
│   ├── progress_report.md
│   ├── trial_run_report.md
│   ├── HUMAN_REVIEW_PROTOCOL.md
│   └── MANUAL_ANNOTATION_CHECKLIST.md
└── tests/                    # 8 test files covering all tiers, pipeline, and types
```

---

## Configuration

HERALD is configured via YAML with environment variable injection:

```yaml
# configs/default.yaml
provider: "gemini"   # or "groq", "openai"

tier1:
  model_name: "cross-encoder/nli-deberta-v3-large"
  device: "cpu"      # or "cuda", "mps"

tier2:
  model: "gemma-3-27b-it"

tier3:
  model: "gemma-3-27b-it"

thresholds:
  T1: 0.70           # Tier 1 confidence threshold
  T2: 0.80           # Tier 2 confidence threshold
```

Provider and model can be overridden at runtime:

```bash
python -m herald.pipeline.run --provider groq --tier2-model llama-3.1-70b-versatile
```

Required API keys (free tiers available):

```
GROQ_API_KEY        # console.groq.com
GEMINI_API_KEY      # aistudio.google.com/apikey
OPENAI_API_KEY      # (optional)
```

---

## Setup and Installation

```bash
# Clone and install (using uv, recommended)
git clone <repo>
cd project
uv sync

# Or with pip
pip install -e .

# Configure environment
cp .env.example .env
# Add API keys to .env

# Run feasibility check
python -m herald.notebooks.feasibility_check

# Run full pipeline on test set
python -m herald.pipeline.run --test-set data/test_sets/trial_cases.json
```

---

## Empirical Results

### Feasibility Validation (40 cases)
NLI signal separation between valid and invalid cases:

| Case Type | Mean Entailment Score |
|---|---|
| Valid | 0.68 |
| Invalid | 0.13 |
| Ambiguous | 0.12 |
| **Gap** | **0.545** |

This 0.545 gap confirms Tier 1 carries genuine discriminative signal, justifying the pipeline architecture.

### Small-Scale Evaluation (10 hand-labeled cases)

| Metric | Value |
|---|---|
| Overall accuracy | **90%** (9/10) |
| Tier 1 resolution rate | 70% of cases |
| Tier 2 resolution rate | 20% of cases |
| Tier 3 resolution rate | 10% of cases |
| Total API cost | $0.00 (free tier) |

### Trial Run on GAO Government Reports (438 cases)

| Metric | Value |
|---|---|
| Overall accuracy | 45% |
| Valid-class accuracy | 98.6% |
| Invalid-class accuracy | 36.3% |
| Ambiguous-class accuracy | 0.0% |
| Tier 1 resolution rate | 40.4% |
| Tier 2 resolution rate | 50.2% |
| Tier 3 resolution rate | 9.2% |
| Tier 4 escalation rate | 0.2% |

The trial run revealed a systematic bias toward VALID verdicts, with complete failure on ambiguous cases. This led to a filtered v2.0 binary evaluation (VALID/INVALID only, excluding ambiguous), improving tractability and surfacing cleaner failure modes for targeted improvement.

---

## Baseline Comparisons

HERALD is compared against four baselines in `notebooks/baseline_comparison.py`:

| System | Description |
|---|---|
| LLM-as-judge | Single LLM call for all cases |
| NLI-only | Tier 1 alone with no escalation |
| 3-tier | Pipeline without Tier 3 debate |
| Random escalation | Tier routing at random thresholds |

Evaluation metrics include per-checkpoint-type accuracy, cost per case, and escalation rate.

---

## Key Design Decisions and Learnings

**Why NLI for Tier 1?** NLI is structurally well-matched to claim validation: it was designed to determine whether a premise entails, contradicts, or is neutral to a hypothesis. Repurposing it for validation avoids the need for custom classifiers and leverages strong pretrained signal.

**Why DeBERTa-v3-large (cross-encoder)?** Cross-encoder architectures read source and hypothesis jointly, enabling fine-grained token-level attention between them. This outperforms bi-encoder approaches (e.g., sentence-BERT) for validation tasks that require precise entailment reasoning rather than semantic similarity.

**Why temperature differentiation in debate?** Uniform temperature in early experiments caused the advocate and critic to generate near-identical arguments, making the debate degenerate. Separating exploration (0.3) from decision-making (0.1) produces genuine dialectical tension and more informative judge decisions.

**Why not always use the strongest model?** At the trial-run scale (438 cases), 40% of cases were resolved by Tier 1 at zero cost. Running Gemini or GPT-4 on those cases would spend API budget with no accuracy benefit. The escalation ladder preserves budget for genuinely hard cases.

**What is the main remaining failure mode?** Ambiguous cases — claims that are neither clearly valid nor clearly invalid — receive high-confidence VALID verdicts, indicating the system lacks calibrated uncertainty for edge cases. Checkpoint-type-specific thresholds and DeBERTa fine-tuning on ambiguous examples are the planned remediation.

---

## Roadmap

- [ ] DeBERTa fine-tuning on weak-labeled pairs (script ready; needs 500+ pairs)
- [ ] Checkpoint-type-specific thresholds (T1_causal, T1_synthesis, etc.)
- [ ] Tier 4 human review web portal (Streamlit or Flask)
- [ ] Calibration analysis and ECE reporting across checkpoint types
- [ ] Full threshold sweep on binary (non-ambiguous) dataset
- [ ] Integration with live economics research agent

---

## Dependencies

| Category | Libraries |
|---|---|
| ML / NLI | `torch`, `transformers` (DeBERTa-v3-large) |
| LLM APIs | `groq`, `google-genai`, `openai` |
| Data | `datasets`, `pandas`, `numpy` |
| Config | `pyyaml`, `python-dotenv` |
| Analysis | `scikit-learn`, `matplotlib`, `seaborn` |
| Build | `uv`, `hatchling` |

---

## Authors

DSAN 6725 — Generative AI Systems  
Georgetown University, Spring 2026
