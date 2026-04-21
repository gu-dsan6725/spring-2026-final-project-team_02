# CLAUDE.md — Policy Memo Writing Agent with HERALD Evaluation Framework

## Project Overview

This project builds an AI-powered Policy Memo Writing Agent with a multi-tiered claim evaluation pipeline called HERALD (Hierarchical Evidence Review and Automated Legitimacy Detection). The system researches policy topics using external tools, generates structured policy memos with full claim-to-source provenance, and allows users to selectively evaluate claims through a 4-tier escalation framework.

---

## Architecture Summary

The system has 4 major phases:

```
[Phase 1: User Input] → [Phase 2: Research & Generation Agent] → [Phase 3: User Review] → [Phase 4: HERALD Evaluation]
                                    ↑                                                              |
                                    └──────────── Revision feedback loop ──────────────────────────┘
```

### Phase 1 — User Input & Prompt Assembly

- User provides: policy topic, background/framing, known sources (URLs/files), optional template
- System assembles a structured system prompt instructing the agent on output format
- Agent is instructed to produce TWO outputs: the policy memo AND a structured notes log

### Phase 2 — Research & Generation Agent

- Agent has access to tools via MCP: arXiv, World Bank API, web search, user-uploaded sources
- Agent loop: Research → Extract Claims → Build Notes Log → Synthesize → Write Memo
- Every tool call is logged via Braintrust for observability
- The agent maintains a running notes log as it researches BEFORE writing the memo

### Phase 3 — User Review Interface

- Memo rendered with inline claim markers (color-coded by claim type)
- Click any claim to view its full provenance in the Notes Log
- User selects claims for HERALD evaluation
- High-risk claims (agent inference, synthesis, causal) are pre-selected by default

### Phase 4 — HERALD Evaluation Pipeline

- 4-tier escalation with early exit on confident verdicts
- Each tier outputs structured feedback usable for agent revision
- Invalid claims are passed back to the agent with constructive revision guidance
- Max 2 revision attempts per claim before flagging for manual intervention

---

## Claim Taxonomy (6 Types)

Every claim in the memo is classified into exactly one of these atomic types. The type determines the HERALD routing path.

### 1. Statistical / Numeric

- **Definition**: A specific number, percentage, rate, or quantitative measure attributed to a source
- **Example**: "Maternal mortality in Chad stands at 1,140 per 100,000 live births."
- **Evaluation focus**: Verification — does the source say this number, with these units, for this time period, for this population?
- **HERALD routing**: Starts at Tier 1 (NLI handles these well)

### 2. Causal

- **Definition**: Asserts that X causes, drives, contributes to, or leads to Y
- **Example**: "Removal of fuel subsidies contributed to a 15% increase in rural transportation costs."
- **Evaluation focus**: Warrant strength — does the source establish a causal mechanism, or merely a correlation?
- **HERALD routing**: Starts at Tier 1, but with LOW confidence threshold for escalation (0.85 instead of 0.9). NLI catches obvious misquotes but misses subtle correlation-as-causation.

### 3. Comparative

- **Definition**: Claims that something is greater, lesser, faster, more effective, or ranked relative to something else
- **Example**: "Cash transfer programs have shown stronger effects on school enrollment than fee waiver programs."
- **Evaluation focus**: Fairness of comparison — same timeframe, population, methodology?
- **HERALD routing**: Starts at Tier 1 (NLI handles these well)

### 4. Predictive / Projective

- **Definition**: Forward-looking claims about what will, is expected to, or is likely to happen
- **Example**: "Urban water demand in the Sahel is projected to exceed supply capacity by 2032."
- **Evaluation focus**: Source authority and conditionality — who made this projection, using what model, under what assumptions?
- **HERALD routing**: SKIPS Tier 1 → starts at Tier 2 (NLI adds no value for predictive claims)

### 5. Normative / Prescriptive

- **Definition**: Claims about what should be done, what best practice is, or what is recommended
- **Example**: "Multi-stakeholder governance frameworks are considered best practice for transboundary water management."
- **Evaluation focus**: Consensus and representativeness — genuine expert consensus, or one school of thought?
- **HERALD routing**: SKIPS Tier 1 → starts at Tier 2 (NLI adds no value for normative claims)

### 6. Synthesis

- **Definition**: A novel inference or generalization drawn by combining multiple sources, where the conclusion is not stated in any single source
- **Example**: "Declining enrollment and rising child labor suggest that education subsidy programs have not reached their most vulnerable target populations."
- **Evaluation focus**: Logical validity — does the conclusion follow from the premises? Are there alternative explanations?
- **HERALD routing**: SKIPS Tier 1 → starts at Tier 2 (by definition no single source entails a synthesis claim)

---

## Derivation Methods (metadata on each claim)

Each claim also carries a derivation method tag indicating how the agent produced it. This correlates with risk level:

| Derivation          | Description                                     | Risk Level |
| ------------------- | ----------------------------------------------- | ---------- |
| `direct_extraction` | Lifted from one source                          | Low        |
| `paraphrase`        | Restated from one source                        | Low        |
| `cross_source`      | Combined from 2+ sources                        | Medium     |
| `agent_inference`   | Agent's own reasoning beyond what sources state | High       |

---

## Notes Log Schema

The notes log is the structured provenance record. It is built DURING research, BEFORE the memo is written. Every claim in the final memo must have a corresponding notes log entry.

```json
{
  "claim_id": "C-003",
  "claim_text": "Cash transfer programs have shown stronger effects on school enrollment than fee waiver programs.",
  "claim_type": "comparative",
  "derivation": "cross_source",
  "sources": [
    {
      "source_id": "S-003",
      "source_title": "Baird et al. (2019) — Conditional Cash Transfers and Education Outcomes",
      "source_url": "https://arxiv.org/abs/example",
      "relevant_chunk": "Our meta-analysis of 12 RCTs across Kenya, Tanzania, and Uganda finds that conditional cash transfer programs increased enrollment by 8.2 percentage points on average."
    },
    {
      "source_id": "S-004",
      "source_title": "UNESCO Global Education Monitoring Report 2023",
      "source_url": "https://www.unesco.org/gem-report/en",
      "relevant_chunk": "Fee waiver programs showed more modest enrollment gains of 3-5 percentage points in comparable East African settings."
    }
  ],
  "reasoning": "Cross-source comparison synthesizing effect sizes from meta-analysis against UNESCO monitoring data."
}
```

---

## HERALD Evaluation Framework

### Tier Routing Table

| Claim Type            | Start Tier        | NLI Escalation Threshold    | Rationale                                              |
| --------------------- | ----------------- | --------------------------- | ------------------------------------------------------ |
| Statistical / Numeric | Tier 1            | 0.9 confidence              | NLI handles entailment well                            |
| Comparative           | Tier 1            | 0.9 confidence              | NLI handles entailment well                            |
| Causal                | Tier 1            | 0.85 confidence (lower bar) | NLI catches misquotes, misses correlation-as-causation |
| Predictive            | Tier 2 (skip NLI) | N/A                         | NLI cannot evaluate predictions                        |
| Normative             | Tier 2 (skip NLI) | N/A                         | NLI cannot evaluate prescriptions                      |
| Synthesis             | Tier 2 (skip NLI) | N/A                         | No single source entails synthesis claims              |

### Tier 1 — NLI Model (Local, Free)

- **Model**: DeBERTa-v3-large fine-tuned on MultiNLI (or similar)
- **Input**: Source chunk(s) as premise, claim text as hypothesis
- **Output**: entailment / neutral / contradiction with confidence scores
- **Decision logic**:
  - Entailment confidence > threshold → VALID, exit
  - Contradiction detected → INVALID, exit with feedback
  - Neutral or below threshold → escalate to Tier 2
- **Implementation**: Run via ONNX Runtime or Hugging Face Transformers locally

### Tier 2 — LLM-as-Judge

- **Model**: Claude Sonnet (via Anthropic API)
- **System prompt**: Domain-specific policy evaluation prompt that instructs the LLM to assess:
  - Accuracy: Does the claim faithfully represent the source?
  - Relevance: Is this claim relevant to the policy argument?
  - Completeness: Does the claim omit important qualifiers from the source?
  - Causal validity (for causal claims): Does the source support the causal mechanism, or only correlation?
  - Comparison fairness (for comparative claims): Are the compared items truly comparable?
  - Projection basis (for predictive claims): Is the projection attributed with proper conditionality?
  - Consensus check (for normative claims): Does this reflect genuine consensus or one viewpoint?
- **Output**: Structured verdict with reasoning, confidence score, and suggested revision if invalid
- **Decision logic**:
  - Confidence > 0.85 → exit with verdict
  - Confidence 0.6-0.85 → escalate to Tier 3
  - Confidence < 0.6 → escalate to Tier 3

### Tier 3 — Multi-Agent Debate

- **3 Personas**:
  - **Domain Expert**: Deep knowledge of the policy area, evaluates substantive accuracy
  - **Methodologist**: Evaluates the quality of evidence, study design, and inferential logic
  - **Skeptic**: Actively challenges the claim, searches for counter-evidence and alternative explanations
- **Process**: Each persona independently evaluates the claim, then a Judge agent synthesizes the three perspectives into a final verdict
- **Output**: Structured verdict with each persona's argument, the judge's synthesis, and suggested revision if invalid
- **Decision logic**:
  - Unanimous agreement → exit with verdict
  - 2-1 split with high judge confidence → exit with verdict
  - No consensus or low confidence → escalate to Tier 4

### Tier 4 — Human Review

- **Input**: The claim, all source chunks, and the full output from Tiers 1-3
- **Interface**: Presents evidence and prior evaluations; human makes final call
- **Output**: Human verdict with optional notes

### HERALD Output Schema

Every HERALD evaluation produces this structure, which is passed back to the agent if revision is needed:

```json
{
  "claim_id": "C-006",
  "tier_reached": 3,
  "verdict": "invalid",
  "confidence": 0.55,
  "feedback": "Multi-agent debate identified a logical gap: the synthesis combines declining enrollment and rising child labor to conclude subsidy programs failed, but neither source establishes that the affected children are the same population receiving subsidies.",
  "suggested_revision": "Consider revising to: 'Declining enrollment and rising child labor rates raise questions about whether education subsidy programs are effectively reaching their most vulnerable target populations.'",
  "tier_details": {
    "tier_1": null,
    "tier_2": {
      "verdict": "uncertain",
      "confidence": 0.58,
      "reasoning": "..."
    },
    "tier_3": {
      "domain_expert": {
        "verdict": "plausible_but_unsupported",
        "reasoning": "..."
      },
      "methodologist": { "verdict": "invalid", "reasoning": "..." },
      "skeptic": { "verdict": "invalid", "reasoning": "..." },
      "judge_synthesis": "..."
    }
  }
}
```

---

## Technology Stack

### Core

- **Frontend**: React (Next.js or Vite), TypeScript, Tailwind CSS
- **Backend**: Python (FastAPI) or Node.js (Express)
- **Agent framework**: Anthropic Claude API with tool use / MCP
- **Database**: PostgreSQL (claims, memos, evaluations) + Redis (session state)

### MCP Tool Servers

- **Web Search**: Anthropic built-in web search tool
- **arXiv**: MCP server wrapping arXiv API (search + PDF retrieval)
- **World Bank**: MCP server wrapping World Bank Indicators API
- **User Sources**: File reader for uploaded PDFs/documents

### HERALD Pipeline

- **Tier 1 (NLI)**: Hugging Face Transformers / ONNX Runtime, DeBERTa-v3-large-mnli
- **Tier 2 (LLM Judge)**: Claude Sonnet via Anthropic API
- **Tier 3 (Multi-Agent Debate)**: 3x Claude Sonnet calls + 1 Judge call
- **Tier 4 (Human)**: Web UI with evidence display

### Observability

- **Braintrust**: Logging/tracing all LLM calls, tool invocations, claim extractions
- **Telemetry**: OpenTelemetry spans for each phase, tool call latency, token usage

---

## Project Structure

```
policy-memo-agent/
├── CLAUDE.md                          # This file
├── README.md
├── package.json
├── .env.example                       # API keys template
├── src/
│   ├── agent/
│   │   ├── prompt-assembler.ts        # Transforms user input → system prompt
│   │   ├── research-agent.ts          # Core agent loop with tool use
│   │   ├── memo-writer.ts             # Memo generation from notes log
│   │   ├── claim-extractor.ts         # Claim classification and notes log builder
│   │   └── loop-controller.ts         # Budget management, retry logic
│   ├── herald/
│   │   ├── router.ts                  # Routes claims to correct starting tier
│   │   ├── tier1-nli.ts               # NLI model evaluation
│   │   ├── tier2-llm-judge.ts         # LLM-as-Judge evaluation
│   │   ├── tier3-debate.ts            # Multi-agent debate
│   │   ├── tier4-human.ts             # Human review queue
│   │   ├── feedback-loop.ts           # Revision pipeline (max 2 retries)
│   │   └── prompts/
│   │       ├── judge-system.ts        # Domain-specific judge prompt
│   │       ├── domain-expert.ts       # Domain expert persona prompt
│   │       ├── methodologist.ts       # Methodologist persona prompt
│   │       ├── skeptic.ts             # Skeptic persona prompt
│   │       └── judge-synthesis.ts     # Debate judge prompt
│   ├── mcp/
│   │   ├── arxiv-server.ts            # arXiv MCP tool server
│   │   ├── worldbank-server.ts        # World Bank API MCP tool server
│   │   ├── file-reader-server.ts      # User-uploaded file reader
│   │   └── tool-registry.ts           # Tool registration and health checks
│   ├── observability/
│   │   ├── braintrust.ts              # Braintrust integration
│   │   ├── telemetry.ts               # OpenTelemetry setup
│   │   └── span-helpers.ts            # Convenience wrappers for tracing
│   ├── db/
│   │   ├── schema.sql                 # PostgreSQL schema
│   │   ├── models.ts                  # TypeScript models / Prisma schema
│   │   └── migrations/
│   ├── ui/
│   │   ├── app/
│   │   │   ├── page.tsx               # Main page / router
│   │   │   ├── layout.tsx
│   │   │   └── globals.css
│   │   ├── components/
│   │   │   ├── InputForm.tsx          # Phase 1: User input
│   │   │   ├── AgentProgress.tsx      # Phase 2: Generation progress
│   │   │   ├── MemoViewer.tsx         # Phase 3: Memo with inline claims
│   │   │   ├── NotesLog.tsx           # Phase 3: Provenance viewer
│   │   │   ├── ClaimSelector.tsx      # Phase 3→4: Select claims for eval
│   │   │   ├── HeraldResults.tsx      # Phase 4: Evaluation results
│   │   │   ├── TierProgress.tsx       # Phase 4: Tier escalation viz
│   │   │   └── HumanReviewQueue.tsx   # Phase 4 Tier 4: Human review UI
│   │   └── hooks/
│   │       ├── useAgent.ts            # Agent lifecycle hook
│   │       ├── useHerald.ts           # HERALD pipeline hook
│   │       └── useWebSocket.ts        # Real-time updates
│   └── types/
│       ├── claims.ts                  # Claim, NotesLogEntry, ClaimType, Derivation
│       ├── herald.ts                  # HeraldResult, TierOutput, Verdict
│       ├── memo.ts                    # Memo, MemoSection
│       └── agent.ts                   # AgentConfig, ToolCall, ResearchPlan
├── tests/
│   ├── agent/
│   ├── herald/
│   └── integration/
└── scripts/
    ├── seed-test-data.ts
    └── run-herald-benchmark.ts
```

### Python Backend Structure (`backend/`)

```
backend/
├── pyproject.toml                     # Project metadata, dependencies, tool config
├── src/
│   └── policy_memo_agent/
│       ├── __init__.py
│       ├── api/
│       │   ├── __init__.py
│       │   ├── app.py                 # FastAPI application factory
│       │   ├── routes/
│       │   │   ├── __init__.py
│       │   │   ├── memos.py           # Memo CRUD endpoints
│       │   │   ├── herald.py          # HERALD evaluation endpoints
│       │   │   └── health.py          # Health check endpoints
│       │   ├── middleware/
│       │   │   ├── __init__.py
│       │   │   └── error_handler.py   # Global error handling
│       │   └── deps.py                # Dependency injection (DB, services)
│       ├── herald/
│       │   ├── __init__.py
│       │   ├── router.py              # Claim routing logic
│       │   ├── tier1_nli.py           # NLI model (DeBERTa/ONNX)
│       │   ├── tier2_judge.py         # LLM-as-Judge
│       │   ├── tier3_debate.py        # Multi-agent debate
│       │   ├── tier4_human.py         # Human review queue
│       │   └── prompts/
│       │       ├── __init__.py
│       │       ├── judge_system.py
│       │       ├── domain_expert.py
│       │       ├── methodologist.py
│       │       ├── skeptic.py
│       │       └── judge_synthesis.py
│       ├── models/
│       │   ├── __init__.py
│       │   ├── claims.py              # Pydantic models mirroring TS types
│       │   ├── herald.py
│       │   ├── memo.py
│       │   └── agent.py
│       ├── services/
│       │   ├── __init__.py
│       │   ├── nli_service.py         # NLI model loading and inference
│       │   └── braintrust_service.py  # Observability wrapper
│       └── db/
│           ├── __init__.py
│           ├── database.py            # SQLAlchemy/asyncpg setup
│           ├── models.py              # ORM models
│           └── repositories/
│               ├── __init__.py
│               ├── memo_repo.py
│               └── claim_repo.py
├── tests/
│   ├── conftest.py                    # Fixtures, test DB, mock services
│   ├── test_herald/
│   │   ├── test_router.py
│   │   ├── test_tier1_nli.py
│   │   ├── test_tier2_judge.py
│   │   ├── test_tier3_debate.py
│   │   └── test_feedback_loop.py
│   ├── test_api/
│   │   ├── test_memos.py
│   │   └── test_herald.py
│   └── test_models/
│       └── test_claims.py
└── alembic/
    ├── alembic.ini
    ├── env.py
    └── versions/
```

---

## Python Backend Infrastructure

### Virtual Environment: uv

We use **uv** as the Python package manager and virtual environment tool. uv is fast, handles lockfiles, and replaces pip, pip-tools, virtualenv, and pyenv in a single binary.

**Why uv over alternatives:**

- **Over venv+pip**: uv is 10-100x faster, has proper lockfile support (`uv.lock`), and handles Python version management
- **Over Poetry**: uv is faster, has better monorepo support, and uses standard `pyproject.toml` without custom sections
- **Over conda**: uv is lighter weight and doesn't conflate Python packages with system packages. We don't need conda's data science environment management.
- **Over pipenv**: uv is significantly faster and more actively maintained

### pyproject.toml

```toml
[project]
name = "policy-memo-agent"
version = "0.1.0"
description = "Policy memo writing agent with HERALD evaluation framework"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.32.0",
    "pydantic>=2.9.0",
    "pydantic-settings>=2.6.0",
    "sqlalchemy>=2.0.36",
    "asyncpg>=0.30.0",
    "alembic>=1.14.0",
    "redis>=5.2.0",
    "httpx>=0.28.0",
    "anthropic>=0.40.0",
    "braintrust>=0.0.160",
    "transformers>=4.46.0",
    "torch>=2.5.0",
    "onnxruntime>=1.20.0",
    "websockets>=14.0",
    "python-multipart>=0.0.12",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.3.0",
    "pytest-asyncio>=0.24.0",
    "pytest-cov>=6.0.0",
    "pytest-xdist>=3.5.0",
    "pytest-timeout>=2.3.0",
    "pytest-mock>=3.14.0",
    "httpx>=0.28.0",
    "ruff>=0.8.0",
    "mypy>=1.13.0",
    "pre-commit>=4.0.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.backends"

[tool.hatch.build.targets.wheel]
packages = ["src/policy_memo_agent"]

# ── Ruff (replaces flake8, isort, black, pyflakes, pycodestyle) ──
[tool.ruff]
target-version = "py311"
line-length = 100
src = ["src", "tests"]

[tool.ruff.lint]
select = [
    "E",     # pycodestyle errors
    "W",     # pycodestyle warnings
    "F",     # pyflakes
    "I",     # isort
    "N",     # pep8-naming
    "UP",    # pyupgrade
    "B",     # flake8-bugbear
    "SIM",   # flake8-simplify
    "T20",   # flake8-print (catches print statements — use logging/braintrust instead)
    "RET",   # flake8-return
    "ARG",   # flake8-unused-arguments
    "PTH",   # flake8-use-pathlib
    "RUF",   # Ruff-specific rules
    "ASYNC", # flake8-async
]
ignore = [
    "E501",  # line length handled by formatter
]

[tool.ruff.lint.per-file-ignores]
"tests/**/*.py" = ["T20", "ARG"]  # allow print and unused args in tests

[tool.ruff.format]
quote-style = "double"
indent-style = "space"
docstring-code-format = true

# ── Mypy ──
[tool.mypy]
python_version = "3.11"
strict = true
warn_return_any = true
warn_unused_configs = true
disallow_untyped_defs = true
disallow_any_explicit = false  # too strict for Pydantic models
plugins = ["pydantic.mypy"]

[[tool.mypy.overrides]]
module = "transformers.*"
ignore_missing_imports = true

[[tool.mypy.overrides]]
module = "onnxruntime.*"
ignore_missing_imports = true

[[tool.mypy.overrides]]
module = "braintrust.*"
ignore_missing_imports = true

# ── Pytest ──
[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
timeout = 30
markers = [
    "integration: tests requiring external API keys (deselect with -m 'not integration')",
    "slow: tests taking > 10 seconds (deselect with -m 'not slow')",
    "tier1: HERALD Tier 1 NLI tests",
    "tier2: HERALD Tier 2 LLM Judge tests",
    "tier3: HERALD Tier 3 Multi-Agent Debate tests",
]
filterwarnings = [
    "ignore::DeprecationWarning:transformers.*",
]

# ── Coverage ──
[tool.coverage.run]
source = ["src/policy_memo_agent"]
omit = ["*/tests/*", "*/migrations/*"]

[tool.coverage.report]
fail_under = 80
show_missing = true
exclude_lines = [
    "pragma: no cover",
    "if TYPE_CHECKING:",
    "if __name__ == .__main__.",
]
```

### Python Commands

```bash
# Environment setup
uv sync                              # Install all dependencies (creates .venv automatically)
uv sync --group dev                  # Install with dev dependencies

# Running
uv run uvicorn policy_memo_agent.api.app:create_app --factory --reload  # Dev server
uv run python -m policy_memo_agent.herald.router  # Run HERALD standalone

# Testing
uv run pytest                        # All tests
uv run pytest tests/test_herald/     # HERALD tests only
uv run pytest -m "not integration"   # Skip integration tests (no API key needed)
uv run pytest -m tier1               # Only Tier 1 NLI tests
uv run pytest --cov --cov-report=html  # Coverage report
uv run pytest -x                     # Stop on first failure
uv run pytest -n auto                # Parallel execution

# Linting & Formatting
uv run ruff check .                  # Lint
uv run ruff check . --fix            # Lint + autofix
uv run ruff format .                 # Format
uv run ruff format . --check         # Check formatting without changing
uv run mypy src/                     # Type check

# Full validation (run before push)
uv run ruff check . && uv run ruff format . --check && uv run mypy src/ && uv run pytest

# Database migrations
uv run alembic upgrade head          # Apply all migrations
uv run alembic revision --autogenerate -m "description"  # Create migration
```

### Python Pre-commit Hooks

The Python side uses the same Husky-based hooks as TypeScript. The `pre-commit` hook in `.husky/pre-commit` should also run Python checks on staged `.py` files. This is configured via lint-staged in `package.json`:

```json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix --max-warnings 0", "prettier --write"],
    "*.py": [
      "bash -c 'cd backend && uv run ruff check --fix'",
      "bash -c 'cd backend && uv run ruff format'"
    ],
    "backend/src/**/*.py": ["bash -c 'cd backend && uv run mypy src/'"],
    "backend/tests/test_herald/**/*.py": [
      "bash -c 'cd backend && uv run pytest tests/test_herald/ -x --timeout=30'"
    ]
  }
}
```

### CI/CD: GitHub Actions

The CI pipeline runs on every push and PR. It has 3 jobs:

1. **lint-and-type-check** — Fast, runs first. Catches formatting, import, and type errors.
2. **test-unit** — Runs all non-integration tests. No API keys needed.
3. **test-integration** — Runs only on `main` branch pushes. Requires API key secrets.

Workflow file: `.github/workflows/ci.yml`

### Research Budget

- Max tool calls per memo: 25 (configurable)
- Max tokens spent on research: 50,000 (configurable)
- Agent creates a research plan BEFORE executing queries
- Plan includes: what to search for, expected claim types, target source count

### MCP Server Reliability

- All tool calls wrapped in try/catch with 3 retries and exponential backoff
- Timeout per tool call: 30 seconds
- If a tool fails after retries, agent logs the gap and continues
- Agent notes "Source unavailable" in the notes log for failed retrievals
- Health check endpoint for each MCP server, checked before agent begins

### Feedback Loop Convergence

- Max 2 revision attempts per invalid claim
- After 2 failed revisions, claim is flagged for human intervention
- Each revision attempt includes the full HERALD feedback as context
- Revision agent prompt includes: original claim, sources, HERALD feedback, and suggested revision

---

## Environment Variables

```
# Anthropic
ANTHROPIC_API_KEY=

# Braintrust
BRAINTRUST_API_KEY=
BRAINTRUST_PROJECT_NAME=policy-memo-agent

# Database
DATABASE_URL=postgresql://...
REDIS_URL=redis://...

# MCP Servers (if self-hosted)
ARXIV_MCP_URL=
WORLDBANK_MCP_URL=

# HERALD Tier 1
HF_MODEL_PATH=microsoft/deberta-v3-large-mnli
# Or ONNX path for faster inference
NLI_ONNX_MODEL_PATH=./models/deberta-v3-large-mnli.onnx

# Optional
LOG_LEVEL=info
MAX_TOOL_CALLS=25
MAX_RESEARCH_TOKENS=50000
MAX_REVISION_ATTEMPTS=2
```

---

## Key Design Decisions

1. **Notes log built during research, not after**: The agent knows which source informed which claim at write-time. Post-hoc scraping loses this provenance.
2. **Claim taxonomy drives HERALD routing**: Each of the 6 claim types has a specific evaluation path. Predictive, normative, and synthesis claims skip Tier 1 entirely.
3. **Derivation method as risk indicator**: Agent inferences get more scrutiny regardless of claim type.
4. **Atomic claims**: Each notes log entry contains exactly one factual assertion. A sentence containing multiple claims is split.
5. **Structured HERALD output**: Every tier produces feedback usable for agent revision, not just pass/fail.
6. **Hybrid completeness check**: After memo generation, a lightweight pass validates that every claim in the prose has a notes log entry.

---

## Commands

```bash
# Development
npm run dev              # Start frontend + backend
npm run agent:test       # Run agent with test input
npm run herald:test      # Run HERALD pipeline on test claims

# Testing
npm run test             # All tests
npm run test:agent       # Agent tests only
npm run test:herald      # HERALD tests only
npm run test:integration # Full pipeline integration tests

# Observability
npm run braintrust:view  # Open Braintrust dashboard
npm run telemetry:view   # View OpenTelemetry traces

# HERALD Benchmark
npx tsx --env-file=.env scripts/run-herald-benchmark.ts --concurrency 1
```

---

## HERALD Benchmark Logging — Required Protocol

**Every time you run the benchmark, you MUST update `docs/benchmark-notes/changelog.md`.**

This is not optional. The changelog is the primary record of what has been tried, what
worked, and what didn't. A teammate is continuing this work and needs the full history.
`docs/benchmark-notes/session-prompt.md` references the changelog as the canonical current
state — no separate update needed there.

### After every benchmark run, add a new entry to `docs/benchmark-notes/changelog.md` with:

1. **Result file** — the exact filename written to `results/` (e.g. `results/benchmark-2026-04-21.json`)
2. **Timestamp** — from the `run_timestamp` field in the JSON
3. **Accuracy** — the `overall.accuracy` value as a percentage
4. **Changes before this run** — every file you modified since the last benchmark run,
   with a 1-sentence description of what changed and why. Be specific: name the prompt
   block, the function, the threshold value.
5. **What the results revealed** — per-claim-type breakdown, tier distribution, which
   claims are still wrong and what pattern they share
6. **Wrong claims table** — list every claim ID that is still wrong, with its type,
   derivation, and a brief diagnosis of why it failed

### The changelog entry format is:

```markdown
### Run N — [brief description]

**Result file:** `results/benchmark-YYYY-MM-DD.N.json`
**Timestamp:** ...
**Accuracy: XX%** (N/50)

#### Changes before this run

- `path/to/file.ts`: what changed and why

#### What the results revealed

...

#### Wrong claims (N wrong)

| Claim  | Type | Derivation | Error |
| ------ | ---- | ---------- | ----- |
| GT-XXX | ...  | ...        | ...   |
```

### Key rules:

- The benchmark uses the **TypeScript** files in `src/herald/`. Changes to
  `backend/src/policy_memo_agent/herald/prompts/` (the Python backend) have **no effect**
  on benchmark results.
- Always diff the new result against the previous one to identify which specific claims
  changed verdict. Use the per_claim_results arrays in both JSON files.
- If accuracy did not change, diagnose _why_ — look at tier distribution shifts and
  confidence score changes even when verdicts are the same.

---

## Development Workflow & Conventions

### Code Style

- TypeScript strict mode everywhere. No `any` types — use the types defined in `src/types/`.
- All async functions must have proper error handling — no unhandled promise rejections.
- Use named exports, not default exports (except React page components required by Next.js).
- Every function that calls an external API (Anthropic, arXiv, World Bank) must be wrapped in try/catch with retry logic.
- Log all errors to both console and Braintrust spans.

### File Naming

- Components: PascalCase (`MemoViewer.tsx`, `HeraldResults.tsx`)
- Utilities/modules: kebab-case (`prompt-assembler.ts`, `loop-controller.ts`)
- Types: kebab-case files, PascalCase exports (`claims.ts` exports `ClaimType`, `NotesLogEntry`)
- Tests: mirror source path (`src/agent/research-agent.ts` → `tests/agent/research-agent.test.ts`)

### Git Workflow

- Commit after each checkpoint (see IMPLEMENTATION_PROMPTS.md)
- Commit messages: `checkpoint-N.M: brief description` (e.g., `checkpoint-2.2: research agent with tool use`)
- Run tests before every commit. Do not commit broken tests.
- Pre-commit hooks enforce quality gates automatically (see below)

### Testing Strategy

- Unit tests for: claim classification, HERALD routing, prompt assembly, budget enforcement
- Integration tests for: full agent loop, full HERALD pipeline, revision feedback loop
- Integration tests are gated behind `ANTHROPIC_API_KEY` — skip if not set
- Use realistic mock data for unit tests (the mock data from the prototype is a good starting point)

### When Working on This Project, Always:

1. Read this CLAUDE.md first. It is the single source of truth for the architecture.
2. Check `src/types/` before creating any new interfaces — the type may already exist.
3. Reference the claim taxonomy when building anything that touches claims. There are exactly 6 types, each with specific HERALD routing. Do not invent new types or change the routing without updating this document.
4. Run the relevant test suite after any change. Use `npm run test:agent` or `npm run test:herald` for targeted runs.
5. When adding a new tool/MCP server, register it in `src/mcp/tool-registry.ts` with timeout, retry count, and health check URL.
6. When modifying HERALD evaluation logic, verify the routing table is still correct: statistical/comparative start Tier 1 (threshold 0.9), causal starts Tier 1 (threshold 0.85), predictive/normative/synthesis skip to Tier 2.

### When Working on This Project, Never:

1. Change the claim taxonomy (6 types) or HERALD routing without updating this CLAUDE.md and all dependent types/tests.
2. Make API calls without error handling and retry logic.
3. Store secrets in code. Use `.env` and the env vars listed above.
4. Skip the notes log. Every claim in the memo MUST have a notes log entry with source provenance.
5. Let the agent loop run unbounded. Always enforce the budget (max_tool_calls, max_research_tokens).
6. Use `console.log` for observability — use the Braintrust span helpers in `src/observability/`.
7. Use `!== undefined` to guard optional fields from LLM JSON responses. LLMs can return `null` for optional fields even when the TypeScript type says `string | undefined`. Always use `!= null` (loose inequality, catches both `null` and `undefined`) when checking optional fields from parsed LLM output. This bug has recurred multiple times in `tier2-llm-judge.ts` on the `suggested_revision` field.

### Plan Before Building

When starting a new checkpoint or feature, use plan mode first. Think through:

- What types/interfaces does this touch?
- What existing modules does it interact with?
- What could break?
- What tests need to exist before this is considered done?

### Review Before Committing

After completing a checkpoint, start a fresh context and review the files that were just created/modified. Check for:

- Type safety (no `any`, no type assertions without justification)
- Error handling coverage
- Test coverage for happy path and failure cases
- Consistency with the claim taxonomy and HERALD routing table

---

## Git Hooks & Quality Gates

### Overview

The project uses **Husky** for Git hooks and **lint-staged** to run checks only on staged files. Every commit must pass: TypeScript compilation, ESLint, Prettier formatting, and unit tests for modified files. This prevents broken code from ever entering the repo.

### Setup (run once after cloning)

```bash
npm install --save-dev husky lint-staged @commitlint/cli @commitlint/config-conventional
npx husky init
```

### Hook Configuration

#### Pre-commit Hook (`.husky/pre-commit`)

Runs on every `git commit`. Blocks the commit if any check fails.

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npx lint-staged
```

#### Commit-msg Hook (`.husky/commit-msg`)

Enforces conventional commit message format. All commits must follow: `checkpoint-N.M: description` or conventional format (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`).

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npx --no -- commitlint --edit ${1}
```

#### Pre-push Hook (`.husky/pre-push`)

Runs the full test suite before allowing a push. More expensive checks that don't need to run on every commit.

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

echo "Running full test suite before push..."
npm run typecheck
npm run test
echo "All checks passed."
```

### lint-staged Configuration (`package.json`)

```json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix --max-warnings 0", "prettier --write"],
    "*.{json,md,yml,yaml}": ["prettier --write"],
    "src/types/**/*.ts": ["bash -c 'npm run typecheck'"],
    "src/herald/**/*.ts": ["bash -c 'npm run test:herald -- --passWithNoTests'"],
    "src/agent/**/*.ts": ["bash -c 'npm run test:agent -- --passWithNoTests'"]
  }
}
```

Key behavior: if you modify any file in `src/herald/`, the HERALD tests run automatically before commit. Same for `src/agent/`. Changes to type definitions trigger a full typecheck. This catches routing table violations and taxonomy mismatches at commit time, not in production.

### Commitlint Configuration (`commitlint.config.js`)

```javascript
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'checkpoint', // checkpoint-2.2: research agent with tool use
        'feat', // feat: add World Bank MCP tool
        'fix', // fix: HERALD routing for causal claims
        'test', // test: add Tier 2 judge prompt tests
        'refactor', // refactor: extract claim classification logic
        'docs', // docs: update CLAUDE.md with new tool
        'chore', // chore: update dependencies
        'ci', // ci: add GitHub Actions workflow
      ],
    ],
    'subject-max-length': [2, 'always', 100],
  },
};
```

### ESLint Configuration (`.eslintrc.json`)

```json
{
  "extends": ["next/core-web-vitals", "plugin:@typescript-eslint/strict-type-checked"],
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "project": "./tsconfig.json"
  },
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/strict-boolean-expressions": "error",
    "no-console": ["warn", { "allow": ["warn", "error"] }],
    "no-unreachable": "error",
    "eqeqeq": ["error", "always"],
    "no-throw-literal": "error"
  },
  "overrides": [
    {
      "files": ["tests/**/*.ts"],
      "rules": {
        "no-console": "off"
      }
    }
  ]
}
```

The `no-console` warning enforces the "use Braintrust span helpers, not console.log" rule from the conventions section. The `no-explicit-any` error enforces the type safety requirement. `strict-boolean-expressions` catches accidental truthiness checks that should be explicit.

### Prettier Configuration (`.prettierrc`)

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always"
}
```

### package.json Scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/ --max-warnings 0",
    "lint:fix": "eslint src/ --fix --max-warnings 0",
    "format": "prettier --write 'src/**/*.{ts,tsx,json,md}'",
    "format:check": "prettier --check 'src/**/*.{ts,tsx,json,md}'",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:agent": "vitest run tests/agent/",
    "test:herald": "vitest run tests/herald/",
    "test:integration": "vitest run tests/integration/",
    "test:coverage": "vitest run --coverage",
    "validate": "npm run typecheck && npm run lint && npm run test",
    "prepare": "husky"
  }
}
```

The `validate` script runs everything — use it before major pushes or PR merges. `prepare` ensures Husky hooks are installed when anyone runs `npm install`.

### What Gets Blocked

| Trigger                       | Check                             | Blocks If                        |
| ----------------------------- | --------------------------------- | -------------------------------- |
| `git commit` (any file)       | ESLint + Prettier on staged files | Lint errors or formatting issues |
| `git commit` (types changed)  | `tsc --noEmit`                    | Type errors anywhere in project  |
| `git commit` (herald changed) | HERALD test suite                 | Any HERALD test fails            |
| `git commit` (agent changed)  | Agent test suite                  | Any agent test fails             |
| `git commit` (message)        | commitlint                        | Message doesn't match format     |
| `git push`                    | Full typecheck + all tests        | Any check fails                  |

### Claude Code Integration

When Claude Code makes changes and tries to commit, these hooks run automatically. If a hook fails, Claude Code will see the error output and should fix the issue before retrying the commit. This is intentional — it catches:

- Type regressions when modifying the claim taxonomy
- HERALD routing bugs when changing evaluation logic
- Missing error handling on new API calls
- Formatting inconsistencies
