/**
 * HERALD Tier 3 — Multi-Agent Debate evaluation.
 *
 * Three Groq Llama 3.3 70B calls run in parallel as distinct personas:
 *   1. Domain Expert   — substantive accuracy and field knowledge
 *   2. Methodologist   — evidence quality and inferential validity
 *   3. Skeptic         — adversarial challenge, alternative explanations
 *
 * A fourth Judge call synthesizes the three perspectives into a final verdict.
 *
 * Decision logic:
 *   - Unanimous or 2-1 with high judge confidence (> 0.80) → exit with verdict
 *   - All uncertain or low judge confidence (≤ 0.80) → escalate to Tier 4 (human)
 */

import OpenAI from 'openai';

import type { NotesLogEntry } from '../types/claims';
import type { TierOutput, Verdict, DebatePersona, DebateOutput } from '../types/herald';
import { logError, startSpan } from '../observability/braintrust';
import { getDomainExpertPrompt } from './prompts/domain-expert';
import { getMethodologistPrompt } from './prompts/methodologist';
import { getSkepticPrompt } from './prompts/skeptic';
import { getJudgeSynthesisPrompt } from './prompts/judge-synthesis';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBATE_MODEL = 'gpt-4o';
const DEBATE_TEMPERATURE = 0.3;
const DEBATE_MAX_TOKENS = 768;
const JUDGE_MAX_TOKENS = 1024;
const JUDGE_CONFIDENCE_THRESHOLD = 0.8;

// ---------------------------------------------------------------------------
// Groq client via OpenAI-compatible SDK (lazy singleton)
// ---------------------------------------------------------------------------

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client === null) {
    _client = new OpenAI({
      apiKey: process.env['OPENAI_API_KEY'],
    });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const DEBATE_TURN_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'submit_debate_turn',
    description:
      'Submit your structured evaluation of the claim. Always call this — do not respond with plain text.',
    parameters: {
      type: 'object',
      properties: {
        verdict: {
          type: 'string',
          enum: ['valid', 'invalid', 'uncertain'],
          description: 'Your verdict on the claim.',
        },
        reasoning: {
          type: 'string',
          description:
            'Specific reasoning citing source text. For invalid verdicts, identify the exact problem.',
        },
        key_concern: {
          type: 'string',
          description:
            'The single most important concern from your perspective (1–2 sentences). This is what the Judge will weigh.',
        },
      },
      required: ['verdict', 'reasoning', 'key_concern'],
    },
  },
};

const SYNTHESIS_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'submit_synthesis',
    description:
      'Submit the final synthesized verdict. Always call this — do not respond with plain text.',
    parameters: {
      type: 'object',
      properties: {
        verdict: {
          type: 'string',
          enum: ['valid', 'invalid', 'uncertain'],
          description: 'The synthesized verdict.',
        },
        confidence: {
          type: 'number',
          description: 'Confidence in the synthesized verdict (0.0–1.0).',
        },
        reasoning: {
          type: 'string',
          description:
            "Which reviewer's argument was most persuasive and why. Address major dissenting points.",
        },
        suggested_revision: {
          type: ['string', 'null'],
          description: 'Required for invalid verdicts. A concrete revised claim text.',
        },
        dominant_persona: {
          type: 'string',
          description:
            "Which reviewer's argument drove the decision (domain_expert, methodologist, skeptic, or unanimous).",
        },
      },
      required: ['verdict', 'confidence', 'reasoning', 'dominant_persona'],
    },
  },
};

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

interface DebateTurnInput {
  verdict: string;
  reasoning: string;
  key_concern: string;
}

function isDebateTurnInput(obj: unknown): obj is DebateTurnInput {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o['verdict'] === 'string' &&
    typeof o['reasoning'] === 'string' &&
    typeof o['key_concern'] === 'string'
  );
}

interface SynthesisInput {
  verdict: string;
  confidence: number;
  reasoning: string;
  suggested_revision?: string | null;
  dominant_persona: string;
}

function isSynthesisInput(obj: unknown): obj is SynthesisInput {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o['verdict'] === 'string' &&
    typeof o['confidence'] === 'number' &&
    typeof o['reasoning'] === 'string' &&
    typeof o['dominant_persona'] === 'string'
  );
}

function parseVerdict(raw: string): Verdict {
  if (raw === 'valid' || raw === 'invalid' || raw === 'uncertain') {
    return raw;
  }
  // Legacy 'needs_revision' from models that haven't seen the updated enum
  if (raw === 'needs_revision') return 'invalid';
  return 'uncertain';
}

// ---------------------------------------------------------------------------
// Claim context builder (shared across all persona calls)
// ---------------------------------------------------------------------------

function buildClaimContext(claim: NotesLogEntry, tier2Output: TierOutput): string {
  const lines: string[] = [
    '## Claim Under Evaluation',
    '',
    `**Claim ID**: ${claim.claim_id}`,
    `**Claim type**: ${claim.claim_type}`,
    `**Derivation**: ${claim.derivation}`,
    `**Claim text**: "${claim.claim_text}"`,
    '',
    '## Cited Sources',
    '',
  ];

  for (const [i, src] of claim.sources.entries()) {
    lines.push(`### Source ${String(i + 1)}: ${src.source_title}`);
    lines.push(`Relevant excerpt:`);
    lines.push('```');
    lines.push(src.relevant_chunk);
    lines.push('```');
    lines.push('');
  }

  lines.push('## Agent Reasoning');
  lines.push('');
  lines.push(claim.reasoning);
  lines.push('');
  lines.push('## Tier 2 LLM Judge Result (Inconclusive)');
  lines.push('');
  lines.push(
    `The LLM Judge at Tier 2 returned: **${tier2Output.verdict}** at ${Math.round(tier2Output.confidence * 100).toString()}% confidence.`,
  );
  lines.push(`Tier 2 reasoning: ${tier2Output.reasoning}`);
  lines.push('');
  lines.push('Provide your independent assessment. Do not simply echo the Tier 2 result.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Single persona call
// ---------------------------------------------------------------------------

async function callPersona(
  persona: DebatePersona,
  systemPrompt: string,
  claimContext: string,
): Promise<DebateOutput> {
  const response = await getClient().chat.completions.create({
    model: DEBATE_MODEL,
    max_tokens: DEBATE_MAX_TOKENS,
    temperature: DEBATE_TEMPERATURE,
    tools: [DEBATE_TURN_TOOL],
    tool_choice: { type: 'function', function: { name: 'submit_debate_turn' } },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: claimContext },
    ],
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  const plainTextContent = response.choices[0]?.message?.content ?? '';
  let parsed: unknown;

  if (toolCall !== undefined && toolCall.type === 'function') {
    try {
      parsed = JSON.parse(toolCall.function.arguments) as unknown;
    } catch {
      throw new Error(
        `Persona '${persona}' JSON parse failed: ${toolCall.function.arguments.slice(0, 200)}`,
      );
    }
  } else if (toolCall !== undefined) {
    throw new Error(`Persona '${persona}' received unexpected tool_call type: ${toolCall.type}`);
  } else if (plainTextContent.length > 0) {
    const jsonMatch = /\{[\s\S]*\}/.exec(plainTextContent);
    if (jsonMatch === null) {
      throw new Error(
        `Persona '${persona}' did not call submit_debate_turn and response contains no JSON. ` +
          `finish_reason=${response.choices[0]?.finish_reason ?? 'null'}`,
      );
    }
    try {
      parsed = JSON.parse(jsonMatch[0]) as unknown;
    } catch {
      throw new Error(
        `Persona '${persona}' plain-text JSON parse failed: ${plainTextContent.slice(0, 200)}`,
      );
    }
  } else {
    throw new Error(
      `Persona '${persona}' did not call submit_debate_turn. ` +
        `finish_reason=${response.choices[0]?.finish_reason ?? 'null'}`,
    );
  }

  if (!isDebateTurnInput(parsed)) {
    throw new Error(
      `Persona '${persona}' output missing required fields: ${JSON.stringify(parsed)}`,
    );
  }

  return {
    persona,
    verdict: parseVerdict(parsed.verdict),
    reasoning: `${parsed.reasoning}\n\nKey concern: ${parsed.key_concern}`,
  };
}

// ---------------------------------------------------------------------------
// Judge synthesis call
// ---------------------------------------------------------------------------

function buildJudgeContext(
  claim: NotesLogEntry,
  personaOutputs: DebateOutput[],
  claimContext: string,
): string {
  const lines: string[] = [claimContext, '', '## Expert Reviewer Verdicts', ''];

  for (const output of personaOutputs) {
    const label =
      output.persona === 'domain_expert'
        ? 'Domain Expert'
        : output.persona === 'methodologist'
          ? 'Research Methodologist'
          : 'Critical Skeptic';

    lines.push(`### ${label}`);
    lines.push(`**Verdict**: ${output.verdict}`);
    lines.push(`**Reasoning**: ${output.reasoning}`);
    lines.push('');
  }

  const verdicts = personaOutputs.map((o) => o.verdict);
  const uniqueVerdicts = new Set(verdicts);
  if (uniqueVerdicts.size === 1) {
    lines.push(`*All three reviewers agree: **${verdicts[0] ?? 'uncertain'}**.*`);
  } else {
    const counts = verdicts.reduce<Record<string, number>>((acc, v) => {
      acc[v] = (acc[v] ?? 0) + 1;
      return acc;
    }, {});
    lines.push(
      `*Split verdict: ${Object.entries(counts)
        .map(([v, n]) => `${String(n)}x ${v}`)
        .join(', ')}.*`,
    );
  }

  lines.push('');
  lines.push(`Synthesize these perspectives into a final verdict for claim ${claim.claim_id}.`);

  return lines.join('\n');
}

async function callJudge(
  claim: NotesLogEntry,
  personaOutputs: DebateOutput[],
  claimContext: string,
): Promise<SynthesisInput> {
  const judgeContext = buildJudgeContext(claim, personaOutputs, claimContext);

  const response = await getClient().chat.completions.create({
    model: DEBATE_MODEL,
    max_tokens: JUDGE_MAX_TOKENS,
    temperature: 0.1, // More deterministic for the final verdict
    tools: [SYNTHESIS_TOOL],
    tool_choice: { type: 'function', function: { name: 'submit_synthesis' } },
    messages: [
      { role: 'system', content: getJudgeSynthesisPrompt() },
      { role: 'user', content: judgeContext },
    ],
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  const plainTextContent = response.choices[0]?.message?.content ?? '';
  let parsed: unknown;

  if (toolCall !== undefined && toolCall.type === 'function') {
    try {
      parsed = JSON.parse(toolCall.function.arguments) as unknown;
    } catch {
      throw new Error(`Judge JSON parse failed: ${toolCall.function.arguments.slice(0, 200)}`);
    }
  } else if (toolCall !== undefined) {
    throw new Error(`Judge received unexpected tool_call type: ${toolCall.type}`);
  } else if (plainTextContent.length > 0) {
    const jsonMatch = /\{[\s\S]*\}/.exec(plainTextContent);
    if (jsonMatch === null) {
      throw new Error(
        `Judge did not call submit_synthesis and response contains no JSON. ` +
          `finish_reason=${response.choices[0]?.finish_reason ?? 'null'}`,
      );
    }
    try {
      parsed = JSON.parse(jsonMatch[0]) as unknown;
    } catch {
      throw new Error(`Judge plain-text JSON parse failed: ${plainTextContent.slice(0, 200)}`);
    }
  } else {
    throw new Error(
      `Judge did not call submit_synthesis. finish_reason=${response.choices[0]?.finish_reason ?? 'null'}`,
    );
  }

  if (!isSynthesisInput(parsed)) {
    throw new Error(`Judge output missing required fields: ${JSON.stringify(parsed)}`);
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run the HERALD Tier 3 Multi-Agent Debate.
 *
 * Runs 3 persona calls in parallel, then a Judge synthesis call.
 *
 * @param claim       - The claim and its source provenance.
 * @param tier2Output - The inconclusive Tier 2 result (context for personas).
 * @returns TierOutput with final verdict, confidence, and debate reasoning.
 */
export async function evaluateWithDebate(
  claim: NotesLogEntry,
  tier2Output: TierOutput,
): Promise<TierOutput> {
  const span = startSpan('herald.tier3.debate', {
    claim_id: claim.claim_id,
    claim_type: claim.claim_type,
    tier2_verdict: tier2Output.verdict,
    tier2_confidence: tier2Output.confidence,
  });

  try {
    const claimContext = buildClaimContext(claim, tier2Output);

    // Run all three persona calls in parallel
    const [expertResult, methodologistResult, skepticResult] = await Promise.all([
      callPersona('domain_expert', getDomainExpertPrompt(claim.claim_type), claimContext),
      callPersona('methodologist', getMethodologistPrompt(claim.claim_type), claimContext),
      callPersona('skeptic', getSkepticPrompt(claim.claim_type), claimContext),
    ]);

    const personaOutputs: DebateOutput[] = [expertResult, methodologistResult, skepticResult];

    // Judge synthesis
    const synthesis = await callJudge(claim, personaOutputs, claimContext);

    const verdict = parseVerdict(synthesis.verdict);
    const confidence = Math.max(0, Math.min(1, synthesis.confidence));

    const output: TierOutput = {
      tier_id: 3,
      verdict: confidence > JUDGE_CONFIDENCE_THRESHOLD ? verdict : 'uncertain',
      confidence,
      reasoning: synthesis.reasoning,
    };

    if (
      typeof synthesis.suggested_revision === 'string' &&
      synthesis.suggested_revision.length > 0
    ) {
      output.suggested_revision = synthesis.suggested_revision;
    }

    span.end({
      verdict: output.verdict,
      confidence,
      persona_verdicts: personaOutputs.map((p) => `${p.persona}:${p.verdict}`).join(','),
      dominant_persona: synthesis.dominant_persona,
    });

    return output;
  } catch (error) {
    logError('herald.tier3.debate', error, {
      claim_id: claim.claim_id,
      claim_type: claim.claim_type,
    });
    span.end({ error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
