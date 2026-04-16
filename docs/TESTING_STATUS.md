# HERALD — Testing Status & Gaps

_Last updated: 2026-04-16_

---

## Quick Summary

| Layer                          | Tests Written               | Tests Passing           | Coverage Level |
| ------------------------------ | --------------------------- | ----------------------- | -------------- |
| TypeScript — HERALD core       | ✅ 320 / 320                | ✅ All green            | High           |
| TypeScript — Agent             | ✅ Yes                      | ✅ All green            | Medium         |
| TypeScript — MCP tools         | ✅ Unit + integration stubs | ✅ All green            | Medium         |
| TypeScript — Observability     | ✅ Yes                      | ✅ All green            | Medium         |
| TypeScript — Integration (E2E) | ❌ Not written              | —                       | None           |
| Python backend — Tier 1 NLI    | ✅ Written                  | ⚠️ Need `uv run pytest` | Medium         |
| Python backend — Tier 3 debate | ✅ Written                  | ⚠️ Need `uv run pytest` | Medium         |
| Python backend — API routes    | ✅ Written                  | ⚠️ Need `uv run pytest` | Medium         |
| UI components                  | ❌ Not written              | —                       | None           |
| UI hooks                       | ❌ Not written              | —                       | None           |
| Full pipeline (live)           | ✅ Run twice manually       | ✅ Passes               | Smoke only     |

---

## What Has Been Tested (and Works)

### HERALD Tier 1 — NLI (`tests/herald/tier1.test.ts`)

- Claim routing: statistical/comparative/causal → Tier 1; predictive/normative/synthesis → skip to Tier 2
- Entailment above threshold exits as `valid`
- Contradiction above 0.7 exits as `invalid` with suggested revision
- Low confidence / neutral → `uncertain`, escalates to Tier 2
- Causal claims use lower NLI threshold (0.85 vs 0.90)
- `skipNLI` types never call the NLI fetch endpoint
- When NLI backend is unavailable (503/connection refused), router falls through to Tier 2 gracefully
- All test tiers (2 and 3) are stubbed so no real API calls are made

### HERALD Tier 2 — LLM Judge (`tests/herald/tier2.test.ts`)

- Groq SDK mock structure verified (`groq-sdk`, not `@anthropic-ai/sdk`)
- Tool calling format: `submit_evaluation` function, `tool_choice: { type: 'function' }`
- Confidence thresholds: >0.85 exits, 0.6–0.85 escalates, <0.6 high-priority escalation
- Fallback: when Groq returns plain text instead of a tool call, JSON is extracted from content
- System prompt injected per claim type
- Tier 1 context injected into user message when escalating
- Model: `llama-3.3-70b-versatile`

### HERALD Tier 4 — Human Review (`tests/herald/tier4.test.ts`)

- Submit claim to queue
- Prevent duplicate submissions (idempotent)
- Retrieve queue sorted (pending first, then by submission time)
- Submit human verdict → updates entry, builds `HeraldResult` with `tier_reached: 4`
- `clearQueue()` resets state
- Escalation reason string built correctly from last tier's confidence

### HERALD Feedback Loop (`tests/herald/feedback-loop.test.ts`)

- Valid claims skip revision
- Invalid claims trigger agent revision call
- After max 2 revision attempts, claim is flagged `requires_human_intervention`
- Revised claim text is rewritten in memo markdown using RegExp (escapes special chars)
- Notes log is updated with revised claim text

### Agent — Prompt Assembler (`tests/agent/prompt-assembler.test.ts`)

- System prompt assembled from topic, background, template, known sources
- Output format instructions included

### Agent — Claim Extractor (`tests/agent/claim-extractor.test.ts`)

- Claims classified into correct types (all 6)
- Notes log entries built with source provenance
- Derivation method tagged correctly

### Agent — Research Agent (`tests/agent/research-agent.test.ts`)

- Agent loop runs with tool use
- Budget enforcement: stops at `MAX_TOOL_CALLS`
- MCP tool calls are logged
- Output: `MemoOutput` with memo + notes log

### MCP Tools — Unit (`tests/mcp/tool-registry.unit.test.ts`)

- Tool registry loads and registers tools
- Health check reports unavailable tools correctly

### Observability (`tests/observability/braintrust.test.ts`)

- Span start/end
- Error logging
- Warning logging

### Full Pipeline — Smoke (`npm run pipeline`, run twice manually)

- Gemini web search returns results
- Agent runs with real API (Groq)
- Notes log generated
- HERALD Tier 2 evaluates claims
- Feedback loop revises
- Human review queue populated
- Output files written to `pipeline-output/`

---

## What Needs to Be Written / Fixed

### Missing Test Files

#### `tests/herald/tier3.test.ts` — **High Priority**

Tier 3 (Multi-Agent Debate) has zero unit test coverage. Needs:

- 3 personas run in parallel (`Promise.all`)
- Judge synthesizes correctly
- Unanimous agreement exits with verdict
- 2–1 split with high judge confidence exits
- Low judge confidence (≤0.80) escalates to Tier 4 (`uncertain`)
- Groq client mocked with `vi.hoisted` + `vi.mock('groq-sdk', ...)` same as tier2
- Persona prompts injected per claim type

#### `tests/integration/pipeline.test.ts` — **High Priority**

Full end-to-end test with seeded data, no real API calls. Needs:

- Groq mocked with deterministic responses
- Gemini search mocked
- Runs `evaluateClaim` → `reviseClaimsFromHerald` → `submitForHumanReview`
- Verifies final output structure matches `HeraldResult` schema
- Verifies memo markdown is rewritten where claims are revised

#### `tests/ui/` — **Medium Priority**

No UI component tests exist. Should cover:

- `MemoViewer`: renders claim markers, handles click to show provenance
- `ClaimSelector`: selection state, pre-selects high-risk derivations
- `HeraldResults`: renders tier progress, verdict badges
- `HumanReviewQueue`: renders pending entries, submits verdict via form
- `Toast`: auto-dismiss timer, stacking, all positions
- `ErrorBoundary`: catches render errors, shows fallback, resets on `resetKey` change
- `useAgent`: phase transitions (idle → planning → researching → writing → complete)
- `useHerald`: claim selection, evaluation phases, submission to human queue

#### `tests/api/` — **Medium Priority**

Next.js API route tests (needs `@next/test-utils` or raw fetch mocking):

- `POST /api/agent/run`: validates `topic` required, calls agent, returns `MemoOutput`
- `POST /api/herald/evaluate`: validates `claim_ids`, runs evaluation pipeline, returns results
- `POST /api/herald/verdict`: validates inputs, 404 on unknown claim, 400 on bad verdict

### Gaps in Existing Tests

#### `tests/herald/tier2.test.ts`

- Does not test the plain-text JSON fallback path (when Groq ignores `tool_choice`)
- Does not test `unknown` verdict value from model (should coerce to `'uncertain'`)
- Does not test `confidence` clamping for values outside [0, 1]

#### `tests/agent/research-agent.test.ts`

- Does not test revision agent (the Groq call that rewrites invalid claims)
- Does not test session memory loading/saving across revisions

#### `tests/herald/feedback-loop.test.ts`

- Does not test concurrent revision of multiple claims
- Does not test when `reviseClaimWithAgent` throws — should it count as a revision attempt?

---

## What Needs to Be Run (Not Just Tested)

### Python Backend — NLI Service

The Tier 1 NLI model (DeBERTa-v3-large-mnli) runs as a FastAPI service. It has never been started in this project yet.

```bash
cd backend
uv sync
uv run uvicorn policy_memo_agent.api.app:create_app --factory --port 8000 --reload
```

When running, HERALD will use real NLI for statistical/comparative/causal claims instead of falling back to Tier 2. This significantly improves evaluation quality and reduces Groq API costs.

**First run downloads ~900MB model from HuggingFace — budget time for this.**

### Python Backend — Tests

```bash
cd backend
uv run pytest -m "not integration" -v
```

These have been written but never executed in this session. Run once to confirm the Python side is green.

### Database Migration (for persistence)

Currently the human review queue is in-memory only. For production:

```bash
cd backend
uv run alembic upgrade head
```

Requires `DATABASE_URL` set in `.env`.

### UI — Browser Test

`npm run dev` starts the Next.js frontend. The full UI has never been manually tested in a browser end-to-end:

- Phase 1: Input form → submit topic
- Phase 2: Agent progress stream (requires WebSocket backend)
- Phase 3: Memo viewer with claim markers
- Phase 4: HERALD evaluation, tier progress, human queue

### WebSocket Server

`useWebSocket.ts` connects to `ws://localhost:8000/ws` (Python backend). The FastAPI app has a lifespan hook for it but the WS route has not been confirmed working. Needs:

```bash
# Start backend
cd backend && uv run uvicorn policy_memo_agent.api.app:create_app --factory --port 8000
# Start frontend
npm run dev
# Then open browser at localhost:3000 and submit a topic
```

---

## What Needs to Be Tuned / Calibrated

### HERALD Confidence Thresholds

Currently hardcoded:
| Tier | Threshold | Location |
|---|---|---|
| Tier 1 — NLI exit | 0.90 (statistical/comparative), 0.85 (causal) | `src/types/claims.ts` → `CLAIM_TYPE_CONFIG` |
| Tier 2 — LLM exit | 0.85 | `src/herald/tier2-llm-judge.ts:34` |
| Tier 2 — high-priority escalation | 0.60 | `src/herald/tier2-llm-judge.ts:36` |
| Tier 3 — debate exit | 0.80 | `src/herald/tier3-debate.ts` |

These were set based on the CLAUDE.md spec. To calibrate properly:

1. Build a ground-truth eval set (20–50 claims with known correct verdicts)
2. Run `evaluateClaim` on each at the current thresholds
3. Compute precision/recall for `valid` vs `invalid`
4. Sweep thresholds systematically (similar to the Python `threshold_sweep.py` script)

### Tier 2 Prompt Quality

`src/herald/prompts/judge-system.ts` has claim-type-specific prompts. These should be evaluated with a set of known-correct and known-incorrect claims. Key questions:

- Does the `normative` prompt correctly distinguish genuine consensus from one school of thought?
- Does the `causal` prompt reliably catch correlation-as-causation?
- Does the `synthesis` prompt flag logical gaps vs. valid synthesis?

### Tier 3 Persona Calibration

The three personas (domain expert, methodologist, skeptic) in `src/herald/prompts/` were written to spec but have not been run against a calibration set. The skeptic persona in particular can produce false `invalid` verdicts on well-supported claims — tune the adversarial intensity.

### Agent Token Budget

`DEFAULT_AGENT_CONFIG` sets `maxToolCalls: 25` and `maxResearchTokens: 50000`. Live pipeline runs showed the agent sometimes uses all 25 tool calls and produces a thin memo. Consider:

- Raising to 35 tool calls for complex policy topics
- Adding a "richness check" after memo generation (does each section have ≥2 claims?)
- Tuning the research plan prompt to front-load high-priority sources

### Groq Rate Limits

Free tier: 14,400 req/day, 6,000 tokens/min on `llama-3.3-70b-versatile`. In a full pipeline run with 10 claims:

- Research agent: ~5–8 Groq calls
- Tier 2: up to 10 calls (one per claim)
- Tier 3: up to 40 calls (3 personas × 10 + 10 judge) if all escalate
- Revision: up to 20 calls (2 attempts × 10 claims)

Worst case: ~78 calls per run. At 14,400/day, this supports ~184 full runs/day — fine for development, but add caching and early exits for production.

---

## Feature Completeness Checklist

### Core Pipeline

- [x] Tier 1 — NLI evaluation (with backend) / graceful fallback (without backend)
- [x] Tier 2 — Groq LLM Judge
- [x] Tier 3 — Multi-Agent Debate (3 personas + judge)
- [x] Tier 4 — Human Review Queue (in-memory)
- [x] Feedback loop (max 2 revision attempts)
- [x] HERALD router with claim-type-based tier routing
- [ ] Tier 4 — Human Review Queue (database persistence)

### Research Agent

- [x] Prompt assembly
- [x] Claim extraction and notes log building
- [x] Tool loop with budget enforcement
- [x] Gemini web search (primary)
- [x] arXiv search
- [x] World Bank API
- [x] FRED (Federal Reserve data)
- [x] GovInfo (US government reports)
- [x] GovReport (academic policy reports)
- [x] Semantic Scholar
- [x] File reader (user-uploaded PDFs/docs)
- [x] Session memory (persisted across revisions)
- [x] Memo versioning
- [ ] File upload API route (`POST /api/upload`)

### Frontend

- [x] Input form (Phase 1)
- [x] Agent progress display (Phase 2)
- [x] Memo viewer with inline claim markers (Phase 3)
- [x] Notes log provenance viewer (Phase 3)
- [x] Claim selector (Phase 3→4)
- [x] HERALD results display (Phase 4)
- [x] Tier progress visualization (Phase 4)
- [x] Human review queue UI (Phase 4)
- [x] Export: Markdown, Word (.docx), JSON, ZIP
- [x] Toast notifications
- [x] Error boundaries
- [ ] File upload UI (drag-and-drop)
- [ ] WebSocket real-time streaming (tested in code, not in browser)
- [ ] Memo version history viewer

### API Routes

- [x] `POST /api/agent/run`
- [x] `POST /api/herald/evaluate`
- [x] `POST /api/herald/verdict`
- [ ] `POST /api/upload` (file upload for user sources)
- [ ] `GET /api/memos` (list saved memos)
- [ ] `GET /api/memos/[id]` (load specific memo)
- [ ] `POST /api/memos` (save memo to DB)
- [ ] `GET /api/herald/queue` (get review queue without evaluating)

### Python Backend

- [x] FastAPI app factory
- [x] NLI service (DeBERTa-v3-large-mnli)
- [x] HERALD routes (Python mirror of TS pipeline)
- [x] Memo CRUD routes (skeleton)
- [ ] Database models / migrations (Alembic, not yet run)
- [ ] Redis session state (configured, not tested)
- [ ] WebSocket endpoint for agent streaming
