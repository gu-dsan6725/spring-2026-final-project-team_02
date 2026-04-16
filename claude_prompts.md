# Implementation Prompts for Claude Code (CORRECTED)

## How to Use This Document

Each section below is a **prompt you paste into Claude Code** at the appropriate stage. They are ordered sequentially — complete each checkpoint before moving to the next. Each prompt references CLAUDE.md so Claude Code has full context on the architecture.

Before starting, make sure:

1. `CLAUDE.md` is in your project root
2. You have your API keys ready (Anthropic, Braintrust)
3. You've decided on your stack (the prompts assume TypeScript + Next.js + FastAPI, but you can tell Claude Code to adjust)

## Prompt Execution Order Summary

| #   | Prompt                              | Creates                                                                          | Depends On    |
| --- | ----------------------------------- | -------------------------------------------------------------------------------- | ------------- |
| 0.1 | Repo init + Python + hooks + CI/CD  | Git, uv, Husky, lint-staged, Ruff, Mypy, pytest, GitHub Actions, Pydantic models | Nothing       |
| 1.1 | TypeScript types + project scaffold | TS type system, Next.js structure                                                | 0.1           |
| 2.1 | Prompt assembler                    | System prompt generation                                                         | 1.1           |
| 2.2 | Research agent + loop               | Agent core with tool use                                                         | 1.1, 2.1      |
| 2.3 | Claim extractor                     | Classification + routing                                                         | 1.1           |
| 3.1 | HERALD Tier 1 + router              | NLI evaluation + routing                                                         | 1.1, 2.3      |
| 3.2 | HERALD Tier 2                       | LLM-as-Judge with type-specific prompts                                          | 1.1, 3.1      |
| 3.3 | HERALD Tier 3                       | Multi-agent debate                                                               | 1.1, 3.1, 3.2 |
| 4.1 | Input + Progress UI                 | Phase 1-2 frontend                                                               | 1.1           |
| 4.2 | Memo + Notes Log UI                 | Phase 3 frontend                                                                 | 1.1, 4.1      |
| 4.3 | Claim Selector + Results UI         | Phase 3-4 frontend                                                               | 1.1, 4.1, 4.2 |
| 5.1 | Real API integration                | Live Anthropic + tool APIs                                                       | 2.2           |
| 5.2 | Braintrust observability            | Logging + tracing                                                                | 5.1           |
| 5.3 | Setup guide + Docker                | Developer onboarding                                                             | All above     |
| 6.1 | Agent loop control                  | Budget, dedup, quality gate                                                      | 2.2, 5.1      |
| 6.2 | MCP reliability                     | Health checks, retries, degradation                                              | 5.1, 6.1      |
| 6.3 | Memory + versioning                 | DB, session state, API endpoints                                                 | 5.1           |
| 7.1 | Revision pipeline                   | Feedback loop with convergence                                                   | 3.1-3.3, 6.3  |
| 7.2 | Human review (Tier 4)               | Queue + UI                                                                       | 7.1           |
| 7.3 | Integration + polish                | E2E test, WebSocket, export, UI polish                                           | All above     |

---

## Tips for Using These Prompts

1. **Start with Checkpoint 0.** It sets up the entire repo foundation — git, Python backend, hooks, CI/CD. Everything else assumes this is done.
2. **Paste one prompt at a time** into Claude Code. Let it complete before moving to the next.
3. **Run tests after each checkpoint** before moving on. Fix failures before proceeding.
4. **Commit after each checkpoint.** The pre-commit hooks will catch issues automatically. If a hook fails, fix the issue — don't bypass it.
5. **The prompts reference CLAUDE.md** — keep it up to date if you make architectural changes.
6. **Checkpoint 5 requires API keys.** Have them ready before starting that section.
7. **Checkpoints 1-3 can be developed without a running frontend.** Use the test scripts.
8. **Checkpoint 4 can be developed with mock data** while the backend catches up.
9. **Python and TypeScript types must stay in sync.** The Pydantic models in `backend/src/policy_memo_agent/models/` must mirror the TypeScript types in `src/types/`. When you change one, change the other.
10. **Use `/setup-hooks` slash command** if hooks get corrupted or need reinstallation.

---

## Checkpoint 0: Repository Initialization, Python Infrastructure & Quality Gates

### Prompt 0.1 — Git Init, Python Backend, Virtual Environment, and All Quality Infrastructure

````
Read CLAUDE.md thoroughly — in particular the "Git Hooks & Quality Gates" section, the "Python Backend Infrastructure" section, and the project structure for both TypeScript and Python.

This prompt sets up the entire repository foundation. Do everything below in order.

## Part 1: Git and Node.js Initialization

1. git init
2. Initialize a Next.js app with TypeScript, Tailwind CSS, and the App Router:
   npx create-next-app@latest . --typescript --tailwind --app --eslint --src-dir --import-alias "@/*" --use-npm
   (If the directory is not empty, move CLAUDE.md aside, run the command, then move it back.)
3. Install additional Node dev dependencies:
   npm install --save-dev husky lint-staged @commitlint/cli @commitlint/config-conventional @typescript-eslint/eslint-plugin @typescript-eslint/parser vitest @vitest/coverage-v8

## Part 2: Python Backend with uv

4. Create the backend/ directory with the full structure specified in CLAUDE.md under "Python Backend Structure":
   - backend/src/policy_memo_agent/ with all subpackages (api, herald, models, services, db)
   - backend/tests/ with conftest.py and test directories
   - backend/alembic/ for migrations
   - All __init__.py files

5. Create backend/pyproject.toml exactly as specified in CLAUDE.md. This is critical — it contains:
   - All project dependencies (FastAPI, uvicorn, pydantic, SQLAlchemy, anthropic, transformers, torch, onnxruntime, braintrust, etc.)
   - Dev dependencies (pytest, pytest-asyncio, pytest-cov, pytest-xdist, pytest-timeout, pytest-mock, ruff, mypy, pre-commit)
   - Ruff configuration: target Python 3.11, line-length 100, select rules E/W/F/I/N/UP/B/SIM/T20/RET/ARG/PTH/RUF/ASYNC, T20 catches print statements (use logging instead)
   - Mypy configuration: strict mode, pydantic plugin
   - Pytest configuration: asyncio_mode auto, timeout 30s, custom markers (integration, slow, tier1, tier2, tier3)
   - Coverage configuration: fail_under 80, source = src/policy_memo_agent

6. Initialize the Python virtual environment with uv:
   cd backend && uv sync --group dev
   This creates .venv/ automatically and installs all dependencies including dev deps.

7. Create backend/.python-version file with: 3.11

8. Create Pydantic models in backend/src/policy_memo_agent/models/ that mirror the TypeScript types:
   - claims.py: ClaimType (StrEnum with 6 values), DerivationMethod (StrEnum with 4 values), Source, NotesLogEntry, ClaimTypeConfig with the HERALD routing table
   - herald.py: Verdict, TierOutput, HeraldResult, DebatePersona, DebateOutput
   - memo.py: MemoInput, MemoOutput
   - agent.py: ResearchPlan, ToolCallLog, AgentConfig
   These Pydantic models are the Python single source of truth. They must match the TypeScript types exactly.

9. Create backend/tests/conftest.py with:
   - Async test client fixture using httpx.AsyncClient + FastAPI TestClient
   - Mock Anthropic client fixture
   - Create one sample NotesLogEntry fixture per claim type (6 total), modeled on the C-003 example in CLAUDE.md. Invent realistic examples for statistical, causal, predictive, normative, and synthesis types alongside the comparative example already in CLAUDE.md.
   - Database test fixtures (use SQLite in-memory for tests)
   - Fixture that marks tests as integration if ANTHROPIC_API_KEY is not set

## Part 3: FastAPI Application Skeleton

10. Create backend/src/policy_memo_agent/api/app.py:
    - FastAPI application factory pattern: def create_app() -> FastAPI
    - Include CORS middleware (allow localhost:3000 for Next.js dev)
    - Include the error handler middleware
    - Mount routes from routes/ directory
    - Lifespan handler that initializes DB connection pool and NLI model on startup

11. Create backend/src/policy_memo_agent/api/routes/health.py:
    - GET /health — returns {"status": "ok", "python": version, "dependencies": {...}}
    - GET /health/nli — checks if NLI model is loaded
    - GET /health/db — checks database connection

12. Create stub route files for memos.py and herald.py with placeholder endpoints that return 501 Not Implemented (we'll fill these in during later checkpoints).

## Part 4: Git Hooks and Linting

13. Initialize Husky: npx husky init

14. Create .husky/pre-commit:
    ```bash
    #!/usr/bin/env sh
    . "$(dirname -- "$0")/_/husky.sh"
    npx lint-staged
    ```

15. Create .husky/commit-msg:
    ```bash
    #!/usr/bin/env sh
    . "$(dirname -- "$0")/_/husky.sh"
    npx --no -- commitlint --edit ${1}
    ```

16. Create .husky/pre-push:
    ```bash
    #!/usr/bin/env sh
    . "$(dirname -- "$0")/_/husky.sh"

    echo "▸ TypeScript checks..."
    npm run typecheck
    npm run test

    echo "▸ Python checks..."
    cd backend
    uv run ruff check .
    uv run ruff format . --check
    uv run mypy src/
    uv run pytest -m "not integration" -x --timeout=30

    echo "All checks passed."
    ```

17. Create lint-staged config in package.json that covers BOTH TypeScript and Python:
    ```json
    {
      "lint-staged": {
        "*.{ts,tsx}": [
          "eslint --fix --max-warnings 0",
          "prettier --write"
        ],
        "*.{json,md,yml,yaml}": [
          "prettier --write"
        ],
        "src/types/**/*.ts": [
          "bash -c 'npm run typecheck'"
        ],
        "src/herald/**/*.ts": [
          "bash -c 'npm run test:herald -- --passWithNoTests'"
        ],
        "src/agent/**/*.ts": [
          "bash -c 'npm run test:agent -- --passWithNoTests'"
        ],
        "backend/**/*.py": [
          "bash -c 'cd backend && uv run ruff check --fix'",
          "bash -c 'cd backend && uv run ruff format'"
        ],
        "backend/src/**/*.py": [
          "bash -c 'cd backend && uv run mypy src/'"
        ],
        "backend/tests/test_herald/**/*.py": [
          "bash -c 'cd backend && uv run pytest tests/test_herald/ -x --timeout=30 --passWithNoTests'"
        ]
      }
    }
    ```

18. Create commitlint.config.js with custom type-enum as specified in CLAUDE.md.

19. Create .eslintrc.json, .prettierrc, .prettierignore as specified in CLAUDE.md.

20. Make all hook files executable: chmod +x .husky/*

## Part 5: CI/CD with GitHub Actions

21. Create .github/workflows/ci.yml:

    ```yaml
    name: CI

    on:
      push:
        branches: [main, develop]
      pull_request:
        branches: [main]

    env:
      NODE_VERSION: '20'
      PYTHON_VERSION: '3.11'

    jobs:
      lint-and-typecheck:
        name: Lint & Type Check
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4

          - name: Setup Node
            uses: actions/setup-node@v4
            with:
              node-version: ${{ env.NODE_VERSION }}
              cache: 'npm'

          - name: Install Node dependencies
            run: npm ci

          - name: TypeScript typecheck
            run: npm run typecheck

          - name: ESLint
            run: npm run lint

          - name: Prettier check
            run: npm run format:check

          - name: Install uv
            uses: astral-sh/setup-uv@v4
            with:
              version: "latest"

          - name: Setup Python
            uses: actions/setup-python@v5
            with:
              python-version: ${{ env.PYTHON_VERSION }}

          - name: Install Python dependencies
            run: cd backend && uv sync --group dev

          - name: Ruff lint
            run: cd backend && uv run ruff check .

          - name: Ruff format check
            run: cd backend && uv run ruff format . --check

          - name: Mypy
            run: cd backend && uv run mypy src/

      test-unit:
        name: Unit Tests
        needs: lint-and-typecheck
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4

          - name: Setup Node
            uses: actions/setup-node@v4
            with:
              node-version: ${{ env.NODE_VERSION }}
              cache: 'npm'

          - name: Install Node dependencies
            run: npm ci

          - name: Run TypeScript tests
            run: npm run test -- --coverage

          - name: Install uv
            uses: astral-sh/setup-uv@v4
            with:
              version: "latest"

          - name: Setup Python
            uses: actions/setup-python@v5
            with:
              python-version: ${{ env.PYTHON_VERSION }}

          - name: Install Python dependencies
            run: cd backend && uv sync --group dev

          - name: Run Python tests (no integration)
            run: cd backend && uv run pytest -m "not integration" --cov --cov-report=xml --timeout=30

          - name: Upload coverage
            uses: codecov/codecov-action@v4
            with:
              files: ./coverage/lcov.info,./backend/coverage.xml
              fail_ci_if_error: false

      test-integration:
        name: Integration Tests
        needs: test-unit
        if: github.ref == 'refs/heads/main'
        runs-on: ubuntu-latest
        environment: integration-tests
        services:
          postgres:
            image: postgres:16
            env:
              POSTGRES_USER: test
              POSTGRES_PASSWORD: test
              POSTGRES_DB: policy_memo_test
            ports:
              - 5432:5432
            options: >-
              --health-cmd pg_isready
              --health-interval 10s
              --health-timeout 5s
              --health-retries 5
          redis:
            image: redis:7
            ports:
              - 6379:6379
            options: >-
              --health-cmd "redis-cli ping"
              --health-interval 10s
              --health-timeout 5s
              --health-retries 5
        steps:
          - uses: actions/checkout@v4

          - name: Setup Node
            uses: actions/setup-node@v4
            with:
              node-version: ${{ env.NODE_VERSION }}
              cache: 'npm'

          - name: Install Node dependencies
            run: npm ci

          - name: Install uv
            uses: astral-sh/setup-uv@v4
            with:
              version: "latest"

          - name: Setup Python
            uses: actions/setup-python@v5
            with:
              python-version: ${{ env.PYTHON_VERSION }}

          - name: Install Python dependencies
            run: cd backend && uv sync --group dev

          - name: Run integration tests
            env:
              ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
              BRAINTRUST_API_KEY: ${{ secrets.BRAINTRUST_API_KEY }}
              DATABASE_URL: postgresql://test:test@localhost:5432/policy_memo_test
              REDIS_URL: redis://localhost:6379
            run: |
              cd backend && uv run alembic upgrade head
              cd backend && uv run pytest -m integration --timeout=60
              npm run test:integration
    ```

22. Create .github/workflows/herald-benchmark.yml — runs weekly on main to track HERALD accuracy over time:

    ```yaml
    name: HERALD Benchmark

    on:
      schedule:
        - cron: '0 6 * * 1'  # Every Monday at 6 AM UTC
      workflow_dispatch:       # Manual trigger

    jobs:
      benchmark:
        runs-on: ubuntu-latest
        environment: integration-tests
        steps:
          - uses: actions/checkout@v4
          - name: Setup Python
            uses: actions/setup-python@v5
            with:
              python-version: '3.11'
          - name: Install uv
            uses: astral-sh/setup-uv@v4
          - name: Install deps
            run: cd backend && uv sync --group dev
          - name: Run HERALD benchmark
            env:
              ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
            run: cd backend && uv run python -m scripts.run_herald_benchmark
    ```

## Part 6: Remaining Configuration Files

23. Create tsconfig.json with strict mode, path aliases (@/ → src/).

24. Create vitest.config.ts with test pattern tests/**/*.test.ts, timeout 30s, coverage thresholds 80%.

25. Add all npm scripts to package.json as specified in CLAUDE.md.

26. Create .gitignore covering both TypeScript and Python:
    ```
    # Node
    node_modules/
    .next/
    dist/
    coverage/
    *.tsbuildinfo

    # Python
    backend/.venv/
    backend/__pycache__/
    backend/**/__pycache__/
    backend/*.egg-info/
    backend/.mypy_cache/
    backend/.ruff_cache/
    backend/.pytest_cache/
    backend/coverage.xml
    backend/htmlcov/
    backend/.coverage

    # Environment
    .env
    .env.local
    .env.*.local

    # IDE
    .vscode/
    .idea/
    *.swp
    *.swo

    # OS
    .DS_Store
    Thumbs.db
    ```

    IMPORTANT: Do NOT include backend/uv.lock in .gitignore. The uv.lock lockfile must be committed to version control for reproducible installs.

27. Create .env.example with all env vars from CLAUDE.md.

## Part 7: Verify Everything Works

28. Run verification:
    - `npm run typecheck` should pass (may need placeholder tsconfig paths)
    - `cd backend && uv run ruff check .` should pass
    - `cd backend && uv run mypy src/` should pass
    - `cd backend && uv run pytest --co` should discover test files (0 tests is fine at this stage)
    - Make a test commit: `git add -A && git commit -m "checkpoint-0.1: repository initialization with full quality infrastructure"`
    - Verify the pre-commit hook runs lint-staged
    - Verify the commit-msg hook accepts the checkpoint format

If anything fails, fix it before moving to Checkpoint 1.
````

---

## Checkpoint 1: TypeScript Type System

### Prompt 1.1 — Define Core TypeScript Types

```
Read CLAUDE.md thoroughly. This is the architecture bible for this project.

Prompt 0.1 has already initialized the repo with Next.js (TypeScript + Tailwind + App Router), the Python backend with uv, Git hooks, and CI/CD. The full directory structure from CLAUDE.md has been created. Do NOT re-initialize the project or recreate the backend directory.

Your task is to define the core type system in src/types/. These types are foundational — everything else builds on them.

In src/types/claims.ts:
- ClaimType enum with exactly 6 values: statistical, causal, comparative, predictive, normative, synthesis
- DerivationMethod enum with 4 values: direct_extraction, paraphrase, cross_source, agent_inference
- ClaimTypeConfig interface mapping each ClaimType to: label, color hex, icon emoji, skipNLI boolean, nliEscalationThreshold (number or null). Use the exact routing table from CLAUDE.md — statistical/comparative threshold 0.9, causal threshold 0.85, predictive/normative/synthesis skip NLI entirely.
- DerivationConfig interface mapping each DerivationMethod to: label, riskLevel (low/medium/high)
- Source interface with: source_id, source_title, source_url, relevant_chunk
- NotesLogEntry interface with: claim_id, claim_text, claim_type (ClaimType), derivation (DerivationMethod), sources (Source[]), reasoning (string)
- Instantiate the CLAIM_TYPE_CONFIG and DERIVATION_CONFIG constants with all values from CLAUDE.md

In src/types/herald.ts:
- Verdict type: 'valid' | 'invalid' | 'needs_revision' | 'uncertain'
- TierOutput interface with: tier_id (1-4), verdict, confidence, reasoning, suggested_revision (optional)
- HeraldResult interface with: claim_id, tier_reached, verdict, confidence, feedback, suggested_revision, tier_details (object with tier_1 through tier_4 each being TierOutput or null)
- DebatePersona type: 'domain_expert' | 'methodologist' | 'skeptic'
- DebateOutput interface with: persona, verdict, reasoning

In src/types/memo.ts:
- MemoInput interface with: topic, background, sources (string), template (string), uploaded_files (File[])
- MemoOutput interface with: memo_markdown (string), notes_log (NotesLogEntry[]), metadata (generation timestamp, token usage, tool calls count)

In src/types/agent.ts:
- ResearchPlan interface with: planned_queries (array of {tool, query, expected_claim_types}), budget (max_tool_calls, max_tokens)
- ToolCallLog interface with: tool_name, query, raw_response, extracted_claims (claim_id[]), latency_ms, timestamp
- AgentConfig interface with: max_tool_calls (default 25), max_research_tokens (default 50000), max_revision_attempts (default 2)

Make sure all types are exported and there's an index.ts barrel file in src/types/.
```

---

## Checkpoint 2: Core Research & Generation Agent

### Prompt 2.1 — Prompt Assembler

```
Read CLAUDE.md, focusing on Phase 1 and Phase 2.

Create src/agent/prompt-assembler.ts:

This module transforms the user's MemoInput into a system prompt for the research agent. The system prompt must instruct the agent to:

1. First create a research plan (what to search for, which tools to query, expected claim types)
2. Execute the research plan using available tools
3. For each piece of evidence found, create a NotesLogEntry with:
   - A unique claim_id (C-001, C-002, ...)
   - Classification into one of the 6 claim types (statistical, causal, comparative, predictive, normative, synthesis)
   - A derivation method tag (direct_extraction, paraphrase, cross_source, agent_inference)
   - The source(s) with source_id, title, URL, and the exact relevant_chunk of text
   - Reasoning explaining how the claim was derived
4. After research is complete, write the policy memo using ONLY claims from the notes log
5. Reference claims inline using [C-XXX] markers
6. If a template was provided, follow its structure
7. Output both the memo AND the notes log as structured JSON

The system prompt should include:
- The user's topic, background, known sources, and template
- The full claim taxonomy definitions (all 6 types with examples) so the agent classifies correctly
- The derivation method definitions so the agent tags correctly
- Explicit instruction that atomic claims = one factual assertion per entry
- Instruction to split sentences with multiple claims
- The notes log JSON schema

Build the assembleSystemPrompt(input: MemoInput) function that returns the complete system prompt string. Also build assembleUserMessage(input: MemoInput) that returns the user message.

Write tests in tests/agent/prompt-assembler.test.ts that verify:
- All 6 claim types are present in the generated system prompt
- The notes log schema is included
- User input fields are properly interpolated
```

### Prompt 2.2 — Research Agent with Tool Use

```
Read CLAUDE.md, focusing on Phase 2, the agent loop, and MCP tool servers.

Create src/agent/research-agent.ts:

This is the core agent that calls the Anthropic API with tool use to research and generate the memo. Implement:

1. A runResearchAgent(input: MemoInput, config: AgentConfig) async function that:
   - Uses the prompt assembler to build the system prompt
   - Calls Claude API (claude-sonnet-4-20250514) with tool use enabled
   - Available tools:
     a. web_search — use Anthropic's server-side tool type (`type: "web_search_20250305"`). This is NOT a custom tool schema — it uses Anthropic's built-in server-side tool format, separate from the custom tool definitions below.
     b. arxiv_search — custom tool definition (query: string, max_results: number) → returns paper titles, abstracts, URLs
     c. worldbank_data — custom tool definition (indicator: string, country: string, date_range: string) → returns data points
     d. read_uploaded_file — custom tool definition (file_path: string) → returns extracted text
   - Implements the agent loop: send message → check for tool_use → execute tool → send tool_result → repeat until done
   - Tracks all tool calls in a ToolCallLog array

2. Budget enforcement via src/agent/loop-controller.ts:
   - Count tool calls, abort if exceeding config.max_tool_calls
   - Track token usage, warn at 80% and abort at 100% of config.max_research_tokens
   - If budget exceeded, instruct agent to synthesize from what it has so far

3. Parse the agent's final response into MemoOutput:
   - Extract memo_markdown
   - Parse notes_log JSON array into NotesLogEntry[]
   - Validate every claim in the memo has a notes log entry (completeness check)
   - Log any orphaned claims (in memo but not in notes log)

4. Error handling:
   - Wrap each tool call in try/catch with 3 retries and exponential backoff (1s, 2s, 4s)
   - 30-second timeout per tool call
   - If tool fails after retries, return a tool_result with error message so agent can adapt
   - Log all errors using the Braintrust span helpers in src/observability/ (NOT console.log — see CLAUDE.md "When Working on This Project, Never" section)

For now, implement arxiv_search, worldbank_data, and read_uploaded_file as mock tool handlers that return realistic sample data. We'll wire up real MCP servers in Checkpoint 5.

Write tests in tests/agent/research-agent.test.ts that verify:
- Agent loop completes and produces both memo and notes log
- Budget enforcement stops the agent when limits are hit
- Tool call failures are handled gracefully
- Completeness check catches orphaned claims
```

### Prompt 2.3 — Claim Extractor and Classifier

```
Read CLAUDE.md, focusing on the Claim Taxonomy section and Notes Log Schema.

Create src/agent/claim-extractor.ts:

This module provides utilities for working with claims. While the agent does most of the classification during generation, we need post-processing utilities:

1. validateNotesLog(log: NotesLogEntry[]) → ValidationResult
   - Checks each entry has a valid claim_type (one of 6)
   - Checks each entry has a valid derivation method (one of 4)
   - Checks sources array is non-empty
   - Checks each source has a non-empty relevant_chunk
   - Returns list of errors and warnings

2. checkMemoCompleteness(memo: string, log: NotesLogEntry[]) → CompletenessReport
   - Extracts all [C-XXX] references from the memo text
   - Cross-references against the notes log
   - Reports: claims in memo but not in log (orphans), claims in log but not in memo (unused)

3. classifyClaim(claimText: string, sources: Source[]) → { type: ClaimType, derivation: DerivationMethod }
   - A fallback classifier using heuristics for post-hoc reclassification:
     - Statistical: contains numbers, percentages, rates, "percent", "$", units of measurement
     - Causal: contains "caused", "contributed to", "led to", "resulted in", "driven by", "due to"
     - Comparative: contains "more than", "less than", "stronger", "weaker", "outperformed", "compared to"
     - Predictive: contains "projected", "forecast", "expected to", "will", "by 2030", "is likely to"
     - Normative: contains "should", "best practice", "recommended", "considered", "ought to"
     - Synthesis: multiple sources AND claim text not closely matching any single source chunk
   - Derivation: direct_extraction if 1 source and >70% token overlap, paraphrase if 1 source and <70%, cross_source if 2+ sources, agent_inference if reasoning contains "infer" or "suggest" or "combination"

4. getHeraldRoutingForClaim(entry: NotesLogEntry) → { startTier: 1 | 2, nliThreshold: number | null }
   - Implements the routing table from CLAUDE.md exactly:
     - statistical → Tier 1, threshold 0.9
     - comparative → Tier 1, threshold 0.9
     - causal → Tier 1, threshold 0.85
     - predictive → Tier 2, threshold null
     - normative → Tier 2, threshold null
     - synthesis → Tier 2, threshold null

Write comprehensive tests covering all 6 claim types for classification and routing.
```

---

## Checkpoint 3: HERALD Evaluation Pipeline (Tiers 1-3)

### Prompt 3.1 — Tier 1: Local NLI Model

```
Read CLAUDE.md, focusing on HERALD Tier 1 and the routing table.

IMPORTANT: CLAUDE.md specifies Tier 1 as "NLI Model (Local, Free)" using "DeBERTa-v3-large fine-tuned on MultiNLI" run via "ONNX Runtime or Hugging Face Transformers locally." Tier 1 MUST be a local model — it is the cheap, fast filter that prevents unnecessary expensive LLM calls in Tiers 2-3. Do NOT use the Anthropic API for Tier 1.

## Part A: Python NLI Service (backend)

Create backend/src/policy_memo_agent/services/nli_service.py:

1. NLIService class that:
   - Loads the DeBERTa-v3-large-mnli model on initialization using Hugging Face Transformers:
     `from transformers import pipeline`
     `self.nli_pipeline = pipeline("text-classification", model="microsoft/deberta-v3-large-mnli", device=-1)`
     (device=-1 for CPU; if GPU is available, use device=0)
   - Alternatively, if the env var NLI_ONNX_MODEL_PATH is set, load via ONNX Runtime for faster CPU inference:
     `import onnxruntime as ort`
     Load the quantized ONNX model and tokenizer
   - Provides a predict(premise: str, hypothesis: str) → NLIResult method that returns:
     - label: "entailment" | "neutral" | "contradiction"
     - scores: dict with confidence for each label
   - Model is loaded ONCE on app startup (via the FastAPI lifespan handler in app.py, already stubbed in Checkpoint 0)
   - Add a health check method: is_loaded() → bool

2. Create backend/src/policy_memo_agent/api/routes/herald.py (replace the 501 stub):
   - POST /api/herald/nli endpoint that:
     - Accepts: { premise: string, hypothesis: string }
     - Calls NLIService.predict()
     - Returns: { label: string, scores: { entailment: float, neutral: float, contradiction: float } }
   - POST /api/herald/nli/batch endpoint that:
     - Accepts: { pairs: [{ premise: string, hypothesis: string }, ...] }
     - Runs all pairs through the NLI model
     - Returns: { results: [{ label, scores }, ...] }

3. Write backend/tests/test_herald/test_tier1_nli.py:
   - Test NLI model loads successfully
   - Test entailment detection: premise="The unemployment rate is 5.2%", hypothesis="Unemployment is at 5.2%" → entailment
   - Test contradiction detection: premise="GDP grew by 3%", hypothesis="GDP shrank by 3%" → contradiction
   - Test neutral detection: premise="The program was implemented in 2020", hypothesis="The program was successful" → neutral
   - Mark these tests with @pytest.mark.tier1 and @pytest.mark.slow (model loading takes time)

## Part B: TypeScript Tier 1 Client

Create src/herald/tier1-nli.ts:

1. evaluateWithNLI(claim: NotesLogEntry) → TierOutput
   - For each source in the claim, construct a premise-hypothesis pair:
     - Premise: source.relevant_chunk
     - Hypothesis: claim.claim_text
   - Call the Python NLI endpoint (POST /api/herald/nli/batch) via HTTP (use fetch or axios)
   - Process the NLI results:
     - Aggregate across multiple sources (if claim has multiple):
       - All entail → entailment
       - Any contradiction → contradiction
       - Mixed → neutral

2. Decision logic (use the thresholds from CLAIM_TYPE_CONFIG):
   - Look up the claim's nliEscalationThreshold from the config
   - If entailment confidence > threshold → verdict: 'valid'
   - If contradiction confidence > 0.7 → verdict: 'invalid', include why
   - Otherwise → verdict: 'uncertain', escalate to Tier 2

3. Return TierOutput with: tier_id: 1, verdict, confidence, reasoning, suggested_revision (if invalid)

4. Guard check: This should NEVER be called for claims where skipNLI is true (predictive, normative, synthesis). The router handles this, but add a guard that throws if called with a skipNLI claim type.

Create src/herald/router.ts:
- routeClaim(claim: NotesLogEntry) → determines starting tier based on claim_type
- evaluateClaim(claim: NotesLogEntry) → runs the full HERALD pipeline with proper routing
  - Checks CLAIM_TYPE_CONFIG[claim.claim_type].skipNLI
  - If false: start at Tier 1, escalate if needed
  - If true: skip directly to Tier 2

Write TypeScript tests that verify:
- Statistical claims with clear entailment pass at Tier 1
- Claims with contradictions fail at Tier 1
- Predictive/normative/synthesis claims are never sent to Tier 1
- Causal claims use the lower 0.85 threshold
- The TypeScript client correctly calls the Python NLI endpoint
```

### Prompt 3.2 — Tier 2: LLM-as-Judge

```
Read CLAUDE.md, focusing on HERALD Tier 2 and the claim-type-specific evaluation criteria.

Create src/herald/tier2-llm-judge.ts:

Implement the LLM-as-Judge evaluation tier with domain-specific prompts.

1. Create src/herald/prompts/judge-system.ts:
   Build a function getJudgePrompt(claimType: ClaimType) that returns a specialized system prompt. Each claim type gets DIFFERENT evaluation criteria:

   For STATISTICAL claims, the prompt emphasizes:
   - Does the source contain this exact number/percentage?
   - Are the units correct?
   - Is the time period correctly stated?
   - Is the population/scope correctly bounded?

   For CAUSAL claims, the prompt emphasizes:
   - Does the source establish a causal mechanism, or only correlation?
   - Does the claim use causal language ("caused", "led to") when the source uses hedged language ("associated with", "correlated")?
   - Is the direction of causality supported?

   For COMPARATIVE claims, the prompt emphasizes:
   - Are the compared items from the same timeframe?
   - Are the populations comparable?
   - Are the methodologies comparable?
   - Does the comparison fairly represent both sides?

   For PREDICTIVE claims, the prompt emphasizes:
   - Who made this projection and what model was used?
   - Are the assumptions/conditions stated?
   - Does the claim narrow uncertainty ranges without disclosure?
   - Is the projection attributed with appropriate hedging?

   For NORMATIVE claims, the prompt emphasizes:
   - Does this reflect genuine expert/institutional consensus?
   - Are there credible dissenting views?
   - Is "best practice" actually contested?
   - Is the scope of the recommendation correctly stated?

   For SYNTHESIS claims, the prompt emphasizes:
   - Does the conclusion logically follow from the premises?
   - Are there alternative explanations the synthesis ignores?
   - Does each source actually support the role assigned to it?
   - Are there logical gaps in the chain of reasoning?

2. evaluateWithLLMJudge(claim: NotesLogEntry, tier1Result?: TierOutput) → TierOutput
   - Build the judge prompt using getJudgePrompt(claim.claim_type)
   - Include in the prompt: the claim text, all source chunks, the claim's derivation method
   - If tier1Result is provided, include it in the prompt so the LLM knows why Tier 1 was inconclusive (e.g., "NLI Tier 1 returned 'neutral' with confidence 0.62 because the premise-hypothesis pair did not clearly entail or contradict. Focus your evaluation on the aspects NLI could not resolve."). This prevents the judge from redundantly re-evaluating aspects Tier 1 already resolved.
   - Call Claude Sonnet with temperature 0.2 for consistency
   - Parse the response into: verdict, confidence, reasoning, suggested_revision
   - Decision logic (matching CLAUDE.md's three bands):
     - Confidence > 0.85 → exit with verdict
     - Confidence 0.6–0.85 → verdict: 'uncertain', escalate to Tier 3
     - Confidence < 0.6 → verdict: 'uncertain', escalate to Tier 3 with high-priority flag

Write tests for each of the 6 claim types verifying the correct judge prompt is selected and the evaluation criteria match what's in CLAUDE.md.
```

### Prompt 3.3 — Tier 3: Multi-Agent Debate

```
Read CLAUDE.md, focusing on HERALD Tier 3.

Create src/herald/tier3-debate.ts:

Implement the multi-agent debate evaluation tier.

1. Create persona prompts in src/herald/prompts/:

   domain-expert.ts — getDomainExpertPrompt(policyTopic: string):
   "You are a senior policy researcher with deep expertise in {policyTopic}. Your role is to evaluate whether this claim is substantively accurate and well-supported by the evidence. You assess the claim from a domain knowledge perspective. You know the literature, the data sources, and the common pitfalls in this field."

   methodologist.ts — getMethodologistPrompt():
   "You are a research methodologist specializing in evidence quality assessment. Your role is to evaluate the quality of evidence supporting this claim. You assess: study design quality, sample sizes, generalizability, inferential validity, and whether the claim's strength is proportional to the evidence. You are especially alert to: cherry-picked statistics, ecological fallacies, survivorship bias, and overgeneralization from limited samples."

   skeptic.ts — getSkepticPrompt():
   "You are a critical policy analyst whose job is to stress-test claims. Your role is to find weaknesses, counter-evidence, and alternative explanations. For every claim, you ask: What would make this wrong? What's the strongest counter-argument? What confounders are being ignored? What context is missing? You are not contrarian for its own sake — you genuinely want to identify claims that won't withstand scrutiny."

   judge-synthesis.ts — getJudgeSynthesisPrompt():
   "You are a senior evaluator synthesizing three expert perspectives on a policy claim. You have received assessments from a Domain Expert, a Methodologist, and a Skeptic. Your job is to weigh their arguments and produce a final verdict. You are looking for: areas of agreement, the strongest objection raised, and whether the claim can be improved rather than rejected outright. Output: a final verdict (valid/invalid/needs_revision), confidence score, synthesized reasoning, and if needed a specific suggested revision."

2. runDebate(claim: NotesLogEntry, previousTierResults: TierOutput[]) → TierOutput
   - Run all 3 persona evaluations in parallel (Promise.all)
   - Each persona receives: the claim, sources, derivation method, and prior tier results
   - Each returns a DebateOutput: { persona, verdict, reasoning }
   - Then run the judge synthesis with all 3 outputs
   - Decision logic (matching CLAUDE.md's consensus-based rules):
     - If all 3 personas agree on the verdict → exit with that verdict (high confidence)
     - If 2 of 3 personas agree AND the judge's confidence in the majority view is > 0.75 → exit with the majority verdict
     - If no majority exists OR judge confidence ≤ 0.75 → verdict: 'uncertain', escalate to Tier 4

3. Wire it into the router in src/herald/router.ts:
   - Update evaluateClaim to chain Tier 1 → Tier 2 → Tier 3 → Tier 4 with proper escalation
   - Each tier only runs if the previous tier returned 'uncertain'
   - Accumulate all tier results into the HeraldResult.tier_details

Write tests verifying:
- All 3 personas are called in parallel
- Judge synthesizes correctly from unanimous agreement (all 3 agree → exit)
- Judge synthesizes correctly from 2-1 split with high confidence (→ exit with majority)
- Judge synthesizes correctly from 2-1 split with low confidence (→ escalate)
- No consensus (3-way split) triggers escalation to Tier 4
- Escalation to Tier 4 happens when judge confidence is low
```

---

## Checkpoint 4: Interactive UI

### Prompt 4.1 — Input Form and Agent Progress UI

```
Read CLAUDE.md. Review the claim taxonomy and all 6 types with their color codes.

Create the frontend UI components. We're using Next.js with Tailwind CSS. The design aesthetic should be editorial/serious — think policy journal, not startup landing page. Use a serif display font (like Playfair Display) for headings, a clean sans-serif (like Source Sans 3) for UI elements, and a serif (like Source Serif 4) for body text. Color palette: dark navy (#1a1a2e), warm gold accent (#e2b04a), warm paper background (#faf9f7).

Create src/ui/components/InputForm.tsx:
- Text input for policy topic (required — show validation error if empty on submit)
- Textarea for background/framing (optional — show "(optional)" label)
- Textarea for known sources, one per line (optional — show "(optional)" label)
- Textarea for template/format instructions (optional — show "(optional)" label)
- File upload area for source documents, drag-and-drop (optional — show "(optional)" label)
- "Generate Policy Memo" button that calls the agent API
- Form validation: topic is required; all other fields are optional. Show helpful placeholder text in all fields.

Create src/ui/components/AgentProgress.tsx:
- Displays while the agent is running
- Shows a live-updating list of agent steps (research plan, tool calls, claim extraction, writing)
- Each step shows: status icon (spinner/checkmark), label, detail text
- Receives updates via WebSocket or polling
- Shows current tool call count / budget and token usage / budget as progress bars

Create src/ui/app/page.tsx:
- State machine managing the phases: input → generating → review → evaluate → herald
- Phase transitions trigger the appropriate component
- Top nav bar with tabs that appear after generation: Memo, Notes Log, Evaluate Claims, HERALD Results

Import Google Fonts in layout.tsx: Playfair Display (400, 700), Source Sans 3 (300, 400, 600, 700), Source Serif 4 (400, 600, 700).
```

### Prompt 4.2 — Memo Viewer with Inline Claim Markers

```
Read CLAUDE.md, focusing on the claim taxonomy colors and the Notes Log schema.

Create src/ui/components/MemoViewer.tsx:

This component renders the policy memo with interactive inline claim markers.

Requirements:
- Parse the memo markdown and render it as formatted HTML
- Detect all [C-XXX] patterns in the text
- For each claim reference, render the following text (until the next claim ref or sentence end) with:
  - A colored bottom border matching the claim type color (from CLAIM_TYPE_CONFIG)
  - A small superscript label showing the claim ID in the claim type's color
  - On hover: show a tooltip with the claim type label and "Click to view sources"
  - On click: call onClaimClick(claimId) which should switch to the Notes Log tab and scroll to that claim
- Render markdown headings (# and ##), bold (**), horizontal rules (---), and numbered lists
- The memo should feel like a real policy document — generous line height (1.8), proper heading hierarchy, horizontal rules between sections

Create src/ui/components/NotesLog.tsx:

This component displays the full notes log with provenance detail for each claim.

Requirements:
- Each claim is a card showing:
  - Claim ID (bold, e.g., "C-001")
  - Claim type badge (colored pill with icon and label from CLAIM_TYPE_CONFIG)
  - Derivation method badge (colored by risk level: green for low, yellow for medium, red for high)
  - The claim text in quotes
  - Sources section: for each source, show:
    - Source ID and title
    - URL (truncated, clickable)
    - The relevant_chunk in a blockquote with a gold left border and italic styling
  - Agent reasoning in smaller gray text
- When a claim is selected (via memo click), highlight its card with:
  - A left border in the claim type's color
  - A warm background tint
  - Auto-scroll to bring it into view
- Clicking a claim card should also highlight the corresponding text in the memo viewer
```

### Prompt 4.3 — Claim Selector and HERALD Results UI

```
Read CLAUDE.md, focusing on HERALD tiers, claim routing, and the HERALD output schema.

Create src/ui/components/ClaimSelector.tsx:

This is the Phase 3→4 bridge where users select which claims to evaluate.

Requirements:
- Show a legend of all 6 claim types with their icons and colors
- List all claims as selectable cards with checkboxes
- Each card shows: claim ID, type badge, derivation badge with risk level, claim text, source count
- For claims where skipNLI is true (predictive, normative, synthesis), show a "→ SKIPS TO TIER 2" indicator
- Pre-select high-risk claims by default: any claim with derivation = agent_inference, or claim_type = causal/synthesis
- Select All / Clear All buttons
- "Run HERALD Evaluation (N claims)" button, disabled if none selected
- Show estimated evaluation time based on: Tier 1 claims × 2s + Tier 2 claims × 5s + buffer

Create src/ui/components/HeraldResults.tsx:

Displays the evaluation results with tier progression visualization.

Requirements:
- Summary bar at top: count of Valid, Invalid, Needs Revision, Uncertain, and total Evaluated claims
- Each evaluated claim gets a result card showing:
  - Verdict icon: green checkmark for valid, red X for invalid, orange exclamation for needs_revision, gray question mark for uncertain
  - Claim ID, type badge, verdict text with confidence percentage
  - Expandable detail section (click to expand):
    - Tier progression visualization: 4 boxes in a row (Tier 1 through 4)
      - Reached tiers: green background (or orange for the final tier if invalid)
      - Skipped tiers: grayed out with strikethrough "Skipped" text
      - Unreached tiers: light gray
      - Animate the progression: tiers light up sequentially with a 500ms delay
    - Evaluation feedback text from the final tier
    - If verdict is needs_revision: show suggested revision in a yellow-bordered box

Create src/ui/components/TierProgress.tsx:
- Reusable component showing the 4-tier progression
- Props: tierReached, claimType (to show which tiers were skipped), verdict, animated (boolean)
- Uses HERALD_TIERS constant with: id, name, description, icon for each tier
```

---

## Checkpoint 5: Wiring Up Real APIs and MCP Tools

### Prompt 5.1 — Anthropic API Integration and MCP Tool Servers

```
Read CLAUDE.md, focusing on the agent architecture, tool use, and MCP Tool Servers section.

The research agent uses Groq (Llama 3.3 70B) instead of the Anthropic API. Groq is already
in the stack — GROQ_API_KEY is in .env. Web search uses the Brave Search API (free tier,
2,000 queries/month) instead of Anthropic's built-in search tool. All external APIs are
wrapped as MCP-compatible tool servers under src/mcp/.

---

## Part A: Install dependencies

npm install groq-sdk
npm install pdf-parse mammoth
npm install --save-dev @types/pdf-parse

Add to .env:
  GROQ_API_KEY=          # already exists from Python backend
  BRAVE_SEARCH_API_KEY=  # free at https://brave.com/search/api/
  GOVINFO_API_KEY=       # free at https://api.govinfo.gov/docs/
  FRED_API_KEY=          # free at https://fred.stlouisfed.org/docs/api/api_key.html

---

## Part B: Implement MCP Tool Servers

Each server exports a single async handler function with this signature:
  (input: Record<string, unknown>) => Promise<Record<string, unknown>>

The handler validates input, calls the external API, parses the response, and returns
structured JSON. All HTTP calls use a shared retry wrapper (3 attempts, exponential backoff,
30s timeout) defined in src/mcp/tool-registry.ts.

---

### src/mcp/arxiv-server.ts

Input: { query: string; max_results?: number }
API:   GET http://export.arxiv.org/api/query?search_query={query}&max_results={n}
Parse: Atom XML — extract entry elements, then for each:
  - title (text)
  - author names (array)
  - summary (abstract text)
  - published date
  - id URL (use as PDF URL, replace /abs/ with /pdf/)
Return: { results: Array<{ title, authors, abstract, published, pdf_url }> }

---

### src/mcp/worldbank-server.ts

Input: { indicator: string; country: string; date_range: string }
  - indicator: World Bank series code, e.g. "NY.GDP.MKTP.CD"
  - country: ISO2 code, e.g. "US" or "all"
  - date_range: e.g. "2018:2023"
API:   GET https://api.worldbank.org/v2/country/{country}/indicator/{indicator}?date={range}&format=json
Parse: Response is array[2] where [1] is the data array. Each entry has:
  - indicator.value (name), country.value, date, value
Return: { indicator, country, observations: Array<{ year, value }> }

---

### src/mcp/govreport-server.ts

Source: HuggingFace Datasets REST API — launch/gov_report dataset
This dataset contains ~19,000 US government reports (GAO, CRS, CDC, OMB).
Use keyword search across the pre-loaded metadata, then fetch the full report text.

Input: { query: string; max_results?: number }
Step 1 — search rows:
  GET https://datasets-server.huggingface.co/search
    ?dataset=launch/gov_report
    &config=default
    &split=train
    &query={query}
    &limit={max_results ?? 5}
Step 2 — for each result, extract:
  - title (from the "title" field if present, else first 80 chars of input)
  - report text (the "input" field — full report text)
  - summary (the "output" field — human-written summary)
Return: { results: Array<{ title, summary, full_text_excerpt (first 2000 chars of input), source_url }> }
source_url should be "https://huggingface.co/datasets/launch/gov_report" for all results.
Handle gracefully if the search endpoint returns no results (return empty array, do not throw).

---

### src/mcp/govinfo-server.ts

Source: US Government Publishing Office — Congressional Research Service, GAO, CBO reports
Requires: GOVINFO_API_KEY

Input: { query: string; collection?: string; max_results?: number }
  - collection: one of "CRS", "GAO", "BILLS", "FR" (Federal Register). Default "CRS".
  - max_results: default 5

Step 1 — search:
  GET https://api.govinfo.gov/search
    ?query={query}
    &pageSize={max_results}
    &offsetMark=*
    &collection={collection}
    &api_key={GOVINFO_API_KEY}
Parse: results[].packageId, title, dateIssued, governmentAuthor

Step 2 — for each packageId, fetch summary:
  GET https://api.govinfo.gov/packages/{packageId}/summary?api_key={GOVINFO_API_KEY}
Parse: title, dateIssued, governmentAuthor, download.txtLink (if present)

Step 3 — if txtLink is present, fetch up to 3000 chars of the text content.

Return: { results: Array<{ packageId, title, date, authors, excerpt, source_url }> }
source_url: https://www.govinfo.gov/content/pkg/{packageId}/html/{packageId}.htm

---

### src/mcp/fred-server.ts

Source: Federal Reserve Economic Data (FRED)
Requires: FRED_API_KEY

Input: { series_id: string; start_date?: string; end_date?: string }
  - series_id: FRED series code, e.g. "UNRATE", "CPIAUCSL", "GDP"
  - start_date / end_date: YYYY-MM-DD format

Step 1 — fetch series metadata:
  GET https://api.stlouisfed.org/fred/series
    ?series_id={series_id}
    &api_key={FRED_API_KEY}
    &file_type=json
Extract: title, units, frequency, notes

Step 2 — fetch observations:
  GET https://api.stlouisfed.org/fred/series/observations
    ?series_id={series_id}
    &api_key={FRED_API_KEY}
    &file_type=json
    &observation_start={start_date ?? "2015-01-01"}
    &observation_end={end_date ?? today}
Extract: observations array of { date, value }

Return: {
  series_id, title, units, frequency,
  observations: Array<{ date, value }>,
  source_url: "https://fred.stlouisfed.org/series/{series_id}"
}

---

### src/mcp/semantic-scholar-server.ts

Source: Semantic Scholar Academic Graph API — no auth needed for basic use
Covers policy-relevant papers in economics, public health, political science not on arXiv.

Input: { query: string; max_results?: number; fields_of_study?: string[] }
API:   GET https://api.semanticscholar.org/graph/v1/paper/search
         ?query={query}
         &limit={max_results ?? 10}
         &fields=title,abstract,year,authors,externalIds,openAccessPdf,citationCount
Optionally filter by fieldsOfStudy if provided.

Return: { results: Array<{
  title, abstract, year,
  authors: string[],
  citation_count,
  pdf_url (from openAccessPdf.url if present, else null),
  source_url: "https://www.semanticscholar.org/paper/{paperId}"
}> }

---

### src/mcp/file-reader-server.ts

Input: { file_path: string }
Route by extension:
  .pdf  → pdf-parse: extract text from buffer
  .docx → mammoth: extractRawText
  .txt / .md → fs.readFile (utf-8)
  other → throw { error: "Unsupported file type: {ext}" }
Return: { file_path, content (full extracted text), char_count }
Error cases: file not found, corrupted file — return { error: string } rather than throwing.

---

### src/mcp/web-search-server.ts

Source: Brave Search API
Requires: BRAVE_SEARCH_API_KEY

Input: { query: string; max_results?: number }
API:   GET https://api.search.brave.com/res/v1/web/search
         ?q={query}
         &count={max_results ?? 10}
Headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_SEARCH_API_KEY }
Parse: web.results array, each with title, url, description
Return: { results: Array<{ title, url, snippet }> }

---

### src/mcp/tool-registry.ts

Define the ToolDefinition interface:
  interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;  // JSON Schema object for the tool's input
    handler: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    timeout_ms: number;
    max_retries: number;
  }

Implement a shared fetchWithRetry utility:
  - Wraps fetch with AbortController (timeout_ms)
  - On failure: wait 2^attempt * 500ms, retry up to max_retries times
  - On final failure: return { error: string } rather than throwing

Register all tools:

  web_search:
    description: "Search the web for recent information, news, and policy documents"
    parameters: { query: string, max_results?: number }
    handler: webSearchHandler
    timeout_ms: 30000, max_retries: 3

  arxiv_search:
    description: "Search arXiv for academic papers. Use for economic research, policy analysis, quantitative studies."
    parameters: { query: string, max_results?: number }
    handler: arxivHandler
    timeout_ms: 30000, max_retries: 3

  worldbank_data:
    description: "Fetch World Bank development indicators by country and year range. Use series codes like NY.GDP.MKTP.CD (GDP), SP.POP.TOTL (population), SH.STA.MMRT (maternal mortality)."
    parameters: { indicator: string, country: string, date_range: string }
    handler: worldbankHandler
    timeout_ms: 30000, max_retries: 3

  govreport_search:
    description: "Search US government reports (GAO, CRS, CDC, OMB) from the GovReport dataset. Best for existing government analyses and official policy positions."
    parameters: { query: string, max_results?: number }
    handler: govreportHandler
    timeout_ms: 30000, max_retries: 3

  govinfo_search:
    description: "Search US Government Publishing Office documents — Congressional Research Service reports, GAO analyses, Federal Register. Use collection CRS for policy briefs, GAO for audits."
    parameters: { query: string, collection?: string, max_results?: number }
    handler: govinfoHandler
    timeout_ms: 30000, max_retries: 3

  fred_data:
    description: "Fetch Federal Reserve economic time series data. Use for macroeconomic statistics: UNRATE (unemployment), CPIAUCSL (inflation), GDP, FEDFUNDS (interest rates)."
    parameters: { series_id: string, start_date?: string, end_date?: string }
    handler: fredHandler
    timeout_ms: 30000, max_retries: 3

  semantic_scholar_search:
    description: "Search Semantic Scholar for academic papers in economics, public health, and political science. Complements arXiv for policy-relevant social science research."
    parameters: { query: string, max_results?: number, fields_of_study?: string[] }
    handler: semanticScholarHandler
    timeout_ms: 30000, max_retries: 3

  read_uploaded_file:
    description: "Read text content from a user-uploaded file (PDF, DOCX, TXT, MD)."
    parameters: { file_path: string }
    handler: fileReaderHandler
    timeout_ms: 10000, max_retries: 1

Export:
  - TOOL_REGISTRY: Record<string, ToolDefinition>
  - getToolDefinitions(): returns array of Groq-compatible tool objects (name, description, parameters as JSON Schema)
  - callTool(name: string, input: Record<string, unknown>): routes to handler with retry

---

## Part C: Research Agent with Groq Tool Use Loop

Update src/agent/research-agent.ts:

### Groq client setup

import Groq from 'groq-sdk';
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = 'llama-3.3-70b-versatile';

### Tool use loop

Groq's function calling follows the same pattern as OpenAI:
- Tools are passed as `tools` array with type "function"
- When the model wants to call a tool, response.choices[0].finish_reason === "tool_calls"
- response.choices[0].message.tool_calls is an array of { id, function: { name, arguments } }
- After calling the tool, append the assistant message AND a tool result message:
    { role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) }
- Continue the loop until finish_reason === "stop"

Implement runResearchAgent(input: MemoInput): Promise<MemoOutput>:

1. Build system prompt via promptAssembler (already exists)
2. Initialise messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }]
3. Get tool definitions from getToolDefinitions()
4. Loop (max input.max_tool_calls ?? 25 iterations):
   a. Call groq.chat.completions.create({ model: MODEL, messages, tools, tool_choice: "auto", response_format: undefined })
   b. If finish_reason === "stop": break — this is the final response
   c. If finish_reason === "tool_calls":
      - For each tool_call in message.tool_calls:
        * Parse arguments: JSON.parse(toolCall.function.arguments)
        * Call callTool(toolCall.function.name, parsedArgs)
        * Log the call to Braintrust span
        * Increment toolCallsUsed counter
      - Append assistant message (with tool_calls) to messages
      - Append one tool result message per tool call to messages
   d. If finish_reason is anything else: break with error
5. Parse the final assistant text response into MemoOutput:
   - The system prompt instructs the agent to output JSON with { memo_sections, notes_log }
   - Use JSON.parse on the content — if it fails, attempt to extract JSON from markdown code block
   - Validate with validateNotesLog and checkMemoCompleteness (already implemented in claim-extractor.ts)
6. Return MemoOutput

### Token budget enforcement

Track approximate token usage (sum of message lengths / 4 as rough estimate).
Stop the loop and return partial output if max_research_tokens is exceeded.
Log a warning to Braintrust when budget is hit.

### Rate limit handling

If groq.chat.completions.create throws with status 429:
  - Wait 60 seconds (Groq free tier resets per minute)
  - Retry once
  - If still 429, throw with a user-facing message

### Braintrust logging

Wrap the entire agent run in a Braintrust trace.
Log each tool call as a child span: { tool_name, input, output, duration_ms }.
Log final output as { memo_section_count, claim_count, tool_calls_used, tokens_estimated }.
Do NOT use console.log — use the span helpers in src/observability/.

---

## Part D: Integration Tests

Write tests/agent/research-agent.test.ts marked @integration (requires GROQ_API_KEY and BRAVE_SEARCH_API_KEY):

1. Tool call routing test — mock the Groq response to return a tool_call for arxiv_search,
   verify the handler is called with correct arguments and result is appended to messages.

2. Full loop test — run the agent on a simple topic ("impact of minimum wage on employment"),
   verify the output has at least 3 notes log entries and a valid memo structure.

3. Budget enforcement test — set max_tool_calls to 2, verify the agent stops after 2 tool calls.

4. Rate limit retry test — mock a 429 response followed by success, verify retry logic fires.

Unit tests (no API key needed):
5. Tool registry test — verify all 8 tools are registered, each has required fields.
6. fetchWithRetry test — mock fetch to fail twice then succeed, verify 3 attempts are made.
```

### Prompt 5.2 — Braintrust Observability (TypeScript + Python)

```
Read CLAUDE.md, focusing on the observability section.

Set up Braintrust integration for logging and tracing across BOTH TypeScript and Python.

## Part A: TypeScript Braintrust Integration

1. Install: npm install braintrust

2. Create src/observability/braintrust.ts:
   - Initialize Braintrust with BRAINTRUST_API_KEY and BRAINTRUST_PROJECT_NAME
   - Create a wrapper function wrapWithBraintrust(name: string, fn: Function) that:
     - Creates a Braintrust span for the function
     - Logs input/output
     - Tracks latency
     - Records any errors
     - Returns the function result

3. Create src/observability/span-helpers.ts with convenience wrappers:
   - logToolCall(toolName, query, response, latencyMs) — logs each MCP/tool call
   - logClaimExtraction(claimId, claimType, derivation, sources) — logs each claim as it's extracted
   - logHeraldEvaluation(claimId, tier, verdict, confidence) — logs each HERALD tier evaluation
   - logAgentLoop(iteration, tokenUsage, toolCallCount) — logs agent loop state

4. Instrument the existing TypeScript code:
   - Wrap research-agent.ts runResearchAgent in a top-level Braintrust experiment
   - Log each tool call within the agent loop
   - Log the notes log output
   - Wrap each HERALD tier evaluation (Tiers 2 and 3, which use the Anthropic API)
   - Log the full HERALD pipeline per claim

## Part B: Python Braintrust Integration

5. Create backend/src/policy_memo_agent/services/braintrust_service.py:
   - Initialize Braintrust with the same API key and project name
   - Create equivalent Python wrappers:
     - log_nli_inference(claim_id, premise, hypothesis, result, latency_ms) — logs every NLI model call
     - log_nli_batch(claim_id, pairs_count, results_summary, total_latency_ms) — logs batch NLI calls
     - log_model_load(model_name, load_time_ms, device) — logs NLI model initialization
   - Instrument the NLI service (nli_service.py) to log every inference call
   - Instrument the /api/herald/nli endpoint to log request/response with latency

## Part C: OpenTelemetry

6. Create src/observability/telemetry.ts:
   - Set up OpenTelemetry with a console exporter (for development)
   - Create spans for: agent_research, agent_write, herald_tier_1, herald_tier_2, herald_tier_3, herald_tier_4
   - Track: total latency per phase, token usage, tool call count, claim count

The goal: after running a full memo generation + evaluation, you should be able to see in Braintrust:
- Every tool call the agent made, with query and response
- Every NLI inference call (from the Python backend), with premise, hypothesis, and result
- Every claim extracted, with type and sources
- Every HERALD evaluation, with tier progression and verdict
```

### Prompt 5.3 — API Keys and Environment Setup Guide

```
Read CLAUDE.md.

Create a comprehensive SETUP.md in the project root that walks a developer through:

1. Prerequisites:
   - Node.js 18+
   - Python 3.11+
   - uv (Python package manager) — install with: curl -LsSf https://astral.sh/uv/install.sh | sh
   - PostgreSQL 14+ (or Docker setup)
   - Redis (or Docker setup)

2. API Key Setup:
   - Anthropic API key: link to https://console.anthropic.com/, explain how to create one
   - Braintrust API key: link to https://www.braintrust.dev/, explain how to create a project
   - Explain each env var in .env.example with comments

3. Installation:
   - Clone the repo
   - npm install (installs Node dependencies + sets up Husky hooks via the prepare script)
   - cd backend && uv sync --group dev (installs Python dependencies into .venv)
   - Copy .env.example to .env and fill in API keys

4. Database Setup:
   - Create the PostgreSQL database
   - Run the schema migration: cd backend && uv run alembic upgrade head
   - Seed test data with: npm run seed (create scripts/seed-test-data.ts)

5. NLI Model Setup:
   - First run will download the DeBERTa-v3-large-mnli model (~1.5GB) from Hugging Face
   - Optional: download the ONNX quantized version for faster CPU inference
   - Verify model loads: curl http://localhost:8000/health/nli

6. Running the Project:
   - npm run dev — starts the Next.js frontend on port 3000
   - cd backend && uv run uvicorn policy_memo_agent.api.app:create_app --factory --reload — starts the FastAPI backend on port 8000
   - Or use docker-compose up for the full stack

7. Verify Setup:
   - A checklist of curl commands to verify each API is reachable
   - A test script that runs a minimal agent loop and confirms output

Also create a docker-compose.yml for local development with PostgreSQL, Redis, and optionally the FastAPI backend containers.
```

---

## Checkpoint 6: Memory, Agent Refinement, and Reliability

### Prompt 6.1 — Agent Loop Control and Research Planning

```
Read CLAUDE.md, focusing on Agent Loop Control and MCP Server Reliability.

Refine src/agent/loop-controller.ts:

1. Research Plan Generation:
   - Before the agent starts researching, it first produces a structured ResearchPlan
   - The plan includes: list of queries to execute, which tool for each query, expected claim types, and priority order
   - Budget allocation: distribute max_tool_calls across planned queries (e.g., 25 calls across 8 planned queries)
   - The agent can deviate from the plan if it discovers relevant leads, but must stay within budget

2. Budget Enforcement:
   - Track: tool_calls_used, tool_calls_remaining, tokens_used, tokens_remaining
   - At 60% budget: log a warning, agent should start prioritizing high-value queries
   - At 80% budget: inject a message to the agent: "You have {N} tool calls remaining. Begin synthesizing from collected evidence."
   - At 100% budget: hard stop, force the agent to write the memo from whatever it has
   - If budget is exhausted with < 3 claims, flag this as a low-evidence memo and warn the user

3. Tool Call Deduplication:
   - Maintain a set of (tool_name, normalized_query) pairs
   - If the agent tries to make a duplicate query, return the cached result instead
   - Normalize queries: lowercase, strip punctuation, sort words

4. Quality Gate:
   - After research and before writing, check:
     - At least 3 unique sources
     - At least 4 claims across at least 2 different claim types
     - If not met, agent does one more targeted search round before writing
   - If quality gate still fails after the extra round, proceed but flag to the user

Write tests for budget enforcement (verify hard stop at limit), deduplication (verify cache hits), and quality gate (verify extra search round triggers).
```

### Prompt 6.2 — MCP Server Reliability and Error Handling

```
Read CLAUDE.md, focusing on MCP Server Reliability.

Update src/mcp/tool-registry.ts (created in Checkpoint 5.1):

1. Health Check System:
   - Before the agent starts, run health checks on all registered tools
   - For arxiv: ping http://export.arxiv.org/api/query?search_query=test&max_results=1
   - For World Bank: ping http://api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.CD?format=json&per_page=1
   - For web search: verify Anthropic API is reachable
   - For NLI: check GET /health/nli on the Python backend
   - Report tool availability to the agent in its system prompt: "Available tools: web_search (healthy), arxiv_search (healthy), worldbank_data (unavailable — API timeout)"
   - Agent adapts its research plan based on available tools

2. Resilient Tool Execution:
   - executeTool(name, params) async function that:
     - Looks up the tool in the registry
     - Wraps execution in a timeout (AbortController)
     - Retries on failure with exponential backoff (1s, 2s, 4s)
     - On final failure: returns a structured error result that the agent can understand
     - Logs all attempts to Braintrust

3. Graceful Degradation:
   - If arXiv is down: agent relies more on web search for academic sources
   - If World Bank is down: agent uses web search for economic data
   - If all external tools fail: agent works only with user-uploaded sources and its own knowledge, with a prominent warning to the user
   - The agent's notes log should mark claims sourced during degraded mode with a flag

Write tests for: health check pass/fail scenarios, retry logic, timeout handling, and graceful degradation paths.
```

### Prompt 6.3 — Session Memory and Memo Versioning

```
Read CLAUDE.md.

Implement persistence so users can resume work across sessions and track memo revisions.

1. Database Schema (update src/db/schema.sql):
   - memos table: id, user_id, topic, background, sources_input, template, memo_markdown, notes_log_json, created_at, updated_at, version
   - claims table: id, memo_id, claim_id (C-001 etc), claim_text, claim_type, derivation, sources_json, reasoning, herald_result_json, revision_count, status (draft/validated/flagged)
   - herald_evaluations table: id, claim_id, tier_reached, verdict, confidence, feedback, suggested_revision, tier_details_json, evaluated_at
   - tool_call_logs table: id, memo_id, tool_name, query, response_summary, latency_ms, success, created_at

2. Memo Versioning:
   - Each time a claim is revised after HERALD evaluation, create a new memo version
   - Store: version number, diff from previous version (which claims changed), timestamp
   - UI shows version history with ability to view/compare versions

3. Session State (using Redis):
   - Store the current agent state during generation (research plan, collected claims so far, tool calls made)
   - If the user's session disconnects during generation, they can resume from where the agent left off
   - Store HERALD evaluation progress (which claims have been evaluated, which are pending)

4. API Endpoints — create these in the FastAPI backend at backend/src/policy_memo_agent/api/routes/memos.py and herald.py (replace the 501 stubs):
   - POST /api/memos — create new memo (triggers agent)
   - GET /api/memos/:id — get memo with notes log
   - GET /api/memos/:id/claims — get all claims for a memo
   - POST /api/memos/:id/evaluate — trigger HERALD on selected claims
   - GET /api/memos/:id/evaluate/:claimId — get HERALD result for a claim
   - GET /api/memos/:id/versions — get version history
   - POST /api/memos/:id/revise — trigger revision of invalid claims

Write tests for: memo creation and retrieval, version creation on claim revision, and HERALD result storage.
```

---

## Checkpoint 7: Feedback Loop Convergence and Revision Pipeline

### Prompt 7.1 — Revision Agent and Feedback Loop

```
Read CLAUDE.md, focusing on Feedback Loop Convergence and HERALD Output Schema.

Create src/herald/feedback-loop.ts:

This is the system that takes invalid HERALD verdicts and sends claims back to the agent for revision.

1. reviseClaimsFromHerald(memo: MemoOutput, heraldResults: HeraldResult[]) → RevisedMemoOutput
   - Filter heraldResults for claims with verdict 'invalid' or 'needs_revision'
   - For each invalid claim, build a revision prompt that includes:
     - The original claim text
     - All source chunks
     - The full HERALD feedback (from whichever tier produced the verdict)
     - The suggested revision (if provided)
     - The claim type and derivation method
     - Explicit instruction: "Revise this claim to address the feedback. You may: rewrite the claim to be more accurate, add qualifiers, narrow the scope, or replace it entirely with a different claim supported by the sources. If the sources genuinely do not support any version of this claim, state that explicitly."
   - Call Claude to produce a revised claim and updated notes log entry
   - Validate the revised claim:
     - Does it still have proper source attribution?
     - Is the claim type still appropriate?
     - Is the derivation method updated if needed?

2. Convergence Control:
   - Track revision_count per claim (stored in DB)
   - Max 2 revision attempts (from AgentConfig.max_revision_attempts)
   - After revision, re-run HERALD on the revised claim
   - If it passes → update the memo with the revised claim
   - If it fails again AND revision_count < max → revise again with additional context: "Previous revision also failed. Here is the feedback from both attempts."
   - If revision_count >= max → flag claim as 'requires_human_intervention', mark in UI with a red badge

3. Memo Rewriting:
   - After all revisions are complete, regenerate the memo sections that contain revised claims
   - Keep unchanged sections intact
   - Create a new memo version with the changes
   - Update the notes log with revised entries

4. Wire into the main flow:
   - After HERALD results come back, if any claims are invalid:
     - Show results to user first
     - User can click "Apply Revisions" to trigger the revision pipeline
     - Show revision progress (which claims are being revised, attempt count)
     - After revisions, show updated HERALD results

Write tests for:
- Single claim revision that passes on retry
- Single claim revision that fails twice and gets flagged for human intervention
- Memo rewriting preserves unchanged sections
- Revision prompt includes full HERALD feedback
```

### Prompt 7.2 — Human Review Queue (Tier 4)

```
Read CLAUDE.md, focusing on HERALD Tier 4.

Create src/herald/tier4-human.ts and src/ui/components/HumanReviewQueue.tsx:

Backend (tier4-human.ts):
1. submitForHumanReview(claim: NotesLogEntry, previousTierResults: TierOutput[]) → creates a review queue entry
2. getHumanReviewQueue(memoId: string) → returns all claims pending human review
3. submitHumanVerdict(claimId: string, verdict: Verdict, notes: string) → saves the human's decision

Frontend (HumanReviewQueue.tsx):
1. Display pending claims in a review queue
2. For each claim, show:
   - The claim text prominently
   - All source chunks with highlighting
   - The full evaluation trail: what each tier said (Tier 1 NLI result, Tier 2 LLM Judge reasoning, Tier 3 debate summary)
   - Why it reached Tier 4 (what was uncertain)
3. Human review controls:
   - Verdict selector: Valid / Invalid / Needs Revision
   - Notes textarea for the human's reasoning
   - If "Needs Revision": textarea for suggested revision
   - Submit button
4. After submission:
   - If valid: claim is marked valid, memo updated
   - If invalid/needs_revision: claim goes through the revision pipeline (Checkpoint 7.1)

Important: The human reviewer should have all the context they need to make a decision without external research. The UI should make it easy to compare the claim against each source chunk side by side.

Write tests for: queue submission, queue retrieval, verdict submission, and integration with the revision pipeline.
```

### Prompt 7.3 — End-to-End Integration and Polish

```
Read CLAUDE.md one final time to verify all components are aligned.

Integration tasks:

1. Full Pipeline Test:
   - Create scripts/run-full-pipeline.ts that:
     - Takes a policy topic as input
     - Runs the complete flow: input → agent research → memo generation → claim extraction → user selects all claims → HERALD evaluation → revision of invalid claims → final memo
     - Outputs: final memo markdown, notes log JSON, HERALD results JSON, revision history
     - Logs everything to Braintrust
   - This is the integration test that proves the whole system works

2. WebSocket Real-Time Updates:
   - Set up WebSocket connection between frontend and backend
   - Stream agent progress events: research_started, tool_call (with details), claim_extracted, memo_writing, memo_complete
   - Stream HERALD progress events: evaluation_started, tier_entered (with claim_id and tier), tier_completed (with verdict), evaluation_complete
   - Frontend components subscribe to these events and update in real-time

3. Error Boundaries:
   - Add React error boundaries around each major component
   - If the agent fails mid-generation: show what was collected so far, offer to retry
   - If HERALD fails on a specific claim: skip it and continue with others, flag the failed one
   - If the API key is invalid/missing: show a clear setup instructions screen

4. Export Options:
   - Download memo as .md file
   - Download memo as .docx using the `docx` npm package (npm install docx) for programmatic .docx generation
   - Download notes log as .json
   - Download HERALD evaluation report as .json
   - Download everything as a .zip bundle

5. Final UI Polish:
   - Loading states for every async operation
   - Empty states for no claims / no results
   - Responsive design that works on tablet+
   - Keyboard navigation: Tab through claims, Enter to expand, Escape to close
   - Toast notifications for: agent complete, evaluation complete, revision complete

Run the full pipeline test with at least 3 different policy topics and verify:
- All 6 claim types appear across the test cases
- HERALD routing is correct (predictive/normative/synthesis skip Tier 1)
- At least one claim gets flagged for revision
- The revision loop converges (doesn't loop infinitely)
- Braintrust shows complete traces for all runs
```

---
