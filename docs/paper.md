# HERALD: A Hierarchical Evidence Review and Automated Legitimacy Detection Framework for Policy Memo Claim Evaluation

---

## Abstract

Policy memos produced by AI agents present a unique verification challenge: they contain claims of widely varying complexity, from simple numerical facts sourced directly from data repositories to multi-source synthesis inferences that require expert judgment to evaluate. Existing evaluation approaches are binary — either cheap heuristic rules that miss nuanced errors, or expensive LLM-as-a-judge calls applied uniformly regardless of claim complexity. We present HERALD (Hierarchical Evidence Review and Automated Legitimacy Detection), a four-tier escalation framework that optimizes evaluation cost by routing claims through progressively more expensive tiers only when cheaper tiers cannot reach confident verdicts. HERALD is built into a full-stack policy memo writing system in which an LLM agent researches policy topics using eight external data sources, generates structured memos with full claim-to-source provenance, and allows users to selectively submit claims for evaluation. Tier 1 uses a local DeBERTa-v3 NLI model (zero API cost) to catch clear entailments and contradictions. Tier 2 applies an LLM-as-a-judge with claim-type-specific evaluation criteria. Tier 3 convenes a three-persona debate (domain expert, methodologist, skeptic) synthesized by a judge agent. Tier 4 escalates to human review. Our initial benchmark on a 50-claim labeled evaluation set finds 82% operational accuracy (whether the correct action — flag or pass — was taken), 94.1% precision, and 66.7% recall. Recall is the primary failure mode: HERALD misses one in three genuinely problematic claims, particularly synthesis claims (F1=0.50) and normative claims with single-institution sourcing (25% hard error rate). Tier 1 NLI was inactive during this baseline run due to an infrastructure configuration gap, so no NLI filtering benefit has been quantified yet. We identify specific prompt-level fixes for the dominant failure modes and outline a threshold calibration methodology for future benchmark runs.

---

## 1. Introduction

### The Problem

As AI agents are increasingly deployed to produce research-backed documents — policy analyses, briefings, literature reviews — a fundamental question arises: how do we verify that the claims these agents make are accurate, well-supported, and fairly represented from their sources? This is harder than it sounds. A policy memo may contain dozens of claims spanning vastly different epistemic categories: a mortality rate cited verbatim from a WHO report, a causal inference drawn from a regression study, a best-practice recommendation synthesized from multiple institutional frameworks. These claims differ not only in content but in the kind of evaluation they require.

Applying a single evaluation strategy to all claims is wasteful at best and ineffective at worst. Running every claim through a full multi-agent debate costs roughly the same whether the claim is a direct numerical extraction (trivially verifiable) or a complex multi-source synthesis (genuinely contested). Conversely, running every claim through a cheap rule-based check misses the subtle distortions that matter most — correlation dressed as causation, a projection stated without its conditional assumptions, a synthesis conclusion that elides population differences across studies.

### Motivation

This project is motivated by the applied AI challenge of building trustworthy AI writing agents for policy domains. Policy memos inform government decisions, funding allocations, and advocacy strategies. The stakes of factual errors or misleading claims are high. We want a system that gives policymakers not just a memo, but a memo they can trust — with every claim traceable to its source and every questionable inference flagged before it reaches a decision-maker.

The policy domain is also a particularly demanding testbed for evaluation frameworks because:

- Claims span six structurally distinct types (statistical, causal, comparative, predictive, normative, synthesis), each requiring different evaluation criteria
- Sources range from quantitative data repositories to qualitative expert opinion
- The agent's synthesis and inference steps introduce risks that source-level checks alone cannot catch

### Research Questions

1. Can a hierarchical NLI → LLM-judge → multi-agent debate escalation framework match or exceed the accuracy of uniform LLM-as-a-judge evaluation at lower average cost per claim?
2. What is the optimal confidence threshold at each tier to minimize false negatives (bad claims passing) while keeping escalation rates manageable?
3. Which claim types and derivation methods represent the hardest evaluation targets, and what prompt strategies reduce error rates on these cases?

---

## 2. Related Work

### LLM-as-a-Judge

The LLM-as-a-judge paradigm has gained significant traction as a scalable alternative to human annotation for evaluating generated text. Prior work demonstrates that large language models can provide evaluations that correlate well with human judgments on dimensions like helpfulness, coherence, and factual accuracy. However, uniform LLM judging applies the same compute cost to every evaluation regardless of difficulty.

[GAP]: We need to add specific citations here — key papers include the original LLM-as-a-judge work (Zheng et al., 2023), constitutional AI evaluators, and factual verification benchmarks. We should also cite work on LLM evaluation biases (positional bias, sycophancy).

### Natural Language Inference for Fact Checking

NLI models have been widely studied for automated fact checking. The core task — determining whether a hypothesis is entailed by, neutral to, or contradicted by a premise — maps naturally onto claim verification when claims are short and their source chunks are available. DeBERTa-v3-large-mnli achieves strong performance on standard NLI benchmarks, making it a natural first-stage filter.

[GAP]: Need citations for DeBERTa, MultiNLI benchmark results, and prior work applying NLI to fact checking (e.g., FEVER dataset work). Should note known limitations: NLI works best for direct entailment and struggles with predictive or normative claims.

### Multi-Agent Debate for Evaluation

Recent work has explored using multiple LLM instances arguing different positions to improve reasoning quality. Society of Mind approaches and debate-based evaluation frameworks show that adversarial multi-agent setups can surface considerations that a single judge misses.

[GAP]: Cite relevant multi-agent debate papers and structured argumentation frameworks. Note how our three-persona design (domain expert + methodologist + skeptic) differs from symmetric debate setups.

### Claim Provenance and Structured Generation

Structured output from language models, including approaches that require agents to emit structured provenance alongside generated text, has been studied in retrieval-augmented generation (RAG) and citation-grounded generation contexts.

[GAP]: Cite RAG provenance work, citation generation papers, and structured generation work. Note that our notes-log approach (provenance built during research, not post-hoc) is architecturally distinct from most RAG evaluation pipelines.

### How Our Approach Differs

HERALD contributes: (1) a principled claim taxonomy with type-specific routing rules, not a one-size-fits-all evaluator; (2) explicit confidence-threshold escalation across four tiers rather than binary judge/human-review decisions; (3) type-specific evaluation criteria at the LLM-judge tier (e.g., causal warrant vs. correlation, normative consensus tests); (4) structured feedback from every tier that is directly usable for agent revision, not just pass/fail verdicts.

---

## 3. System Architecture

The system is organized as a four-phase pipeline:

```
[Phase 1: User Input] → [Phase 2: Research & Generation] → [Phase 3: User Review] → [Phase 4: HERALD Evaluation]
                                    ↑                                                           |
                                    └──────────── Revision feedback loop ──────────────────────┘
```

### 3.1 Technology Stack

**Frontend:** Next.js 16.2.3, React 19.2.5, TypeScript, Tailwind CSS 4.2.2
**Backend:** Python 3.11+, FastAPI 0.115.0, SQLAlchemy 2.0 (async), asyncpg 0.30.0
**Research Agent LLM:** Groq API running Llama-3.3-70B-Versatile
**HERALD Tier 1:** `cross-encoder/nli-deberta-v3-large` via HuggingFace Transformers or ONNX Runtime
**HERALD Tier 2/3:** OpenAI-compatible API (currently `gpt-4o-mini` in benchmark; production target is Claude Sonnet via Anthropic API)
**Infrastructure:** PostgreSQL 15, Redis 7, Docker Compose
**Observability:** Braintrust (LLM call tracing, NLI inference logging, tool call logging)
**Package Management:** uv (Python), npm (Node.js)

### 3.2 Phase 1 — User Input and Prompt Assembly

The user provides a policy topic, optional background/framing text, known source URLs or uploaded files, and an optional memo template. The system assembles a structured system prompt (`src/agent/prompt-assembler.ts`) that injects:

- The full six-type claim taxonomy with definitions and examples
- The required notes log JSON schema (every claim must be recorded before the memo is written)
- The required output format: a structured memo object plus a `notes_log` array
- A research plan directive (the agent must create an explicit plan before executing queries)
- The list of available tools and their descriptions
- The user's background context and any known sources

The prompt assembly step is deterministic — it does not call any LLM. Its output is the system prompt that drives the research agent.

### 3.3 Phase 2 — Research and Generation Agent

**File:** `src/agent/research-agent.ts`

The research agent uses the Groq API (OpenAI-compatible interface, model: `llama-3.3-70b-versatile`). The agent loop:

1. Receives the assembled system prompt and user topic as the initial message
2. Calls Groq with all tool definitions in scope (8 tools; see Section 3.3.1)
3. If Groq returns tool calls, the agent executes each via `src/mcp/tool-registry.ts` and appends results to the message history
4. The loop continues until the agent returns a final message (no more tool calls) or the budget is exhausted
5. The final message is parsed to extract the structured `{ memo, notes_log }` JSON

**Budget enforcement** (`src/agent/loop-controller.ts`):

- Hard limit: 60 tool calls per memo (configurable via `MAX_TOOL_CALLS`)
- Token budget: 50,000 research tokens (configurable via `MAX_RESEARCH_TOKENS`)
- At 60% budget: no action (agent continues)
- At 80% budget: a synthesis prompt is injected encouraging the agent to move toward memo writing
- At 100% budget: hard stop, agent forced to synthesize from available information
- Deduplication cache: `(tool_name, normalized_query) → cached_result` prevents redundant tool calls

**Quality gate** (checked before returning to user): minimum 3 unique sources, 4 distinct claims, 2 different claim types in the notes log.

**Rate limit handling:** on HTTP 429 from Groq, the agent waits 60 seconds and retries once.

#### 3.3.1 MCP Tool Registry

**File:** `src/mcp/tool-registry.ts`

Eight tools are registered, each with a handler, timeout, retry policy, and health check URL:

| Tool                      | Source                    | Description                                   |
| ------------------------- | ------------------------- | --------------------------------------------- |
| `web_search`              | Brave Search API          | Current news, policy documents, web content   |
| `arxiv_search`            | arXiv Atom feed           | Academic preprints (XML parsed via regex)     |
| `worldbank_search`        | World Bank Indicators API | Development statistics and country indicators |
| `govinfo_search`          | GovInfo API               | US Congressional reports, GAO analyses        |
| `fred_search`             | Federal Reserve (FRED)    | US macroeconomic and financial data           |
| `govreport_search`        | Government report index   | Government technical reports                  |
| `semantic_scholar_search` | Semantic Scholar API      | Academic paper metadata and abstracts         |
| `file_reader`             | Local file system         | User-uploaded PDFs and documents              |

All tool calls are wrapped in `fetchWithRetry()` with AbortController-based timeouts (30 seconds) and exponential backoff (500ms → 1s → 2s, up to 3 retries). Failed calls after max retries are logged to Braintrust and noted in the agent's context as "Source unavailable."

All tool invocations are logged via Braintrust spans: tool name, input query, output preview, and latency in milliseconds.

#### 3.3.2 Notes Log and Claim Provenance

The agent is instructed to maintain a running notes log **during research, before writing the memo**. This is the critical design choice that makes provenance possible: because the agent records which source informed which claim at the time of research, the link between claim and source is explicit in the structured output, not reconstructed post-hoc.

Each notes log entry (`src/types/claims.ts`) contains:

- `claim_id`: Unique identifier (e.g., "C-003") used to inline-cite the claim in the memo text
- `claim_text`: The single atomic assertion as it will appear in the memo
- `claim_type`: One of the six canonical types (see Section 3.5)
- `derivation`: One of four derivation methods (see Section 3.5)
- `sources`: Array of source objects, each with title, URL, and the exact relevant excerpt
- `reasoning`: One-sentence explanation of how the claim was derived from the source(s)

After generation, `src/agent/claim-extractor.ts` runs a completeness check: every `[C-XXX]` citation marker in the memo must have a corresponding notes log entry, and every notes log entry must be cited somewhere in the memo. Orphaned IDs in either direction are reported as validation errors.

### 3.4 Phase 3 — User Review Interface

**Components:** `src/ui/components/MemoViewer.tsx`, `NotesLog.tsx`, `ClaimSelector.tsx`

The generated memo is rendered with inline claim markers `[C-001]`, `[C-002]`, etc., displayed as color-coded superscript badges. Each claim type has a distinct color (blue for statistical, orange for causal, purple for comparative, green for predictive, pink for normative, red for synthesis). Clicking a claim marker opens the full provenance panel: source title, URL, exact excerpt, derivation method, and agent reasoning.

The user selects which claims to submit for HERALD evaluation. By default, high-risk claims are pre-selected: those with `agent_inference` or `cross_source` derivation methods, and all synthesis and normative claims (highest-error types per benchmark results).

### 3.5 Claim Taxonomy

Every claim in the memo is classified into exactly one of six atomic types. The type determines both the evaluation criteria and the HERALD routing path:

| Claim Type      | Definition                                                    | HERALD Start Tier | NLI Threshold |
| --------------- | ------------------------------------------------------------- | ----------------- | ------------- |
| **Statistical** | A specific number, rate, or quantitative measure              | Tier 1            | 0.90          |
| **Causal**      | Asserts X causes/drives/leads to Y                            | Tier 1            | 0.85 (lower)  |
| **Comparative** | Claims something is greater/lesser relative to something else | Tier 1            | 0.90          |
| **Predictive**  | Forward-looking: what will happen, projected, expected        | Tier 2 (skip NLI) | N/A           |
| **Normative**   | What should be done, best practice, recommended               | Tier 2 (skip NLI) | N/A           |
| **Synthesis**   | Novel inference combining multiple sources                    | Tier 2 (skip NLI) | N/A           |

The rationale for the routing split: NLI models evaluate whether a premise entails a hypothesis — a meaningful check for claims that are directly or indirectly stated in a source, but meaningless for claims about future states (predictive), prescriptions (normative), or multi-source inferences where no single source entails the conclusion (synthesis).

Causal claims use a lower NLI escalation threshold (0.85 vs. 0.90) because NLI can catch obvious misquotes but cannot detect the correlation-as-causation distortion that is the most common causal claim error. Sending borderline causal cases to Tier 2 is therefore more important than for statistical/comparative claims.

Each claim also carries a **derivation method** tag indicating how the agent produced it:

| Derivation          | Description                                      | Risk Level |
| ------------------- | ------------------------------------------------ | ---------- |
| `direct_extraction` | Lifted verbatim or near-verbatim from one source | Low        |
| `paraphrase`        | Restated from one source                         | Low        |
| `cross_source`      | Combined from two or more sources                | Medium     |
| `agent_inference`   | Agent's own reasoning beyond what sources state  | High       |

Derivation method is used in HERALD to modulate skepticism: agent_inference claims receive heightened scrutiny regardless of claim type.

### 3.6 Phase 4 — HERALD Evaluation Pipeline

**Router:** `src/herald/router.ts` (TypeScript), `backend/src/policy_memo_agent/herald/router.py` (Python)

The router implements the following logic for each claim:

```
1. Determine starting tier based on claim_type (routeClaim())
2. If startTier == 1 (statistical, causal, comparative):
     a. Call Tier 1 NLI batch endpoint (POST /api/herald/nli/batch)
     b. If verdict != 'uncertain' → return HeraldResult (early exit)
3. Run Tier 2 LLM Judge
     a. If verdict != 'uncertain' → return HeraldResult (early exit)
4. Run Tier 3 Multi-Agent Debate
     a. Build final HeraldResult from Tier 3 output
5. Return HeraldResult with full tier_details
```

The HERALD output schema (`src/types/herald.ts`) carries the verdict, confidence score, structured feedback, suggested revision text, and the full output from each tier that ran. This schema is passed back to the research agent when revision is requested.

#### 3.6.1 Tier 1 — NLI Evaluation

**TypeScript:** `src/herald/tier1-nli.ts`
**Python Service:** `backend/src/policy_memo_agent/services/nli_service.py`
**Python Tier:** `backend/src/policy_memo_agent/herald/tier1_nli.py`

The NLI service (`NLIService`) wraps either a HuggingFace Transformers pipeline or an ONNX Runtime session. Model resolution order at startup:

1. If `NLI_ONNX_MODEL_PATH` is set → load ONNX model and tokenizer from that directory (3-4x faster on CPU)
2. Otherwise → load HuggingFace pipeline for the model at `HF_MODEL_PATH` (default: `cross-encoder/nli-deberta-v3-large`)

The model is loaded **once** at FastAPI application startup via the lifespan handler and held in a module-level singleton. It is never replaced by an LLM call.

**Inference:** For each claim, the source chunk(s) are provided as the premise and the claim text as the hypothesis. The model outputs three scores: entailment, neutral, contradiction. The `NLIResult` carries all three scores and the winning label.

**Decision logic:**

- Contradiction score ≥ 0.80 → INVALID, exit (claim contradicts its source)
- Entailment score ≥ claim-type threshold → VALID, exit (claim is entailed by its source)
- Otherwise → UNCERTAIN, escalate to Tier 2

**ONNX path:** Inputs are tokenized with max length 512 and truncation. Logits are converted to probabilities via softmax. Label order: 0=contradiction, 1=neutral, 2=entailment. The HuggingFace path normalizes labels from various formats (LABEL_0/1/2, uppercase) to canonical lowercase strings.

**Tier 1 API:** The TypeScript tier calls `POST http://localhost:8000/api/herald/nli/batch` — the FastAPI backend endpoint. This requires the Python backend to be running. In Benchmark 01, this service was not running, causing all Tier 1 attempts to silently fail and route directly to Tier 2.

Every NLI inference is logged to Braintrust with: claim ID, premise chunk, hypothesis text, all three scores, winning label, latency in milliseconds, and whether ONNX or HuggingFace was used.

#### 3.6.2 Tier 2 — LLM-as-a-Judge

**TypeScript:** `src/herald/tier2-llm-judge.ts`
**Python:** `backend/src/policy_memo_agent/herald/tier2_judge.py`
**Prompts:** `src/herald/prompts/judge-system.ts`

The LLM judge is called with a system prompt composed of:

- `BASE_INSTRUCTIONS`: general evaluation posture (evaluate only what source material supports; flag agent_inference derivations for heightened scrutiny; output structured JSON via tool call)
- `CRITERIA_<TYPE>`: claim-type-specific evaluation criteria (selected based on the claim's type)

**The six evaluation criterion sets** (`CRITERIA_STATISTICAL`, `CRITERIA_CAUSAL`, `CRITERIA_COMPARATIVE`, `CRITERIA_PREDICTIVE`, `CRITERIA_NORMATIVE`, `CRITERIA_SYNTHESIS`) each contain:

- Explicit evaluation questions specific to the claim type
- Named red flags (e.g., "Correlation ≠ causation" for causal claims; "Single NGO ≠ consensus" for normative claims)
- Sample revision language for invalid claims of that type

**Structured output:** The judge uses an OpenAI-compatible function call (`submit_evaluation`) to return:

```json
{
  "verdict": "valid | invalid | needs_revision | uncertain",
  "confidence": 0.0–1.0,
  "reasoning": "Specific reasoning citing sources",
  "suggested_revision": "Concrete revised claim text (if invalid or needs_revision)"
}
```

**Decision thresholds:**

- Confidence > 0.85 → exit with verdict (valid, invalid, or needs_revision)
- Confidence 0.60–0.85 → override verdict to 'uncertain', escalate to Tier 3
- Confidence < 0.60 → override to 'uncertain', escalate to Tier 3 with high-priority flag

#### 3.6.3 Tier 3 — Multi-Persona Debate

**TypeScript:** `src/herald/tier3-debate.ts`
**Python:** `backend/src/policy_memo_agent/herald/tier3_debate.py`
**Persona Prompts:** `src/herald/prompts/` (domain-expert, methodologist, skeptic, judge-synthesis)

Three LLM personas evaluate the claim in parallel:

**Domain Expert** (`src/herald/prompts/domain-expert.ts`): Evaluates substantive accuracy from the perspective of a domain specialist. Focuses on whether the claim aligns with accepted field knowledge, whether the cited source is an appropriate authority, and whether the claim overstates or understates what the source supports.

**Methodologist** (`src/herald/prompts/methodologist.ts`): Evaluates evidence quality and inferential validity. Examines study design, sample size, geographic and temporal scope, generalizability, and whether the inference drawn follows from the study methodology.

**Skeptic** (`src/herald/prompts/skeptic.ts`): Actively challenges the claim by searching for alternative explanations, counter-evidence, and edge cases. The skeptic is designed to be adversarial — but is also constrained by a guardrail: if the source chunk directly and specifically states what the claim asserts (same figure, same population, same units), the skeptic should not raise purely methodological objections.

Each persona outputs a structured evaluation (verdict + reasoning). The **Judge** (`src/herald/prompts/judge-synthesis.ts`) then synthesizes the three perspectives, using a `submit_synthesis` tool call to return:

```json
{
  "verdict": "valid | invalid | needs_revision | uncertain",
  "confidence": 0.0–1.0,
  "reasoning": "Which reviewer's argument was most persuasive and why",
  "suggested_revision": "...",
  "dominant_persona": "domain_expert | methodologist | skeptic | unanimous"
}
```

**Consensus rules:**

- Unanimous (3/3 agree) → exit with that verdict, confidence boosted to ≥ 0.90
- 2-1 majority + judge confidence > 0.75 → exit with majority verdict
- No consensus or judge confidence ≤ 0.75 → UNCERTAIN, escalate to Tier 4

#### 3.6.4 Tier 4 — Human Review

**File:** `src/herald/tier4-human.ts`, `src/ui/components/HumanReviewQueue.tsx`

Claims that exhaust automated evaluation are queued for human review. The human review UI presents: the claim text, all source chunks, and the full structured output from each tier that ran (including each persona's reasoning from Tier 3). The reviewer submits a verdict (valid/invalid/needs_revision/uncertain) with optional notes. The verdict is recorded with `tier_reached: 4` in the HERALD result schema.

### 3.7 Feedback and Revision Loop

Invalid or needs_revision claims are passed back to the research agent with the full HERALD output as context. The revision prompt includes: original claim text, source excerpts, HERALD feedback, and suggested revision text. The agent produces a revised claim and notes log entry. Maximum 2 revision attempts per claim; after 2 failed revisions, the claim is permanently flagged for human intervention (`revision_count` field in the claims database table).

### 3.8 Database and Persistence

**ORM:** SQLAlchemy 2.0 async, asyncpg driver, PostgreSQL 15
**Schema** (`backend/src/policy_memo_agent/db/models.py`):

- `memos`: Memo metadata, markdown content, notes log JSON, status, version number
- `memo_versions`: Full revision history with changed claim IDs and change reason
- `claims`: Individual claims with claim type, derivation, sources JSON, HERALD result JSON, revision count, status
- `tool_call_logs`: Every research tool invocation with input, output, extracted claim IDs, and latency

**Migrations:** Alembic (`backend/alembic/versions/`). Applied with `uv run alembic upgrade head`.

**Session state:** Redis 7 (claim evaluation queues, WebSocket session tracking, deduplication cache)

---

## 4. Data and Evaluation

### 4.1 Research Data Sources

The research agent has access to eight data sources covering complementary aspects of policy research:

- **Brave Search**: Open web content, news, government websites, NGO publications
- **arXiv**: Peer-reviewed preprints across economics, public health, environmental science, social sciences
- **World Bank Indicators API**: Country-level development statistics (GDP, health, education, poverty indicators)
- **GovInfo**: US Congressional Research Service reports, GAO analyses, federal agency publications
- **FRED (Federal Reserve Economic Data)**: Macroeconomic and financial time series
- **Semantic Scholar**: Academic paper metadata, citations, abstracts
- **Government Reports index**: Additional government technical reports
- **File reader**: User-uploaded PDFs and documents (e.g., country strategy papers, evaluation reports)

No training data was collected for this project. The system is designed to operate entirely on retrieved information — there is no fine-tuning or RAG over a pre-built corpus.

[GAP]: We have not characterized the distribution of sources actually retrieved during memo generation. A systematic analysis of which tools are called most frequently, what types of queries they receive, and whether source quality varies systematically across domains would strengthen the evaluation section.

### 4.2 Evaluation Benchmark

**Eval set file:** `data/eval-set.json`
**Size:** 50 labeled claims
**Generation:** The eval set was generated using a structured prompt to Claude (see `docs/THRESHOLD_CALIBRATION_PLAN.md`) specifying the distribution requirements, then manually reviewed for plausibility and label correctness.

**Distribution:**

- Claim types: 8–9 claims per type (all six types represented)
- Derivation methods: approximately 14 direct_extraction, 15 paraphrase, 10 cross_source, 11 agent_inference
- Verdicts: approximately 25 valid, 15 invalid, 10 needs_revision
- Edge cases: 5–8 "skeptic trap" claims (well-supported claims designed to test whether the skeptic persona over-fires false invalid verdicts)

**Benchmark runner:** `scripts/run-herald-benchmark.ts`

- Loads eval-set.json, calls `evaluateClaim()` for each claim
- Compares result verdict against `ground_truth_verdict`
- Outputs per-claim results and aggregate metrics to `results/benchmark-YYYY-MM-DD.json`
- Supports `--dry-run` (mock verdicts), `--claim-types` filter, configurable output directory

### 4.3 Evaluation Metrics

**Operational accuracy (primary metric):** Whether HERALD made the correct action decision — either passing a valid claim or flagging a problematic one (invalid or needs_revision). This is a two-bucket metric: {valid} vs {invalid, needs_revision}. The distinction between invalid and needs_revision within the flagged bucket is treated as a soft error — revision is triggered either way, so the downstream consequence is the same.

**Strict accuracy:** Exact match between predicted and ground-truth verdict (valid/invalid/needs_revision). Lower than operational accuracy because soft errors count as wrong.

**Hard error rate:** Rate of critical mismatches: a claim labeled valid by HERALD when ground truth is invalid/needs_revision (false negative), or vice versa. This is the metric most directly tied to the risk of a bad claim entering a policy memo. Our target is ≤15%.

**Precision, Recall, F1:** Computed over the binary task: HERALD correctly flags all genuinely problematic claims (positive class = invalid or needs_revision).

### 4.4 Benchmark 01 Results (Baseline Run, 2026-04-19)

**Configuration:** Tier 1 NLI: not running (infrastructure gap). Tiers 2/3: `gpt-4o-mini`. Concurrency: 1 (sequential). Real API calls.

#### Overall Results

| Metric                     | Value                      |
| -------------------------- | -------------------------- |
| Total claims               | 50                         |
| Strict accuracy            | 70.0%                      |
| **Operational accuracy**   | **82.0%**                  |
| Hard error rate            | 18.0% ⚠ (above 15% target) |
| Soft error rate            | 12.0%                      |
| Precision                  | 94.1%                      |
| Recall                     | 66.7%                      |
| F1                         | 78.0%                      |
| Skeptic false-invalid rate | 2.0% ✓                     |

**Primary finding:** Precision is strong (94.1%) — when HERALD flags a claim, it is almost always correct. The failure mode is recall (66.7%): HERALD misses one in three genuinely problematic claims, letting them pass as valid. This is the wrong failure direction for a claim verification system where false negatives (bad claims reaching policy documents) are more costly than false positives.

#### Results by Claim Type

| Type          | Total | Strict Acc | Bucket Acc | Hard Err  | Soft Err | F1       | Assessment           |
| ------------- | ----- | ---------- | ---------- | --------- | -------- | -------- | -------------------- |
| comparative   | 8     | 75.0%      | 100.0%     | 0.0%      | 25.0%    | 1.00     | Excellent            |
| statistical   | 9     | 77.8%      | 88.9%      | 11.1%     | 11.1%    | 88.9%    | Good                 |
| causal        | 9     | 77.8%      | 88.9%      | 11.1%     | 11.1%    | 80.0%    | Good                 |
| predictive    | 8     | 75.0%      | 87.5%      | 12.5%     | 12.5%    | 85.7%    | Acceptable           |
| normative     | 8     | 62.5%      | 75.0%      | 25.0%     | 12.5%    | 66.7%    | Weak                 |
| **synthesis** | 8     | **50.0%**  | **50.0%**  | **50.0%** | 0.0%     | **0.50** | **Critical failure** |

**Synthesis (F1=0.50, 50% hard error rate):** Half of all invalid synthesis claims were passed as valid. Root cause: the judge prompt's soft directive to apply "heightened scrutiny" to agent_inference derivations is insufficient. The judge defers to the agent's reasoning field — treating it as supporting evidence rather than recognizing it as the claim under evaluation.

**Normative (25% hard error rate):** The consensus test criterion is not being applied consistently. The judge passes normative claims sourced from a single institution without flagging the single-institution problem.

#### Results by Derivation Method

| Derivation        | Total | Bucket Acc | Hard Err | F1    | Assessment                 |
| ----------------- | ----- | ---------- | -------- | ----- | -------------------------- |
| direct_extraction | 14    | 100%       | 0.0%     | 1.00  | Perfect                    |
| paraphrase        | 15    | 73.3%      | 26.7%    | 66.7% | Concerning                 |
| cross_source      | 10    | 70.0%      | 30.0%    | 66.7% | Concerning                 |
| agent_inference   | 11    | 81.8%      | 18.2%    | 0.00  | Bucket OK, labeling broken |

Direct extraction claims are perfectly classified — these are trivially verifiable (claim text ≈ source text). The surprising finding is paraphrase: 26.7% hard error rate suggests the judge is not catching meaning drift in paraphrased claims (cases where the agent slightly changed the meaning while restating). agent_inference has F1=0.0 with reasonable bucket accuracy — it correctly flags these claims as needing action but systematically mislabels the verdict type (invalid vs. needs_revision confusion).

#### Tier Distribution

| Tier               | Claims | Percentage |
| ------------------ | ------ | ---------- |
| Tier 1 (NLI)       | 0      | 0%         |
| Tier 2 (LLM Judge) | 32     | 64%        |
| Tier 3 (Debate)    | 18     | 36%        |
| Tier 4 (Human)     | 0      | 0%         |

Tier 1 was silent — a configuration error, not a calibration result. 26 claims (statistical + comparative + causal) should have entered at Tier 1, but the Python NLI backend was not running. All were routed directly to Tier 2 via the fallback path. The 36% Tier 3 escalation rate reflects the fraction of claims where Tier 2 returned confidence in the 0.60–0.85 "uncertain" band, which is within expected range.

[GAP]: We have no NLI baseline. Benchmark 02 must run with the Python backend active to measure (a) what fraction of claims NLI resolves without LLM calls, and (b) whether NLI improves recall on statistical/comparative/causal claims.

### 4.5 Identified Fixes for Benchmark 02

1. **Start NLI backend** before running — exercises Tier 1 for 26/50 claims
2. **Tighten synthesis prompt:** add explicit directive that agent reasoning is the subject of evaluation, not supporting evidence; require the judge to name at least one alternative explanation before returning valid; add a population-overlap criterion
3. **Tighten normative prompt:** add explicit rule that a single NGO, think tank, or non-intergovernmental body does not constitute consensus
4. **Lower Tier 2 exit threshold** from 0.85 to 0.80 to push more borderline cases to Tier 3, improving recall at acceptable precision cost
5. **Skeptic guardrail:** already partially in place; verify it holds after other prompt changes

---

## 5. Models and Technologies

### 5.1 Language Models

**Research Agent — Groq / Llama-3.3-70B-Versatile**
Selected for fast inference (tokens/second significantly higher than hosted API alternatives), cost-effectiveness (free tier: 14,400 requests/day, sufficient for development), and OpenAI-compatible API (tool use works directly with existing agent code). The 70B parameter count provides strong reasoning capability for research planning and memo synthesis.

**HERALD Tier 2/3 Judge — gpt-4o-mini (benchmark); target Claude Sonnet (Anthropic API)**
gpt-4o-mini was used in Benchmark 01 for evaluation. The production design targets Claude Sonnet via the Anthropic API for its structured tool use reliability and strong policy-domain reasoning. The OpenAI-compatible interface allows the same TypeScript code to work with both.

**HERALD Tier 1 — cross-encoder/nli-deberta-v3-large**
DeBERTa-v3-large is a state-of-the-art NLI model (disentangled attention mechanism, fine-tuned on MultiNLI and related benchmarks). It runs locally via HuggingFace Transformers with CUDA support (GPU) or CPU. An ONNX export path is supported for 3-4x CPU speedup without GPU. No API calls required — this is the zero-marginal-cost first tier.

### 5.2 Frameworks and Libraries

**Agent/LLM:**

- Groq SDK (OpenAI-compatible Python/TypeScript client)
- Anthropic SDK (Python, for Tier 2/3 in production)
- HuggingFace Transformers 4.46+ (NLI model loading and inference)
- ONNX Runtime 1.20+ (optional quantized model path)
- PyTorch 2.5+ (Transformers backend)

**Backend:**

- FastAPI 0.115.0 with async support (uvicorn ASGI server)
- SQLAlchemy 2.0 async ORM with asyncpg 0.30.0 driver
- Alembic 1.14 (schema migrations)
- Pydantic v2 (request/response validation, typed models)
- Redis 5.2 (session state, evaluation queues)

**Frontend:**

- Next.js 16.2.3 with App Router, React 19.2.5
- TypeScript (strict mode, no implicit any)
- Tailwind CSS 4.2.2 with custom CSS variables
- Vitest (unit and integration tests)

**Observability:**

- Braintrust (LLM call tracing, span-based logging, NLI inference logging)
- Custom span helpers: every tool call, NLI inference, and LLM judge call is logged with input/output previews, latency, and metadata

**Infrastructure:**

- Docker Compose (PostgreSQL 15, Redis 7)
- uv (Python package management, virtual environments, lockfiles)
- GitHub Actions (CI pipeline template, HERALD benchmark workflow)

### 5.3 Infrastructure and Deployment

The system runs as three processes: Next.js frontend (port 3000), FastAPI backend (port 8000), and Docker-hosted infrastructure (PostgreSQL + Redis). The NLI model is loaded in-process by the FastAPI backend on startup.

The backend includes a lifespan handler that on startup: initializes the PostgreSQL connection pool, initializes Redis, loads the NLI model (DeBERTa), and registers CORS middleware to allow localhost:3000 requests.

WebSocket support (`/api/ws/{session_id}`) enables real-time progress streaming during memo generation — optional, with polling fallback.

[GAP]: No horizontal scaling, load balancing, or container orchestration is currently implemented. The NLI model load (~100MB+ memory footprint, 1-3s startup on CPU) would need to be managed carefully in a multi-instance deployment. No authentication or multi-user session isolation is implemented beyond session-ID-based Redis keys.

### 5.4 Justification for Technical Choices

**Groq over Anthropic for the research agent:** Speed and cost. Llama-3.3-70B on Groq is substantially faster and cheaper than Claude Sonnet for the research loop, which may involve 20-60 tool calls per memo. Claude Sonnet is reserved for the judgment-intensive HERALD tiers.

**Local NLI over LLM-as-judge for Tier 1:** The entire value proposition of HERALD's Tier 1 is zero marginal cost. Using an LLM at Tier 1 would undermine the cost-optimization rationale. DeBERTa-v3-large achieves near-SOTA NLI accuracy on standard benchmarks at ~1-3s latency on CPU.

**Python for the backend:** The NLI model requires Transformers and PyTorch, which are Python-native. FastAPI provides async support and automatic OpenAPI documentation, making it a natural fit alongside the ML stack.

**ONNX as optional path:** ONNX Runtime provides 3-4x speedup over PyTorch on CPU without requiring a GPU. This is important for deployments where GPU is not available (e.g., cost-constrained cloud instances).

**Structured tool calls for judge output:** Using `submit_evaluation` as a tool call function rather than asking the judge to produce JSON in free text dramatically reduces parsing failures and ensures the confidence score is always a float in [0,1].

---

## 6. Responsible AI Considerations

### 6.1 Hallucination Reduction via Claim Provenance

The most significant structural mitigation for hallucination in this system is the **notes log architecture**: the agent is required to record every claim with its source chunk before writing the memo. This design makes it structurally difficult for the agent to generate uncited claims — any claim that appears in the memo must have a corresponding notes log entry with a source URL and exact excerpt. The completeness check (`src/agent/claim-extractor.ts`) enforces this: orphaned claim IDs (in memo but not in notes log) are reported as blocking validation errors.

The derivation method taxonomy further surfaces risk: agent_inference claims (the highest hallucination risk, since they represent reasoning beyond what sources state) are tagged at creation time and receive heightened scrutiny in HERALD.

### 6.2 Structured Evaluation with Specific Criteria

The claim-type-specific evaluation criteria in the HERALD judge prompts are designed to catch the specific distortion patterns most common in each claim type — not just generic factual accuracy. Examples:

- Statistical claims: checking units, time period, and population specificity
- Causal claims: requiring source to establish mechanism, not just correlation
- Normative claims: testing whether "best practice" reflects genuine consensus or a single institution's view
- Synthesis claims: requiring logical validity checks and alternative explanation enumeration

This specificity is intended to catch the subtle distortions (meaning drift in paraphrase, correlation-as-causation, single-institution consensus) that generic evaluation prompts miss.

### 6.3 Confidence-Threshold Escalation

HERALD's escalation design embeds a built-in skepticism: cases where the automated judge is uncertain are not treated as valid by default. Low-confidence verdicts escalate to progressively more rigorous evaluation. Claims that exhaust all automated tiers reach human review rather than defaulting to any automated verdict. This fail-open-to-human design prioritizes recall (catching bad claims) over automation rate.

### 6.4 Source Attribution

Every claim in the generated memo is linked to its source URL, source title, and exact relevant excerpt. Users can inspect this provenance before submitting claims for evaluation. The revision feedback loop includes the source excerpts in the revision prompt so the agent revises with full context.

### 6.5 Known Gaps and Recommendations

**[GAP] Bias and Fairness Analysis:** No systematic analysis of whether HERALD performs differently across policy domains (e.g., health vs. economic claims), geographic regions (e.g., Global South vs. OECD countries), or source types (e.g., peer-reviewed vs. NGO reports). Recommendation: stratify eval set by domain and region, compute per-stratum precision/recall, and report any significant disparities.

**[GAP] LLM Judge Bias:** LLM judges exhibit known biases — positional bias (favoring the first argument), verbosity bias (favoring longer responses), and sycophancy (agreeing with confident-sounding claims). The current judge prompts do not explicitly instruct against these. Recommendation: add explicit anti-sycophancy instructions to the judge system prompt; experiment with randomly shuffling persona argument order in Tier 3 synthesis; compare judge verdicts on the same claim presented with and without the agent's reasoning field.

**[GAP] PII Handling:** Policy memos may be written about topics that involve individual-level data (e.g., health outcomes for specific populations, migration case studies). Currently there is no PII detection, redaction, or anonymization layer. Recommendation: add a PII scanner (e.g., Presidio or a regex-based detector) as a pre-processing step on user-provided source documents before they are passed to the research agent.

**[GAP] Data Anonymization:** User memos and their associated notes logs are stored in PostgreSQL without anonymization. If this system were deployed for sensitive policy work, memo content could contain confidential information. Recommendation: implement field-level encryption for memo content and notes log data, with key management separate from the database.

**[GAP] Source Quality Assessment:** The current system retrieves sources via API but does not assess source quality, authority, or potential bias of the retrieved source. A publication from a partisan think tank is treated identically to a peer-reviewed meta-analysis. Recommendation: add a source quality signal (e.g., domain reputation score, publication type classification) to the notes log, and surface this signal in the HERALD judge prompts.

**[GAP] Agent Prompt Injection:** The research agent receives web search results as tool outputs. Malicious web content could attempt prompt injection (e.g., instructions embedded in a web page that the agent then follows). Recommendation: add a sanitization step that strips HTML, removes common prompt injection patterns, and truncates tool outputs at a safe length before they are appended to the agent's message history.

**[GAP] Transparency to End Users:** There is currently no explanation of HERALD's evaluation methodology surfaced to users of the policy memo system. Users see verdict badges (valid/invalid/needs_revision) and feedback text, but do not understand the tier architecture or confidence thresholds. Recommendation: add an "About HERALD" explainer panel in the UI that describes the evaluation process and its limitations.

---

## 7. Findings and Discussion

### 7.1 Key Insights

**Claim type is a strong predictor of evaluation difficulty.** Comparative claims (bucket accuracy 100%) and statistical claims (88.9%) are well within reach of current automated evaluation. Synthesis claims (50.0% bucket accuracy) represent a qualitatively different challenge — they require logical validity assessment across multiple sources with different populations and time periods, which no automated evaluator reliably handles.

**Derivation method is the clearest risk signal.** Direct extraction claims are perfectly classified. Paraphrase claims have a 26.7% hard error rate — the agent is making subtle meaning changes that the judge misses. This suggests the judge needs an explicit "paraphrase distortion" criterion: compare claim text word-by-word to source excerpt and flag any introduced quantifiers, scope changes, or causal language not present in the source.

**Precision/recall tradeoff is currently skewed wrong.** The system has high precision (94.1%) but low recall (66.7%). For a claim verification system, false negatives (bad claims passing) are more costly than false positives (valid claims flagged). The current threshold calibration (Tier 2 exit at confidence > 0.85) is too permissive — the system is over-confident when it says valid. Lowering the exit threshold to 0.80 should push more borderline cases to Tier 3 debate, improving recall.

**The multi-persona design works for avoiding over-rejection.** The skeptic persona's 2.0% false-invalid rate on skeptic-trap claims (well-supported claims designed to trip the skeptic) validates the persona design and the guardrail we added. This is a small sample (5-8 claims) but encouraging.

**Infrastructure gaps matter at least as much as prompt quality.** The most consequential finding from Benchmark 01 is that Tier 1 was completely silent — not because the NLI model fails, but because the Python backend wasn't running. In a production pipeline, this would be a silent degradation: the system continues to work (claims route to Tier 2), but at higher cost and without the cheap filter. Robust health checks and startup validation are essential.

### 7.2 Unexpected Challenges

**Paraphrase distortion is harder to detect than expected.** We initially hypothesized that paraphrase (low-risk derivation) would be close to direct extraction in performance. The 26.7% hard error rate on paraphrase claims was surprising. The issue appears to be that the judge evaluates "does the claim broadly match the source intent" rather than "did the agent introduce any scope, quantifier, or causal language not in the source." This is a more specific check that requires a different prompt framing.

**Agent reasoning creates evaluation circularity for synthesis claims.** For synthesis claims, the agent provides a `reasoning` field explaining how it combined sources. The judge is reading this reasoning as additional context — but it is actually the claim under evaluation. When the judge sees "the agent reasoned that A + B implies C," it tends to validate C if the reasoning sounds logical, rather than independently assessing whether the source material supports C. This is the root cause of the synthesis F1=0.50 finding.

**Normative consensus is an underspecified criterion.** "Does this reflect genuine consensus?" is a hard question even for human experts. The current criterion gives the judge no operational definition of consensus — how many institutions? What types? Over what time period? Without a concrete test (e.g., "at least two independent authoritative bodies with different funders"), the judge falls back on surface plausibility.

### 7.3 Performance and Scalability Considerations

**Latency:** Tier 1 NLI on CPU takes ~1-3 seconds per claim. Tier 2 LLM judge takes ~5-15 seconds per API call. Tier 3 debate (3 parallel persona calls + synthesis) takes ~20-40 seconds. For a 10-claim evaluation, total wall time without Tier 1 is 1-5 minutes. With Tier 1 resolving ~half of claims, the wall time for easily-classifiable claims drops to seconds.

**Cost (Tier 2/3 at gpt-4o-mini rates, approximate):**

- Tier 2 judge: ~$0.001 per claim
- Tier 3 debate (4 calls): ~$0.004 per claim
- Average cost per claim at 64% Tier 2 / 36% Tier 3 split: ~$0.002

**Scalability bottleneck:** The NLI model is loaded in a single FastAPI process. Under concurrent evaluation requests, the NLI model will serialize — only one inference at a time. For a production system handling multiple simultaneous users, the NLI service would need to be horizontally scaled or moved to a dedicated model-serving layer (e.g., TorchServe, Triton Inference Server).

---

## 8. Conclusion and Future Work

### 8.1 Summary of Contributions

We present HERALD, a four-tier claim evaluation framework designed for AI-generated policy memos. Our contributions are:

1. **A six-type claim taxonomy with type-specific evaluation routing** — not a single evaluator applied uniformly, but a principled taxonomy that routes claims to the appropriate evaluation strategy based on their epistemic structure
2. **A hierarchical escalation architecture** — NLI (zero API cost) → LLM judge (low cost) → multi-persona debate (moderate cost) → human review (reserved for genuinely contested claims), with confidence-threshold exit conditions at each tier
3. **Type-specific judge prompt criteria** — six distinct evaluation criterion sets with claim-type-appropriate red flags and revision guidance, rather than generic factual accuracy prompts
4. **Full claim provenance** — a structured notes log architecture that links every claim to its source excerpts and derivation method, built during research (not reconstructed post-hoc), enabling both HERALD evaluation and user review
5. **A labeled evaluation set and benchmark methodology** — 50 ground-truth labeled claims across all six types and four derivation methods, with a benchmark runner that computes operational accuracy, precision, recall, F1, and per-type breakdowns

### 8.2 Limitations

**Tier 1 NLI not yet benchmarked.** The baseline run has no NLI data. We cannot yet quantify how much the NLI tier reduces LLM API costs, or whether it improves or degrades recall for statistical/comparative/causal claims.

**Recall is below target.** The 66.7% recall rate (18% hard error rate vs. 15% target) means one in three bad claims passes as valid. The system is not yet reliable enough for production use without human review of all claims flagged by the agent as high-risk.

**Synthesis evaluation remains unsolved.** F1=0.50 on synthesis claims is effectively random classification. The fixes identified (explicit anti-deferential directive, alternative explanation requirement, population-overlap criterion) are promising but unvalidated.

**Eval set is synthetic.** The 50-claim evaluation set was generated by an LLM from a specification, not collected from real policy memo writing sessions. The distribution of claim types and error patterns in real usage may differ.

**Single-model judge.** All of Tier 2/3 uses gpt-4o-mini in the benchmark. Model-specific behaviors (verbosity bias, sycophancy patterns) may not generalize to other judges. The production target (Claude Sonnet) has not been evaluated.

### 8.3 Future Work

**Immediate (Benchmark 02):**

- Start NLI backend and measure Tier 1 impact
- Implement prompt fixes for synthesis and normative claims
- Lower Tier 2 exit threshold from 0.85 to 0.80
- Run threshold sweep across the full threshold grid using mocked LLM responses

**Short-term:**

- Characterize paraphrase distortion patterns and add a dedicated distortion detection criterion
- Evaluate with Claude Sonnet at Tier 2/3 to compare against gpt-4o-mini results
- Add ONNX model export and benchmark NLI latency improvement
- Implement source quality signals (domain reputation, publication type) as HERALD context

**Medium-term:**

- Collect real policy memo writing sessions to build an organic eval set (not LLM-generated)
- Stratify evaluation by policy domain and geographic region to detect systematic biases
- Implement the revision loop end-to-end and measure whether HERALD feedback improves revised claim quality
- Add PII detection for user-uploaded source documents

**Long-term:**

- Fine-tune a smaller NLI model on policy-domain claim-source pairs for improved domain-specific accuracy
- Build a feedback dataset from human Tier 4 verdicts to train a reward model that could replace or augment the LLM judge
- Develop confidence calibration: the raw confidence scores from the LLM judge are not well-calibrated (the model reports 0.85 confidence in cases that are wrong 18% of the time). Calibration against labeled data would allow threshold-setting to directly optimize recall at a target precision

---

## References

[To be populated — key areas to cite: LLM-as-a-judge foundational work, DeBERTa and NLI benchmarks, multi-agent debate literature, RAG provenance and citation generation, FEVER and fact-checking datasets, policy AI applications, hallucination evaluation frameworks]
