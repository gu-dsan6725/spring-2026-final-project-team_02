/**
 * HERALD Tier 2 — LLM-as-Judge evaluation.
 *
 * Calls Claude Sonnet to assess a claim against its cited source chunks using
 * a claim-type-specific evaluation prompt.  This tier handles:
 *
 *   - Claims that Tier 1 (NLI) returned 'uncertain' on (statistical, comparative, causal)
 *   - Claims that skip NLI entirely (predictive, normative, synthesis)
 *
 * Decision thresholds (from CLAUDE.md):
 *   confidence > 0.85   → exit with verdict (valid / invalid / needs_revision)
 *   confidence 0.6–0.85 → override to 'uncertain', escalate to Tier 3
 *   confidence < 0.6    → override to 'uncertain', escalate to Tier 3 (high-priority)
 */

import Anthropic from '@anthropic-ai/sdk';

import { DERIVATION_CONFIG, type NotesLogEntry } from '../types/claims';
import type { TierOutput, Verdict } from '../types/herald';
import { logError, startSpan } from '../observability/braintrust';
import { getJudgePrompt } from './prompts/judge-system';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JUDGE_MODEL = 'claude-sonnet-4-6';
const JUDGE_TEMPERATURE = 0.2;
const JUDGE_MAX_TOKENS = 1024;

/** Confidence at or above this value → exit with the model's verdict. */
const CONFIDENCE_EXIT_THRESHOLD = 0.85;

/** Confidence below this value → escalate to Tier 3 with high-priority flag. */
const CONFIDENCE_HIGH_PRIORITY_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// Anthropic client (lazy singleton)
// ---------------------------------------------------------------------------

let _client: Anthropic | null = null;

/** Return the shared Anthropic client, creating it on first call. */
function getClient(): Anthropic {
  if (_client === null) {
    _client = new Anthropic();
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Tool definition for structured output
// ---------------------------------------------------------------------------

const SUBMIT_EVALUATION_TOOL: Anthropic.Tool = {
  name: 'submit_evaluation',
  description:
    'Submit the structured claim evaluation result. ' +
    'Always call this tool — do not respond with plain text.',
  input_schema: {
    type: 'object' as const,
    properties: {
      verdict: {
        type: 'string',
        enum: ['valid', 'invalid', 'needs_revision', 'uncertain'],
        description: 'The evaluation verdict for this claim.',
      },
      confidence: {
        type: 'number',
        description: 'Confidence in the verdict, from 0.0 (very uncertain) to 1.0 (very certain).',
      },
      reasoning: {
        type: 'string',
        description:
          'Clear, specific reasoning citing source material. ' +
          'For invalid/needs_revision verdicts, identify the specific mismatch.',
      },
      suggested_revision: {
        type: 'string',
        description:
          'Concrete revised claim text that would be valid. ' +
          'Required for invalid and needs_revision verdicts; omit for valid/uncertain.',
      },
    },
    required: ['verdict', 'confidence', 'reasoning'],
  },
};

// ---------------------------------------------------------------------------
// Type guard for parsed tool output
// ---------------------------------------------------------------------------

interface JudgeToolInput {
  verdict: string;
  confidence: number;
  reasoning: string;
  suggested_revision?: string;
}

function isJudgeToolInput(input: unknown): input is JudgeToolInput {
  if (typeof input !== 'object' || input === null) return false;
  const obj = input as Record<string, unknown>;
  return (
    typeof obj['verdict'] === 'string' &&
    typeof obj['confidence'] === 'number' &&
    typeof obj['reasoning'] === 'string'
  );
}

function parseVerdict(raw: string): Verdict {
  if (raw === 'valid' || raw === 'invalid' || raw === 'needs_revision' || raw === 'uncertain') {
    return raw;
  }
  // Unknown value from model — treat as uncertain rather than crash
  return 'uncertain';
}

// ---------------------------------------------------------------------------
// User message builder
// ---------------------------------------------------------------------------

function buildUserMessage(claim: NotesLogEntry, tier1Result?: TierOutput): string {
  const derivationConfig = DERIVATION_CONFIG[claim.derivation];
  const riskLabel = `${derivationConfig.riskLevel} risk`;

  const lines: string[] = [
    '## Claim to Evaluate',
    '',
    `**Claim ID**: ${claim.claim_id}`,
    `**Claim type**: ${claim.claim_type}`,
    `**Derivation method**: ${claim.derivation} (${riskLabel})`,
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

  if (tier1Result !== undefined) {
    lines.push('## Prior Tier 1 NLI Result (Inconclusive)');
    lines.push('');
    lines.push(
      'The NLI model at Tier 1 could not reach a confident verdict. ' +
        'Use this context to focus your evaluation on what NLI could not resolve — ' +
        'do not simply repeat what NLI already determined.',
    );
    lines.push(`- NLI verdict: ${tier1Result.verdict}`);
    lines.push(`- NLI confidence: ${(tier1Result.confidence * 100).toFixed(1)}%`);
    lines.push(`- NLI reasoning: ${tier1Result.reasoning}`);
    lines.push('');
  }

  lines.push(
    'Please evaluate the claim against the source material and call `submit_evaluation` ' +
      'with your structured assessment.',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Decision logic
// ---------------------------------------------------------------------------

function applyDecisionLogic(raw: JudgeToolInput): TierOutput {
  const verdict = parseVerdict(raw.verdict);
  const confidence = Math.max(0, Math.min(1, raw.confidence));

  if (confidence > CONFIDENCE_EXIT_THRESHOLD) {
    // Confident verdict — exit Tier 2
    const output: TierOutput = {
      tier_id: 2,
      verdict,
      confidence,
      reasoning: raw.reasoning,
    };
    if (raw.suggested_revision !== undefined && raw.suggested_revision.length > 0) {
      output.suggested_revision = raw.suggested_revision;
    }
    return output;
  }

  if (confidence < CONFIDENCE_HIGH_PRIORITY_THRESHOLD) {
    // Very low confidence — escalate to Tier 3 as high priority
    return {
      tier_id: 2,
      verdict: 'uncertain',
      confidence,
      reasoning:
        `[HIGH-PRIORITY ESCALATION: confidence ${(confidence * 100).toFixed(1)}% < ` +
        `${(CONFIDENCE_HIGH_PRIORITY_THRESHOLD * 100).toFixed(0)}% threshold] ` +
        raw.reasoning,
    };
  }

  // Mid-band confidence (0.6–0.85) — escalate to Tier 3 normally
  return {
    tier_id: 2,
    verdict: 'uncertain',
    confidence,
    reasoning:
      `[ESCALATING TO TIER 3: confidence ${(confidence * 100).toFixed(1)}% is below ` +
      `the ${(CONFIDENCE_EXIT_THRESHOLD * 100).toFixed(0)}% exit threshold] ` +
      raw.reasoning,
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Evaluate a claim at HERALD Tier 2 using Claude Sonnet as a domain-aware judge.
 *
 * @param claim       - The claim and its source provenance from the notes log.
 * @param tier1Result - Optional Tier 1 NLI result (when Tier 1 was inconclusive).
 *                      Passed to the judge so it can focus on what NLI missed.
 * @returns TierOutput with verdict, confidence, reasoning, and optional revision.
 */
export async function evaluateWithLLMJudge(
  claim: NotesLogEntry,
  tier1Result?: TierOutput,
): Promise<TierOutput> {
  const span = startSpan('herald.tier2.evaluate', {
    claim_id: claim.claim_id,
    claim_type: claim.claim_type,
    derivation: claim.derivation,
    has_tier1_context: tier1Result !== undefined,
  });

  try {
    const systemPrompt = getJudgePrompt(claim.claim_type);
    const userMessage = buildUserMessage(claim, tier1Result);

    const response = await getClient().messages.create({
      model: JUDGE_MODEL,
      max_tokens: JUDGE_MAX_TOKENS,
      temperature: JUDGE_TEMPERATURE,
      system: [
        {
          type: 'text' as const,
          text: systemPrompt,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      tools: [SUBMIT_EVALUATION_TOOL],
      tool_choice: { type: 'tool' as const, name: 'submit_evaluation' },
      messages: [{ role: 'user' as const, content: userMessage }],
    });

    // Extract the tool_use block — required by tool_choice: { type: 'tool' }
    const toolUseBlock = response.content.find((b) => b.type === 'tool_use');
    if (toolUseBlock === undefined) {
      throw new Error(
        `Tier 2 judge model did not call submit_evaluation. ` +
          `stop_reason=${response.stop_reason ?? 'null'}, ` +
          `content_types=${response.content.map((b) => b.type).join(',')}`,
      );
    }

    if (!isJudgeToolInput(toolUseBlock.input)) {
      throw new Error(
        `submit_evaluation tool input failed validation: ` + JSON.stringify(toolUseBlock.input),
      );
    }

    const result = applyDecisionLogic(toolUseBlock.input);

    span.end({
      verdict: result.verdict,
      confidence: result.confidence,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    });

    return result;
  } catch (error) {
    logError('herald.tier2.evaluate', error, {
      claim_id: claim.claim_id,
      claim_type: claim.claim_type,
    });
    span.end({ error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
