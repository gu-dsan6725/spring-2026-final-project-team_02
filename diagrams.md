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

## Diagram 2b — System Architecture (Optimized)

```mermaid
flowchart LR
    classDef ui      fill:#2563eb,color:#fff,stroke:#1d4ed8,rx:6
    classDef agent   fill:#059669,color:#fff,stroke:#047857,rx:6
    classDef tools   fill:#0f172a,color:#94a3b8,stroke:#334155,rx:6
    classDef herald  fill:#dc2626,color:#fff,stroke:#b91c1c,rx:6
    classDef obs     fill:#4b5563,color:#fff,stroke:#374151,rx:6
    classDef artifact fill:#1d4ed8,color:#fff,stroke:#1e40af,rx:6,stroke-dasharray:4 2

    %% UI
    subgraph UI["  UI  ·  Next.js  "]
        U1(["① Input\nForm"]):::ui
        U2(["② Review\nMemo"]):::ui
        U3(["③ Select\nClaims"]):::ui
        U4(["④ HERALD\nResults"]):::ui
    end

    %% Agent
    subgraph AG["  Research Agent  ·  Groq Llama 3.3 70B  "]
        A1["Research\nLoop"]:::agent
        A2[("Notes Log\nprovenance")]:::artifact
        A3["Policy\nMemo"]:::artifact
        A1 --> A2 & A3
    end

    %% Tools
    subgraph MC["  8 Research Tools  ·  MCP Registry  "]
        direction TB
        MC1["Web Search  ·  arXiv  ·  World Bank\nSemantic Scholar  ·  GovReport\nGovInfo  ·  FRED  ·  User Files"]:::tools
    end

    %% HERALD
    subgraph HE["  HERALD Pipeline  "]
        H1["T1  NLI\nDeBERTa"]:::herald
        H2["T2  LLM Judge\nClaude Sonnet"]:::herald
        H3["T3  Debate\n3 Agents + Judge"]:::herald
        H4["T4  Human\nReview"]:::herald
        H1 -->|uncertain| H2 -->|uncertain| H3 -->|no consensus| H4
    end

    %% Observability
    OBS(["Braintrust\nAll spans & traces"]):::obs

    %% Main flow
    U1 -->|"topic + context"| A1
    A1 <-->|"tool calls / results"| MC1
    A3 -->|"rendered"| U2
    A2 -->|"provenance"| U2
    U2 --> U3
    U3 -->|"selected claims"| H1
    H1 & H2 & H3 & H4 -->|"verdict"| U4

    %% Feedback loop
    HE -.->|"invalid + feedback\nmax 2 revisions"| A1

    %% Observability
    AG & HE & UI -.->|spans| OBS
```

---

## Diagram 2c — System Architecture (TB Layout)

```mermaid
flowchart TB
    classDef ui     fill:#2563eb,color:#fff,stroke:#1d4ed8
    classDef agent  fill:#059669,color:#fff,stroke:#047857
    classDef herald fill:#dc2626,color:#fff,stroke:#b91c1c
    classDef obs    fill:#4b5563,color:#fff,stroke:#374151
    classDef art    fill:#1e40af,color:#fff,stroke:#93c5fd,stroke-dasharray:4 2

    subgraph L1["① User Input"]
        direction LR
        N1["Topic & Context"]:::ui ~~~ N2["Source Files"]:::ui
    end

    subgraph L2["② Research Agent  ·  Groq Llama 3.3 70B  ·  8 MCP Tools"]
        direction LR
        N3["Prompt Builder"]:::agent --> N4["Research Loop"]:::agent --> N5["Claim Extractor"]:::agent --> N6["Memo Writer"]:::agent
    end

    subgraph L3["③ Artifacts"]
        direction LR
        N7["Policy Memo"]:::art ~~~ N8[("Notes Log")]:::art
    end

    subgraph L4["④ User Review"]
        direction LR
        N9["Memo Viewer"]:::ui ~~~ N10["Claim Selector"]:::ui
    end

    subgraph L5["⑤ HERALD  ·  4-Tier Evaluation"]
        direction LR
        N11["Router"]:::herald --> N12["T1  NLI"]:::herald --> N13["T2  Judge"]:::herald --> N14["T3 / T4  Debate"]:::herald
    end

    subgraph L6["⑥ Output"]
        direction LR
        N15["HERALD Results"]:::ui ~~~ N16["Memo Resolved"]:::ui
    end

    subgraph L7["Observability  ·  Braintrust"]
        direction LR
        N17["LLM & Tool Traces"]:::obs ~~~ N18["Eval Spans"]:::obs
    end

    N1 & N2 --> N3
    N6      --> N7 & N8
    N7 & N8 --> N9
    N10     -->|"selected claims"| N11
    N14     --> N15 & N16
    N14     -.->|"invalid + feedback"| N4
    L2      -.->|"spans"| N17
    L5      -.->|"spans"| N18
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

## Diagram 3b — Detailed Technical Architecture (Optimized)

```mermaid
flowchart LR
    classDef fe       fill:#2563eb,color:#fff,stroke:#1d4ed8
    classDef agent    fill:#059669,color:#fff,stroke:#047857
    classDef mcp      fill:#0f172a,color:#94a3b8,stroke:#334155
    classDef herald   fill:#dc2626,color:#fff,stroke:#b91c1c
    classDef py       fill:#7c3aed,color:#fff,stroke:#6d28d9
    classDef obs      fill:#4b5563,color:#fff,stroke:#374151
    classDef artifact fill:#1e40af,color:#fff,stroke:#93c5fd,stroke-dasharray:4 2

    %% ── FRONTEND ───────────────────────────────────────────────────────────
    subgraph FE["Frontend — Next.js / TypeScript"]
        direction TB
        FE1["① Input & Progress\nInputForm · AgentProgress\nuseAgent · useWebSocket"]:::fe
        FE2["② Memo Review\nMemoViewer · NotesLog\nClaimSelector"]:::fe
        FE3["③ Evaluation UI\nHeraldResults · TierProgress\nHumanReviewQueue · useHerald"]:::fe
        FE1 --> FE2 --> FE3
    end

    %% ── RESEARCH AGENT ──────────────────────────────────────────────────────
    subgraph AGT["Research Agent — TypeScript · Groq SDK"]
        direction TB
        PA["prompt-assembler.ts\n→ system prompt"]:::agent
        RA["research-agent.ts\nGroq Llama 3.3 70B\nfunction-calling loop\n— loop-controller.ts —\nmax 25 calls · 50K tokens"]:::agent
        CE["claim-extractor.ts\n6 claim types · 4 derivation methods"]:::agent
        MW["memo-writer.ts\n→ synthesizes final memo"]:::agent
        NL[("Notes Log\nJSON provenance")]:::artifact
        MM["Policy Memo\nMarkdown"]:::artifact
        PA --> RA --> CE --> NL --> MW --> MM
    end

    %% ── MCP TOOLS ───────────────────────────────────────────────────────────
    subgraph MCP["MCP Tool Registry — 8 Tools · retry + timeout"]
        MC1["web-search · arXiv · World Bank\nSemantic Scholar · GovReport\nGovInfo · FRED · file-reader"]:::mcp
    end

    %% ── HERALD ──────────────────────────────────────────────────────────────
    subgraph HER["HERALD Pipeline — TypeScript + Python"]
        direction TB
        HR["router.ts\nStatistical/Comparative → T1 @0.90\nCausal → T1 @0.85\nPredictive/Normative/Synthesis → T2"]:::herald
        T1H["Tier 1 — NLI\ntier1-nli.ts · tier1_nli.py\nDeBERTa-v3-large-mnli"]:::herald
        T2H["Tier 2 — LLM Judge\ntier2-llm-judge.ts · tier2_judge.py\nClaude Sonnet"]:::herald
        T3H["Tier 3 — Debate\ntier3-debate.ts · tier3_debate.py\nExpert · Methodologist · Skeptic + Judge"]:::herald
        T4H["Tier 4 — Human Review\ntier4-human.ts"]:::herald
        FL["feedback-loop.ts\nmax 2 revisions\n→ requires_human_intervention"]:::herald
        HR --> T1H -->|uncertain| T2H -->|uncertain| T3H -->|no consensus| T4H
        T1H & T2H & T3H & T4H --> FL
    end

    %% ── PYTHON BACKEND ──────────────────────────────────────────────────────
    subgraph PY["Python Backend — FastAPI"]
        direction TB
        API["/api/memos\n/api/herald\n/api/health"]:::py
        DB[("PostgreSQL\nmemos · claims · evaluations\nAlembic migrations")]:::py
        RD[(Redis\nsession state)]:::py
        API --> DB & RD
    end

    %% ── OBSERVABILITY ───────────────────────────────────────────────────────
    subgraph OBS["Observability"]
        direction LR
        BT["Braintrust\nLLM · tools · claims · tiers"]:::obs
        OT["OpenTelemetry\nlatency · token usage"]:::obs
        BT -.- OT
    end

    %% ── CROSS-LAYER FLOWS ───────────────────────────────────────────────────
    FE1 -->|"topic + context"| PA
    FE1 -->|"HTTP /api/memos"| API
    MM -->|"rendered memo"| FE2
    NL  -->|"provenance"| FE2
    FE2 -->|"HTTP /api/herald\nselected claims"| API
    API <-->|"evaluation requests"| HER
    FL  -->|"verdict + tier details"| FE3
    FL  -.->|"invalid + feedback"| RA
    RA  <-->|"tool calls / results"| MC1

    AGT & HER -.->|spans| BT
    FE  & PY  -.->|spans| OT
```

---

## Diagram 3c — Detailed Technical Architecture (TB Layout)

```mermaid
flowchart TB
    classDef fe    fill:#2563eb,color:#fff,stroke:#1d4ed8
    classDef agent fill:#059669,color:#fff,stroke:#047857
    classDef mcp   fill:#0f172a,color:#94a3b8,stroke:#334155
    classDef her   fill:#dc2626,color:#fff,stroke:#b91c1c
    classDef py    fill:#7c3aed,color:#fff,stroke:#6d28d9
    classDef obs   fill:#4b5563,color:#fff,stroke:#374151
    classDef art   fill:#1e40af,color:#fff,stroke:#93c5fd,stroke-dasharray:4 2

    subgraph L1["① Frontend  ·  Input & Progress"]
        direction LR
        N1["InputForm"]:::fe ~~~ N2["AgentProgress"]:::fe ~~~ N3["useAgent"]:::fe ~~~ N4["useWebSocket"]:::fe
    end

    subgraph L2["② Research Agent  ·  TypeScript  ·  Groq SDK  ·  loop-controller  max 25 calls / 50K tokens"]
        direction LR
        N5["prompt-assembler.ts"]:::agent --> N6["research-agent.ts\nGroq Llama 3.3 70B"]:::agent --> N7["claim-extractor.ts\n6 types · 4 methods"]:::agent --> N8["memo-writer.ts"]:::agent
    end

    subgraph L3["③ MCP Tool Registry  ·  8 Tools  ·  retry + timeout"]
        direction LR
        N9["web-search · arXiv"]:::mcp ~~~ N10["World Bank · Scholar"]:::mcp ~~~ N11["GovReport · GovInfo"]:::mcp ~~~ N12["FRED · file-reader"]:::mcp
    end

    subgraph L4["④ Artifacts"]
        direction LR
        N13["Policy Memo"]:::art ~~~ N14[("Notes Log\nJSON provenance")]:::art
    end

    subgraph L5["⑤ Frontend  ·  Memo Review"]
        direction LR
        N15["MemoViewer"]:::fe ~~~ N16["NotesLog"]:::fe ~~~ N17["ClaimSelector"]:::fe
    end

    subgraph L6["⑥ Python Backend  ·  FastAPI"]
        direction LR
        N18["/api/memos\n/api/herald · /api/health"]:::py ~~~ N19[("PostgreSQL\nmemos · claims")]:::py ~~~ N20[(Redis\nsession state)]:::py ~~~ N21["Alembic\nmigrations"]:::py
    end

    subgraph L7["⑦ HERALD Pipeline  ·  TypeScript + Python"]
        direction LR
        N22["router.ts\nclaim type → tier"]:::her --> N23["T1  NLI\nDeBERTa"]:::her --> N24["T2  Judge\nClaude Sonnet"]:::her --> N25["T3 / T4  Debate\n+ feedback-loop.ts"]:::her
    end

    subgraph L8["⑧ Frontend  ·  Evaluation UI"]
        direction LR
        N26["HeraldResults"]:::fe ~~~ N27["TierProgress"]:::fe ~~~ N28["HumanReviewQueue"]:::fe ~~~ N29["useHerald"]:::fe
    end

    subgraph L9["Observability"]
        direction LR
        N30["Braintrust\nLLM · tools · tiers"]:::obs ~~~ N31["OpenTelemetry\nlatency · tokens"]:::obs
    end

    %% Main pipeline — top to bottom
    N1          --> N5
    N6          <-->|"tool calls / results"| N9
    N8          --> N13 & N14
    N13 & N14   --> N15
    N17         -->|"HTTP /api/herald"| N18
    N18         --> N19 & N20
    N18         -->|"evaluation requests"| N22
    N25         --> N26 & N28

    %% Required backward arrow — feedback loop
    N25         -.->|"invalid + feedback"| N6

    %% Observability spans
    L2 & L7     -.->|"spans"| N30
    L1 & L6     -.->|"spans"| N31
```

---

## Diagram 3d — Detailed Technical Architecture (Balanced)

```mermaid
flowchart TB
    classDef fe    fill:#2563eb,color:#fff,stroke:#1d4ed8
    classDef agent fill:#059669,color:#fff,stroke:#047857
    classDef mcp   fill:#0f172a,color:#94a3b8,stroke:#334155
    classDef her   fill:#dc2626,color:#fff,stroke:#b91c1c
    classDef py    fill:#7c3aed,color:#fff,stroke:#6d28d9
    classDef obs   fill:#4b5563,color:#fff,stroke:#374151
    classDef art   fill:#1e40af,color:#fff,stroke:#93c5fd,stroke-dasharray:4 2

    subgraph INPUT["① Input Phase  ·  Next.js Frontend"]
        direction LR
        N1["InputForm"]:::fe ~~~ N2["AgentProgress"]:::fe ~~~ N3["useAgent"]:::fe ~~~ N4["useWebSocket"]:::fe
    end

    subgraph AGT["② Research Agent  ·  Groq Llama 3.3 70B  ·  loop-controller"]
        direction LR
        A1["prompt-assembler"]:::agent --> A2["research-agent"]:::agent --> A3["claim-extractor\n6 types · 4 methods"]:::agent --> A4["memo-writer"]:::agent
    end

    subgraph MCP["MCP Tool Registry  ·  8 Tools  ·  retry + timeout"]
        direction LR
        M1["web-search · arXiv"]:::mcp ~~~ M2["World Bank · Scholar"]:::mcp ~~~ M3["GovReport · GovInfo"]:::mcp ~~~ M4["FRED · file-reader"]:::mcp
    end

    subgraph REV["③ Review Phase  ·  Artifacts & Selection"]
        direction LR
        R1["Policy Memo"]:::art ~~~ R2[("Notes Log")]:::art ~~~ R3["MemoViewer"]:::fe ~~~ R4["ClaimSelector"]:::fe
    end

    subgraph BE["④ Python Backend  ·  FastAPI"]
        direction LR
        B1["/api/herald · /api/memos"]:::py ~~~ B2[("PostgreSQL\nmemos · claims")]:::py ~~~ B3[(Redis\nsession state)]:::py ~~~ B4["Alembic\nmigrations"]:::py
    end

    subgraph HER["⑤ HERALD Pipeline  ·  TypeScript + Python"]
        direction LR
        H1["router.ts"]:::her --> H2["T1  NLI\nDeBERTa"]:::her --> H3["T2  Judge\nClaude Sonnet"]:::her --> H4["T3/T4  Debate\nfeedback-loop.ts"]:::her
    end

    subgraph OUT["⑥ Evaluation UI  ·  Next.js Frontend"]
        direction LR
        O1["HeraldResults"]:::fe ~~~ O2["TierProgress"]:::fe ~~~ O3["HumanReviewQueue"]:::fe ~~~ O4["useHerald"]:::fe
    end

    subgraph OBS["Observability"]
        direction LR
        OB1["Braintrust\nLLM · tools · tiers"]:::obs ~~~ OB2["OpenTelemetry\nlatency · tokens"]:::obs
    end

    N1          -->|"topic + context"| A2
    A3          <-->|"tool calls / results"| M1
    A4          --> R1 & R2
    R4          -->|"HTTP /api/herald"| B1
    B1          -->|"evaluation requests"| H1
    H4          --> O1
    H4          -.->|"invalid + feedback"| A2
    AGT & HER   -.->|"spans"| OB1
    INPUT & BE  -.->|"spans"| OB2
```

---

## Diagram 3e — Detailed Technical Architecture (Condensed & Balanced)

```mermaid
flowchart LR
    classDef fe    fill:#2563eb,color:#fff,stroke:#1d4ed8
    classDef agent fill:#059669,color:#fff,stroke:#047857
    classDef mcp   fill:#0f172a,color:#94a3b8,stroke:#334155
    classDef her   fill:#dc2626,color:#fff,stroke:#b91c1c
    classDef py    fill:#7c3aed,color:#fff,stroke:#6d28d9
    classDef obs   fill:#4b5563,color:#fff,stroke:#374151
    classDef art   fill:#1e40af,color:#fff,stroke:#93c5fd,stroke-dasharray:4 2

    subgraph IN["① Input  ·  Next.js"]
        direction TB
        N1["InputForm"]:::fe
        N2["AgentProgress\nuseWebSocket"]:::fe
        N3["useAgent"]:::fe
        N1 ~~~ N2 ~~~ N3
    end

    subgraph AGT["② Research Agent  ·  Groq Llama 3.3 70B"]
        direction TB
        A1["prompt-assembler"]:::agent
        A2["research-agent\nloop-controller  ·  max 25 calls"]:::agent
        A3["claim-extractor\n6 types  ·  4 derivation methods"]:::agent
        A4["memo-writer"]:::agent
        A1 --> A2 --> A3 --> A4
    end

    subgraph MCP["MCP Tool Registry  ·  8 Tools  ·  retry + timeout"]
        direction LR
        M1["web-search  ·  arXiv\nWorld Bank  ·  Scholar"]:::mcp
        M2["GovReport  ·  GovInfo\nFRED  ·  file-reader"]:::mcp
        M1 ~~~ M2
    end

    subgraph REV["③ Memo Review  ·  Next.js"]
        direction TB
        R1["Policy Memo"]:::art
        R2[("Notes Log")]:::art
        R3["MemoViewer  ·  NotesLog"]:::fe
        R4["ClaimSelector"]:::fe
        R1 ~~~ R2
        R1 & R2 --> R3 --> R4
    end

    subgraph BE["④ Python Backend  ·  FastAPI"]
        direction TB
        B1["/api/herald  ·  /api/memos\n/api/health"]:::py
        B2[("PostgreSQL\nmemos  ·  claims  ·  evaluations")]:::py
        B3["Redis  ·  Alembic"]:::py
        B1 --> B2 & B3
    end

    subgraph HER["⑤ HERALD Pipeline  ·  TypeScript + Python"]
        direction TB
        H1["Router\n3 routing paths by claim type"]:::her
        H2["T1  NLI  ·  DeBERTa\nentailment  ·  neutral  ·  contradiction"]:::her
        H3["T2  LLM Judge  ·  Claude Sonnet\naccuracy  ·  completeness  ·  validity"]:::her
        H4["T3  Debate  +  T4  Human Review\nfeedback-loop  ·  max 2 revisions"]:::her
        H1 --> H2 --> H3 --> H4
    end

    subgraph OUT["⑥ Evaluation UI  ·  Next.js"]
        direction TB
        O1["HeraldResults\nTierProgress"]:::fe
        O2["HumanReviewQueue"]:::fe
        O3["useHerald"]:::fe
        O1 ~~~ O2 ~~~ O3
    end

    subgraph OBS["Observability"]
        direction LR
        OB1["Braintrust\nLLM  ·  tools  ·  claims  ·  tiers"]:::obs
        OB2["OpenTelemetry\nlatency  ·  token usage"]:::obs
        OB1 -.- OB2
    end

    N1          -->|"topic + context"| A1
    A2          <-->|"tool calls / results"| M1
    A4          --> R1 & R2
    R4          -->|"HTTP /api/herald"| B1
    B1          -->|"evaluation requests"| H1
    H4          --> O1
    H4          -.->|"invalid + feedback\nmax 2 attempts"| A2
    AGT & HER   -.->|"spans"| OB1
    IN  & BE    -.->|"spans"| OB2
```

---

## Diagram 3f — Detailed Technical Architecture (Vertical & Concise)

```mermaid
flowchart TB
    classDef fe    fill:#2563eb,color:#fff,stroke:#1d4ed8
    classDef agent fill:#059669,color:#fff,stroke:#047857
    classDef mcp   fill:#0f172a,color:#94a3b8,stroke:#334155
    classDef her   fill:#dc2626,color:#fff,stroke:#b91c1c
    classDef py    fill:#7c3aed,color:#fff,stroke:#6d28d9
    classDef obs   fill:#4b5563,color:#fff,stroke:#374151
    classDef art   fill:#1e40af,color:#fff,stroke:#93c5fd,stroke-dasharray:4 2

    subgraph IN["① User Input"]
        direction LR
        N1["Input\nForm"]:::fe ~~~ N2["Agent\nProgress"]:::fe ~~~ N3["useAgent\nuseWebSocket"]:::fe
    end

    subgraph AGT["② Research Agent  ·  Groq Llama 3.3 70B"]
        direction LR
        A1["Prompt\nBuilder"]:::agent --> A2["Research\nLoop"]:::agent --> A3["Claim\nExtractor"]:::agent --> A4["Memo\nWriter"]:::agent
    end

    subgraph MCP["MCP Tools  ·  8 Sources"]
        direction LR
        M1["Web Search\narXiv"]:::mcp ~~~ M2["World Bank\nScholar"]:::mcp ~~~ M3["GovReport\nGovInfo"]:::mcp ~~~ M4["FRED\nFiles"]:::mcp
    end

    subgraph REV["③ Memo Review"]
        direction LR
        R1["Policy\nMemo"]:::art ~~~ R2[("Notes\nLog")]:::art ~~~ R3["Memo\nViewer"]:::fe ~~~ R4["Claim\nSelector"]:::fe
    end

    subgraph BE["④ Python Backend  ·  FastAPI"]
        direction LR
        B1["API\nRoutes"]:::py ~~~ B2[("PostgreSQL")]:::py ~~~ B3["Redis\nAlembic"]:::py
    end

    subgraph HER["⑤ HERALD Pipeline  ·  TypeScript + Python"]
        direction LR
        H1["Router"]:::her --> H2["T1  NLI\nDeBERTa"]:::her --> H3["T2  Judge\nClaude Sonnet"]:::her --> H4["T3 Debate\nT4 Human"]:::her
    end

    subgraph OUT["⑥ Evaluation UI"]
        direction LR
        O1["Herald\nResults"]:::fe ~~~ O2["Tier\nProgress"]:::fe ~~~ O3["Human\nQueue"]:::fe ~~~ O4["use\nHerald"]:::fe
    end

    subgraph OBS["Observability"]
        direction LR
        OB1["Braintrust\nAll LLM & Tool Traces"]:::obs ~~~ OB2["OpenTelemetry\nLatency & Tokens"]:::obs
    end

    N1          -->|"topic"| A1
    A2          <-->|"tool calls"| M1
    A4          --> R1 & R2
    R4          -->|"/api/herald"| B1
    B1          -->|"evaluate"| H1
    H4          --> O1
    H4          -.->|"feedback"| A2
    AGT & HER   -.->|"spans"| OB1
    IN  & BE    -.->|"spans"| OB2
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

---

## Diagram 4b — HERALD Framework (Condensed)

```mermaid
flowchart TD
    classDef entry   fill:#1e293b,color:#f8fafc,stroke:#475569
    classDef router  fill:#334155,color:#f8fafc,stroke:#64748b
    classDef t1      fill:#1d4ed8,color:#fff,stroke:#93c5fd
    classDef t2      fill:#b45309,color:#fff,stroke:#fcd34d
    classDef t3      fill:#065f46,color:#fff,stroke:#6ee7b7
    classDef t4      fill:#7c2d12,color:#fff,stroke:#fca5a5
    classDef valid   fill:#14532d,color:#fff,stroke:#86efac
    classDef invalid fill:#7f1d1d,color:#fff,stroke:#fca5a5
    classDef revise  fill:#1e3a5f,color:#fff,stroke:#93c5fd,stroke-dasharray:4 2

    CLAIM(["📋 Claim from Notes Log\nclaim_text · claim_type · sources"]):::entry

    CLAIM --> ROUTER{{"🔀 Router\nroute by claim_type"}}:::router

    ROUTER -->|"Statistical · Comparative\nthreshold 0.90"| T1
    ROUTER -->|"Causal\nthreshold 0.85"| T1
    ROUTER -->|"Predictive · Normative\nSynthesis — skip NLI"| T2

    T1["🔵 Tier 1 — NLI Model\nDeBERTa-v3-large-mnli\nentailment · neutral · contradiction"]:::t1
    T2["🟠 Tier 2 — LLM Judge\nClaude Sonnet\naccuracy · completeness · validity"]:::t2
    T3["🟢 Tier 3 — Multi-Agent Debate\nExpert · Methodologist · Skeptic\n→ Judge synthesis"]:::t3
    T4["🔴 Tier 4 — Human Review\nclaim + sources + prior tier outputs"]:::t4

    T1 -->|"confident verdict"| VERDICT
    T1 -->|"uncertain"| T2
    T2 -->|"confidence > 0.85"| VERDICT
    T2 -->|"confidence ≤ 0.85"| T3
    T3 -->|"consensus reached"| VERDICT
    T3 -->|"no consensus"| T4
    T4 --> VERDICT

    VERDICT{{"⚖️ Verdict"}}:::router

    VERDICT -->|"✅ valid"| DONE(["Memo + Notes Log updated\nmark resolved"]):::valid
    VERDICT -->|"❌ invalid · attempt < 2"| REVISE["Agent revision\noriginal claim + HERALD feedback\n→ re-enter HERALD"]:::revise
    VERDICT -->|"❌ invalid · attempt ≥ 2"| FLAG(["requires_human_intervention\nsurface in UI ⚠"]):::invalid

    REVISE -->|"revised claim"| ROUTER
```
