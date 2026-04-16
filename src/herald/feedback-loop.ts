/**
 * HERALD Feedback Loop — Revision Pipeline (Checkpoint 7.1)
 *
 * Takes invalid/needs_revision HERALD verdicts and sends claims back to the
 * LLM for revision.  Enforces convergence: at most 2 revision attempts per
 * claim (configurable via AgentConfig.max_revision_attempts).
 *
 * Flow:
 *   invalid/needs_revision claim
 *     → buildRevisionPrompt (includes HERALD feedback, sources, suggested revision)
 *     → Groq Llama 3.3 70B produces a revised claim + updated notes log entry
 *     → re-run HERALD on revised claim
 *     → if PASS → update memo + notes log
 *     → if FAIL and attempts < max → revise again with accumulated feedback
 *     → if FAIL and attempts >= max → flag as requires_human_intervention
 */

import Groq from 'groq-sdk';

import {
  CLAIM_TYPE_CONFIG,
  DerivationMethod,
  DERIVATION_CONFIG,
  type NotesLogEntry,
} from '../types/claims';
import type { HeraldResult, TierOutput } from '../types/herald';
import type { AgentConfig } from '../types/agent';
import { DEFAULT_AGENT_CONFIG } from '../types/agent';
import type { MemoOutput } from '../types/memo';
import { logError, logWarn, startSpan } from '../observability/braintrust';
import { evaluateClaim } from './router';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RevisionAttempt {
  attempt_number: number;
  revised_claim_text: string;
  herald_result: HeraldResult;
  passed: boolean;
}

export interface ClaimRevisionState {
  claim_id: string;
  original_claim_text: string;
  revision_count: number;
  /** 'revised' = passed HERALD after revision; 'failed_max_attempts' = flagged for human review */
  status: 'revised' | 'failed_max_attempts' | 'unchanged';
  final_claim_text: string;
  final_notes_entry: NotesLogEntry;
  final_herald_result: HeraldResult | null;
  attempts: RevisionAttempt[];
}

export interface RevisedMemoOutput {
  memo_markdown: string;
  notes_log: NotesLogEntry[];
  revision_states: ClaimRevisionState[];
  /** claim_ids that exceeded max revision attempts and need human review */
  requires_human_intervention: string[];
}

// ---------------------------------------------------------------------------
// Groq client (lazy singleton — same pattern as research-agent.ts)
// ---------------------------------------------------------------------------

let _groqClient: Groq | null = null;

function getGroqClient(): Groq {
  if (_groqClient === null) {
    _groqClient = new Groq({ apiKey: process.env['GROQ_API_KEY'] });
  }
  return _groqClient;
}

const REVISION_MODEL = 'llama-3.3-70b-versatile';
const REVISION_MAX_TOKENS = 1024;
const REVISION_TEMPERATURE = 0.3;

// ---------------------------------------------------------------------------
// Verdict predicate helpers
// ---------------------------------------------------------------------------

function needsRevision(verdict: HeraldResult['verdict']): boolean {
  return verdict === 'invalid' || verdict === 'needs_revision';
}

function isPassingVerdict(verdict: HeraldResult['verdict']): boolean {
  return verdict === 'valid';
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a meticulous policy research editor responsible for revising factual claims in policy memos. You are given a claim, its cited sources, and structured feedback from an evaluation pipeline explaining exactly why the claim is problematic.

Your job is to revise the claim so that it faithfully represents what the sources actually say. You may:
- Rewrite the claim to be more accurate or add necessary qualifiers
- Narrow the scope of the claim to match what the source actually demonstrates
- Replace it with a different, related claim that IS supported by the sources
- If the sources genuinely cannot support any reasonable version of this claim, say so explicitly

You MUST respond with a JSON object containing exactly these fields:
{
  "revised_claim_text": "The revised claim text, or the string 'UNSUPPORTABLE' if no valid claim can be made from these sources.",
  "reasoning": "Brief explanation of what you changed and why.",
  "derivation_update": "one of: direct_extraction | paraphrase | cross_source | agent_inference — update if the revision changes the derivation method"
}

Do not add any text outside the JSON object.`;

function buildRevisionPrompt(
  claim: NotesLogEntry,
  heraldResult: HeraldResult,
  previousAttempts: RevisionAttempt[],
): string {
  const claimTypeCfg = CLAIM_TYPE_CONFIG[claim.claim_type];
  const derivationCfg = DERIVATION_CONFIG[claim.derivation];

  const lines: string[] = [
    '## Claim Requiring Revision',
    '',
    `**Claim ID**: ${claim.claim_id}`,
    `**Claim type**: ${claim.claim_type} — ${claimTypeCfg.label}`,
    `**Derivation method**: ${claim.derivation} — ${derivationCfg.label} (${derivationCfg.riskLevel} risk)`,
    '',
    '**Original claim text**:',
    `"${claim.claim_text}"`,
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

  if (claim.sources.length === 0) {
    lines.push('*No sources cited for this claim.*');
    lines.push('');
  }

  lines.push('## HERALD Evaluation Feedback');
  lines.push('');
  lines.push(`**Verdict**: ${heraldResult.verdict}`);
  lines.push(`**Tier reached**: ${String(heraldResult.tier_reached)}`);
  lines.push(`**Feedback**: ${heraldResult.feedback}`);

  if (heraldResult.suggested_revision !== null && heraldResult.suggested_revision.length > 0) {
    lines.push('');
    lines.push('**Suggested revision from evaluator**:');
    lines.push(`"${heraldResult.suggested_revision}"`);
  }

  if (previousAttempts.length > 0) {
    lines.push('');
    lines.push('## Previous Revision Attempts (All Failed)');
    lines.push('');
    lines.push(
      'The following revisions were tried and still failed HERALD evaluation. ' +
        'Learn from these failures — do not repeat the same revision strategy.',
    );
    lines.push('');

    for (const attempt of previousAttempts) {
      lines.push(`### Attempt ${String(attempt.attempt_number)}: "${attempt.revised_claim_text}"`);
      lines.push(`HERALD verdict: **${attempt.herald_result.verdict}**`);
      lines.push(`Feedback: ${attempt.herald_result.feedback}`);
      lines.push('');
    }
  }

  lines.push('## Task');
  lines.push('');
  lines.push(
    'Revise this claim to address the feedback above. Respond with only a JSON object as described in the system prompt.',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Revision agent call
// ---------------------------------------------------------------------------

interface RevisionOutput {
  revised_claim_text: string;
  reasoning: string;
  derivation_update: string;
}

function isRevisionOutput(obj: unknown): obj is RevisionOutput {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o['revised_claim_text'] === 'string' &&
    typeof o['reasoning'] === 'string' &&
    typeof o['derivation_update'] === 'string'
  );
}

async function callRevisionAgent(prompt: string): Promise<RevisionOutput> {
  const response = await getGroqClient().chat.completions.create({
    model: REVISION_MODEL,
    max_tokens: REVISION_MAX_TOKENS,
    temperature: REVISION_TEMPERATURE,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
  });

  const content = response.choices[0]?.message?.content ?? '';

  // Extract JSON from the response (may have markdown code fences)
  const jsonMatch = /\{[\s\S]*\}/.exec(content);
  if (jsonMatch === null) {
    throw new Error(`Revision agent did not return valid JSON. Raw: ${content.slice(0, 300)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]) as unknown;
  } catch {
    throw new Error(`Revision agent JSON parse failed. Raw: ${jsonMatch[0].slice(0, 300)}`);
  }

  if (!isRevisionOutput(parsed)) {
    throw new Error(`Revision agent output missing required fields: ${JSON.stringify(parsed)}`);
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Memo rewriting — replaces old claim text with new in the markdown prose
// ---------------------------------------------------------------------------

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rewriteMemoMarkdown(markdown: string, oldClaimText: string, newClaimText: string): string {
  if (newClaimText === 'UNSUPPORTABLE' || newClaimText.length === 0) {
    return markdown;
  }
  // Use regex replacement to safely handle special characters in claim text
  return markdown.replace(new RegExp(escapeRegExp(oldClaimText), 'g'), newClaimText);
}

// ---------------------------------------------------------------------------
// Derivation method normaliser
// ---------------------------------------------------------------------------

const VALID_DERIVATIONS: DerivationMethod[] = [
  DerivationMethod.DirectExtraction,
  DerivationMethod.Paraphrase,
  DerivationMethod.CrossSource,
  DerivationMethod.AgentInference,
];

function normaliseDerivation(raw: string, fallback: DerivationMethod): DerivationMethod {
  if ((VALID_DERIVATIONS as string[]).includes(raw)) {
    return raw as DerivationMethod;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Single-claim revision loop
// ---------------------------------------------------------------------------

async function reviseSingleClaim(
  claim: NotesLogEntry,
  initialHeraldResult: HeraldResult,
  maxAttempts: number,
): Promise<ClaimRevisionState> {
  const state: ClaimRevisionState = {
    claim_id: claim.claim_id,
    original_claim_text: claim.claim_text,
    revision_count: 0,
    status: 'unchanged',
    final_claim_text: claim.claim_text,
    final_notes_entry: { ...claim },
    final_herald_result: initialHeraldResult,
    attempts: [],
  };

  let currentClaim = { ...claim };
  let currentHeraldResult = initialHeraldResult;
  const previousAttempts: RevisionAttempt[] = [];

  while (state.revision_count < maxAttempts && needsRevision(currentHeraldResult.verdict)) {
    const attemptNumber = state.revision_count + 1;
    const span = startSpan('herald.feedback_loop.revision_attempt', {
      claim_id: claim.claim_id,
      attempt: attemptNumber,
    });

    try {
      const prompt = buildRevisionPrompt(currentClaim, currentHeraldResult, previousAttempts);
      const revisionOutput = await callRevisionAgent(prompt);

      // Check if the agent declared the claim unsupportable
      if (revisionOutput.revised_claim_text === 'UNSUPPORTABLE') {
        logWarn('feedback_loop.unsupportable', {
          claim_id: claim.claim_id,
          attempt: attemptNumber,
          reasoning: revisionOutput.reasoning,
        });
        span.end({ outcome: 'unsupportable' });
        break;
      }

      // Build updated notes log entry with revised text
      const updatedClaim: NotesLogEntry = {
        ...currentClaim,
        claim_text: revisionOutput.revised_claim_text,
        derivation: normaliseDerivation(revisionOutput.derivation_update, currentClaim.derivation),
        reasoning: revisionOutput.reasoning,
      };

      // Re-run HERALD on the revised claim
      const revisedHeraldResult = await evaluateClaim(updatedClaim);

      const attempt: RevisionAttempt = {
        attempt_number: attemptNumber,
        revised_claim_text: revisionOutput.revised_claim_text,
        herald_result: revisedHeraldResult,
        passed: isPassingVerdict(revisedHeraldResult.verdict),
      };

      state.revision_count += 1;
      state.attempts.push(attempt);
      previousAttempts.push(attempt);
      state.final_herald_result = revisedHeraldResult;

      span.end({
        verdict: revisedHeraldResult.verdict,
        passed: attempt.passed,
      });

      if (attempt.passed) {
        // Revision succeeded
        state.status = 'revised';
        state.final_claim_text = revisionOutput.revised_claim_text;
        state.final_notes_entry = updatedClaim;
        return state;
      }

      // Failed — loop will try again if attempts remain
      currentClaim = updatedClaim;
      currentHeraldResult = revisedHeraldResult;
    } catch (err) {
      logError('feedback_loop.revision_attempt', err, {
        claim_id: claim.claim_id,
        attempt: attemptNumber,
      });
      span.end({ error: err instanceof Error ? err.message : String(err) });
      // Don't re-throw — treat as a failed attempt and stop
      break;
    }
  }

  // Exhausted attempts without passing
  state.status = 'failed_max_attempts';
  return state;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run the HERALD revision pipeline for all invalid/needs_revision claims.
 *
 * @param memo         - The generated memo (markdown + notes log)
 * @param heraldResults - HERALD evaluation results for the memo's claims
 * @param config       - Agent configuration (controls max_revision_attempts)
 * @returns RevisedMemoOutput with updated memo, notes log, and revision states
 */
export async function reviseClaimsFromHerald(
  memo: MemoOutput,
  heraldResults: HeraldResult[],
  config: AgentConfig = DEFAULT_AGENT_CONFIG,
): Promise<RevisedMemoOutput> {
  const span = startSpan('herald.feedback_loop', {
    total_results: heraldResults.length,
    max_revision_attempts: config.max_revision_attempts,
  });

  // Index notes log by claim_id for fast lookup
  const notesIndex = new Map<string, NotesLogEntry>(memo.notes_log.map((e) => [e.claim_id, e]));

  // Filter to claims that need revision
  const toRevise = heraldResults.filter((r) => needsRevision(r.verdict));

  if (toRevise.length === 0) {
    span.end({ revised_count: 0, flagged_count: 0 });
    return {
      memo_markdown: memo.memo_markdown,
      notes_log: memo.notes_log,
      revision_states: [],
      requires_human_intervention: [],
    };
  }

  // Revise all claims (sequentially to avoid overwhelming the API)
  const revisionStates: ClaimRevisionState[] = [];
  for (const heraldResult of toRevise) {
    const claim = notesIndex.get(heraldResult.claim_id);
    if (claim === undefined) {
      logWarn('feedback_loop.missing_claim', {
        claim_id: heraldResult.claim_id,
        note: 'Claim in heraldResults has no matching notes log entry — skipping.',
      });
      continue;
    }

    const state = await reviseSingleClaim(claim, heraldResult, config.max_revision_attempts);
    revisionStates.push(state);
  }

  // Apply revisions to memo markdown and notes log
  let updatedMarkdown = memo.memo_markdown;
  const updatedNotesLog = [...memo.notes_log];

  const requiresHumanIntervention: string[] = [];

  for (const state of revisionStates) {
    if (state.status === 'revised') {
      // Update markdown (replace old claim text with new)
      updatedMarkdown = rewriteMemoMarkdown(
        updatedMarkdown,
        state.original_claim_text,
        state.final_claim_text,
      );

      // Update notes log entry in place
      const idx = updatedNotesLog.findIndex((e) => e.claim_id === state.claim_id);
      if (idx !== -1) {
        updatedNotesLog[idx] = state.final_notes_entry;
      }
    } else if (state.status === 'failed_max_attempts') {
      requiresHumanIntervention.push(state.claim_id);
    }
  }

  const revisedCount = revisionStates.filter((s) => s.status === 'revised').length;
  span.end({
    revised_count: revisedCount,
    flagged_count: requiresHumanIntervention.length,
  });

  return {
    memo_markdown: updatedMarkdown,
    notes_log: updatedNotesLog,
    revision_states: revisionStates,
    requires_human_intervention: requiresHumanIntervention,
  };
}

// ---------------------------------------------------------------------------
// Tier output builder helper (used by tests and tier4)
// ---------------------------------------------------------------------------

export function buildTierOutputSummary(result: HeraldResult): string {
  const parts: string[] = [];

  if (result.tier_details.tier_1 !== null) {
    const t1 = result.tier_details.tier_1;
    parts.push(
      `Tier 1 NLI: ${t1.verdict} (${Math.round(t1.confidence * 100).toString()}%) — ${t1.reasoning}`,
    );
  }
  if (result.tier_details.tier_2 !== null) {
    const t2 = result.tier_details.tier_2;
    parts.push(
      `Tier 2 Judge: ${t2.verdict} (${Math.round(t2.confidence * 100).toString()}%) — ${t2.reasoning}`,
    );
  }
  if (result.tier_details.tier_3 !== null) {
    const t3 = result.tier_details.tier_3;
    parts.push(
      `Tier 3 Debate: ${t3.verdict} (${Math.round(t3.confidence * 100).toString()}%) — ${t3.reasoning}`,
    );
  }

  return parts.join('\n\n');
}

// Export TierOutput type for tier4-human.ts
export type { TierOutput };
