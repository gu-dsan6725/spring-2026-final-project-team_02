# Setup Guide — Policy Memo Agent with HERALD

Complete setup instructions for local development. Follow each section in order.

---

## Prerequisites

| Tool    | Minimum Version | Install                                            |
| ------- | --------------- | -------------------------------------------------- |
| Node.js | 20.x            | https://nodejs.org or `nvm install 20`             |
| Python  | 3.11+           | https://python.org or `pyenv install 3.11`         |
| uv      | latest          | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Docker  | 24+             | https://docs.docker.com/get-docker/                |
| Git     | 2.40+           | pre-installed on most systems                      |

---

## API Keys

The following API keys are required or optional. All free tiers are sufficient for development.

### Required

| Service          | Purpose                            | Free tier       | Get key                       |
| ---------------- | ---------------------------------- | --------------- | ----------------------------- |
| **Groq**         | Research agent LLM (Llama 3.3 70B) | 14,400 req/day  | https://console.groq.com      |
| **Brave Search** | Web search for research agent      | 2,000 req/month | https://brave.com/search/api/ |

### Optional (enables additional data sources)

| Service           | Purpose                            | Free tier                   | Get key                               |
| ----------------- | ---------------------------------- | --------------------------- | ------------------------------------- |
| **Braintrust**    | Observability and LLM tracing      | Free hobby tier             | https://braintrust.dev                |
| **GovInfo**       | US Congressional/GAO reports       | Free, registration required | https://api.govinfo.gov/docs/         |
| **FRED**          | Federal Reserve economic data      | Free, registration required | https://fred.stlouisfed.org/docs/api/ |
| **OTEL endpoint** | Distributed tracing (Jaeger/Tempo) | Self-hosted                 | —                                     |

> Anthropic API key is no longer required for the research agent (switched to Groq). It is only needed if you enable optional Tier 2/3 HERALD judges that use Claude.

---

## Installation

### 1. Clone and install Node dependencies

```bash
git clone https://github.com/gu-dsan6725/spring-2026-final-project-team_02.git
cd spring-2026-final-project-team_02
npm install
```

### 2. Install Python backend dependencies

```bash
cd backend
uv sync
cd ..
```

To include the NLI model dependencies (torch + transformers):

```bash
cd backend
uv sync --extra nli
cd ..
```

> On CPU-only machines the NLI model runs in ~1-3s per inference. For faster inference, export the model to ONNX (see [NLI Model Setup](#nli-model-setup) below).

---

## Environment Variables

Copy the example file and fill in your keys:

```bash
cp .env.example .env
```

Required values to set in `.env`:

```bash
# Research agent (required)
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Web search (required)
BRAVE_SEARCH_API_KEY=BSAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Observability (optional — app works without these)
BRAINTRUST_API_KEY=
BRAINTRUST_PROJECT_NAME=policy-memo-agent

# Additional data sources (optional)
GOVINFO_API_KEY=
FRED_API_KEY=
```

Leave all other values at their defaults for local development.

---

## Database Setup

Start PostgreSQL and Redis with Docker:

```bash
docker compose up -d
```

Verify both containers are healthy:

```bash
docker compose ps
# Expected: policy-memo-db (healthy), policy-memo-redis (healthy), policy-memo-backend (healthy)
```

Apply database migrations:

```bash
cd backend
uv run alembic upgrade head
cd ..
```

Seed test data (optional — creates sample memos and claims for UI development):

```bash
npm run seed
```

---

## NLI Model Setup

The HERALD Tier 1 pipeline uses DeBERTa-v3-large-mnli. The model is downloaded automatically on first run (~900MB).

### Option A: HuggingFace (default, no setup needed)

The model downloads to `~/.cache/huggingface/hub` on first startup. Set in `.env`:

```bash
HF_MODEL_PATH=microsoft/deberta-v3-large-mnli
```

### Option B: ONNX (faster CPU inference, ~3-4x speedup)

Export the model once, then point the backend at the ONNX file:

```bash
cd backend
uv run python -c "
from optimum.onnxruntime import ORTModelForSequenceClassification
model = ORTModelForSequenceClassification.from_pretrained(
    'microsoft/deberta-v3-large-mnli',
    export=True
)
model.save_pretrained('./models/deberta-v3-large-mnli-onnx')
"
```

Then set in `.env`:

```bash
NLI_ONNX_MODEL_PATH=./models/deberta-v3-large-mnli-onnx
```

---

## Running the Project

### Start everything (frontend + backend + infra)

```bash
# Terminal 1: infrastructure
docker compose up -d

# Terminal 2: Python backend
cd backend
uv run uvicorn policy_memo_agent.api.app:create_app --factory --reload --port 8000

# Terminal 3: Next.js frontend
npm run dev
```

Open http://localhost:3000 in your browser.

### Backend only (API development)

```bash
docker compose up -d postgres redis
cd backend
uv run uvicorn policy_memo_agent.api.app:create_app --factory --reload --port 8000
```

API docs available at http://localhost:8000/docs

---

## Verify Setup

Run this checklist to confirm everything is working:

```bash
# 1. TypeScript compiles without errors
npm run typecheck

# 2. Linting passes
npm run lint

# 3. JavaScript tests pass
npm run test

# 4. Python linting and types pass
cd backend && uv run ruff check . && uv run mypy src/ && cd ..

# 5. Python tests pass (no API keys needed)
cd backend && uv run pytest -m "not integration" -x && cd ..

# 6. Full validate (runs everything)
npm run verify
```

### Smoke test the NLI endpoint

With the backend running:

```bash
curl -s -X POST http://localhost:8000/api/herald/nli \
  -H "Content-Type: application/json" \
  -d '{
    "premise": "Maternal mortality in Chad stands at 1,140 per 100,000 live births.",
    "hypothesis": "Chad has high maternal mortality."
  }' | python -m json.tool
```

Expected response:

```json
{
  "label": "entailment",
  "scores": {
    "entailment": 0.92,
    "neutral": 0.06,
    "contradiction": 0.02
  }
}
```

---

## Troubleshooting

### `NLI model is not loaded` (503)

The NLI model loads at backend startup. If you hit this error:

1. Check backend logs: `docker compose logs backend`
2. Wait ~30-60s for first-run model download to complete
3. Hit `/health/nli` to check load status: `curl http://localhost:8000/health/nli`

### `GROQ_API_KEY not set`

The research agent will refuse to run without this key. Ensure `.env` is in the project root and the key starts with `gsk_`.

### `BRAVE_SEARCH_API_KEY not set`

Web search tool will be unavailable. The agent will still run but web search tool calls will return `{error: "BRAVE_SEARCH_API_KEY not configured"}`.

### `transformers` or `torch` not installed

Run: `cd backend && uv sync --extra nli`

### Docker containers not starting

Check disk space: `df -h`. PostgreSQL needs ~500MB and the NLI model cache needs ~1GB.

### Port conflicts

Change ports in `.env` (`BACKEND_PORT`, `FRONTEND_PORT`) and `docker-compose.yml` if 3000, 5432, 6379, or 8000 are in use.

---

## Project Commands Reference

```bash
# Development
npm run dev                    # Start Next.js frontend
npm run build                  # Production build

# Testing
npm run test                   # All JS tests
npm run test:herald            # HERALD pipeline tests only
npm run test:agent             # Agent tests only
npm run verify                 # Full verify (TS + lint + tests + Python)

# Database
docker compose up -d           # Start postgres + redis + backend
docker compose down            # Stop all services
docker compose down -v         # Stop and delete all data

# Backend
cd backend
uv run uvicorn policy_memo_agent.api.app:create_app --factory --reload
uv run pytest                  # All Python tests
uv run pytest -m "not integration"  # Skip tests needing API keys
uv run ruff check . --fix      # Lint + autofix
uv run mypy src/               # Type check
```
