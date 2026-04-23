/**
 * HERALD Tier 3 — Senior Reviewer (single focused haiku call).
 *
 * Previously implemented as a 3-persona multi-agent debate, which caused:
 *   1. Adversarial convergence: the Skeptic persona biased verdicts toward "invalid"
 *   2. High crash rate: judge tool calls frequently omitted the "reasoning" field,
 *      causing isSynthesisInput() to throw and mark claims as wrong
 *   3. Cost: 4 haiku calls per claim (3 personas + judge) made HERALD more expensive
 *      than a single haiku call despite having cheaper NLI and mini-T2 stages
 *
 * New design: one haiku call that receives the full claim context + T2 reasoning
 * and makes a final definitive assessment. The model acts as a "senior reviewer"
 * with explicit calibration bias toward VALID for close calls.
 *
 * Decision logic unchanged:
 *   - Confidence > 0.80 → exit with verdict
 *   - Confidence ≤ 0.80 → escalate to Tier 4 (human review)
 */

import Anthropic from '@anthropic-ai/sdk';

import type { NotesLogEntry } from '../types/claims';
import type { TierOutput, Verdict } from '../types/herald';
import { logError, startSpan } from '../observability/braintrust';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REVIEWER_MODEL = 'claude-haiku-4-5';
const REVIEWER_TEMPERATURE = 0.1;
const REVIEWER_MAX_TOKENS = 1024;
const JUDGE_CONFIDENCE_THRESHOLD = 0.8;

// ---------------------------------------------------------------------------
// Anthropic client (lazy singleton)
// ---------------------------------------------------------------------------

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client === null) {
    _client = new Anthropic({
      apiKey: process.env['ANTHROPIC_API_KEY'],
    });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const REVIEW_TOOL: Anthropic.Tool = {
  name: 'submit_review',
  description:
    'Submit your final verdict on the claim. Always call this — do not respond with plain text.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: {
        type: 'string',
        enum: ['valid', 'invalid', 'uncertain'],
        description: 'Your final verdict.',
      },
      confidence: {
        type: 'number',
        description: 'Confidence in your verdict (0.0–1.0). Be calibrated — use 0.85+ only when the answer is clear.',
      },
      reasoning: {
        type: 'string',
        description:
          'Your reasoning citing specific source text. For invalid verdicts, identify the exact error.',
      },
      suggested_revision: {
        type: 'string',
        description: 'Required for invalid verdicts only. A concrete revised claim text.',
      },
    },
    required: ['verdict', 'confidence', 'reasoning'],
  },
};

// ---------------------------------------------------------------------------
// Type guard — lenient: only verdict and confidence are truly required
// ---------------------------------------------------------------------------

interface ReviewInput {
  verdict: string;
  confidence: number;
  reasoning: string;
  suggested_revision?: string | null;
}

function isReviewInput(obj: unknown): obj is ReviewInput {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  // reasoning is expected but tolerated as missing — fall back to a placeholder
  return typeof o['verdict'] === 'string' && typeof o['confidence'] === 'number';
}

function parseVerdict(raw: string): Verdict {
  if (raw === 'valid' || raw === 'invalid' || raw === 'uncertain') return raw;
  if (raw === 'needs_revision') return 'invalid';
  return 'uncertain';
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  return `You are a senior policy research analyst making a final definitive assessment of a claim's validity.

The claim has already been reviewed by a Tier 2 LLM judge that was unable to reach a confident verdict. Your job is to make the final call.

**Your evaluation standard:**
- VALID: The claim is faithfully supported by the cited source material. It may be a paraphrase, aggregation, or cross-source synthesis — that is fine as long as the conclusion follows from the evidence.
- INVALID: There is a specific, concrete, quotable error — wrong number, wrong direction, fabricated projection, unsupported causal claim, or material misrepresentation. You must be able to point to the exact phrase in the source that contradicts the claim.
- UNCERTAIN: You have doubts but cannot identify a specific concrete error. The evidence is genuinely ambiguous or the source excerpt is too short to evaluate.

**Critical calibration rules:**
1. When in doubt between INVALID and UNCERTAIN, choose UNCERTAIN.
2. When in doubt between VALID and UNCERTAIN, choose VALID.
3. A paraphrase that preserves the proposition, scope, timeframe, and attribution is VALID even when the wording differs.
4. A synthesis claim is VALID if the conclusion follows logically from the combined sources — it does not need to appear verbatim in any single source.
5. Do NOT penalize a claim for omitting caveats the source mentions unless the omission materially changes the meaning.
6. Theoretical alternative explanations are NOT grounds for INVALID. You must identify a specific inferential error or misrepresentation.

Always call the submit_review tool with your assessment.`.trim();
}

function buildClaimContext(claim: NotesLogEntry, tier2Output: TierOutput): string {
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
    lines.push(`### Source ${String(i + 1)}: ${src.source_title}`);
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
    `The Tier 2 reviewer returned: **${tier2Output.verdict}** at ${Math.round(tier2Output.confidence * 100).toString()}% confidence.`,
  );
  lines.push(`Tier 2 reasoning: ${tier2Output.reasoning}`);
  lines.push('');
  lines.push(
    'This is a close call. Make the definitive assessment. Do not simply echo the Tier 2 result — ' +
      'use the source material directly. Call submit_review with your verdict.',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------

// Main export
// ---------------------------------------------------------------------------

/**
 * Run the HERALD Tier 3 Senior Reviewer (single haiku call).
 *
 * @param claim       - The claim and its source provenance.
 * @param tier2Output - The inconclusive Tier 2 result (context for the reviewer).
 * @returns TierOutput with final verdict, confidence, and reasoning.
 */
export async function evaluateWithDebate(
  claim: NotesLogEntry,
  tier2Output: TierOutput,
): Promise<TierOutput> {
  const span = startSpan('herald.tier3.reviewer', {
    claim_id: claim.claim_id,
    claim_type: claim.claim_type,
    tier2_verdict: tier2Output.verdict,
    tier2_confidence: tier2Output.confidence,
  });

  try {
    const claimContext = buildClaimContext(claim, tier2Output);

    const response = await getClient().messages.create({
      model: REVIEWER_MODEL,
      max_tokens: REVIEWER_MAX_TOKENS,
      temperature: REVIEWER_TEMPERATURE,
      system: buildSystemPrompt(),
      tools: [REVIEW_TOOL],
      tool_choice: { type: 'tool', name: 'submit_review' },
      messages: [{ role: 'user', content: claimContext }],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    let parsed: unknown;

    if (toolUse != null) {
      parsed = toolUse.input;
    } else {
      // Fallback: extract JSON from text block
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
      const text = textBlock?.text ?? '';
      const jsonMatch = /\{[\s\S]*\}/.exec(text);
      if (jsonMatch === null) {
        throw new Error(
          `Senior reviewer did not call submit_review and response contains no JSON. ` +
            `stop_reason=${response.stop_reason ?? 'null'}`,
        );
      }
      try {
        parsed = JSON.parse(jsonMatch[0]) as unknown;
      } catch {
        throw new Error(`Senior reviewer plain-text JSON parse failed: ${text.slice(0, 200)}`);
      }
    }

    if (!isReviewInput(parsed)) {
      throw new Error(
        `Senior reviewer output missing required fields (verdict, confidence): ${JSON.stringify(parsed)}`,
      );
    }

    const rawParsed = parsed as unknown as Record<string, unknown>;
    const reasoning =
      typeof rawParsed['reasoning'] === 'string'
        ? rawParsed['reasoning']
        : `Verdict: ${parsed.verdict} (reasoning not provided by model)`;

    const verdict = parseVerdict(parsed.verdict);
    const confidence = Math.max(0, Math.min(1, parsed.confidence));

    const output: TierOutput = {
      tier_id: 3,
      verdict: confidence > JUDGE_CONFIDENCE_THRESHOLD ? verdict : 'uncertain',
      confidence,
      reasoning,
    };

    if (
      typeof rawParsed['suggested_revision'] === 'string' &&
      (rawParsed['suggested_revision'] as string).length > 0
    ) {
      output.suggested_revision = rawParsed['suggested_revision'] as string;
    }

    if (response.usage != null) {
      output.usage = {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        api_calls: 1,
      };
    }

    span.end({ verdict: output.verdict, confidence });

    return output;
  } catch (error) {
    logError('herald.tier3.reviewer', error, {
      claim_id: claim.claim_id,
      claim_type: claim.claim_type,
    });
    span.end({ error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
