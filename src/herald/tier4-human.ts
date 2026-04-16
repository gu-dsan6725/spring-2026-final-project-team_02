/**
 * HERALD Tier 4 — Human Review Queue (Checkpoint 7.2)
 *
 * Manages the queue of claims that have exhausted automated evaluation (Tiers 1-3)
 * and require a human reviewer to make the final determination.
 *
 * Storage: in-memory Map keyed by memo_id.  In production this would be backed
 * by the PostgreSQL database via a claim_review_queue table; the interface here
 * is designed to make that swap trivial.
 *
 * Public API:
 *   submitForHumanReview(claim, previousTierResults, memoId?)
 *   getHumanReviewQueue(memoId)
 *   submitHumanVerdict(claimId, verdict, notes, suggestedRevision?)
 *   clearQueue()  — test/dev helper
 */

import type { NotesLogEntry } from '../types/claims';
import type { HeraldResult, TierOutput, Verdict } from '../types/herald';
import { logWarn } from '../observability/braintrust';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface HumanReviewEntry {
  /** Unique ID for this review queue entry. */
  id: string;
  memo_id: string;
  claim: NotesLogEntry;
  /** Full evaluation trail from all tiers that ran before escalating to Tier 4. */
  previous_tier_results: TierOutput[];
  /** Human-readable explanation of why this reached Tier 4. */
  escalation_reason: string;
  status: 'pending' | 'reviewed';
  submitted_at: string;
  reviewed_at: string | null;
  verdict: Verdict | null;
  notes: string | null;
  suggested_revision: string | null;
}

export interface HumanVerdictSubmission {
  verdict: Verdict;
  notes: string;
  suggested_revision?: string;
}

export interface HumanReviewResult {
  entry: HumanReviewEntry;
  /** If the verdict is valid, this is the updated HeraldResult to record. */
  resolved_herald_result: HeraldResult | null;
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

// Map<memo_id, HumanReviewEntry[]>
const _queue: Map<string, HumanReviewEntry[]> = new Map();

const DEFAULT_MEMO_ID = 'default';

function getOrCreateQueue(memoId: string): HumanReviewEntry[] {
  let entries = _queue.get(memoId);
  if (entries === undefined) {
    entries = [];
    _queue.set(memoId, entries);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `review-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildEscalationReason(previousResults: TierOutput[]): string {
  const lastResult = previousResults.at(-1);

  if (lastResult === undefined) {
    return 'No automated tier produced a confident verdict. Manual review required.';
  }

  const tierLabel =
    lastResult.tier_id === 1
      ? 'NLI model'
      : lastResult.tier_id === 2
        ? 'LLM Judge'
        : 'Multi-Agent Debate';

  return (
    `${tierLabel} (Tier ${String(lastResult.tier_id)}) confidence was below the exit threshold ` +
    `(${Math.round(lastResult.confidence * 100).toString()}%). ` +
    `Verdict was '${lastResult.verdict}'. Human adjudication required.`
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add a claim to the human review queue.
 *
 * @param claim              The notes log entry for the claim requiring review.
 * @param previousTierResults Full list of TierOutput records from all tiers that ran.
 * @param memoId             Memo identifier (defaults to 'default').
 * @returns The created HumanReviewEntry.
 */
export function submitForHumanReview(
  claim: NotesLogEntry,
  previousTierResults: TierOutput[],
  memoId: string = DEFAULT_MEMO_ID,
): HumanReviewEntry {
  const queue = getOrCreateQueue(memoId);

  // Prevent duplicates: if already pending, return existing entry
  const existing = queue.find((e) => e.claim.claim_id === claim.claim_id && e.status === 'pending');
  if (existing !== undefined) {
    logWarn('tier4.duplicate_submission', {
      claim_id: claim.claim_id,
      memo_id: memoId,
      existing_id: existing.id,
    });
    return existing;
  }

  const entry: HumanReviewEntry = {
    id: generateId(),
    memo_id: memoId,
    claim,
    previous_tier_results: previousTierResults,
    escalation_reason: buildEscalationReason(previousTierResults),
    status: 'pending',
    submitted_at: new Date().toISOString(),
    reviewed_at: null,
    verdict: null,
    notes: null,
    suggested_revision: null,
  };

  queue.push(entry);
  return entry;
}

/**
 * Return all review queue entries for a given memo (pending and reviewed).
 *
 * @param memoId Memo identifier.
 * @returns Sorted list of entries (pending first, then by submission time).
 */
export function getHumanReviewQueue(memoId: string = DEFAULT_MEMO_ID): HumanReviewEntry[] {
  const queue = _queue.get(memoId) ?? [];
  return [...queue].sort((a, b) => {
    // Pending before reviewed
    if (a.status !== b.status) {
      return a.status === 'pending' ? -1 : 1;
    }
    return a.submitted_at.localeCompare(b.submitted_at);
  });
}

/**
 * Submit a human verdict for a pending review entry.
 *
 * @param claimId          The claim_id to resolve.
 * @param submission       The human's verdict, notes, and optional suggested revision.
 * @param memoId           Memo identifier.
 * @returns HumanReviewResult with the updated entry and resolved HeraldResult.
 */
export function submitHumanVerdict(
  claimId: string,
  submission: HumanVerdictSubmission,
  memoId: string = DEFAULT_MEMO_ID,
): HumanReviewResult {
  const queue = getOrCreateQueue(memoId);
  const entry = queue.find((e) => e.claim.claim_id === claimId && e.status === 'pending');

  if (entry === undefined) {
    throw new Error(`No pending review entry found for claim_id='${claimId}' in memo '${memoId}'.`);
  }

  entry.status = 'reviewed';
  entry.reviewed_at = new Date().toISOString();
  entry.verdict = submission.verdict;
  entry.notes = submission.notes;
  entry.suggested_revision = submission.suggested_revision ?? null;

  // Build a HeraldResult that records the human's decision
  const resolvedHeraldResult: HeraldResult = {
    claim_id: claimId,
    tier_reached: 4,
    verdict: submission.verdict,
    confidence: 1.0, // human verdict is authoritative
    feedback: submission.notes,
    suggested_revision: submission.suggested_revision ?? null,
    tier_details: {
      tier_1: entry.previous_tier_results.find((t) => t.tier_id === 1) ?? null,
      tier_2: entry.previous_tier_results.find((t) => t.tier_id === 2) ?? null,
      tier_3: entry.previous_tier_results.find((t) => t.tier_id === 3) ?? null,
      tier_4: {
        tier_id: 4,
        verdict: submission.verdict,
        confidence: 1.0,
        reasoning: submission.notes,
        suggested_revision: submission.suggested_revision,
      },
    },
  };

  return {
    entry,
    resolved_herald_result: resolvedHeraldResult,
  };
}

/**
 * Get a single pending review entry by claim_id.
 * Returns undefined if not found or already reviewed.
 */
export function getPendingEntry(
  claimId: string,
  memoId: string = DEFAULT_MEMO_ID,
): HumanReviewEntry | undefined {
  return (_queue.get(memoId) ?? []).find(
    (e) => e.claim.claim_id === claimId && e.status === 'pending',
  );
}

/** Returns the count of pending reviews for a memo. */
export function getPendingCount(memoId: string = DEFAULT_MEMO_ID): number {
  return (_queue.get(memoId) ?? []).filter((e) => e.status === 'pending').length;
}

/**
 * Clear the entire queue (all memos).
 * Used in tests and development. Do not call in production.
 */
export function clearQueue(): void {
  _queue.clear();
}
