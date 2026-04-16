/**
 * HERALD Tier 4 — Human Review Queue tests (Checkpoint 7.2)
 *
 * Tests cover:
 *   Queue submission:
 *   - submitForHumanReview creates an entry with correct fields
 *   - Submitting the same pending claim twice returns the existing entry (no duplicate)
 *   - Escalation reason reflects the last tier result
 *   - Entry with no tier results gets a generic escalation reason
 *
 *   Queue retrieval:
 *   - getHumanReviewQueue returns entries sorted: pending first, then by submission time
 *   - Empty memo returns an empty array
 *   - Entries for different memos are isolated
 *
 *   Verdict submission:
 *   - submitHumanVerdict marks entry as reviewed with all fields populated
 *   - HeraldResult from submitHumanVerdict has tier_reached=4 and confidence=1.0
 *   - Previous tier results are preserved in tier_details
 *   - Submitting verdict for unknown claimId throws
 *   - Submitting verdict for already-reviewed entry throws
 *
 *   Integration with revision pipeline:
 *   - After valid verdict, resolved_herald_result has verdict='valid'
 *   - After needs_revision verdict, resolved_herald_result carries suggested_revision
 *   - getPendingCount reflects pending/reviewed state transitions
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  ClaimType,
  DerivationMethod,
  type NotesLogEntry,
  type Source,
} from '../../src/types/claims';
import type { TierOutput } from '../../src/types/herald';
import {
  clearQueue,
  getPendingCount,
  getPendingEntry,
  getHumanReviewQueue,
  submitForHumanReview,
  submitHumanVerdict,
} from '../../src/herald/tier4-human';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_SOURCE: Source = {
  source_id: 'S-001',
  source_title: 'WHO Report 2023',
  source_url: 'https://who.int/example',
  relevant_chunk: 'Maternal mortality: 1,140 per 100,000 live births.',
};

function makeClaim(overrides: Partial<NotesLogEntry> = {}): NotesLogEntry {
  return {
    claim_id: 'C-001',
    claim_text: 'Maternal mortality in Chad stands at 2,000 per 100,000 live births.',
    claim_type: ClaimType.Statistical,
    derivation: DerivationMethod.DirectExtraction,
    sources: [SAMPLE_SOURCE],
    reasoning: 'Extracted from WHO data.',
    ...overrides,
  };
}

const TIER1_RESULT: TierOutput = {
  tier_id: 1,
  verdict: 'uncertain',
  confidence: 0.65,
  reasoning: 'NLI returned neutral — could not confirm entailment.',
};

const TIER2_RESULT: TierOutput = {
  tier_id: 2,
  verdict: 'uncertain',
  confidence: 0.72,
  reasoning: 'Judge uncertain: source figure differs but claim may be rounded.',
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearQueue();
});

// ---------------------------------------------------------------------------
// Queue submission
// ---------------------------------------------------------------------------

describe('submitForHumanReview', () => {
  it('creates a queue entry with all required fields', () => {
    const claim = makeClaim();
    const entry = submitForHumanReview(claim, [TIER1_RESULT, TIER2_RESULT], 'memo-001');

    expect(entry.id).toMatch(/^review-/);
    expect(entry.memo_id).toBe('memo-001');
    expect(entry.claim.claim_id).toBe('C-001');
    expect(entry.status).toBe('pending');
    expect(entry.verdict).toBeNull();
    expect(entry.notes).toBeNull();
    expect(entry.suggested_revision).toBeNull();
    expect(entry.reviewed_at).toBeNull();
    expect(entry.submitted_at).toBeTruthy();
    expect(entry.previous_tier_results).toHaveLength(2);
  });

  it('includes the escalation reason in the entry', () => {
    const claim = makeClaim();
    const entry = submitForHumanReview(claim, [TIER2_RESULT], 'memo-001');

    expect(entry.escalation_reason).toContain('Tier 2');
    expect(entry.escalation_reason).toContain('uncertain');
  });

  it('generates a generic escalation reason when no tier results provided', () => {
    const claim = makeClaim();
    const entry = submitForHumanReview(claim, [], 'memo-001');

    expect(entry.escalation_reason).toBeTruthy();
    expect(entry.escalation_reason.length).toBeGreaterThan(10);
  });

  it('returns existing entry without creating a duplicate for the same pending claim', () => {
    const claim = makeClaim();
    const entry1 = submitForHumanReview(claim, [TIER1_RESULT], 'memo-001');
    const entry2 = submitForHumanReview(claim, [TIER1_RESULT, TIER2_RESULT], 'memo-001');

    expect(entry1.id).toBe(entry2.id);

    const queue = getHumanReviewQueue('memo-001');
    expect(queue).toHaveLength(1);
  });

  it('uses default memo_id when memoId is omitted', () => {
    const claim = makeClaim();
    submitForHumanReview(claim, []);

    const queue = getHumanReviewQueue(); // default memo_id
    expect(queue).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Queue retrieval
// ---------------------------------------------------------------------------

describe('getHumanReviewQueue', () => {
  it('returns empty array for an unknown memoId', () => {
    expect(getHumanReviewQueue('no-such-memo')).toEqual([]);
  });

  it('returns entries sorted: pending first, then reviewed', () => {
    const claim1 = makeClaim({ claim_id: 'C-001' });
    const claim2 = makeClaim({ claim_id: 'C-002' });
    const claim3 = makeClaim({ claim_id: 'C-003' });

    submitForHumanReview(claim1, [], 'memo-001');
    submitForHumanReview(claim2, [], 'memo-001');
    submitForHumanReview(claim3, [], 'memo-001');

    // Review claim2 (put it in reviewed state)
    submitHumanVerdict('C-002', { verdict: 'valid', notes: 'Looks good.' }, 'memo-001');

    const queue = getHumanReviewQueue('memo-001');
    expect(queue).toHaveLength(3);
    // Pending entries come first
    expect(queue[0]?.status).toBe('pending');
    expect(queue[1]?.status).toBe('pending');
    expect(queue[2]?.status).toBe('reviewed');
  });

  it('isolates entries by memoId', () => {
    submitForHumanReview(makeClaim({ claim_id: 'C-001' }), [], 'memo-A');
    submitForHumanReview(makeClaim({ claim_id: 'C-002' }), [], 'memo-B');

    expect(getHumanReviewQueue('memo-A')).toHaveLength(1);
    expect(getHumanReviewQueue('memo-B')).toHaveLength(1);
    expect(getHumanReviewQueue('memo-A')[0]?.claim.claim_id).toBe('C-001');
    expect(getHumanReviewQueue('memo-B')[0]?.claim.claim_id).toBe('C-002');
  });
});

// ---------------------------------------------------------------------------
// Verdict submission
// ---------------------------------------------------------------------------

describe('submitHumanVerdict', () => {
  it('marks the entry as reviewed with all verdict fields', () => {
    const claim = makeClaim();
    submitForHumanReview(claim, [TIER1_RESULT], 'memo-001');

    const result = submitHumanVerdict(
      'C-001',
      { verdict: 'valid', notes: 'Confirmed by source.' },
      'memo-001',
    );

    const entry = result.entry;
    expect(entry.status).toBe('reviewed');
    expect(entry.verdict).toBe('valid');
    expect(entry.notes).toBe('Confirmed by source.');
    expect(entry.reviewed_at).toBeTruthy();
    expect(entry.suggested_revision).toBeNull();
  });

  it('stores the suggested revision when provided', () => {
    submitForHumanReview(makeClaim(), [], 'memo-001');

    const result = submitHumanVerdict(
      'C-001',
      {
        verdict: 'needs_revision',
        notes: 'Source says 1,140 not 2,000.',
        suggested_revision: 'Maternal mortality in Chad stands at 1,140 per 100,000 live births.',
      },
      'memo-001',
    );

    expect(result.entry.suggested_revision).toBe(
      'Maternal mortality in Chad stands at 1,140 per 100,000 live births.',
    );
  });

  it('produces a HeraldResult with tier_reached=4 and confidence=1.0', () => {
    submitForHumanReview(makeClaim(), [TIER1_RESULT, TIER2_RESULT], 'memo-001');

    const { resolved_herald_result } = submitHumanVerdict(
      'C-001',
      { verdict: 'invalid', notes: 'Claim contradicts the source data.' },
      'memo-001',
    );

    expect(resolved_herald_result).not.toBeNull();
    expect(resolved_herald_result?.tier_reached).toBe(4);
    expect(resolved_herald_result?.confidence).toBe(1.0);
    expect(resolved_herald_result?.verdict).toBe('invalid');
    expect(resolved_herald_result?.feedback).toBe('Claim contradicts the source data.');
  });

  it('preserves previous tier results in tier_details of resolved HeraldResult', () => {
    submitForHumanReview(makeClaim(), [TIER1_RESULT, TIER2_RESULT], 'memo-001');

    const { resolved_herald_result } = submitHumanVerdict(
      'C-001',
      { verdict: 'valid', notes: 'Ok.' },
      'memo-001',
    );

    expect(resolved_herald_result?.tier_details.tier_1).toEqual(TIER1_RESULT);
    expect(resolved_herald_result?.tier_details.tier_2).toEqual(TIER2_RESULT);
    expect(resolved_herald_result?.tier_details.tier_3).toBeNull();
    expect(resolved_herald_result?.tier_details.tier_4?.tier_id).toBe(4);
  });

  it('throws when claim_id not found in queue', () => {
    expect(() => {
      submitHumanVerdict('C-UNKNOWN', { verdict: 'valid', notes: 'Test.' }, 'memo-001');
    }).toThrow(/No pending review entry/);
  });

  it('throws when submitting verdict for an already-reviewed claim', () => {
    submitForHumanReview(makeClaim(), [], 'memo-001');
    submitHumanVerdict('C-001', { verdict: 'valid', notes: 'First review.' }, 'memo-001');

    expect(() => {
      submitHumanVerdict('C-001', { verdict: 'invalid', notes: 'Second review.' }, 'memo-001');
    }).toThrow(/No pending review entry/);
  });
});

// ---------------------------------------------------------------------------
// Integration with revision pipeline
// ---------------------------------------------------------------------------

describe('integration with revision pipeline verdicts', () => {
  it('valid verdict produces a passing HeraldResult', () => {
    submitForHumanReview(makeClaim(), [TIER2_RESULT], 'memo-001');

    const { resolved_herald_result } = submitHumanVerdict(
      'C-001',
      { verdict: 'valid', notes: 'Confirmed from source.' },
      'memo-001',
    );

    expect(resolved_herald_result?.verdict).toBe('valid');
  });

  it('needs_revision verdict carries suggested_revision through', () => {
    submitForHumanReview(makeClaim(), [], 'memo-001');

    const { resolved_herald_result } = submitHumanVerdict(
      'C-001',
      {
        verdict: 'needs_revision',
        notes: 'Change the number.',
        suggested_revision: 'Mortality is 1,140 per 100,000.',
      },
      'memo-001',
    );

    expect(resolved_herald_result?.verdict).toBe('needs_revision');
    expect(resolved_herald_result?.suggested_revision).toBe('Mortality is 1,140 per 100,000.');
  });
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

describe('getPendingCount and getPendingEntry', () => {
  it('getPendingCount returns 0 for empty queue', () => {
    expect(getPendingCount('memo-001')).toBe(0);
  });

  it('getPendingCount decrements when a verdict is submitted', () => {
    submitForHumanReview(makeClaim({ claim_id: 'C-001' }), [], 'memo-001');
    submitForHumanReview(makeClaim({ claim_id: 'C-002' }), [], 'memo-001');

    expect(getPendingCount('memo-001')).toBe(2);

    submitHumanVerdict('C-001', { verdict: 'valid', notes: '.' }, 'memo-001');
    expect(getPendingCount('memo-001')).toBe(1);
  });

  it('getPendingEntry returns undefined for reviewed entries', () => {
    submitForHumanReview(makeClaim(), [], 'memo-001');
    submitHumanVerdict('C-001', { verdict: 'valid', notes: '.' }, 'memo-001');

    expect(getPendingEntry('C-001', 'memo-001')).toBeUndefined();
  });

  it('getPendingEntry returns the entry while still pending', () => {
    submitForHumanReview(makeClaim(), [], 'memo-001');
    const entry = getPendingEntry('C-001', 'memo-001');
    expect(entry?.claim.claim_id).toBe('C-001');
    expect(entry?.status).toBe('pending');
  });
});
