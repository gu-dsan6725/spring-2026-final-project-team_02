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

---

## Agent Loop Control

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
```

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
