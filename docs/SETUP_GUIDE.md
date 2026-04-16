# HERALD — Full Setup Guide

_Step-by-step: every API key, service, and command to get the project fully operational._

---

## Prerequisites

Before starting, install:

```bash
# Node 20.6+ (required for --env-file flag)
node --version   # must be >= 20.6.0

# npm 10+
npm --version

# Python 3.11+
python3 --version  # must be >= 3.11

# uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh
# or on Windows: powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
uv --version

# git
git --version
```

---

## Step 1 — Clone and Install

```bash
git clone https://github.com/gu-dsan6725/spring-2026-final-project-team_02.git
cd spring-2026-final-project-team_02

# Install Node dependencies (frontend + TypeScript pipeline)
npm install

# Install Python dependencies (NLI backend)
cd backend
uv sync
cd ..
```

---

## Step 2 — API Keys

Copy the environment template:

```bash
cp .env.example .env
```

Open `.env` and fill in the following. Everything in **Required** must be set. Everything in **Optional** unlocks additional features.

---

### Required: Groq

**What it powers:** Research agent (memo generation), HERALD Tier 2 LLM judge, Tier 3 debate personas, revision agent.

**Cost:** Free tier — 14,400 requests/day on `llama-3.3-70b-versatile`. More than enough for development.

1. Go to [https://console.groq.com](https://console.groq.com)
2. Sign up or log in
3. Click **API Keys** in the left sidebar
4. Click **Create API Key**, name it `herald-dev`
5. Copy the key (starts with `gsk_`)

```bash
# In .env:
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

### Required: Gemini

**What it powers:** Web search with grounding (the primary search tool for the research agent). Replaces Brave Search.

**Cost:** Free tier — 1,500 requests/day.

1. Go to [https://aistudio.google.com](https://aistudio.google.com)
2. Sign in with your Google account
3. Click **Get API key** in the top navigation
4. Click **Create API key** → select a Google Cloud project (or create a new one)
5. Copy the key (starts with `AIza`)

```bash
# In .env:
GEMINI_API_KEY=AIzaxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

### Optional: Braintrust (Observability)

**What it powers:** LLM call tracing — see every prompt, response, token count, latency, and evaluation score in a dashboard. The app runs fine without this; spans just go nowhere.

**Cost:** Free hobby tier. No credit card required.

1. Go to [https://braintrust.dev](https://braintrust.dev)
2. Sign up
3. Go to **Settings → API Keys**
4. Click **Create API Key**
5. Copy the key

```bash
# In .env:
BRAINTRUST_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
BRAINTRUST_PROJECT_NAME=policy-memo-agent
```

---

### Optional: GovInfo (US Government / Congressional Reports)

**What it powers:** Searches congressional reports, GAO reports, Federal Register documents via the `govinfo_search` tool.

**Cost:** Free. Requires registration.

1. Go to [https://api.govinfo.gov/docs/](https://api.govinfo.gov/docs/)
2. Click **Sign Up**
3. Verify your email
4. Your API key will be emailed to you

```bash
# In .env:
GOVINFO_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

### Optional: FRED (Federal Reserve Economic Data)

**What it powers:** Real-time economic indicators — GDP, unemployment, inflation, interest rates, etc. via the `fred_data` tool.

**Cost:** Free. No credit card.

1. Go to [https://fred.stlouisfed.org/docs/api/api_key.html](https://fred.stlouisfed.org/docs/api/api_key.html)
2. Click **Request API Key**
3. Create a FRED account or log in
4. Your key appears on the page immediately

```bash
# In .env:
FRED_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

### Optional: Brave Search

**What it powers:** Alternative web search if you prefer Brave over Gemini. The agent uses Gemini by default.

**Cost:** Free tier — 2,000 requests/month.

1. Go to [https://brave.com/search/api/](https://brave.com/search/api/)
2. Click **Get Started for free**
3. Sign up, verify email
4. Go to **API Keys** in your dashboard
5. Copy the key

```bash
# In .env:
BRAVE_SEARCH_API_KEY=BSAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

### Optional: OpenTelemetry (Distributed Tracing)

**What it powers:** Ship traces to Jaeger, Honeycomb, Grafana Tempo, or any OTLP-compatible backend. Leave blank to print traces to stderr during development.

For local Jaeger:

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest

# In .env:
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=policy-memo-agent
```

---

## Step 3 — Verify Keys Work

```bash
# Test Groq
node --env-file=.env -e "
const Groq = require('groq-sdk');
const g = new Groq({ apiKey: process.env.GROQ_API_KEY });
g.chat.completions.create({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'say ok' }], max_tokens: 5 })
  .then(r => console.log('Groq OK:', r.choices[0].message.content))
  .catch(e => console.error('Groq FAIL:', e.message));
"

# Test Gemini (run the dry pipeline — uses Gemini for search)
npm run pipeline:dry
```

---

## Step 4 — Start the Python NLI Backend (Tier 1)

This is optional but strongly recommended. Without it, HERALD skips Tier 1 and every claim goes straight to Groq (Tier 2), which costs more API calls and is slower.

```bash
cd backend

# First run: downloads DeBERTa-v3-large-mnli (~900MB) from HuggingFace
# Subsequent runs: loads from local cache (~5 sec)
uv run uvicorn policy_memo_agent.api.app:create_app \
  --factory \
  --host 0.0.0.0 \
  --port 8000 \
  --reload

# You should see:
# INFO:     Uvicorn running on http://0.0.0.0:8000
# INFO:     NLI model loaded: microsoft/deberta-v3-large-mnli
```

Keep this terminal open. Open a new terminal for the remaining steps.

**Verify it's running:**

```bash
curl http://localhost:8000/health
# {"status":"ok","nli_model_loaded":true}
```

**Test NLI directly:**

```bash
curl -X POST http://localhost:8000/api/herald/nli/batch \
  -H "Content-Type: application/json" \
  -d '{"pairs": [{"premise": "The unemployment rate is 4.2%.", "hypothesis": "Unemployment stands at 4.2%."}]}'
# {"results":[{"label":"entailment","entailment":0.97,"neutral":0.02,"contradiction":0.01}]}
```

---

## Step 5 — Database (Optional, for Persistence)

Without this, the human review queue resets when the server restarts. Set up PostgreSQL to persist it.

### With Docker (easiest):

```bash
docker run -d \
  --name herald-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=policy_memo \
  -p 5432:5432 \
  postgres:16

docker run -d \
  --name herald-redis \
  -p 6379:6379 \
  redis:7-alpine

# In .env:
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/policy_memo
# REDIS_URL=redis://localhost:6379
```

### Run migrations:

```bash
cd backend
uv run alembic upgrade head
# Applied: create_memos_table, create_claims_table, create_review_queue_table
```

---

## Step 6 — Run the Test Suite

Confirm everything is working before using the app.

```bash
# TypeScript tests (320 tests, no API keys needed — all mocked)
npm run test

# Expected output:
# Test Files  10 passed (10)
#      Tests  320 passed (320)

# TypeScript typecheck
npm run typecheck
# (no output = success)

# TypeScript lint
npm run lint
# (no output = success)

# Python tests (requires backend uv sync to have been run)
cd backend
uv run pytest -m "not integration" -v
# Expected: all green

# Back to root for full validation
cd ..
npm run validate
```

---

## Step 7 — Run the Pipeline (CLI mode)

Test the full pipeline end-to-end from the command line before starting the UI.

```bash
# Dry run (uses mock/seed data, no live API calls)
npm run pipeline:dry

# Live run (real Groq + Gemini calls, ~2–3 minutes)
npm run pipeline

# With a custom topic
node --env-file=.env --import tsx scripts/run-full-pipeline.ts \
  --topic "Universal basic income effects on labor markets" \
  --output ./my-run

# Output files written to pipeline-output/ (or ./my-run/):
# ├── memo.md               — the full policy memo in Markdown
# ├── notes-log.json        — all claims with source provenance
# ├── HERALD-report.json    — full evaluation results for each claim
# └── pipeline-summary.txt  — human-readable summary of what happened
```

---

## Step 8 — Start the Frontend

```bash
# From the project root (not backend/)
npm run dev

# Expected output:
# ▲ Next.js 16.x.x
# - Local: http://localhost:3000
# - Ready in 2.3s
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Step 9 — Use the App (Full Walkthrough)

### Phase 1 — Input

1. Enter a policy topic (e.g., _"Impact of universal school meal programs on student outcomes"_)
2. Optionally add background context or known source URLs
3. Click **Generate Memo**

### Phase 2 — Research & Generation

- Watch the agent progress panel (real-time if WebSocket backend is running)
- The agent runs ~15–25 tool calls: web search, arXiv, World Bank, FRED, etc.
- Takes 2–5 minutes depending on topic complexity

### Phase 3 — Review

- The generated memo appears with **colored inline claim markers**
  - Blue = Statistical, Orange = Causal, Green = Comparative
  - Purple = Predictive, Red = Normative, Teal = Synthesis
- Click any marker to see the full source provenance in the Notes Log
- High-risk claims (agent_inference, synthesis, causal) are pre-selected for HERALD evaluation

### Phase 4 — HERALD Evaluation

1. Adjust which claims to evaluate in the **Claim Selector**
2. Click **Run HERALD Evaluation**
3. Watch tier progress badges update per claim (T1 → T2 → T3 as needed)
4. Claims flagged `invalid` or `needs_revision` go through automatic revision
5. Claims that can't be resolved automatically appear in the **Human Review Queue**
6. Submit verdicts for queued claims via the review form

### Export

Click **Export** in the top toolbar to download:

- `memo.md` — Markdown
- `memo.docx` — Word document
- `notes-log.json` — claim provenance
- `HERALD-report.json` — full evaluation trail
- `herald-bundle.zip` — all of the above

---

## Step 10 — Full Verification Checklist

Run this after initial setup to confirm every layer works:

```bash
# 1. TypeScript checks
npm run validate
# Expected: typecheck OK, lint OK, 320/320 tests

# 2. Python checks
cd backend
uv run ruff check .          # lint
uv run mypy src/             # type check
uv run pytest -m "not integration" -v  # tests
cd ..

# 3. NLI backend health
curl http://localhost:8000/health

# 4. Dry pipeline run
npm run pipeline:dry

# 5. Live pipeline run
npm run pipeline

# 6. Frontend
npm run dev
# → open localhost:3000, submit a topic, confirm memo generates
```

---

## Environment Variable Reference (Complete)

```bash
# ── Required ──────────────────────────────────────────────────────────────────
GROQ_API_KEY=gsk_...                   # Groq — agent + HERALD tiers 2 & 3
GEMINI_API_KEY=AIza...                 # Gemini — web search grounding

# ── Optional: Observability ───────────────────────────────────────────────────
BRAINTRUST_API_KEY=sk-...              # LLM tracing dashboard
BRAINTRUST_PROJECT_NAME=policy-memo-agent
OTEL_EXPORTER_OTLP_ENDPOINT=          # e.g. http://localhost:4318
OTEL_SERVICE_NAME=policy-memo-agent

# ── Optional: Additional data sources ────────────────────────────────────────
GOVINFO_API_KEY=                       # US Gov reports (free, needs signup)
FRED_API_KEY=                          # Federal Reserve data (free)
BRAVE_SEARCH_API_KEY=                  # Alternative web search (optional)

# ── Optional: Python backend ──────────────────────────────────────────────────
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/policy_memo
REDIS_URL=redis://localhost:6379
HF_MODEL_PATH=microsoft/deberta-v3-large-mnli   # Downloaded automatically
NLI_ONNX_MODEL_PATH=                            # Optional: pre-exported ONNX

# ── Agent configuration ───────────────────────────────────────────────────────
MAX_TOOL_CALLS=25                      # Max tool calls per memo run
MAX_RESEARCH_TOKENS=50000              # Max tokens in research phase
MAX_REVISION_ATTEMPTS=2                # HERALD revision retries before Tier 4
LOG_LEVEL=info
BACKEND_PORT=8000
FRONTEND_PORT=3000
```

---

## Troubleshooting

### `GROQ_API_KEY not found` when running scripts

The scripts use Node's `--env-file` flag (Node 20.6+). Confirm your Node version:

```bash
node --version  # must be 20.6.0 or higher
```

If it's older, upgrade Node or add `require('dotenv').config()` to the script.

### NLI backend not loading (Tier 1 skipped)

Check the Python server is running at port 8000:

```bash
curl http://localhost:8000/health
```

If the server crashed, check its terminal for Python tracebacks. Common issue: `torch` not installed — run `cd backend && uv sync` again.

### Groq `rate_limit_exceeded` during large pipeline runs

The free tier is 6,000 tokens/minute. If you hit it:

- Add `--claims 3` flag to evaluate only 3 claims (pipeline script)
- Or upgrade to Groq paid tier
- Or add `await new Promise(r => setTimeout(r, 10000))` delays between tier calls

### `tsc` errors on `src/ui/` files

The Next.js `tsconfig.json` and root `tsconfig.json` have different settings. Run:

```bash
npm run typecheck    # uses root tsconfig
cd src/ui && npx tsc --noEmit  # uses Next.js tsconfig
```

### Alembic migration fails (`relation already exists`)

Database was partially initialized. Reset it:

```bash
cd backend
uv run alembic downgrade base
uv run alembic upgrade head
```

### Port 3000 in use

```bash
npx kill-port 3000
npm run dev
```

### Port 8000 in use

```bash
lsof -ti:8000 | xargs kill -9
cd backend && uv run uvicorn policy_memo_agent.api.app:create_app --factory --port 8000
```

---

## Quick-Start (Minimum Viable Setup)

If you just want to see the pipeline working with minimal setup:

```bash
# 1. Clone + install
git clone <repo-url> && cd <repo> && npm install

# 2. Set two required keys
echo "GROQ_API_KEY=gsk_..." >> .env
echo "GEMINI_API_KEY=AIza..." >> .env

# 3. Run dry pipeline (no live API calls)
npm run pipeline:dry

# 4. Run live pipeline (real calls)
npm run pipeline

# 5. Start UI
npm run dev
# Open localhost:3000
```

Everything else (NLI backend, database, Braintrust, FRED, GovInfo) is optional and enables additional features.
