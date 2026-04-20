/**
 * HERALD Feedback Loop — revision pipeline tests (Checkpoint 7.1)
 *
 * All external dependencies are mocked:
 *   - groq-sdk: controls what the revision agent "says"
 *   - ./router:  controls HERALD re-evaluation outcomes
 *
 * Test coverage:
 *   - Single claim revision that passes on first retry
 *   - Single claim revision that fails twice → flagged for human intervention
 *   - Memo rewriting preserves unchanged sections
 *   - Revision prompt includes full HERALD feedback and previous attempts
 *   - Claims with 'valid' verdict are not revised
 *   - Missing notes log entry is skipped gracefully
 *   - Groq API error is handled (claim flagged, not thrown)
 *   - 'UNSUPPORTABLE' response stops revision without crashing
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ClaimType,
  DerivationMethod,
  type NotesLogEntry,
  type Source,
} from '../../src/types/claims';
import type { HeraldResult } from '../../src/types/herald';
import type { MemoOutput } from '../../src/types/memo';
import { reviseClaimsFromHerald } from '../../src/herald/feedback-loop';

// ---------------------------------------------------------------------------
// Mock: groq-sdk
// ---------------------------------------------------------------------------

const mockGroqCreate = vi.hoisted(() => vi.fn());

vi.mock('groq-sdk', () => ({
  default: vi.fn(function () {
    return {
      chat: { completions: { create: mockGroqCreate } },
    };
  }),
}));

// ---------------------------------------------------------------------------
// Mock: HERALD router (re-evaluation of revised claims)
// ---------------------------------------------------------------------------

const mockEvaluateClaim = vi.hoisted(() => vi.fn());

vi.mock('../../src/herald/router', () => ({
  evaluateClaim: mockEvaluateClaim,
}));

// ---------------------------------------------------------------------------
// Mock: braintrust (avoid external calls in tests)
// ---------------------------------------------------------------------------

vi.mock('../../src/observability/braintrust', () => ({
  startSpan: () => ({ log: vi.fn(), end: vi.fn(), id: 'test', name: 'test', startTime: 0 }),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logToolCall: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SAMPLE_SOURCE: Source = {
  source_id: 'S-001',
  source_title: 'World Bank Data 2023',
  source_url: 'https://data.worldbank.org/indicator/SH.STA.MMRT',
  relevant_chunk: 'Maternal mortality ratio for Chad: 1,140 per 100,000 live births (2020).',
};

function makeClaim(overrides: Partial<NotesLogEntry> = {}): NotesLogEntry {
  return {
    claim_id: 'C-001',
    claim_text: 'Maternal mortality in Chad stands at 2,000 per 100,000 live births.',
    claim_type: ClaimType.Statistical,
    derivation: DerivationMethod.DirectExtraction,
    sources: [SAMPLE_SOURCE],
    reasoning: 'Extracted from World Bank data.',
    ...overrides,
  };
}

function makeMemo(claim: NotesLogEntry): MemoOutput {
  return {
    memo_markdown: `# Health Policy\n\n${claim.claim_text} This is a serious problem.`,
    notes_log: [claim],
    metadata: {
      generation_timestamp: new Date().toISOString(),
      token_usage: 1000,
      tool_calls_count: 5,
    },
  };
}

function makeHeraldResult(overrides: Partial<HeraldResult> = {}): HeraldResult {
  return {
    claim_id: 'C-001',
    tier_reached: 1,
    verdict: 'invalid',
    confidence: 0.92,
    feedback: 'The source says 1,140, not 2,000. This is a direct contradiction.',
    suggested_revision: 'Maternal mortality in Chad stands at 1,140 per 100,000 live births.',
    tier_details: {
      tier_1: {
        tier_id: 1,
        verdict: 'invalid',
        confidence: 0.92,
        reasoning: 'Contradiction detected: source says 1,140, claim says 2,000.',
      },
      tier_2: null,
      tier_3: null,
      tier_4: null,
    },
    ...overrides,
  };
}

function makeGroqResponse(content: string) {
  return {
    choices: [{ message: { content } }],
  };
}

function makeRevisionJson(revisedText: string, derivation = 'direct_extraction'): string {
  return JSON.stringify({
    revised_claim_text: revisedText,
    reasoning: `Corrected figure from source. Original said 2,000 but source states ${revisedText}.`,
    derivation_update: derivation,
  });
}

function makePassingHeraldResult(claimId = 'C-001'): HeraldResult {
  return {
    claim_id: claimId,
    tier_reached: 1,
    verdict: 'valid',
    confidence: 0.95,
    feedback: 'Entailment confirmed.',
    suggested_revision: null,
    tier_details: {
      tier_1: { tier_id: 1, verdict: 'valid', confidence: 0.95, reasoning: 'Confirmed.' },
      tier_2: null,
      tier_3: null,
      tier_4: null,
    },
  };
}

function makeFailingHeraldResult(claimId = 'C-001', feedback = 'Still incorrect.'): HeraldResult {
  return {
    claim_id: claimId,
    tier_reached: 2,
    verdict: 'invalid',
    confidence: 0.88,
    feedback,
    suggested_revision: null,
    tier_details: {
      tier_1: null,
      tier_2: { tier_id: 2, verdict: 'invalid', confidence: 0.88, reasoning: feedback },
      tier_3: null,
      tier_4: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reviseClaimsFromHerald', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['GROQ_API_KEY'] = 'test-groq-key';
    delete process.env['OPENAI_API_KEY'];
    delete process.env['REVISION_LLM_PROVIDER'];
    delete process.env['REVISION_GROQ_MODEL'];
    delete process.env['REVISION_OPENAI_MODEL'];
  });

  // ─── Happy path ───────────────────────────────────────────────────────────

  it('revises a single invalid claim that passes on first retry', async () => {
    const claim = makeClaim();
    const memo = makeMemo(claim);
    const heraldResult = makeHeraldResult();

    const correctedText = 'Maternal mortality in Chad stands at 1,140 per 100,000 live births.';
    mockGroqCreate.mockResolvedValueOnce(makeGroqResponse(makeRevisionJson(correctedText)));
    mockEvaluateClaim.mockResolvedValueOnce(makePassingHeraldResult());

    const result = await reviseClaimsFromHerald(memo, [heraldResult], {
      max_tool_calls: 25,
      max_research_tokens: 50000,
      max_revision_attempts: 2,
    });

    expect(result.requires_human_intervention).toHaveLength(0);
    expect(result.revision_states).toHaveLength(1);

    const state = result.revision_states[0];
    expect(state.status).toBe('revised');
    expect(state.revision_count).toBe(1);
    expect(state.final_claim_text).toBe(correctedText);
    expect(state.attempts[0]?.passed).toBe(true);
  });

  it('updates the memo markdown with the revised claim text', async () => {
    const claim = makeClaim();
    const memo = makeMemo(claim);
    const heraldResult = makeHeraldResult();

    const correctedText = 'Maternal mortality in Chad stands at 1,140 per 100,000 live births.';
    mockGroqCreate.mockResolvedValueOnce(makeGroqResponse(makeRevisionJson(correctedText)));
    mockEvaluateClaim.mockResolvedValueOnce(makePassingHeraldResult());

    const result = await reviseClaimsFromHerald(memo, [heraldResult]);

    expect(result.memo_markdown).toContain(correctedText);
    expect(result.memo_markdown).not.toContain(claim.claim_text);
  });

  it('preserves unchanged memo sections when revising one of two claims', async () => {
    const claim1 = makeClaim({ claim_id: 'C-001', claim_text: 'Wrong figure: 2,000.' });
    const claim2 = makeClaim({
      claim_id: 'C-002',
      claim_text: 'This is the valid unchanged sentence.',
      sources: [],
    });

    const memo: MemoOutput = {
      memo_markdown: `# Policy\n\n${claim1.claim_text}\n\n${claim2.claim_text}`,
      notes_log: [claim1, claim2],
      metadata: { generation_timestamp: '', token_usage: 0, tool_calls_count: 0 },
    };

    const heraldResults = [
      makeHeraldResult({ claim_id: 'C-001' }),
      makeHeraldResult({ claim_id: 'C-002', verdict: 'valid', feedback: 'Good.' }),
    ];

    const correctedText = 'Correct figure: 1,140.';
    mockGroqCreate.mockResolvedValueOnce(makeGroqResponse(makeRevisionJson(correctedText)));
    mockEvaluateClaim.mockResolvedValueOnce(makePassingHeraldResult('C-001'));

    const result = await reviseClaimsFromHerald(memo, heraldResults);

    // The valid claim's text is preserved
    expect(result.memo_markdown).toContain(claim2.claim_text);
    // The invalid claim's text is replaced
    expect(result.memo_markdown).toContain(correctedText);
    expect(result.memo_markdown).not.toContain(claim1.claim_text);
    // Only one revision state (valid claims are skipped)
    expect(result.revision_states).toHaveLength(1);
  });

  it('updates the notes log entry for a successfully revised claim', async () => {
    const claim = makeClaim();
    const memo = makeMemo(claim);
    const heraldResult = makeHeraldResult();

    const correctedText = 'Maternal mortality in Chad stands at 1,140 per 100,000 live births.';
    mockGroqCreate.mockResolvedValueOnce(makeGroqResponse(makeRevisionJson(correctedText)));
    mockEvaluateClaim.mockResolvedValueOnce(makePassingHeraldResult());

    const result = await reviseClaimsFromHerald(memo, [heraldResult]);

    const updatedEntry = result.notes_log.find((e) => e.claim_id === 'C-001');
    expect(updatedEntry?.claim_text).toBe(correctedText);
  });

  // ─── Convergence failure ──────────────────────────────────────────────────

  it('flags a claim for human intervention after max revision attempts', async () => {
    const claim = makeClaim();
    const memo = makeMemo(claim);
    const heraldResult = makeHeraldResult();

    // Both revision attempts produce revisions that still fail
    mockGroqCreate
      .mockResolvedValueOnce(makeGroqResponse(makeRevisionJson('Still wrong: 1,500.')))
      .mockResolvedValueOnce(makeGroqResponse(makeRevisionJson('Also wrong: 1,200.')));
    mockEvaluateClaim
      .mockResolvedValueOnce(makeFailingHeraldResult('C-001', 'Attempt 1 feedback.'))
      .mockResolvedValueOnce(makeFailingHeraldResult('C-001', 'Attempt 2 feedback.'));

    const result = await reviseClaimsFromHerald(memo, [heraldResult], {
      max_tool_calls: 25,
      max_research_tokens: 50000,
      max_revision_attempts: 2,
    });

    expect(result.requires_human_intervention).toContain('C-001');

    const state = result.revision_states[0];
    expect(state.status).toBe('failed_max_attempts');
    expect(state.revision_count).toBe(2);
    expect(state.attempts).toHaveLength(2);
    expect(state.attempts[0]?.passed).toBe(false);
    expect(state.attempts[1]?.passed).toBe(false);
  });

  it('preserves original memo content for claims that exceed max attempts', async () => {
    const claim = makeClaim();
    const memo = makeMemo(claim);
    const heraldResult = makeHeraldResult();

    mockGroqCreate.mockResolvedValue(makeGroqResponse(makeRevisionJson('Wrong: 1,500.')));
    mockEvaluateClaim.mockResolvedValue(makeFailingHeraldResult());

    const result = await reviseClaimsFromHerald(memo, [heraldResult], {
      max_tool_calls: 25,
      max_research_tokens: 50000,
      max_revision_attempts: 2,
    });

    // Original markdown preserved for failed revision
    expect(result.memo_markdown).toContain(claim.claim_text);
  });

  it('stops after 1 attempt when max_revision_attempts is 1', async () => {
    const claim = makeClaim();
    const memo = makeMemo(claim);
    const heraldResult = makeHeraldResult();

    mockGroqCreate.mockResolvedValueOnce(makeGroqResponse(makeRevisionJson('Still wrong.')));
    mockEvaluateClaim.mockResolvedValueOnce(makeFailingHeraldResult());

    const result = await reviseClaimsFromHerald(memo, [heraldResult], {
      max_tool_calls: 25,
      max_research_tokens: 50000,
      max_revision_attempts: 1,
    });

    expect(mockGroqCreate).toHaveBeenCalledTimes(1);
    expect(result.requires_human_intervention).toContain('C-001');
  });

  // ─── Revision prompt content ──────────────────────────────────────────────

  it('includes full HERALD feedback in the revision prompt', async () => {
    const claim = makeClaim();
    const memo = makeMemo(claim);
    const heraldResult = makeHeraldResult({
      feedback: 'The source says 1,140, not 2,000. Direct contradiction.',
      suggested_revision: 'Maternal mortality in Chad stands at 1,140 per 100,000 live births.',
    });

    mockGroqCreate.mockResolvedValueOnce(makeGroqResponse(makeRevisionJson('1,140.')));
    mockEvaluateClaim.mockResolvedValueOnce(makePassingHeraldResult());

    await reviseClaimsFromHerald(memo, [heraldResult]);

    // Inspect the prompt passed to Groq
    const callArgs = mockGroqCreate.mock.calls[0] as [{ messages: { content: string }[] }];
    const userMessage = callArgs[0].messages[1]?.content ?? '';

    expect(userMessage).toContain('The source says 1,140, not 2,000');
    expect(userMessage).toContain('Maternal mortality in Chad stands at 1,140');
    expect(userMessage).toContain(claim.claim_text);
  });

  it('includes previous failed attempt in the prompt on second attempt', async () => {
    const claim = makeClaim();
    const memo = makeMemo(claim);
    const heraldResult = makeHeraldResult();

    mockGroqCreate
      .mockResolvedValueOnce(makeGroqResponse(makeRevisionJson('Attempt 1 text.')))
      .mockResolvedValueOnce(makeGroqResponse(makeRevisionJson('Attempt 2 text.')));
    mockEvaluateClaim
      .mockResolvedValueOnce(makeFailingHeraldResult('C-001', 'Attempt 1 still failed.'))
      .mockResolvedValueOnce(makeFailingHeraldResult('C-001', 'Attempt 2 still failed.'));

    await reviseClaimsFromHerald(memo, [heraldResult], {
      max_tool_calls: 25,
      max_research_tokens: 50000,
      max_revision_attempts: 2,
    });

    // Second Groq call should include "Previous Revision Attempts"
    const secondCallArgs = mockGroqCreate.mock.calls[1] as [{ messages: { content: string }[] }];
    const secondUserMessage = secondCallArgs[0].messages[1]?.content ?? '';

    expect(secondUserMessage).toContain('Previous Revision Attempts');
    expect(secondUserMessage).toContain('Attempt 1 text.');
    expect(secondUserMessage).toContain('Attempt 1 still failed.');
  });

  // ─── Edge cases ───────────────────────────────────────────────────────────

  it('returns unchanged output when no claims need revision', async () => {
    const claim = makeClaim();
    const memo = makeMemo(claim);
    const heraldResult = makeHeraldResult({ verdict: 'valid' });

    const result = await reviseClaimsFromHerald(memo, [heraldResult]);

    expect(result.revision_states).toHaveLength(0);
    expect(result.requires_human_intervention).toHaveLength(0);
    expect(result.memo_markdown).toBe(memo.memo_markdown);
    expect(mockGroqCreate).not.toHaveBeenCalled();
  });

  it('skips a claim when its claim_id has no matching notes log entry', async () => {
    const claim = makeClaim();
    const memo = makeMemo(claim);
    const heraldResult = makeHeraldResult({ claim_id: 'C-UNKNOWN' });

    const result = await reviseClaimsFromHerald(memo, [heraldResult]);

    expect(result.revision_states).toHaveLength(0);
    expect(mockGroqCreate).not.toHaveBeenCalled();
  });

  it('handles UNSUPPORTABLE response without crashing', async () => {
    const claim = makeClaim();
    const memo = makeMemo(claim);
    const heraldResult = makeHeraldResult();

    mockGroqCreate.mockResolvedValueOnce(
      makeGroqResponse(
        JSON.stringify({
          revised_claim_text: 'UNSUPPORTABLE',
          reasoning: 'No source supports any version of this claim.',
          derivation_update: 'direct_extraction',
        }),
      ),
    );

    const result = await reviseClaimsFromHerald(memo, [heraldResult]);

    // UNSUPPORTABLE → treated as failed, flagged for human review
    expect(result.requires_human_intervention).toContain('C-001');
    expect(result.memo_markdown).toContain(claim.claim_text); // original preserved
  });

  it('handles Groq API error gracefully — claim flagged, not thrown', async () => {
    const claim = makeClaim();
    const memo = makeMemo(claim);
    const heraldResult = makeHeraldResult();

    mockGroqCreate.mockRejectedValueOnce(new Error('Groq API timeout'));

    const result = await reviseClaimsFromHerald(memo, [heraldResult]);

    expect(result.requires_human_intervention).toContain('C-001');
    // Should not throw
  });

  it('triggers revision for invalid verdict', async () => {
    const claim = makeClaim();
    const memo = makeMemo(claim);
    const heraldResult = makeHeraldResult({ verdict: 'invalid' });

    const correctedText = 'Revised to match source.';
    mockGroqCreate.mockResolvedValueOnce(makeGroqResponse(makeRevisionJson(correctedText)));
    mockEvaluateClaim.mockResolvedValueOnce(makePassingHeraldResult());

    const result = await reviseClaimsFromHerald(memo, [heraldResult]);

    expect(result.revision_states[0]?.status).toBe('revised');
  });

  it('updates the derivation method if the revision changes it', async () => {
    const claim = makeClaim({ derivation: DerivationMethod.DirectExtraction });
    const memo = makeMemo(claim);
    const heraldResult = makeHeraldResult();

    mockGroqCreate.mockResolvedValueOnce(
      makeGroqResponse(makeRevisionJson('Combined from two sources.', 'cross_source')),
    );
    mockEvaluateClaim.mockResolvedValueOnce(makePassingHeraldResult());

    const result = await reviseClaimsFromHerald(memo, [heraldResult]);

    const updatedEntry = result.notes_log.find((e) => e.claim_id === 'C-001');
    expect(updatedEntry?.derivation).toBe('cross_source');
  });

  // ─── Concurrent revision ──────────────────────────────────────────────────

  it('revises multiple invalid claims independently', async () => {
    const claim1 = makeClaim({ claim_id: 'C-001', claim_text: 'Wrong figure: 2,000.' });
    const claim2 = makeClaim({
      claim_id: 'C-002',
      claim_text: 'Another wrong figure: 5,000.',
      sources: [{ ...SAMPLE_SOURCE, source_id: 'S-002' }],
    });

    const memo: MemoOutput = {
      memo_markdown: `# Policy\n\n${claim1.claim_text}\n\n${claim2.claim_text}`,
      notes_log: [claim1, claim2],
      metadata: { generation_timestamp: '', token_usage: 0, tool_calls_count: 0 },
    };

    const heraldResults = [
      makeHeraldResult({ claim_id: 'C-001', feedback: 'C-001 is wrong.' }),
      makeHeraldResult({ claim_id: 'C-002', feedback: 'C-002 is wrong.' }),
    ];

    // Both claims need revision, both succeed on first attempt
    mockGroqCreate
      .mockResolvedValueOnce(makeGroqResponse(makeRevisionJson('Correct: 1,140.')))
      .mockResolvedValueOnce(makeGroqResponse(makeRevisionJson('Correct: 4,200.')));
    mockEvaluateClaim
      .mockResolvedValueOnce(makePassingHeraldResult('C-001'))
      .mockResolvedValueOnce(makePassingHeraldResult('C-002'));

    const result = await reviseClaimsFromHerald(memo, heraldResults, {
      max_tool_calls: 25,
      max_research_tokens: 50000,
      max_revision_attempts: 2,
    });

    expect(result.revision_states).toHaveLength(2);
    expect(result.revision_states[0]?.status).toBe('revised');
    expect(result.revision_states[1]?.status).toBe('revised');
    expect(result.requires_human_intervention).toHaveLength(0);
  });

  it('handles mixed outcomes — one claim revised, one flagged for human review', async () => {
    const claim1 = makeClaim({ claim_id: 'C-001', claim_text: 'Fixable wrong figure.' });
    const claim2 = makeClaim({
      claim_id: 'C-002',
      claim_text: 'Unfixable claim.',
      sources: [{ ...SAMPLE_SOURCE, source_id: 'S-002' }],
    });

    const memo: MemoOutput = {
      memo_markdown: `# Policy\n\n${claim1.claim_text}\n\n${claim2.claim_text}`,
      notes_log: [claim1, claim2],
      metadata: { generation_timestamp: '', token_usage: 0, tool_calls_count: 0 },
    };

    const heraldResults = [
      makeHeraldResult({ claim_id: 'C-001' }),
      makeHeraldResult({ claim_id: 'C-002' }),
    ];

    // C-001 succeeds, C-002 fails both attempts
    mockGroqCreate
      .mockResolvedValueOnce(makeGroqResponse(makeRevisionJson('Fixed: 1,140.'))) // C-001 attempt 1
      .mockResolvedValueOnce(makeGroqResponse(makeRevisionJson('Still wrong: 3,000.'))) // C-002 attempt 1
      .mockResolvedValueOnce(makeGroqResponse(makeRevisionJson('Still wrong: 2,500.'))); // C-002 attempt 2
    mockEvaluateClaim
      .mockResolvedValueOnce(makePassingHeraldResult('C-001'))
      .mockResolvedValueOnce(makeFailingHeraldResult('C-002', 'Attempt 1 failed.'))
      .mockResolvedValueOnce(makeFailingHeraldResult('C-002', 'Attempt 2 failed.'));

    const result = await reviseClaimsFromHerald(memo, heraldResults, {
      max_tool_calls: 25,
      max_research_tokens: 50000,
      max_revision_attempts: 2,
    });

    const c001state = result.revision_states.find((s) => s.claim_id === 'C-001');
    const c002state = result.revision_states.find((s) => s.claim_id === 'C-002');

    expect(c001state?.status).toBe('revised');
    expect(c002state?.status).toBe('failed_max_attempts');
    expect(result.requires_human_intervention).toContain('C-002');
    expect(result.requires_human_intervention).not.toContain('C-001');
  });

  // ─── reviseClaimWithAgent throws ─────────────────────────────────────────

  it('counts a thrown error as a failed attempt (not infinite loop)', async () => {
    const claim = makeClaim();
    const memo = makeMemo(claim);
    const heraldResult = makeHeraldResult();

    // First Groq call throws, so revision loop breaks
    mockGroqCreate.mockRejectedValueOnce(new Error('Groq internal server error'));

    const result = await reviseClaimsFromHerald(memo, [heraldResult], {
      max_tool_calls: 25,
      max_research_tokens: 50000,
      max_revision_attempts: 2,
    });

    // Throwing counts as a failed revision attempt — claim flagged for human review
    expect(result.requires_human_intervention).toContain('C-001');
    // Only 1 Groq call was made (the one that threw), not 2
    expect(mockGroqCreate).toHaveBeenCalledTimes(1);
  });

  it('does not count a throw against revision_count — state reflects 0 successful attempts', async () => {
    const claim = makeClaim();
    const memo = makeMemo(claim);
    const heraldResult = makeHeraldResult();

    mockGroqCreate.mockRejectedValueOnce(new Error('Network error'));

    const result = await reviseClaimsFromHerald(memo, [heraldResult]);

    const state = result.revision_states[0];
    // Error breaks out of the loop before incrementing revision_count
    expect(state?.revision_count).toBe(0);
    expect(state?.attempts).toHaveLength(0);
  });
});
