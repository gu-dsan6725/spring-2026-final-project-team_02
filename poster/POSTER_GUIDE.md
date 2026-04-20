# Poster Guide — Policy Memo Agent & HERALD

**Format**: 48" × 36" landscape (standard conference)  
**Submission deadline**: Friday, April 24, 2026 (PDF)  
**Used at**: Poster session following the April 28 presentations  
**Walkthrough target**: 3 minutes verbal — a stranger should understand the project in one pass

---

## What a Poster Is (and Is Not)

A poster is not a condensed version of your slides. It is a **standalone artifact** — someone walks up without context, reads it in under 2 minutes, and leaves understanding what you built and what you found. Design for the person who will NOT get a verbal walkthrough from you.

The 3-minute verbal walkthrough is a bonus, not the primary communication channel.

---

## Layout: 7-Panel Grid

Use a standard 3-column, landscape layout. The reading order is left-to-right, top-to-bottom within each column.

```
┌─────────────────┬───────────────────────────┬─────────────────┐
│                 │                           │                 │
│   HEADER        │   HEADER (continued)      │   HEADER        │
│   (full width across all 3 columns)        │                 │
│                 │                           │                 │
├─────────────────┼───────────────────────────┼─────────────────┤
│                 │                           │                 │
│  Panel 1        │  Panel 3                  │  Panel 5        │
│  Problem &      │  HERALD Framework         │  Benchmark      │
│  Motivation     │  (largest panel)          │  Results        │
│                 │                           │                 │
├─────────────────┼───────────────────────────┼─────────────────┤
│                 │                           │                 │
│  Panel 2        │  Panel 4                  │  Panel 6        │
│  System         │  Claim Taxonomy &         │  Conclusions    │
│  Architecture   │  Routing Table            │  & QR Code      │
│                 │                           │                 │
└─────────────────┴───────────────────────────┴─────────────────┘
```

**Column widths**: Left 28%, Center 44%, Right 28%.  
The center column is wider because it holds the two most complex panels (HERALD pipeline and Claim Taxonomy).

---

## Header (Full Width)

**Height**: ~10% of total poster height (~3.6")

**Content**:
- **Title**: Policy Memo Writing Agent with HERALD Evaluation
- **Subtitle** (smaller): *Hierarchical Evidence Review and Automated Legitimacy Detection*
- **Team**: Team name / Georgetown University DSAN 6725 / April 2026
- **One-sentence abstract**: *An AI agent that researches policy topics, generates structured memos with full claim provenance, and validates every claim through a type-aware 4-tier evaluation pipeline.*

**Design**: University color scheme. Title in 72pt+. Subtitle in 40pt. Institution/team line in 28pt. Left-align or center — pick one and be consistent.

---

## Panel 1 — Problem & Motivation

**Size**: ~28% width × ~40% height  
**Target reading time**: 20 seconds

**Content**:

**The Problem**  
Policy memos rely on dozens of factual claims. Common failure modes:
- Numeric misreporting (e.g., citing 4.2% when source says 3.9%)
- Causal overclaiming (source shows correlation, claim asserts causation)
- Unsupported synthesis (conclusion not entailed by any cited source)

Manual verification of every claim is too slow at scale. No existing tool validates claims by *type* with structured source provenance.

**Why It Matters**  
Policy decisions downstream of flawed memos have real consequences. A systematic validation layer reduces researcher error before publication.

**Design notes**:
- 3 bullet points max under each heading
- Consider a small 2-column "claim vs. source" contrast box — e.g.:

| Claim | Source says |
|-------|------------|
| "HIV prevalence: 4.2%" | "3.9% [3.3–4.6%]" |
| "Cash transfers *cause* enrollment gains" | "...were *associated with*..." |

This makes the problem concrete in 5 seconds.

---

## Panel 2 — System Architecture

**Size**: ~28% width × ~40% height  
**Target reading time**: 30 seconds

**Content**: A simplified version of Diagram 3e from `slides/diagrams.md`.

Simplify aggressively for poster scale — the full diagram is too dense. Use a vertical stack of 4 labeled boxes with arrows:

```
┌─────────────────────────┐
│  UI  (Next.js + React)  │
│  InputForm → MemoViewer │
│  → ClaimSelector        │
└────────────┬────────────┘
             ↓
┌─────────────────────────┐
│  Research Agent          │
│  Groq Llama 3.3 70B      │
│  8 MCP Tools             │
│  → Notes Log + Memo     │
└────────────┬────────────┘
             ↓
┌─────────────────────────┐
│  HERALD Pipeline         │
│  Tier 1→2→3→4           │
│  Feedback Loop (max 2x) │
└────────────┬────────────┘
             ↓
┌─────────────────────────┐
│  Backend                 │
│  FastAPI + PostgreSQL   │
│  + Braintrust tracing   │
└─────────────────────────┘
```

Include one horizontal row of MCP tool icons or labels beneath the Research Agent box:  
`Web Search · arXiv · World Bank · FRED · Semantic Scholar · GovReport · GovInfo · Files`

**Design notes**: Use color bands — blue for UI, green for Agent, red for HERALD, purple for Backend. These match `diagrams.md` color conventions. Keep font size ≥ 18pt for all text in this panel.

---

## Panel 3 — HERALD Framework (Center, Large)

**Size**: ~44% width × ~40% height — the visual anchor of the poster  
**Target reading time**: 45 seconds

This is the main intellectual contribution. Give it space.

**Content**: Use Diagram 4b (HERALD condensed) from `slides/diagrams.md` as the base, adapted for print.

The diagram should show:
1. A claim entering the Router
2. Three left-branching paths by claim type:
   - Statistical/Comparative/Causal → **Tier 1 (NLI, DeBERTa)**
   - Predictive/Normative/Synthesis → skip to **Tier 2**
3. Tier 1 → exits on confidence (0.90 / 0.85) or escalates to Tier 2
4. **Tier 2 (Claude Sonnet)** → 4-dimension evaluation → exits on confidence > 0.85 or escalates
5. **Tier 3 (Multi-Agent Debate)** → 3 personas in parallel (Domain Expert · Methodologist · Skeptic) → Judge synthesis → exits or escalates
6. **Tier 4 (Human Review)** → final arbiter
7. Invalid verdict → **Revision Agent** → re-enter (max 2 attempts)
8. Valid verdict → **Memo Updated**

Below the diagram, add a compact decision table:

| Tier | Model | Exits When |
|------|-------|-----------|
| 1 — NLI | DeBERTa (local, free) | Confidence ≥ 0.90 / 0.85 |
| 2 — Judge | Claude Sonnet | Confidence > 0.85 |
| 3 — Debate | Groq Llama 3.3 70B ×4 | Consensus or judge > 0.80 |
| 4 — Human | — | Always exits |

**Design notes**: This panel will likely be the first thing people read after the title. Make the diagram large enough to be legible from 4 feet away. Minimum font size 16pt. Use the same tier color coding as the UI (if possible, include a screenshot thumbnail of the TierProgress component).

---

## Panel 4 — Claim Taxonomy & Routing

**Size**: ~44% width × ~40% height

**Content**: The 6 claim types with their routing rationale. This explains *why* HERALD is designed the way it is.

| Type | Example | HERALD Start | Why |
|------|---------|-------------|-----|
| **Statistical** | "Mortality: 1,140 per 100k" | Tier 1 (0.90) | NLI checks entailment well |
| **Comparative** | "CCTs > fee waivers on enrollment" | Tier 1 (0.90) | NLI checks entailment well |
| **Causal** | "Subsidy removal *caused* cost increase" | Tier 1 (0.85) | NLI catches misquotes; misses correlation traps |
| **Predictive** | "Demand projected to exceed supply by 2032" | Tier 2 | NLI cannot evaluate predictions |
| **Normative** | "Multi-stakeholder governance is best practice" | Tier 2 | NLI cannot evaluate prescriptions |
| **Synthesis** | "Declining enrollment + child labor → subsidies failed" | Tier 2 | No single source entails a synthesis |

Below the table, add a 2-row label strip for derivation methods:

**Derivation Risk:**  
`direct_extraction` (Low) → `paraphrase` (Low) → `cross_source` (Medium) → `agent_inference` (High ⚠)

Agent inferences are pre-selected for evaluation regardless of claim type.

**Design notes**: The table is the content. Don't pad it with prose. Use row shading to group Tier 1 types (rows 1–3) vs. Tier 2 types (rows 4–6).

---

## Panel 5 — Benchmark Results

**Size**: ~28% width × ~40% height  
**Target reading time**: 25 seconds

**Headline**: 84% overall accuracy across 50 ground-truth claims

**Main chart**: A horizontal bar chart of F1 by claim type. This is more scannable than a table at poster scale.

```
Statistical  ████████████████████ 100%
Causal       ████████████████████ 100%
Comparative  ████████████████████ 100%
Predictive   █████████████████░░░  86%
Normative    █████████████░░░░░░░  67%
Synthesis    ░░░░░░░░░░░░░░░░░░░░   0%  ← open problem
```

Below the chart, 3 bullet findings:
- **Perfect on well-defined claims**: statistical, causal, comparative reach 100% F1
- **Synthesis gap**: 62.5% false-invalid rate — system is too skeptical of agent inferences; root cause is prompt design, not pipeline flaw
- **7 benchmark runs** with iterative prompt tuning; normative improved from 25% → 67% F1 across runs

**Design notes**: Use green for ≥ 90%, amber for 60–89%, red for < 60%. The synthesis bar should be visually alarming — that's honest and interesting. Do not hide it. Reviewers who see you acknowledge a limitation will trust your 100% results on the other types.

---

## Panel 6 — Conclusions & QR Code

**Size**: ~28% width × ~40% height

**Content** (split into three sub-blocks):

**Contributions**
1. Type-aware claim evaluation — 6 taxonomic types, each routed to the correct evaluation method
2. Structured provenance — notes log built at research time, not scraped after
3. Multi-tier escalation — NLI for speed, debate for ambiguity, human for irreducible uncertainty
4. 84% accuracy with a clear path to closing the synthesis gap

**Limitations & Next Steps**
- Synthesis/normative prompts need refinement (skeptical default posture)
- Eval set expanding from 50 → 104 claims for per-type statistical validity
- Formal experiment: HERALD vs. LLM-as-Judge baseline (System A/B/C), protocol in `experiment-design.md`

**QR Code**  
Place a QR code linking to the GitHub repository in the bottom-right corner.  
Label it: *"Code, eval set, benchmark results"*

Optionally add a second QR code linking to a 2-minute demo video if you have one.

**Design notes**: The QR code should be at least 1.5" × 1.5" to scan reliably from arm's length. Use a URL shortener (e.g., `git.io` or `bit.ly`) so the raw URL is also human-readable below the QR code.

---

## Typography & Design

**Font sizes** (minimum at 48"×36"):
- Title: 72–84pt
- Panel headings: 40–48pt
- Body text: 22–28pt
- Table cells: 18–22pt
- Captions: 16pt

**Never go below 16pt** — it won't be readable at arm's length.

**Fonts**: Use two at most. A sans-serif for headings (e.g., Inter, Helvetica, Source Sans) and the same or a complementary sans for body. Avoid serif fonts for technical content.

**Color conventions** (match `diagrams.md`):
- Blue: UI layer
- Green: Research Agent
- Red: HERALD pipeline
- Purple: Backend/database
- Amber/orange: warnings or open problems (synthesis gap)
- Gray: infrastructure/observability

**Whitespace**: Leave ~0.5" margins around each panel. Panels that touch each other look crowded at print scale.

**Background**: White or very light gray. Avoid dark backgrounds — they print badly and reduce contrast for text.

---

## Tooling Recommendations

| Tool | Notes |
|------|-------|
| **Canva** (free) | Fastest for a team. Has 48×36 poster template. Drag-and-drop. Export PDF. |
| **Google Slides** | Set custom slide size to 48"×36". Export → PDF. Easy collaboration. |
| **PowerPoint** | Same as Google Slides. Design → Slide Size → Custom. |
| **Figma** | Best design control. Use the 48"×36" frame. Free tier sufficient. |
| **LaTeX (beamerposter)** | Best for academic formatting, hardest to use. Only if someone on the team knows it. |

**For diagrams**: Export Mermaid diagrams from `slides/diagrams.md` as SVG via [mermaid.live](https://mermaid.live). Import SVG into your poster tool — SVG scales without pixelation at any print size.

**Print resolution**: Export at 150–300 DPI for a 48"×36" poster. At 150 DPI that is 7200×5400 pixels. At 300 DPI it is 14400×10800 pixels. Most print shops accept 150 DPI for posters viewed at arm's length.

---

## 3-Minute Verbal Walkthrough Script

When someone stops at your poster, use this flow:

> **"The problem"** (20 sec): Policy researchers write memos with dozens of claims — statistics, causal claims, predictions. Manually checking every claim against its source is too slow. And not all claims are the same: you can check a number with a text comparison, but you can't check 'this policy *should* be implemented' the same way.

> **"What we built"** (30 sec): An AI agent that researches a topic using 8 external sources, generates a policy memo, and tracks *provenance* for every claim — which source, which excerpt, how the claim was derived. That feeds into HERALD — a 4-tier pipeline. [point to Panel 3]

> **"HERALD"** (60 sec): Claims are routed by type. Statistical claims get checked with a local NLI model — fast and free. Causal and synthesis claims get escalated to an LLM judge, then to a 3-persona debate if the judge is uncertain. Every tier produces structured feedback the agent can use to revise the claim.

> **"Results"** (30 sec): 84% overall accuracy on our 50-claim eval set. Perfect on well-defined types — statistical, causal, comparative. Synthesis is the open problem — [point to bar chart] — the system is too skeptical of agent inferences. We know the fix, it's a prompt tuning issue.

> **"What's next"** (20 sec): We're running a formal experiment comparing HERALD to a single LLM-as-judge call — does the multi-tier design actually improve accuracy per dollar? The protocol is ready, the eval set is expanding to 104 claims.

Pause here and let them ask questions. Don't rush to fill silence.

---

## Checklist Before Printing

- [ ] All text ≥ 16pt — zoom out to 25% and check readability
- [ ] All diagrams exported as SVG from `mermaid.live` (not screenshot PNG)
- [ ] Benchmark numbers match `results/benchmark-2026-04-19.5.json`
- [ ] QR code tested on 3 different phones before printing
- [ ] PDF exported at correct dimensions: 48" × 36" (4320pt × 2592pt at 90 DPI, or use px equivalents your tool shows)
- [ ] No panel text is cut off at edges (check with 0.5" margin guide)
- [ ] Color-blind safe: don't rely on red/green alone — use fill pattern or label text as backup
- [ ] Submitted to print shop with at least 24-hour lead time before April 28
