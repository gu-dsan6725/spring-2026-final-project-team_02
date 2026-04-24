# Diagrams

## Diagram 1 — Simple Overview

```mermaid
flowchart LR
    A["Phase 1\nUser provides topic"] --> B["Phase 2\nAI agent researches\n& writes memo"]
    B --> C["Phase 3\nUser reviews memo\n& selects claims to check"]
    C --> D["Phase 4\nHERALD evaluates claims\n& flags revisions"]
    D -->|"Revised claims\nre-evaluated"| D
```

---

## Diagram 2 — System Architecture (Medium)

```mermaid
flowchart TD
    subgraph UI["UI Layer — Next.js"]
        U1[Input Form] --> U2[Agent Progress View]
        U2 --> U3[Memo Viewer\nwith inline claim markers]
        U3 --> U4[HERALD Results Panel]
    end

    subgraph AGENT["Agent Layer — Groq Llama 3.3 70B"]
        A1[Research Agent\ntool-calling loop]
        A2[(Notes Log\nJSON provenance)]
        A3[Policy Memo\nMarkdown]
        A1 --> A2
        A1 --> A3

        subgraph TOOLS["MCP Tool Registry — 8 Sources"]
            T1[Web Search]
            T2[arXiv]
            T3[World Bank API]
            T4[Semantic Scholar]
            T5[GovReport]
            T6[GovInfo]
            T7[FRED]
            T8[User Files]
        end

        A1 <-->|tool calls / results| TOOLS
    end

    subgraph HERALD["HERALD Pipeline"]
        H1[Router\nclaim type → starting tier]
        H2[Tier 1: NLI Model\nDeBERTa]
        H3[Tier 2: LLM Judge\nClaude Sonnet]
        H4[Tier 3: Multi-Agent Debate\nDomain Expert · Methodologist · Skeptic]
        H5[Tier 4: Human Review]
        H1 --> H2 --> H3 --> H4 --> H5
    end

    subgraph OBS["Observability — Braintrust"]
        O1[LLM call traces]
        O2[Tool invocation logs]
        O3[Claim evaluation spans]
        O4[Token usage & latency]
    end

    U1 -->|topic + context| A1
    A3 -->|rendered memo| U3
    A2 -->|provenance| U3
    U3 -->|selected claims| H1
    H1 -.->|invalid verdict +\nHERALD feedback| A1
    H4 --> U4
    H5 --> U4

    AGENT -.->|spans| OBS
    HERALD -.->|spans| OBS
    UI -.->|spans| OBS
```

---

## Diagram 3 — Detailed Technical Architecture

```mermaid
flowchart TD
    %% ── Style definitions ──────────────────────────────────────────────────
    classDef fe      fill:#1d4ed8,color:#fff,stroke:#1e40af
    classDef agent   fill:#065f46,color:#fff,stroke:#064e3b
    classDef mcp     fill:#1e3a5f,color:#fff,stroke:#1e3a5f
    classDef herald  fill:#7c2d12,color:#fff,stroke:#6b2110
    classDef py      fill:#4a1d96,color:#fff,stroke:#3b0764
    classDef obs     fill:#374151,color:#fff,stroke:#1f2937

    %% ── FRONTEND ───────────────────────────────────────────────────────────
    subgraph FE["Frontend — Next.js / TypeScript"]
        direction TB
        subgraph COMP["Components"]
            C1[InputForm]:::fe
            C2[AgentProgress]:::fe
            C3[MemoViewer]:::fe
            C4[NotesLog]:::fe
            C5[ClaimSelector]:::fe
            C6[HeraldResults]:::fe
            C7[TierProgress]:::fe
            C8[HumanReviewQueue]:::fe
        end
        subgraph HOOKS["Hooks"]
            H1[useAgent]:::fe
            H2[useHerald]:::fe
            H3[useWebSocket\nreal-time streaming]:::fe
        end
        C1 --> C2 --> C3
        C3 --> C4
        C3 --> C5
        C5 --> C6
        C6 --> C7
        C7 --> C8
        H1 -.- C2
        H2 -.- C6
        H3 -.- C2
    end

    %% ── RESEARCH AGENT ─────────────────────────────────────────────────────
    subgraph AGT["Research Agent Layer — TypeScript / Groq SDK"]
        direction TB
        PA[prompt-assembler.ts\nbuilds system prompt]:::agent
        RA["research-agent.ts\nGroq Llama 3.3 70B\nfunction-calling loop"]:::agent
        LC["loop-controller.ts\nmax 25 tool calls\nmax 50K tokens"]:::agent
        CE["claim-extractor.ts\nclassifies 6 claim types\nassigns derivation methods"]:::agent
        MW[memo-writer.ts\nsynthesizes final memo]:::agent
        NL[("Notes Log\nJSON provenance\nclaim → sources")]:::agent
        MM["Policy Memo\nMarkdown"]:::agent

        PA --> RA
        RA <--> LC
        RA --> CE
        CE --> NL
        NL --> MW
        MW --> MM
    end

    %% ── MCP TOOLS ──────────────────────────────────────────────────────────
    subgraph MCP["MCP Tool Registry — 8 Tools  ·  retry + timeout"]
        direction LR
        T1[web-search]:::mcp
        T2[arXiv]:::mcp
        T3[World Bank]:::mcp
        T4[Semantic Scholar]:::mcp
        T5[GovReport]:::mcp
        T6[GovInfo]:::mcp
        T7[FRED]:::mcp
        T8[file-reader]:::mcp
    end

    %% ── HERALD PIPELINE ────────────────────────────────────────────────────
    subgraph HER["HERALD Pipeline — TypeScript + Python"]
        direction TB
        HR["router.ts\nStatistical/Comparative → T1 @ 0.90\nCausal → T1 @ 0.85\nPredictive/Normative/Synthesis → T2"]:::herald
        T1H["Tier 1 — NLI Model\ntier1-nli.ts / tier1_nli.py\nDeBERTa-v3-large-mnli\nentailment · neutral · contradiction"]:::herald
        T2H["Tier 2 — LLM Judge\ntier2-llm-judge.ts / tier2_judge.py\nClaude Sonnet\naccuracy · completeness · causal validity\ncomparison fairness"]:::herald
        T3H["Tier 3 — Multi-Agent Debate\ntier3-debate.ts / tier3_debate.py\nDomain Expert + Methodologist + Skeptic\n→ Judge synthesis  (all Groq Llama 3.3)"]:::herald
        T4H["Tier 4 — Human Review\ntier4-human.ts\nHumanReviewQueue UI"]:::herald
        FL["feedback-loop.ts\nrevision pipeline\nmax 2 re-runs → requires_human_intervention"]:::herald

        HR --> T1H --> T2H --> T3H --> T4H
        T1H -->|"entailment > threshold\nEXIT VALID"| FL
        T1H -->|"contradiction\nEXIT INVALID"| FL
        T2H -->|"confidence > 0.85\nEXIT"| FL
        T3H -->|"consensus reached\nEXIT"| FL
        T4H --> FL
    end

    %% ── PYTHON BACKEND ─────────────────────────────────────────────────────
    subgraph PY["Python Backend — FastAPI"]
        direction TB
        R1["/api/memos"]:::py
        R2["/api/herald"]:::py
        R3["/api/health"]:::py
        DB[("PostgreSQL\nmemos · claims\nevaluations")]:::py
        RD[(Redis\nsession state)]:::py
        AL[Alembic\nmigrations]:::py
        R1 & R2 --> DB
        R1 & R2 --> RD
        AL --> DB
    end

    %% ── OBSERVABILITY ──────────────────────────────────────────────────────
    subgraph OBS["Observability"]
        direction LR
        BT["Braintrust\nLLM calls · tool calls\nclaim extractions · HERALD tiers"]:::obs
        OT["OpenTelemetry\nlatency spans\ntoken usage"]:::obs
    end

    %% ── CROSS-LAYER DATA FLOWS ─────────────────────────────────────────────
    C1 -->|"topic + context\nvia HTTP"| PA
    MM -->|"rendered memo"| C3
    NL -->|"provenance"| C4
    C5 -->|"selected claims"| HR
    FL -->|"invalid + feedback\nmax 2 attempts"| RA
    FL -->|"verdict + tier details"| C6
    T4H -->|"human queue"| C8

    RA <-->|"tool calls / results"| MCP
    R2 <-->|"claim evaluation\nrequests"| HER
    C1 -->|"HTTP"| R1
    C5 -->|"HTTP"| R2

    AGT -.->|spans| BT
    HER -.->|spans| BT
    FE  -.->|spans| OT
    PY  -.->|spans| OT
    BT  -.- OT
```

---

## Diagram 4 — HERALD Framework Deep Dive

```mermaid
flowchart TD
    %% ── Styles ─────────────────────────────────────────────────────────────
    classDef entry   fill:#1f2937,color:#f9fafb,stroke:#374151
    classDef router  fill:#374151,color:#f9fafb,stroke:#4b5563
    classDef t1      fill:#1d4ed8,color:#fff,stroke:#1e40af
    classDef t1exit  fill:#1e40af,color:#fff,stroke:#1d4ed8,font-weight:bold
    classDef t2      fill:#b45309,color:#fff,stroke:#92400e
    classDef t2exit  fill:#92400e,color:#fff,stroke:#b45309,font-weight:bold
    classDef t3      fill:#065f46,color:#fff,stroke:#064e3b
    classDef t3exit  fill:#064e3b,color:#fff,stroke:#065f46,font-weight:bold
    classDef t4      fill:#7c2d12,color:#fff,stroke:#6b2110
    classDef schema  fill:#4a1d96,color:#fff,stroke:#3b0764
    classDef valid   fill:#14532d,color:#fff,stroke:#166534,font-weight:bold
    classDef invalid fill:#7f1d1d,color:#fff,stroke:#991b1b,font-weight:bold
    classDef fl      fill:#1e3a5f,color:#fff,stroke:#1e40af
    classDef human   fill:#7c2d12,color:#fff,stroke:#6b2110,font-weight:bold

    %% ── ENTRY ───────────────────────────────────────────────────────────────
    ENTRY["Notes Log Claim\n─────────────────────\nclaim_text\nclaim_type  ∈  {statistical, causal, comparative,\n               predictive, normative, synthesis}\nderivation_method\nsources[]  →  relevant_chunk per source"]:::entry

    %% ── ROUTER ───────────────────────────────────────────────────────────────
    ENTRY --> ROUTER{{"router.ts\nBranch on claim_type"}}:::router
    ROUTER -->|"Statistical\nor Comparative"| T1_90["Tier 1  ·  NLI threshold = 0.90"]:::t1
    ROUTER -->|"Causal\n(lower bar: NLI catches\nmisquotes, misses\ncorrelation-as-causation)"| T1_85["Tier 1  ·  NLI threshold = 0.85"]:::t1
    ROUTER -->|"Predictive · Normative\nor Synthesis\n(NLI cannot evaluate)"| SKIP(["SKIP → go directly\nto Tier 2"]):::router

    %% ── TIER 1 ───────────────────────────────────────────────────────────────
    subgraph T1BOX["Tier 1 — NLI Model  ·  DeBERTa-v3-large-mnli"]
        direction TB
        T1RUN["Input:\n  premise  =  source relevant_chunk\n  hypothesis  =  claim_text\n\nOutput:\n  entailment / neutral / contradiction\n  + confidence score"]:::t1
        T1CHK{{"NLI result?"}}:::t1
        T1RUN --> T1CHK
    end

    T1_90 & T1_85 --> T1RUN

    T1CHK -->|"entailment confidence\n> threshold"| EX_V1(["EXIT → VALID ✓"]):::valid
    T1CHK -->|"contradiction\ndetected"| EX_I1(["EXIT → INVALID ✗"]):::invalid
    T1CHK -->|"neutral  or\nbelow threshold"| T2RUN

    %% ── TIER 2 ───────────────────────────────────────────────────────────────
    subgraph T2BOX["Tier 2 — LLM Judge  ·  Claude Sonnet"]
        direction TB
        T2RUN["Evaluates:\n  accuracy · completeness\n  causal validity\n  comparison fairness\n  projection conditionality\n  normative consensus\n\nOutput: structured verdict + confidence"]:::t2
        T2CHK{{"Confidence?"}}:::t2
        T2RUN --> T2CHK
    end

    SKIP --> T2RUN

    T2CHK -->|"confidence > 0.85"| EX_T2(["EXIT with verdict ✓/✗"]):::t2exit
    T2CHK -->|"confidence 0.60 – 0.85\nor < 0.60"| T3A

    %% ── TIER 3 ───────────────────────────────────────────────────────────────
    subgraph T3BOX["Tier 3 — Multi-Agent Debate  ·  Groq Llama 3.3 70B  ·  3 parallel calls"]
        direction LR
        T3A["Domain Expert\nsubstantive accuracy\n& field knowledge"]:::t3
        T3B["Methodologist\nevidence quality\n& inferential validity"]:::t3
        T3C["Skeptic\nadversarial challenge\n& counter-evidence"]:::t3
        T3J["Judge Synthesis\n1 call aggregates\n3 perspectives"]:::t3
        T3CHK{{"Consensus?"}}:::t3
        T3A & T3B & T3C --> T3J --> T3CHK
    end

    T3CHK -->|"unanimous  or  2-1\njudge confidence > 0.80"| EX_T3(["EXIT with verdict ✓/✗"]):::t3exit
    T3CHK -->|"no consensus  or\njudge confidence ≤ 0.80"| T4RUN

    %% ── TIER 4 ───────────────────────────────────────────────────────────────
    subgraph T4BOX["Tier 4 — Human Review"]
        direction TB
        T4RUN["Displays to reviewer:\n  · claim text\n  · all source chunks\n  · full Tier 1 – 3 outputs"]:::t4
        T4OUT["Human verdict\n+ optional notes"]:::t4
        T4RUN --> T4OUT
    end

    %% ── HERALD OUTPUT SCHEMA ─────────────────────────────────────────────────
    EX_V1  --> SCHEMA
    EX_I1  --> SCHEMA
    EX_T2  --> SCHEMA
    EX_T3  --> SCHEMA
    T4OUT  --> SCHEMA

    SCHEMA["HERALD Output Schema\n──────────────────────────────\nclaim_id\ntier_reached\nverdict          valid · invalid · needs_revision\nconfidence\nfeedback\nsuggested_revision\ntier_details\n  tier_1:  { verdict, confidence, nli_label }\n  tier_2:  { verdict, confidence, reasoning }\n  tier_3:  { domain_expert, methodologist,\n             skeptic, judge_synthesis }\n  tier_4:  { human_verdict, notes }"]:::schema

    %% ── FEEDBACK LOOP ────────────────────────────────────────────────────────
    subgraph FL["Feedback Loop  ·  feedback-loop.ts"]
        direction TB
        FL1{{"verdict  =  valid?"}}:::fl
        FL2(["Update memo text\n+ notes log entry\nmark resolved ✓"]):::valid
        FL3{{"revision_count < 2?"}}:::fl
        FL4["Send to Groq agent:\n  original claim\n  + HERALD feedback\n  + suggested_revision\n  → re-run full HERALD pipeline"]:::fl
        FL5(["Flag: requires_human_intervention\nsurface in UI ⚠"]):::human

        FL1 -->|"yes"| FL2
        FL1 -->|"no  (invalid or\nneeds_revision)"| FL3
        FL3 -->|"yes"| FL4
        FL3 -->|"no  (≥ 2 attempts)"| FL5
        FL4 -->|"revised claim\nre-enters HERALD"| FL4_OUT(["→ HERALD router"]):::router
    end

    SCHEMA --> FL1
```
