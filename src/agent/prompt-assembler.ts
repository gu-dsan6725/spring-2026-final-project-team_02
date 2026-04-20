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
      "tool": "web_search | arxiv | world_bank | file_reader",
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
// Topic scope detection
// ---------------------------------------------------------------------------

/**
 * Detects whether a topic is US-domestic, international, or ambiguous.
 * Returns the detected scope and a tool priority recommendation to embed
 * in the system prompt.
 */
function detectTopicScope(topic: string): 'us_domestic' | 'international' | 'ambiguous' {
  const lower = topic.toLowerCase();

  // Strong US-domestic signals
  const usDomesticSignals = [
    'united states',
    'u.s.',
    'us ',
    ' us ',
    'american',
    'america',
    'federal',
    'congress',
    'senate',
    'house of representatives',
    'hud',
    'fha',
    'fannie mae',
    'freddie mac',
    'medicare',
    'medicaid',
    'snap',
    'tanf',
    'eitc',
    'irs',
    'cbo',
    'gao',
    'crs',
    'california',
    'texas',
    'new york',
    'florida',
    'illinois',
    // add state abbreviations as word boundaries would be better but these cover common cases
    ' ny ',
    ' ca ',
    ' tx ',
    ' fl ',
    'subsidy',
    'subsidies', // housing subsidies, farm subsidies — overwhelmingly US policy debates
    'section 8',
    'housing voucher',
    'low-income housing tax credit',
    'lihtc',
    'obamacare',
    'aca',
    'affordable care act',
    'dodd-frank',
    'sarbanes-oxley',
  ];

  // Strong international / non-US signals
  const internationalSignals = [
    'global',
    'international',
    'developing countr',
    'low-income countr',
    'world bank',
    'imf ',
    'international monetary fund',
    'sahel',
    'sub-saharan',
    'latin america',
    'southeast asia',
    'south asia',
    'oecd',
    'g20',
    'g7',
    'united nations',
    ' un ',
    'unicef',
    'who ',
    'world health organization',
    'eu ',
    'european union',
    'eurozone',
  ];

  const usScore = usDomesticSignals.filter((s) => lower.includes(s)).length;
  const intlScore = internationalSignals.filter((s) => lower.includes(s)).length;

  if (usScore > intlScore && usScore >= 1) return 'us_domestic';
  if (intlScore > usScore && intlScore >= 1) return 'international';
  return 'ambiguous';
}

function buildToolPriorityInstructions(
  scope: 'us_domestic' | 'international' | 'ambiguous',
): string {
  if (scope === 'us_domestic') {
    return `
## Tool Priority — US Domestic Policy Topic

This topic has been identified as a US domestic policy issue. Apply the following tool
priority order for your research plan. Within your budget, you MUST use each tier before
exhausting calls on any single tool:

**Tier 1 — Primary (use first, use most):**
- govinfo_search: Congressional Research Service (CRS) and GAO reports are the authoritative
  source for US federal policy analysis. Search here first for any legislative, regulatory,
  or budgetary claim.
- fred_data: For any economic or statistical claim (housing prices, unemployment, income,
  inflation, federal spending), pull the relevant FRED series. Prefer FRED over web search
  for quantitative US data.
- govreport_search: GAO, CBO, and OMB government reports. Use for program evaluations,
  cost estimates, and agency findings.

**Tier 2 — Secondary (use after Tier 1 for each sub-topic):**
- semantic_scholar_search: Peer-reviewed US policy research, economics papers.
- arxiv_search: Quantitative policy analysis, economics preprints.
- web_search: Recent news, agency announcements, legislation not yet in govinfo.
  Use for recency, not as a primary source of evidence.

**Tier 3 — Avoid for US domestic topics unless explicitly relevant:**
- worldbank_data: Only if comparing US to international benchmarks.

**Distribution rule:** No single tool should account for more than 40% of your total tool
calls. If you have used web_search 3 or more times, switch to a Tier 1 tool before
making another web_search call.
`;
  }

  if (scope === 'international') {
    return `
## Tool Priority — International Policy Topic

This topic has been identified as an international or cross-country policy issue. Apply the
following tool priority order. Within your budget, you MUST use each tier before
exhausting calls on any single tool:

**Tier 1 — Primary (use first, use most):**
- worldbank_data: World Bank indicators are the gold standard for cross-country development
  statistics. Always check here first for any quantitative country-level claim.
- semantic_scholar_search: Development economics, global health, and international
  political economy research.
- arxiv_search: Quantitative economics and policy analysis preprints.

**Tier 2 — Secondary:**
- web_search: Recent reports from multilateral agencies (UN, WHO, IMF, OECD).
  Use for recency; prefer primary sources where possible.
- govreport_search: US government analyses of international topics (GAO, CRS).

**Tier 3 — Avoid for international topics unless relevant:**
- fred_data: Only if US economic data is a direct comparison point.
- govinfo_search: Only for US foreign policy / aid legislation.

**Distribution rule:** No single tool should account for more than 40% of your total tool
calls. If you have used web_search 3 or more times, switch to a Tier 1 tool before
making another web_search call.
`;
  }

  // ambiguous
  return `
## Tool Priority — General / Mixed-Scope Policy Topic

The scope of this topic is unclear. Distribute your tool calls evenly across available tools.
Do NOT default to web_search for more than 2 consecutive calls. After every 2 web_search
calls, make at least 1 call to a specialised database (govinfo_search, fred_data,
worldbank_data, arxiv_search, semantic_scholar_search, or govreport_search).

**Distribution rule:** No single tool should account for more than 35% of your total tool
calls.
`;
}

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
- Follow the Tool Priority instructions above. Do not concentrate calls on web_search.
`;

// ---------------------------------------------------------------------------
// Memo writing instructions
// ---------------------------------------------------------------------------

const MEMO_WRITING_INSTRUCTIONS = `
## Step 3 — Write the Policy Memo

After completing research, write the memo using ONLY claims from the notes log.

Rules:
- Reference every factual claim with its [C-XXX] marker inline in the prose.
- Follow the provided template structure if one was given; otherwise use standard memo sections
  (Executive Summary, Background, Key Findings, Policy Recommendations, Conclusion).
- Write at the policy-analyst level: concise, evidence-grounded, and action-oriented.
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
    `- Maximum research tokens: ${String(input.max_research_tokens ?? 100000)}`,
  ].join('\n');

  const knownSourcesSection =
    input.known_sources !== undefined && input.known_sources.length > 0
      ? `\n## Known Sources Provided by the User\n\nConsult these sources first before using search tools:\n${input.known_sources.map((s, i) => `${String(i + 1)}. ${s}`).join('\n')}\n`
      : '';

  const templateSection =
    input.template !== undefined && input.template.trim().length > 0
      ? `\n## Memo Template\n\nThe user has provided the following structural template. Follow it exactly:\n\n${input.template}\n`
      : '';

  const backgroundSection =
    input.background !== undefined && input.background.trim().length > 0
      ? `\n## Background / Framing Provided by the User\n\n${input.background}\n`
      : '';

  const scope = detectTopicScope(input.topic + ' ' + (input.background ?? ''));
  const toolPrioritySection = buildToolPriorityInstructions(scope);

  return `You are an expert policy researcher and writer. Your task is to research the topic below
and produce a well-sourced policy memo with full claim provenance.

## Topic

${input.topic}
${backgroundSection}${knownSourcesSection}${templateSection}
## Research Budget

${budgetLines}

---
${CLAIM_TAXONOMY}
---
${DERIVATION_METHODS}
---
${NOTES_LOG_SCHEMA}
---
${toolPrioritySection}
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
