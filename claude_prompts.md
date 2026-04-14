# Implementation Prompts for Claude Code

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
2. Create package.json: `npm init -y`, set name to "policy-memo-agent"
3. Install Node dev dependencies:
   npm install --save-dev husky lint-staged @commitlint/cli @commitlint/config-conventional eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint-config-next prettier vitest @vitest/coverage-v8 typescript @types/node @types/react @types/react-dom

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
   - Sample NotesLogEntry fixtures (reuse the 6 mock claims from CLAUDE.md — one per claim type)
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

    # uv
    backend/uv.lock
    ```

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

### Prompt 1.1 — Initialize Project and Define Types

```
Read CLAUDE.md thoroughly. This is the architecture bible for this project.

Initialize the project:
- Create a Next.js app with TypeScript and Tailwind CSS in the project root
- Set up a Python backend directory at /backend using FastAPI
- Create the full directory structure as specified in CLAUDE.md under "Project Structure"
- Create .env.example with all environment variables listed in CLAUDE.md

Then define the core type system in src/types/. These types are foundational — everything else builds on them:

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
   - Available tools (define as Anthropic tool schemas):
     a. web_search — uses Anthropic's built-in web search
     b. arxiv_search — searches arXiv API (query: string, max_results: number) → returns paper titles, abstracts, URLs
     c. worldbank_data — queries World Bank Indicators API (indicator: string, country: string, date_range: string) → returns data points
     d. read_uploaded_file — reads content from user-uploaded files (file_path: string) → returns extracted text
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
   - Log all errors to console and Braintrust

For now, implement arxiv_search and worldbank_data as mock tool handlers that return realistic sample data. We'll wire up real APIs in Checkpoint 4.

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

### Prompt 3.1 — Tier 1: NLI Model

```
Read CLAUDE.md, focusing on HERALD Tier 1 and the routing table.

Create src/herald/tier1-nli.ts:

Implement the NLI-based evaluation tier. For the initial implementation, we'll call the Anthropic API to simulate NLI rather than running a local model (we'll swap in a real NLI model later, so keep the interface clean).

1. evaluateWithNLI(claim: NotesLogEntry) → TierOutput
   - For each source in the claim, construct a premise-hypothesis pair:
     - Premise: source.relevant_chunk
     - Hypothesis: claim.claim_text
   - Call Claude with a specialized NLI prompt that instructs it to:
     - Determine if the premise ENTAILS, CONTRADICTS, or is NEUTRAL to the hypothesis
     - Return a confidence score 0-1
     - Explain its reasoning
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

Important: This should NEVER be called for claims where skipNLI is true (predictive, normative, synthesis). The router will handle this, but add a guard check that throws if called with a skipNLI claim type.

Create src/herald/router.ts:
- routeClaim(claim: NotesLogEntry) → determines starting tier based on claim_type
- evaluateClaim(claim: NotesLogEntry) → runs the full HERALD pipeline with proper routing
  - Checks CLAIM_TYPE_CONFIG[claim.claim_type].skipNLI
  - If false: start at Tier 1, escalate if needed
  - If true: skip directly to Tier 2

Write tests that verify:
- Statistical claims with clear entailment pass at Tier 1
- Claims with contradictions fail at Tier 1
- Predictive/normative/synthesis claims are never sent to Tier 1
- Causal claims use the lower 0.85 threshold
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
   - Include: the claim text, all source chunks, the claim's derivation method, and (if available) the Tier 1 result
   - Call Claude Sonnet with temperature 0.2 for consistency
   - Parse the response into: verdict, confidence, reasoning, suggested_revision
   - Decision logic:
     - Confidence > 0.85 → exit with verdict
     - Confidence < 0.85 → verdict: 'uncertain', escalate to Tier 3

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
   - Decision logic:
     - Judge confidence > 0.75 → exit with verdict
     - Judge confidence < 0.75 → verdict: 'uncertain', escalate to Tier 4

3. Wire it into the router in src/herald/router.ts:
   - Update evaluateClaim to chain Tier 1 → Tier 2 → Tier 3 → Tier 4 with proper escalation
   - Each tier only runs if the previous tier returned 'uncertain'
   - Accumulate all tier results into the HeraldResult.tier_details

Write tests verifying:
- All 3 personas are called in parallel
- Judge synthesizes correctly from unanimous agreement
- Judge synthesizes correctly from 2-1 split
- Escalation to Tier 4 happens when judge confidence is low
```

---

## Checkpoint 4: Interactive UI

### Prompt 4.1 — Input Form and Agent Progress UI

```
Read CLAUDE.md. Review the claim taxonomy and all 6 types with their color codes.

Create the frontend UI components. We're using Next.js with Tailwind CSS. The design aesthetic should be editorial/serious — think policy journal, not startup landing page. Use a serif display font (like Playfair Display) for headings, a clean sans-serif (like Source Sans 3) for UI elements, and a serif (like Source Serif 4) for body text. Color palette: dark navy (#1a1a2e), warm gold accent (#e2b04a), warm paper background (#faf9f7).

Create src/ui/components/InputForm.tsx:
- Text input for policy topic
- Textarea for background/framing
- Textarea for known sources (one per line)
- Textarea for template/format instructions
- File upload area for source documents (drag-and-drop)
- "Generate Policy Memo" button that calls the agent API
- Form validation: topic is required, show helpful placeholder text in all fields

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
- Summary bar at top: count of Valid, Needs Revision, and total Evaluated claims
- Each evaluated claim gets a result card showing:
  - Verdict icon: green checkmark for valid, orange exclamation for needs_revision
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

### Prompt 5.1 — Anthropic API Integration

```
Read CLAUDE.md, focusing on the agent architecture and tool use.

Create or update src/agent/research-agent.ts to use the real Anthropic API:

1. Set up the Anthropic client using the SDK:
   - npm install @anthropic-ai/sdk
   - Initialize with ANTHROPIC_API_KEY from env
   - Use model: 'claude-sonnet-4-20250514'

2. Implement the tool use loop properly:
   - Define tool schemas for: web_search (use Anthropic's built-in), arxiv_search, worldbank_data, read_uploaded_file
   - Send initial message with system prompt + user message + tools
   - Check response for tool_use stop_reason
   - For each tool_use block: execute the tool handler, collect results
   - Send tool_result messages back
   - Continue loop until the agent produces a final text response (stop_reason: 'end_turn')
   - Parse final response into MemoOutput

3. Implement real tool handlers for arxiv_search:
   - Use the arXiv API: GET http://export.arxiv.org/api/query?search_query={query}&max_results={n}
   - Parse the Atom XML response
   - Extract: title, authors, abstract, published date, PDF URL
   - Return as structured JSON the agent can consume

4. Implement real tool handler for worldbank_data:
   - Use the World Bank Indicators API: GET http://api.worldbank.org/v2/country/{country}/indicator/{indicator}?date={range}&format=json
   - Parse the JSON response
   - Extract: indicator name, country, year, value
   - Return as structured JSON

5. Implement read_uploaded_file:
   - Accept a file path
   - Use appropriate parser based on file extension (.pdf → pdf-parse, .docx → mammoth, .txt → fs.readFile)
   - Return extracted text content

6. Handle rate limits and errors:
   - Implement exponential backoff for 429 responses
   - Timeout tool calls at 30 seconds
   - Log all API calls with timestamps for observability

Write integration tests that verify the full agent loop works end-to-end with real API calls (mark as integration tests that require API keys).
```

### Prompt 5.2 — Braintrust Observability

```
Read CLAUDE.md, focusing on the observability section.

Set up Braintrust integration for logging and tracing.

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

4. Instrument the existing code:
   - Wrap research-agent.ts runResearchAgent in a top-level Braintrust experiment
   - Log each tool call within the agent loop
   - Log the notes log output
   - Wrap each HERALD tier evaluation
   - Log the full HERALD pipeline per claim

5. Create src/observability/telemetry.ts:
   - Set up OpenTelemetry with a console exporter (for development)
   - Create spans for: agent_research, agent_write, herald_tier_1, herald_tier_2, herald_tier_3, herald_tier_4
   - Track: total latency per phase, token usage, tool call count, claim count

The goal: after running a full memo generation + evaluation, you should be able to see in Braintrust:
- Every tool call the agent made, with query and response
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
   - PostgreSQL 14+ (or Docker setup)
   - Redis (or Docker setup)

2. API Key Setup:
   - Anthropic API key: link to https://console.anthropic.com/, explain how to create one
   - Braintrust API key: link to https://www.braintrust.dev/, explain how to create a project
   - Explain each env var in .env.example with comments

3. Database Setup:
   - Create the PostgreSQL database
   - Run the schema migration (create src/db/schema.sql with tables for: memos, claims, sources, herald_evaluations, tool_call_logs)
   - Seed test data with scripts/seed-test-data.ts

4. Running the Project:
   - npm install in root
   - pip install -r backend/requirements.txt
   - npm run dev — starts both frontend and backend
   - npm run agent:test — runs agent with sample input
   - npm run herald:test — runs HERALD on sample claims

5. Verify Setup:
   - A checklist of curl commands to verify each API is reachable
   - A test script that runs a minimal agent loop and confirms output

Also create a docker-compose.yml for local development with PostgreSQL and Redis containers.
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

Create src/mcp/tool-registry.ts:

1. Tool Registry:
   - Register each tool with: name, handler function, timeout (ms), max_retries, health_check_url
   - Tools: web_search (30s timeout, 3 retries), arxiv_search (30s, 3), worldbank_data (30s, 3), read_uploaded_file (10s, 1)

2. Health Check System:
   - Before the agent starts, run health checks on all registered tools
   - For arxiv: ping http://export.arxiv.org/api/query?search_query=test&max_results=1
   - For World Bank: ping http://api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.CD?format=json&per_page=1
   - For web search: verify Anthropic API is reachable
   - Report tool availability to the agent in its system prompt: "Available tools: web_search (healthy), arxiv_search (healthy), worldbank_data (unavailable — API timeout)"
   - Agent adapts its research plan based on available tools

3. Resilient Tool Execution:
   - executeTool(name, params) async function that:
     - Looks up the tool in the registry
     - Wraps execution in a timeout (AbortController)
     - Retries on failure with exponential backoff (1s, 2s, 4s)
     - On final failure: returns a structured error result that the agent can understand
     - Logs all attempts to Braintrust

4. Graceful Degradation:
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

4. API Endpoints (create in the Next.js API routes or FastAPI backend):
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
   - Download memo as .docx (using the docx npm package — reference the SKILL.md for docx creation)
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
