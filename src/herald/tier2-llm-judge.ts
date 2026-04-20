/**
 * HERALD Tier 2 — LLM-as-Judge evaluation.
 *
 * Calls Groq (Llama 3.3 70B) to assess a claim against its cited source chunks
 * using a claim-type-specific evaluation prompt.  This tier handles:
 *
 *   - Claims that Tier 1 (NLI) returned 'uncertain' on (statistical, comparative, causal)
 *   - Claims that skip NLI entirely (predictive, normative, synthesis)
 *
 * Decision thresholds (from CLAUDE.md, calibrated after benchmark01):
 *   confidence > 0.80   → exit with verdict (valid / invalid)
 *   confidence 0.6–0.80 → override to 'uncertain', escalate to Tier 3
 *   confidence < 0.6    → override to 'uncertain', escalate to Tier 3 (high-priority)
 */

import OpenAI from 'openai';

import { DERIVATION_CONFIG, DerivationMethod, type NotesLogEntry } from '../types/claims';
import type { MeaningDriftLabel, TierOutput, Verdict } from '../types/herald';
import { logError, startSpan } from '../observability/braintrust';
import { getJudgePrompt } from './prompts/judge-system';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JUDGE_MODEL = 'gpt-4o-mini';
const JUDGE_TEMPERATURE = 0.2;
const JUDGE_MAX_TOKENS = 1024;

/** Confidence at or above this value → exit with the model's verdict. */
const CONFIDENCE_EXIT_THRESHOLD = 0.8;

/** Confidence below this value → escalate to Tier 3 with high-priority flag. */
const CONFIDENCE_HIGH_PRIORITY_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// OpenAI client (lazy singleton)
// ---------------------------------------------------------------------------

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client === null) {
    _client = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Function definition for structured output (OpenAI-compatible tool calling)
// ---------------------------------------------------------------------------

const SUBMIT_EVALUATION_FUNCTION: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'submit_evaluation',
    description:
      'Submit the structured claim evaluation result. ' +
      'Always call this function — do not respond with plain text.',
    parameters: {
      type: 'object',
      properties: {
        verdict: {
          type: 'string',
          enum: ['valid', 'invalid', 'uncertain'],
          description: 'The evaluation verdict for this claim.',
        },
        confidence: {
          type: 'number',
          description:
            'Confidence in the verdict, from 0.0 (very uncertain) to 1.0 (very certain).',
        },
        reasoning: {
          type: 'string',
          description:
            'Clear, specific reasoning citing source material. ' +
            'For invalid verdicts, identify the specific mismatch.',
        },
        suggested_revision: {
          type: ['string', 'null'],
          description:
            'Concrete revised claim text that would be valid. ' +
            'Required for invalid verdicts; omit for valid/uncertain.',
        },
        meaning_drift_label: {
          type: ['string', 'null'],
          enum: [
            'no_drift',
            'hedging_drift',
            'scope_drift',
            'attribution_drift',
            'causal_strength_drift',
            'normative_strength_drift',
            'quantification_drift',
            null,
          ],
          description:
            'For paraphrase claims, classify whether any meaning drift occurred. ' +
            'Use no_drift when the paraphrase is faithful; otherwise choose the main drift type. ' +
            'Use null for non-paraphrase claims.',
        },
      },
      required: ['verdict', 'confidence', 'reasoning'],
    },
  },
};

// ---------------------------------------------------------------------------
// Type guard for parsed function output
// ---------------------------------------------------------------------------

interface JudgeToolInput {
  verdict: string;
  confidence: number;
  reasoning: string;
  suggested_revision?: string;
  meaning_drift_label?: MeaningDriftLabel | null;
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
  if (raw === 'valid' || raw === 'invalid' || raw === 'uncertain') {
    return raw;
  }
  // Unknown value from model (including legacy 'needs_revision') — treat as invalid
  if (raw === 'needs_revision') return 'invalid';
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

  if (claim.derivation === DerivationMethod.Paraphrase) {
    lines.push('## Paraphrase Fidelity Checklist');
    lines.push('');
    lines.push(
      'This is a paraphrase claim. Compare the claim against the source for proposition, scope, ' +
        'timeframe, attribution, modality/hedging, and strength of causal or normative language.',
    );
    lines.push(
      'If those elements are preserved, treat wording differences as a faithful paraphrase and ' +
        'prefer `valid` over `invalid`.',
    );
    lines.push(
      'If there is drift, classify the primary issue using one label: no_drift, hedging_drift, ' +
        'scope_drift, attribution_drift, causal_strength_drift, normative_strength_drift, or quantification_drift.',
    );
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
    if (raw.meaning_drift_label !== undefined) {
      output.meaning_drift_label = raw.meaning_drift_label;
    }
    return output;
  }

  if (confidence < CONFIDENCE_HIGH_PRIORITY_THRESHOLD) {
    // Very low confidence — escalate to Tier 3 as high priority
    return {
      tier_id: 2,
      verdict: 'uncertain',
      confidence,
      meaning_drift_label: raw.meaning_drift_label,
      reasoning:
        `[HIGH-PRIORITY ESCALATION: confidence ${(confidence * 100).toFixed(1)}% < ` +
        `${(CONFIDENCE_HIGH_PRIORITY_THRESHOLD * 100).toFixed(0)}% threshold] ` +
        raw.reasoning,
    };
  }

  // Mid-band confidence (0.6–0.80) — escalate to Tier 3 normally
  return {
    tier_id: 2,
    verdict: 'uncertain',
    confidence,
    meaning_drift_label: raw.meaning_drift_label,
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
 * Evaluate a claim at HERALD Tier 2 using Groq Llama 3.3 70B as a domain-aware judge.
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

    const response = await getClient().chat.completions.create({
      model: JUDGE_MODEL,
      max_tokens: JUDGE_MAX_TOKENS,
      temperature: JUDGE_TEMPERATURE,
      tools: [SUBMIT_EVALUATION_FUNCTION],
      tool_choice: { type: 'function', function: { name: 'submit_evaluation' } },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    });

    // Extract the function call — required by tool_choice: function
    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    const plainTextContent = response.choices[0]?.message?.content ?? '';

    let parsed: unknown;

    if (toolCall !== undefined && toolCall.type === 'function') {
      // Normal path: model called the function
      try {
        parsed = JSON.parse(toolCall.function.arguments) as unknown;
      } catch {
        throw new Error(
          `submit_evaluation arguments JSON parse failed: ${toolCall.function.arguments.slice(0, 300)}`,
        );
      }
    } else if (toolCall !== undefined) {
      throw new Error(`submit_evaluation received unexpected tool_call type: ${toolCall.type}`);
    } else if (plainTextContent.length > 0) {
      // Fallback: Groq occasionally ignores tool_choice and returns plain text JSON
      const jsonMatch = /\{[\s\S]*\}/.exec(plainTextContent);
      if (jsonMatch === null) {
        throw new Error(
          `Tier 2 judge did not call submit_evaluation and response contains no JSON. ` +
            `finish_reason=${response.choices[0]?.finish_reason ?? 'null'}`,
        );
      }
      try {
        parsed = JSON.parse(jsonMatch[0]) as unknown;
      } catch {
        throw new Error(
          `Tier 2 judge plain-text JSON parse failed: ${plainTextContent.slice(0, 300)}`,
        );
      }
    } else {
      throw new Error(
        `Tier 2 judge model did not call submit_evaluation. ` +
          `finish_reason=${response.choices[0]?.finish_reason ?? 'null'}`,
      );
    }

    if (!isJudgeToolInput(parsed)) {
      throw new Error(`submit_evaluation arguments failed validation: ` + JSON.stringify(parsed));
    }

    const result = applyDecisionLogic(parsed);

    span.end({
      verdict: result.verdict,
      confidence: result.confidence,
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
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
