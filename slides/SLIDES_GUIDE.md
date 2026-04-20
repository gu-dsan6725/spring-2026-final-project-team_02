# Slides Guide — Policy Memo Agent & HERALD

**Presentation**: Tuesday, April 28, 2026 — 10 min talk + 5 min Q&A  
**Submission deadline**: Friday, April 24, 2026  
**Format**: 15–20 slides, PDF or Google Slides  
**Grading weight**: Communication 15%, but Technical Depth (35%) and Evaluation Rigor (25%) are won or lost here

---

## Time Budget

| Section | Slides | Time |
|---------|--------|------|
| Problem + Solution | 2 | ~1.5 min |
| Architecture | 2 | ~2 min |
| HERALD Deep Dive | 3 | ~2.5 min |
| Results | 2 | ~1.5 min |
| Demo | — | ~2 min (live or video) |
| Conclusion | 1 | ~30 sec |
| **Total** | **~10** | **10 min** |

10 minutes is short. Every slide must earn its place. Cut anything that is already visible on a diagram.

---

## Slide-by-Slide Breakdown

---

### Slide 1 — Title

**Content:**
- Title: *Policy Memo Writing Agent with HERALD Evaluation*
- Team name, course, date
- One-line tagline: *"AI-powered policy research with claim-level provenance and multi-tier validation"*

**Design**: Clean. No bullet points. Add a small screenshot of the UI (Phase 3 Memo Viewer with inline claim markers is visually striking).

---

### Slide 2 — The Problem

**Content (3 bullets max):**
- Policy researchers write memos with dozens of claims — many unsupported, causal when sources only show correlation, or quantitatively misreported
- Manual source verification is too slow at scale
- No existing tool validates claims *by type* with structured provenance

**What NOT to include**: Generic "AI is transforming everything" framing. Be specific and concrete.

**Speaker note**: Open with one real example. The Kenya HIV prevalence claim in our eval set (`GT-002`) is perfect — the agent wrote 4.2% but the source says 3.9%. That's a real policy memo error. Use it.

---

### Slide 3 — Solution: 4-Phase Overview

**Content**: The 4-phase pipeline as a clean flow diagram.

**Use**: Diagram 1 from `slides/diagrams.md` (the simple 4-phase flowchart). Keep it high-level here — details come later.

```
[Phase 1: User Input]
  → [Phase 2: Research Agent + 8 MCP Tools]
  → [Phase 3: User Reviews Memo + Claims]
  → [Phase 4: HERALD Evaluation]
       ↑____________ Revision feedback loop ____________|
```

**Talking point**: The key innovation is not that we generate a memo — it's that every claim carries structured provenance (claim type, source, relevant chunk, derivation method) and feeds into a type-aware evaluation pipeline. Emphasize the feedback loop.

---

### Slide 4 — System Architecture

**Content**: Full system diagram showing all layers.

**Use**: Diagram 3e (condensed & balanced) from `slides/diagrams.md`. This diagram already shows:
- UI layer (Next.js, React hooks, WebSocket)
- Agent layer (Groq Llama 3.3 70B, 8 MCP tools, loop controller)
- HERALD layer (Tier 1–4, router, feedback loop)
- Backend layer (FastAPI, PostgreSQL, Redis)
- Observability (Braintrust, OpenTelemetry)

**One talking point per layer** — don't read the diagram. Just point and say what each layer does in one sentence.

---

### Slide 5 — The Research Agent

**Content:**
- Model: Groq Llama 3.3 70B with function calling
- Budget: max 25 tool calls, 50,000 tokens per memo
- 8 MCP tools: Web Search, arXiv, World Bank, FRED, Semantic Scholar, GovReport, GovInfo, File Reader
- Agent creates a research plan *before* executing queries
- Outputs two things: the policy memo AND the structured notes log

**Design**: A small table of the 8 tools with one-line descriptions is cleaner than a bullet list.

**Key point to land**: The notes log is built *during* research, not scraped after. The agent knows which source informed which claim at write-time. Post-hoc attribution loses this.

---

### Slide 6 — The Notes Log (Provenance)

**Content**: Show a real notes log entry. Use `pipeline-output/notes-log.json`.

Format it as a truncated code block:
```json
{
  "claim_id": "C-003",
  "claim_text": "Cash transfer programs have shown stronger effects on school enrollment...",
  "claim_type": "comparative",
  "derivation": "cross_source",
  "sources": [{ "relevant_chunk": "..." }],
  "reasoning": "Cross-source comparison synthesizing effect sizes..."
}
```

**Key point**: The `claim_type` and `derivation` fields are what HERALD uses to route evaluation. This schema is the contract between the agent and the evaluation pipeline.

---

### Slide 7 — Claim Taxonomy: Why Type Matters

**Content**: The 6 claim types mapped to their HERALD starting tier.

| Claim Type | Example | Starts At |
|------------|---------|-----------|
| Statistical | "Mortality in Chad: 1,140 per 100,000" | Tier 1 (NLI) |
| Comparative | "CCTs show stronger enrollment effects than fee waivers" | Tier 1 (NLI) |
| Causal | "Fuel subsidy removal caused 15% transport cost increase" | Tier 1 (NLI, 0.85 threshold) |
| Predictive | "Water demand projected to exceed supply by 2032" | Tier 2 (LLM Judge) |
| Normative | "Multi-stakeholder governance is considered best practice" | Tier 2 (LLM Judge) |
| Synthesis | "Declining enrollment + rising child labor suggest subsidies failed" | Tier 2 (LLM Judge) |

**Key point to land**: NLI can check whether a source *entails* a number or comparison. It cannot assess whether a projection is properly conditioned, or whether a synthesis follows logically. Type determines evaluation method — that's the core design insight.

---

### Slide 8 — HERALD Pipeline

**Content**: The 4-tier escalation flow.

**Use**: Diagram 4b (HERALD condensed) from `slides/diagrams.md`.

Walk through the flow verbally:
1. **Tier 1 — NLI (DeBERTa, local/free)**: Entailment check. Source chunk as premise, claim as hypothesis. Exits on confidence ≥ 0.90 (stat/comp) or 0.85 (causal). Contradiction → INVALID immediately.
2. **Tier 2 — LLM Judge (Claude Sonnet)**: 4-dimension evaluation — accuracy, relevance, completeness, + type-specific check (causal mechanism? comparison fairness? projection conditionality? genuine consensus?). Exits on confidence > 0.85.
3. **Tier 3 — Multi-Agent Debate (Groq Llama 3.3 70B)**: 3 personas run in parallel — Domain Expert, Methodologist, Skeptic. Judge synthesizes. Exits on consensus or judge confidence > 0.80.
4. **Tier 4 — Human Review**: For claims no tier could resolve confidently.

**Key point**: Early exit design means simple claims (clear entailment) cost almost nothing. Only genuinely ambiguous claims reach Tier 3. This is what makes the pipeline practical.

---

### Slide 9 — Feedback Loop

**Content**: The revision cycle.

```
Invalid verdict
    ↓
HERALD feedback + suggested revision
    ↓
Revision agent rewrites claim (Groq Llama + full feedback as context)
    ↓
Re-enter HERALD pipeline
    ↓
Max 2 attempts → flag requires_human_intervention
```

Show the HERALD output schema (abbreviated):
```json
{
  "verdict": "invalid",
  "tier_reached": 3,
  "feedback": "Multi-agent debate identified a logical gap...",
  "suggested_revision": "Consider revising to: '...'"
}
```

**Key point**: Feedback is structured, not freeform. Every tier produces a revision-ready output. The agent receives exactly what it needs to fix the claim.

---

### Slide 10 — Benchmark Results

**Content**: Results from the 7 benchmark runs against `data/eval-set.json` (50 ground-truth claims).

**Headline number**: **84% overall accuracy**

| Claim Type | F1 | Verdict |
|------------|----|---------|
| Statistical | 100% | ✓ Perfect |
| Causal | 100% | ✓ Perfect |
| Comparative | 100% | ✓ Perfect |
| Predictive | 86% | ~ Good |
| Normative | 67% | ⚠ Needs tuning |
| Synthesis | 0% | ✗ Open problem |

**Do not hide the synthesis gap.** It is the most interesting finding. Own it.

**What drove it**: The system is too aggressive for synthesis claims — 62.5% false-invalid rate (valid synthesis claims rejected). Root cause: the judge defers to source-checking logic instead of evaluating whether the *inference* follows. This is a prompt tuning problem, not a pipeline flaw.

---

### Slide 11 — Evaluation Rigor (Methodology)

**Content**: Brief overview of how results were produced — this earns the 25% Evaluation Rigor grade.

- **Eval set**: 50 ground-truth claims across all 6 types, balanced valid/invalid (24/26), with curated adversarial cases ("SKEPTIC TRAPS" — valid claims designed to look suspicious)
- **Metrics**: Accuracy, Precision, Recall, F1, False-Invalid Rate (FIR), False-Valid Rate (FVR)
- **7 benchmark runs** with iterative prompt tuning between runs (documented in `docs/running-notes.md` and `docs/benchmark-notes/`)
- **Planned**: Full HERALD vs. LLM-as-Judge experiment (System A/B/C) — experiment protocol in `experiment-design.md`, scripts in `experiment-scripts/`

**Note the limitation honestly**: 50 claims is enough for overall accuracy; per-type cells as small as n=3 are directional only. Eval set expanding to 104 claims for final analysis.

---

### Slide 12 — Live Demo

**No slide content** — switch to the running system.

**Demo script (2 minutes)**:
1. **Phase 1** (15 sec): Submit a topic. Use a pre-tested topic, e.g., *"Education subsidy programs in Sub-Saharan Africa"*. Show the form fields (topic, background, optional source URL).
2. **Phase 2** (30 sec): Watch the agent research in real time. Point out the tool call log (Web Search → arXiv → World Bank). Show token budget counting down.
3. **Phase 3** (30 sec): Memo appears with inline colored claim markers. Click one marker — show the NotesLog panel opening with source provenance. Point out the claim type badge.
4. **Phase 4** (30 sec): Select 2–3 claims (pre-select a synthesis claim and a statistical one). Run HERALD. Show TierProgress visualization — one exits at Tier 1, the synthesis escalates to Tier 3.
5. **Export** (10 sec): Hit Export → Markdown. Done.

**If live demo fails**: Have a pre-recorded 2-minute video ready. Also have `pipeline-output/memo.md` and `pipeline-output/HERALD-report.json` open in tabs as a static fallback.

**Do not run the demo for the first time in front of the audience.** Test it the day before with the actual laptop you'll be presenting from.

---

### Slide 13 — Tech Stack

**Content**: One-paragraph summary formatted as a clean table.

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 + React 19 + TypeScript + Tailwind CSS |
| Research Agent | Groq Llama 3.3 70B (function calling, 8 MCP tools) |
| HERALD Tier 1 | DeBERTa-v3-large-mnli (local, HuggingFace Transformers) |
| HERALD Tier 2 | Claude Sonnet (Anthropic API) |
| HERALD Tier 3 | Groq Llama 3.3 70B (3 parallel personas + judge) |
| Backend | FastAPI (Python) + PostgreSQL + Redis |
| Observability | Braintrust (LLM traces) + OpenTelemetry |
| Quality Gates | Husky + ESLint + Ruff + mypy + pytest + GitHub Actions |

**Key justification to mention**: Tier 1 is local/free (DeBERTa) specifically to make simple claim checks cost-zero. Tier 3 uses Groq (fast inference) not Anthropic because 3 parallel debate calls need low latency. Tier 2 uses Claude Sonnet because the 4-dimension judge prompt needs stronger instruction-following.

---

### Slide 14 — Conclusion

**Content:**
- **What we built**: End-to-end system that generates policy memos with claim provenance and validates claims through type-aware multi-tier evaluation
- **What works**: Perfect accuracy on well-defined claim types (statistical, causal, comparative)
- **What's next**: Synthesis/normative prompt refinement, expand eval set to 104 claims, run full A/B/C cost experiment
- **Broader relevance**: The HERALD routing design applies to any structured fact-checking task — news articles, scientific preprints, legal briefs

**One sentence for close**: *"We built a system that treats each claim as a typed object with provenance, and evaluates it accordingly — not as undifferentiated text."*

---

## What to Cut if You're Over Time

Cut in this order:
1. Slide 11 (Evaluation Rigor) — compress into 3 bullets on Slide 10
2. Slide 6 (Notes Log) — mention the schema verbally during Slide 5
3. Slide 13 (Tech Stack) — cut to 5 seconds or remove entirely

Do NOT cut Slides 7, 8, or 10. The taxonomy, the HERALD pipeline, and the results are the intellectual core of this project.

---

## Q&A Preparation

Anticipate these questions:

**"Why not just use GPT-4 to check every claim?"**  
Single-call LLM evaluation is System B in our experiment design. The cost-adjusted F1 comparison is exactly what our experiment measures. The claim is: NLI handles 40–60% of statistical/comparative claims for free, which means Tier 3's 4-call cost only applies to genuinely uncertain cases. We have a formal experiment ready to quantify this.

**"How do you know your ground truth labels are correct?"**  
Each eval entry has a written rationale (`ground_truth_rationale`), and adversarial cases are labeled "SKEPTIC TRAP" with explicit justification for why a skeptic challenge fails. Labels were reviewed against the actual source chunks. Where all three systems disagree with the label, we flag for re-review.

**"What happens when a source is wrong or biased?"**  
HERALD validates *claim-to-source fidelity*, not source quality. If a source itself is wrong, HERALD would call the claim valid (it accurately represents the bad source). Source quality is a separate problem — it's partially addressed by using multiple sources (cross_source derivation) and by the Methodologist persona in Tier 3 who evaluates study design.

**"Why does synthesis have 0% F1?"**  
The judge is using source-entailment logic for claims that are, by definition, not entailed by any single source. We've identified the prompt fix (add a skeptical default posture for synthesis, explicitly instruct the judge to evaluate *logical validity of the inference* rather than source coverage). This is in the tuning backlog.

**"Is this production-ready?"**  
The pipeline and evaluation logic are production-quality. Tier 4 human review is in-memory (no database persistence yet). E2E integration tests are not written. We would not call it production-ready, but it is well beyond a demo — it has real benchmarks, quality gates, and CI/CD.

---

## Diagrams Reference

All diagrams are in `slides/diagrams.md` as Mermaid source. Render them before the submission deadline.

| Diagram | Best For |
|---------|---------|
| Diagram 1 | Slide 3 (4-phase overview) |
| Diagram 3e | Slide 4 (full architecture) |
| Diagram 4b | Slide 8 (HERALD condensed) |
| Diagram 4 (detailed) | Backup / paper figure |

To render Mermaid diagrams: paste into [mermaid.live](https://mermaid.live) or use the Mermaid plugin in VS Code. Export as SVG for best quality in slides.

---

## Division of Labor (Suggested)

With 10 minutes and multiple team members, assign slides by section so each person has a coherent narrative arc — not alternating every slide.

| Section | Slides | Role |
|---------|--------|------|
| Problem + Solution + Agent | 2–5 | Speaker A |
| HERALD + Taxonomy + Feedback Loop | 6–9 | Speaker B |
| Results + Evaluation + Demo | 10–12 | Speaker C |
| Tech Stack + Conclusion | 13–14 | Speaker A or B (closing) |

All members must participate (per deliverables requirement). Practice handoffs — the transition between speakers should be one sentence, not a pause.

---

## Final Checklist Before April 24

- [ ] All diagrams rendered from `slides/diagrams.md` (not raw Mermaid text)
- [ ] Benchmark result table pulled from `results/benchmark-2026-04-19.5.json`
- [ ] Screenshot of Phase 3 MemoViewer on title slide
- [ ] Demo tested end-to-end on the presentation laptop
- [ ] Fallback video recorded (≤2 min)
- [ ] `pipeline-output/` files open in browser tabs as static fallback
- [ ] Q&A answers rehearsed for the 5 questions above
- [ ] Slide deck exported to PDF (submit PDF, present from Google Slides or Keynote)
