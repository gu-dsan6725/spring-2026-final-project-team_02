/**
 * Transforms a MemoInput into system and user prompts for the research agent.
 *
 * The system prompt instructs the agent to:
 *   1. Create a research plan
 *   2. Execute the plan via available tools
 *   3. Build a notes log (one NotesLogEntry per atomic claim) during research
 *   4. Write the policy memo referencing only notes-log claims via [C-XXX] markers
 *   5. Output both the memo and the notes log as structured JSON
 */

import type { MemoInput } from '../types/memo';

// Cap injected document content to keep system prompt within reason (~750 tokens per doc)
const MAX_DOC_CHARS = 3_000;

// ---------------------------------------------------------------------------
// Claim taxonomy — authoritative definitions embedded in the system prompt
// ---------------------------------------------------------------------------

const CLAIM_TAXONOMY = `
## Claim Taxonomy

Every claim you extract must be classified into exactly one of the six types below.
Classification determines how the claim is later evaluated by the HERALD framework.

### 1. statistical
A specific number, percentage, rate, or quantitative measure attributed to a source.
Example: "Maternal mortality in Chad stands at 1,140 per 100,000 live births."
Focus: Does the source state this number, with these units, for this time period and population?

### 2. causal
Asserts that X causes, drives, contributes to, or leads to Y.
Example: "Removal of fuel subsidies contributed to a 15% increase in rural transportation costs."
Focus: Does the source establish a causal mechanism, or only a correlation?
Note: This type carries a lower HERALD confidence threshold — be precise.

### 3. comparative
Claims something is greater, lesser, faster, more effective, or ranked relative to something else.
Example: "Cash transfer programs have shown stronger effects on school enrollment than fee waiver programs."
Focus: Same timeframe, population, and methodology for both sides of the comparison?

### 4. predictive
Forward-looking claims about what will, is expected to, or is likely to happen.
Example: "Urban water demand in the Sahel is projected to exceed supply capacity by 2032."
Focus: Who made this projection, using what model, under what assumptions?

### 5. normative
Claims about what should be done, what best practice is, or what is recommended.
Example: "Multi-stakeholder governance frameworks are considered best practice for transboundary water management."
Focus: Genuine expert consensus, or one school of thought?

### 6. synthesis
A novel inference drawn by combining multiple sources; the conclusion is NOT stated in any single source.
Example: "Declining enrollment and rising child labor suggest subsidy programs have not reached their most vulnerable target populations."
Focus: Does the conclusion logically follow from the premises? Are there alternative explanations?
`;

// ---------------------------------------------------------------------------
// Derivation method definitions
// ---------------------------------------------------------------------------

const DERIVATION_METHODS = `
## Derivation Methods

Every notes-log entry must also carry a derivation tag:

- direct_extraction  — Lifted verbatim (or near-verbatim) from a single source. Lowest risk.
- paraphrase         — Restated in different words from a single source. Low risk.
- cross_source       — Synthesized from two or more sources. Medium risk.
- agent_inference    — The agent's own reasoning beyond what any source explicitly states. Highest risk.

Use the most conservative tag that accurately describes how the claim was produced.
`;

// ---------------------------------------------------------------------------
// Notes log JSON schema
// ---------------------------------------------------------------------------

const NOTES_LOG_SCHEMA = `
## Notes Log Entry Schema

Build one entry per atomic claim (= one factual assertion). If a sentence contains multiple
distinct factual assertions, split it into multiple entries with separate claim_ids.

\`\`\`json
{
  "claim_id": "C-001",
  "claim_text": "The exact claim text as it will appear (or be referenced) in the memo.",
  "claim_type": "statistical | causal | comparative | predictive | normative | synthesis",
  "derivation": "direct_extraction | paraphrase | cross_source | agent_inference",
  "sources": [
    {
      "source_id": "S-001",
      "source_title": "Author(s), Year — Full Title",
      "source_url": "https://...",
      "relevant_chunk": "The exact passage from the source that supports this claim."
    }
  ],
  "reasoning": "One-to-two sentences explaining how the claim was derived from the source(s)."
}
\`\`\`

Rules:
- claim_ids are sequential: C-001, C-002, C-003, …
- source_ids are sequential across the entire session: S-001, S-002, …
- The same source may appear in multiple entries (reuse its source_id and title/URL).
- relevant_chunk must be the verbatim passage (or the closest available excerpt) — never a paraphrase.
- If a tool call failed to retrieve a source, record source_url as the attempted URL and
  relevant_chunk as "Source unavailable — retrieval failed."
`;

// ---------------------------------------------------------------------------
// Final output schema
// ---------------------------------------------------------------------------

const OUTPUT_SCHEMA = `
## Required Output Format

After completing research and writing the memo, output a single JSON object:

\`\`\`json
{
  "memo": {
    "title": "Policy Memo: <descriptive title>",
    "sections": [
      {
        "title": "Section heading",
        "content": "Section prose. Inline claim markers look like [C-001], [C-002].",
        "claim_ids": ["C-001", "C-002"]
      }
    ]
  },
  "notes_log": [
    { ...NotesLogEntry... },
    { ...NotesLogEntry... }
  ]
}
\`\`\`

Every [C-XXX] marker in the memo prose MUST correspond to an entry in notes_log.
Every entry in notes_log MUST be referenced at least once in the memo prose.
Do NOT include claims in the memo that are not in the notes_log.
`;

// ---------------------------------------------------------------------------
// Research plan instructions
// ---------------------------------------------------------------------------

const RESEARCH_PLAN_INSTRUCTIONS = `
## Step 1 — Create a Research Plan

Before making any tool calls, output a research plan as a JSON object (not included in the
final output — this is for your internal organisation):

\`\`\`json
{
  "topic": "...",
  "queries": [
    {
      "tool": "web_search | arxiv_search | worldbank_data | semantic_scholar_search | govreport_search | govinfo_search | fred_data | read_uploaded_file",
      "query": "...",
      "expected_claim_types": ["statistical", "causal"],
      "rationale": "Why this query is relevant to the memo."
    }
  ],
  "target_source_count": 8,
  "notes": "Any constraints or framing to keep in mind."
}
\`\`\`
`;

// ---------------------------------------------------------------------------
// Tool use instructions
// ---------------------------------------------------------------------------

const TOOL_USE_INSTRUCTIONS = `
## Step 2 — Execute the Research Plan

Use the available tools to gather evidence. For each tool call:
- If the call succeeds, extract all relevant claims and add them to the notes log.
- If the call fails after retries, log the gap (source_url = attempted URL,
  relevant_chunk = "Source unavailable — retrieval failed.") and continue.
- Stop tool calls once you reach the budget limit. Do not exceed it.
- Log progress by updating the notes log incrementally as you research.
`;

// ---------------------------------------------------------------------------
// Memo writing instructions
// ---------------------------------------------------------------------------

const MEMO_WRITING_INSTRUCTIONS = `
## Step 3 — Write the Policy Memo

After completing research, write the memo using ONLY claims from the notes log.

Rules:
- Minimum length: 600 words of prose. Target 700–900 words. Do NOT stop writing until you
  have reached at least 600 words of substantive prose (excluding headings and [C-XXX] markers).
  A memo under 600 words is incomplete — expand each section with analysis and context until
  the minimum is met.
- If a template structure was provided, you MUST follow it exactly — use its section headings
  verbatim and fill each section. Do not invent different sections.
- If no template was given, use standard memo sections:
  Executive Summary, Background, Key Findings, Policy Recommendations, Conclusion.
- Reference every factual claim with its [C-XXX] marker inline in the prose.
- Write at the policy-analyst level: precise, evidence-grounded, and action-oriented.
- Do not introduce any claim that does not have a notes-log entry.
- Synthesis claims (claim_type = "synthesis") must be clearly framed as analytical inference,
  not as established fact.
- Predictive claims must include the source and conditionality (e.g., "according to X, under
  assumption Y, …").
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assembles the complete system prompt for the research agent.
 * Embeds the claim taxonomy, derivation methods, notes-log schema, and all
 * behavioural instructions. User-specific fields (topic, background, sources,
 * template) are interpolated so the agent has full context at prompt time.
 */
export function assembleSystemPrompt(input: MemoInput): string {
  const budgetLines = [
    `- Maximum tool calls: ${String(input.max_tool_calls ?? 25)}`,
    `- Maximum research tokens: ${String(input.max_research_tokens ?? 50000)}`,
  ].join('\n');

  const knownSourcesSection =
    input.known_sources !== undefined && input.known_sources.length > 0
      ? `\n## Known Sources (REQUIRED — consult these before any search tools)\n\nYou MUST retrieve and cite these sources. Use read_uploaded_file or web search to access them. Do not skip them.\n${input.known_sources.map((s, i) => `${String(i + 1)}. ${s}`).join('\n')}\n`
      : '';

  const sourceDocsSection =
    input.source_document_texts !== undefined && input.source_document_texts.length > 0
      ? `\n## Uploaded Source Documents (REQUIRED — cite these directly)\n\nThe user has uploaded the following documents. You MUST extract claims from them and include them in the notes log before doing any external searches.\n\n${input.source_document_texts.map((d) => `### ${d.name}\n\`\`\`\n${d.content.slice(0, MAX_DOC_CHARS)}${d.content.length > MAX_DOC_CHARS ? '\n[... truncated]' : ''}\n\`\`\``).join('\n\n')}\n`
      : '';

  const templateSection =
    input.template !== undefined && input.template.trim().length > 0
      ? `\n## Memo Template (REQUIRED — use these exact section headings)\n\nYou MUST structure the memo using the following template. Use each heading verbatim. Do not add, rename, or omit sections.\n\n${input.template}\n`
      : '';

  const backgroundSection =
    input.background !== undefined && input.background.trim().length > 0
      ? `\n## Background / Framing Provided by the User\n\n${input.background}\n`
      : '';

  return `You are an expert policy researcher and writer. Your task is to research the topic below
and produce a well-sourced policy memo with full claim provenance.

## Topic

${input.topic}
${backgroundSection}${knownSourcesSection}${sourceDocsSection}${templateSection}
## Research Budget

${budgetLines}

---
${CLAIM_TAXONOMY}
---
${DERIVATION_METHODS}
---
${NOTES_LOG_SCHEMA}
---
${RESEARCH_PLAN_INSTRUCTIONS}
---
${TOOL_USE_INSTRUCTIONS}
---
${MEMO_WRITING_INSTRUCTIONS}
---
${OUTPUT_SCHEMA}

## Important Constraints

1. Atomic claims only — one factual assertion per notes-log entry.
   Split multi-claim sentences into separate entries.
2. Every [C-XXX] marker in the memo must have a notes-log entry.
3. Every notes-log entry must be referenced in the memo.
4. Never exceed the tool-call or token budget.
5. Never fabricate a source. If a source is unavailable, record it as such.
6. Never use console.log or print statements — all output must be structured JSON.
`;
}

/**
 * Assembles the user-turn message that triggers the agent.
 * Kept deliberately short — all substantive instructions are in the system prompt.
 */
export function assembleUserMessage(input: MemoInput): string {
  return `Please research and write a policy memo on the following topic:

"${input.topic}"

Follow the instructions in the system prompt exactly. Begin with the research plan,
then execute it, build the notes log incrementally, and finally produce the memo.
Output the final result as a single JSON object containing "memo" and "notes_log".`;
}
