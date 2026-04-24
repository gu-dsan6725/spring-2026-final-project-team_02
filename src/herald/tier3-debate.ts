/**
 * HERALD Tier 3 — Multi-Agent Debate.
 *
 * Three personas (Domain Expert, Methodologist, Skeptic) independently evaluate
 * the claim in parallel, then a Judge synthesises their perspectives into a final
 * verdict.
 *
 * Decision logic:
 *   - Judge confidence > 0.80 → exit with judge's verdict
 *   - Judge confidence ≤ 0.80 → override to 'uncertain', escalate to Tier 4
 */

import OpenAI from 'openai';

import type { NotesLogEntry } from '../types/claims';
import type { TierOutput, Verdict } from '../types/herald';
import { logError, startSpan } from '../observability/braintrust';
import { getDomainExpertPrompt } from './prompts/domain-expert';
import { getMethodologistPrompt } from './prompts/methodologist';
import { getSkepticPrompt } from './prompts/skeptic';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBATE_MODEL = 'gpt-4o-mini';
const DEBATE_TEMPERATURE = 0.3;
const DEBATE_MAX_TOKENS = 1024;
const JUDGE_CONFIDENCE_THRESHOLD = 0.8;

// ---------------------------------------------------------------------------
// OpenAI client (lazy singleton)
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

const SUBMIT_DEBATE_TURN: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'submit_debate_turn',
    description:
      'Submit your evaluation of the claim. Always call this function — do not respond with plain text.',
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
          description: 'Your reasoning, citing specific source text.',
        },
        key_concern: {
          type: 'string',
          description: 'The primary concern or key point from your perspective.',
        },
      },
      required: ['verdict', 'reasoning', 'key_concern'],
    },
  },
};

const SUBMIT_SYNTHESIS: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'submit_synthesis',
    description:
      'Submit your synthesis of the debate and final verdict. Always call this — do not respond with plain text.',
    parameters: {
      type: 'object',
      properties: {
        verdict: {
          type: 'string',
          enum: ['valid', 'invalid', 'uncertain'],
          description: 'The final verdict after synthesising all perspectives.',
        },
        confidence: {
          type: 'number',
          description: 'Confidence in the final verdict (0.0–1.0).',
        },
        reasoning: {
          type: 'string',
          description: 'Synthesis of the debate and rationale for the verdict.',
        },
        suggested_revision: {
          type: 'string',
          description: 'For invalid verdicts, a concrete revised claim text.',
        },
        dominant_persona: {
          type: 'string',
          enum: ['domain_expert', 'methodologist', 'skeptic'],
          description: 'Which persona most influenced the final verdict.',
        },
      },
      required: ['verdict', 'confidence', 'reasoning'],
    },
  },
};

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

interface DebateTurnInput {
  verdict: string;
  reasoning: string;
  key_concern?: string;
}

interface SynthesisInput {
  verdict: string;
  confidence: number;
  reasoning: string;
  suggested_revision?: string | null;
  dominant_persona?: string;
}

function isDebateTurnInput(obj: unknown): obj is DebateTurnInput {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return typeof o['verdict'] === 'string' && typeof o['reasoning'] === 'string';
}

function isSynthesisInput(obj: unknown): obj is SynthesisInput {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return typeof o['verdict'] === 'string' && typeof o['confidence'] === 'number';
}

function parseVerdict(raw: string): Verdict {
  if (raw === 'valid' || raw === 'invalid' || raw === 'uncertain') return raw;
  if (raw === 'needs_revision') return 'invalid';
  return 'uncertain';
}

// ---------------------------------------------------------------------------
// Message builder
// ---------------------------------------------------------------------------

function buildClaimUserMessage(claim: NotesLogEntry, tier2Output: TierOutput): string {
  const lines: string[] = [
    '## Claim Under Review',
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
    lines.push(`### Source ${String(i + 1)}: ${src.source_title} (${src.source_id})`);
    lines.push(`URL: ${src.source_url}`);
    lines.push('Relevant excerpt:');
    lines.push('```');
    lines.push(src.relevant_chunk);
    lines.push('```');
    lines.push('');
  }

  lines.push('## Agent Reasoning');
  lines.push('');
  lines.push(claim.reasoning);
  lines.push('');
  lines.push('## Tier 2 Review (Inconclusive)');
  lines.push('');
  lines.push(
    `Tier 2 verdict: **${tier2Output.verdict}** at ${Math.round(tier2Output.confidence * 100).toString()}% confidence.`,
  );
  lines.push(`Tier 2 reasoning: ${tier2Output.reasoning}`);
  lines.push('');
  lines.push(
    'Evaluate the claim against the source material and call `submit_debate_turn` with your verdict.',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Persona call
// ---------------------------------------------------------------------------

async function runPersona(systemPrompt: string, userMessage: string): Promise<DebateTurnInput> {
  const response = await getClient().chat.completions.create({
    model: DEBATE_MODEL,
    temperature: DEBATE_TEMPERATURE,
    max_tokens: DEBATE_MAX_TOKENS,
    tools: [SUBMIT_DEBATE_TURN],
    tool_choice: { type: 'function', function: { name: 'submit_debate_turn' } },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (
    toolCall == null ||
    toolCall.type !== 'function' ||
    toolCall.function.name !== 'submit_debate_turn'
  ) {
    throw new Error(
      `Persona did not call submit_debate_turn. ` +
        `finish_reason=${response.choices[0]?.finish_reason ?? 'unknown'}`,
    );
  }

  const parsed: unknown = JSON.parse(toolCall.function.arguments) as unknown;
  if (!isDebateTurnInput(parsed)) {
    throw new Error(
      `Persona submit_debate_turn missing required fields: ${JSON.stringify(parsed)}`,
    );
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Judge call
// ---------------------------------------------------------------------------

async function runJudge(
  claim: NotesLogEntry,
  tier2Output: TierOutput,
  personaResults: DebateTurnInput[],
): Promise<SynthesisInput> {
  const [domainExpert, methodologist, skeptic] = personaResults;

  const judgeLines: string[] = [
    '## Claim Under Review',
    '',
    `**Claim text**: "${claim.claim_text}"`,
    '',
    '## Three-Perspective Debate Summary',
    '',
    `**Domain Expert**: ${domainExpert.verdict} — ${domainExpert.reasoning}`,
    '',
    `**Methodologist**: ${methodologist.verdict} — ${methodologist.reasoning}`,
    '',
    `**Skeptic**: ${skeptic.verdict} — ${skeptic.reasoning}`,
    '',
    '## Tier 2 Context',
    '',
    `Tier 2 returned **${tier2Output.verdict}** at ${Math.round(tier2Output.confidence * 100).toString()}% confidence: ${tier2Output.reasoning}`,
    '',
    'Synthesise the three perspectives into a final verdict. Call `submit_synthesis` with your assessment.',
  ];

  const response = await getClient().chat.completions.create({
    model: DEBATE_MODEL,
    temperature: DEBATE_TEMPERATURE,
    max_tokens: DEBATE_MAX_TOKENS,
    tools: [SUBMIT_SYNTHESIS],
    tool_choice: { type: 'function', function: { name: 'submit_synthesis' } },
    messages: [
      {
        role: 'system',
        content:
          "You are a senior policy analyst synthesising a multi-perspective debate on a claim's validity. " +
          'Review all three persona evaluations and make a definitive final verdict. ' +
          'If perspectives diverge significantly or confidence is low, prefer UNCERTAIN over a contested verdict.',
      },
      { role: 'user', content: judgeLines.join('\n') },
    ],
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (
    toolCall == null ||
    toolCall.type !== 'function' ||
    toolCall.function.name !== 'submit_synthesis'
  ) {
    throw new Error(
      `Judge did not call submit_synthesis. ` +
        `finish_reason=${response.choices[0]?.finish_reason ?? 'unknown'}`,
    );
  }

  const parsed: unknown = JSON.parse(toolCall.function.arguments) as unknown;
  if (!isSynthesisInput(parsed)) {
    throw new Error(`Judge submit_synthesis missing required fields: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run the HERALD Tier 3 Multi-Agent Debate.
 *
 * @param claim       - The claim and its source provenance.
 * @param tier2Output - The inconclusive Tier 2 result (context for the debate).
 * @returns TierOutput with final verdict, confidence, and reasoning.
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
    const userMessage = buildClaimUserMessage(claim, tier2Output);

    // Run 3 personas in parallel
    const [domainExpert, methodologist, skeptic] = await Promise.all([
      runPersona(getDomainExpertPrompt(claim.claim_type), userMessage),
      runPersona(getMethodologistPrompt(claim.claim_type), userMessage),
      runPersona(getSkepticPrompt(claim.claim_type), userMessage),
    ]);

    // Judge synthesises all three perspectives
    const judgeResult = await runJudge(claim, tier2Output, [domainExpert, methodologist, skeptic]);

    const verdict = parseVerdict(judgeResult.verdict);
    const confidence = Math.max(0, Math.min(1, judgeResult.confidence));
    const finalVerdict = confidence > JUDGE_CONFIDENCE_THRESHOLD ? verdict : 'uncertain';

    const reasoning =
      typeof judgeResult.reasoning === 'string' && judgeResult.reasoning.length > 0
        ? judgeResult.reasoning
        : `Verdict: ${verdict} (no reasoning provided)`;

    const output: TierOutput = {
      tier_id: 3,
      verdict: finalVerdict,
      confidence,
      reasoning,
    };

    const rawJudge = judgeResult as unknown as Record<string, unknown>;
    if (
      typeof rawJudge['suggested_revision'] === 'string' &&
      rawJudge['suggested_revision'].length > 0
    ) {
      output.suggested_revision = rawJudge['suggested_revision'];
    }

    span.end({ verdict: finalVerdict, confidence });

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
