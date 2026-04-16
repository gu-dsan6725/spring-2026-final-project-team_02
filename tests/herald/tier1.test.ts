/**
 * HERALD Tier 1 — TypeScript tests.
 *
 * These tests mock the fetch call to the Python NLI service so no backend
 * is required.  They verify:
 *
 *  - Statistical/comparative claims are routed through Tier 1
 *  - Causal claims use the lower 0.85 threshold
 *  - Predictive/normative/synthesis claims skip Tier 1 entirely
 *  - Entailment above threshold → verdict 'valid'
 *  - Contradiction above 0.7 → verdict 'invalid' with suggested revision
 *  - Low-confidence / neutral → verdict 'uncertain'
 *  - The client correctly posts to /api/herald/nli/batch
 *  - Guard throws when skipNLI claim type is passed directly to evaluateWithNLI
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ClaimType,
  DerivationMethod,
  type NotesLogEntry,
  type Source,
} from '../../src/types/claims';
import { evaluateWithNLI } from '../../src/herald/tier1-nli';
import {
  claimTypesSkippingNLI,
  claimTypesUsingNLI,
  evaluateClaim,
  routeClaim,
} from '../../src/herald/router';

// Isolate tier1 tests from the real Tier 2 implementation.
// evaluateClaim() routes through Tier 2 for uncertain/skipNLI results;
// these tests only care about Tier 1 behavior, so we stub Tier 2 here.
vi.mock('../../src/herald/tier2-llm-judge', () => ({
  evaluateWithLLMJudge: vi.fn().mockResolvedValue({
    tier_id: 2,
    verdict: 'uncertain',
    confidence: 0.0,
    reasoning: 'Tier 2 stub (mocked for tier1 isolation).',
  }),
}));

// Stub Tier 3 so that when Tier 2 returns 'uncertain' the router does not
// attempt real Groq API calls.  Tier 3 returns a confident verdict so the
// pipeline exits cleanly.
vi.mock('../../src/herald/tier3-debate', () => ({
  evaluateWithDebate: vi.fn().mockResolvedValue({
    tier_id: 3,
    verdict: 'valid',
    confidence: 0.9,
    reasoning: 'Tier 3 stub (mocked for tier1 isolation).',
  }),
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeSource(chunk: string, id = 'S-001'): Source {
  return {
    source_id: id,
    source_title: 'Test Source',
    source_url: 'https://example.com',
    relevant_chunk: chunk,
  };
}

function makeEntry(overrides: Partial<NotesLogEntry> = {}): NotesLogEntry {
  return {
    claim_id: 'C-001',
    claim_text: 'The unemployment rate is 5.2%.',
    claim_type: ClaimType.Statistical,
    derivation: DerivationMethod.DirectExtraction,
    sources: [makeSource('The unemployment rate is 5.2%.')],
    reasoning: 'Direct extraction.',
    ...overrides,
  };
}

/** Build a mock fetch Response for the /nli/batch endpoint. */
function mockNLIBatch(
  labels: Array<{ label: string; entailment: number; neutral: number; contradiction: number }>,
) {
  const results = labels.map(({ label, entailment, neutral, contradiction }) => ({
    label,
    scores: { entailment, neutral, contradiction },
  }));
  return Promise.resolve(
    new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Router: routeClaim
// ---------------------------------------------------------------------------

describe('routeClaim', () => {
  it('routes statistical claims to Tier 1 with threshold 0.9', () => {
    const decision = routeClaim(makeEntry({ claim_type: ClaimType.Statistical }));
    expect(decision.startTier).toBe(1);
    expect(decision.skipNLI).toBe(false);
    expect(decision.nliThreshold).toBe(0.9);
  });

  it('routes comparative claims to Tier 1 with threshold 0.9', () => {
    const decision = routeClaim(makeEntry({ claim_type: ClaimType.Comparative }));
    expect(decision.startTier).toBe(1);
    expect(decision.nliThreshold).toBe(0.9);
  });

  it('routes causal claims to Tier 1 with lower threshold 0.85', () => {
    const decision = routeClaim(makeEntry({ claim_type: ClaimType.Causal }));
    expect(decision.startTier).toBe(1);
    expect(decision.skipNLI).toBe(false);
    expect(decision.nliThreshold).toBe(0.85);
  });

  it('routes predictive claims to Tier 2 (skipNLI)', () => {
    const decision = routeClaim(makeEntry({ claim_type: ClaimType.Predictive }));
    expect(decision.startTier).toBe(2);
    expect(decision.skipNLI).toBe(true);
    expect(decision.nliThreshold).toBeNull();
  });

  it('routes normative claims to Tier 2 (skipNLI)', () => {
    const decision = routeClaim(makeEntry({ claim_type: ClaimType.Normative }));
    expect(decision.startTier).toBe(2);
    expect(decision.skipNLI).toBe(true);
  });

  it('routes synthesis claims to Tier 2 (skipNLI)', () => {
    const decision = routeClaim(makeEntry({ claim_type: ClaimType.Synthesis }));
    expect(decision.startTier).toBe(2);
    expect(decision.skipNLI).toBe(true);
  });
});

describe('claimTypesSkippingNLI / claimTypesUsingNLI', () => {
  it('skipNLI set contains exactly predictive, normative, synthesis', () => {
    const skipping = claimTypesSkippingNLI();
    expect(skipping).toHaveLength(3);
    expect(skipping).toContain(ClaimType.Predictive);
    expect(skipping).toContain(ClaimType.Normative);
    expect(skipping).toContain(ClaimType.Synthesis);
  });

  it('useNLI set contains exactly statistical, comparative, causal', () => {
    const using = claimTypesUsingNLI();
    expect(using).toHaveLength(3);
    expect(using).toContain(ClaimType.Statistical);
    expect(using).toContain(ClaimType.Comparative);
    expect(using).toContain(ClaimType.Causal);
  });
});

// ---------------------------------------------------------------------------
// evaluateWithNLI: guard check
// ---------------------------------------------------------------------------

describe('evaluateWithNLI guard', () => {
  it.each([ClaimType.Predictive, ClaimType.Normative, ClaimType.Synthesis])(
    'throws for skipNLI claim type: %s',
    async (claimType) => {
      const claim = makeEntry({ claim_type: claimType });
      await expect(evaluateWithNLI(claim)).rejects.toThrow(/skipNLI=true/);
    },
  );

  it('does NOT throw for statistical claim', async () => {
    fetchMock.mockReturnValueOnce(
      mockNLIBatch([{ label: 'entailment', entailment: 0.95, neutral: 0.03, contradiction: 0.02 }]),
    );
    const claim = makeEntry({ claim_type: ClaimType.Statistical });
    await expect(evaluateWithNLI(claim)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// evaluateWithNLI: verdict logic
// ---------------------------------------------------------------------------

describe('evaluateWithNLI verdicts', () => {
  it('returns valid when entailment confidence > 0.9 (statistical)', async () => {
    fetchMock.mockReturnValueOnce(
      mockNLIBatch([{ label: 'entailment', entailment: 0.95, neutral: 0.03, contradiction: 0.02 }]),
    );

    const result = await evaluateWithNLI(makeEntry({ claim_type: ClaimType.Statistical }));

    expect(result.verdict).toBe('valid');
    expect(result.confidence).toBeCloseTo(0.95);
    expect(result.tier_id).toBe(1);
  });

  it('returns uncertain when entailment < threshold (0.9 for statistical)', async () => {
    fetchMock.mockReturnValueOnce(
      mockNLIBatch([{ label: 'entailment', entailment: 0.8, neutral: 0.15, contradiction: 0.05 }]),
    );

    const result = await evaluateWithNLI(makeEntry({ claim_type: ClaimType.Statistical }));

    expect(result.verdict).toBe('uncertain');
    expect(result.tier_id).toBe(1);
  });

  it('returns valid for causal claim when entailment >= 0.85 (lower threshold)', async () => {
    fetchMock.mockReturnValueOnce(
      mockNLIBatch([{ label: 'entailment', entailment: 0.87, neutral: 0.08, contradiction: 0.05 }]),
    );

    const result = await evaluateWithNLI(makeEntry({ claim_type: ClaimType.Causal }));

    expect(result.verdict).toBe('valid');
  });

  it('returns uncertain for causal claim when entailment < 0.85', async () => {
    fetchMock.mockReturnValueOnce(
      mockNLIBatch([{ label: 'entailment', entailment: 0.82, neutral: 0.1, contradiction: 0.08 }]),
    );

    const result = await evaluateWithNLI(makeEntry({ claim_type: ClaimType.Causal }));

    expect(result.verdict).toBe('uncertain');
  });

  it('returns invalid with suggested_revision when contradiction > 0.7', async () => {
    fetchMock.mockReturnValueOnce(
      mockNLIBatch([
        { label: 'contradiction', entailment: 0.05, neutral: 0.1, contradiction: 0.85 },
      ]),
    );

    const result = await evaluateWithNLI(makeEntry({ claim_type: ClaimType.Statistical }));

    expect(result.verdict).toBe('invalid');
    expect(result.suggested_revision).toBeTruthy();
    expect(result.tier_id).toBe(1);
  });

  it('returns uncertain when contradiction is weak (< 0.7)', async () => {
    fetchMock.mockReturnValueOnce(
      mockNLIBatch([
        { label: 'contradiction', entailment: 0.2, neutral: 0.45, contradiction: 0.35 },
      ]),
    );

    const result = await evaluateWithNLI(makeEntry({ claim_type: ClaimType.Statistical }));

    // Contradiction is the dominant label but confidence < 0.7 → uncertain
    expect(result.verdict).toBe('uncertain');
  });

  it('returns uncertain for neutral aggregate', async () => {
    fetchMock.mockReturnValueOnce(
      mockNLIBatch([{ label: 'neutral', entailment: 0.2, neutral: 0.65, contradiction: 0.15 }]),
    );

    const result = await evaluateWithNLI(makeEntry({ claim_type: ClaimType.Statistical }));

    expect(result.verdict).toBe('uncertain');
  });
});

// ---------------------------------------------------------------------------
// evaluateWithNLI: multi-source aggregation
// ---------------------------------------------------------------------------

describe('evaluateWithNLI multi-source aggregation', () => {
  it('all sources entail → valid (uses min entailment score)', async () => {
    fetchMock.mockReturnValueOnce(
      mockNLIBatch([
        { label: 'entailment', entailment: 0.95, neutral: 0.03, contradiction: 0.02 },
        { label: 'entailment', entailment: 0.91, neutral: 0.05, contradiction: 0.04 },
      ]),
    );

    const claim = makeEntry({
      claim_type: ClaimType.Statistical,
      sources: [makeSource('Chunk 1', 'S-001'), makeSource('Chunk 2', 'S-002')],
    });
    const result = await evaluateWithNLI(claim);

    expect(result.verdict).toBe('valid');
    // Confidence should be the min entailment (0.91)
    expect(result.confidence).toBeCloseTo(0.91);
  });

  it('any source contradicts → contradiction wins (all-entail + one contradiction)', async () => {
    fetchMock.mockReturnValueOnce(
      mockNLIBatch([
        { label: 'entailment', entailment: 0.95, neutral: 0.03, contradiction: 0.02 },
        { label: 'contradiction', entailment: 0.05, neutral: 0.1, contradiction: 0.85 },
      ]),
    );

    const claim = makeEntry({
      claim_type: ClaimType.Statistical,
      sources: [makeSource('Chunk A', 'S-001'), makeSource('Chunk B', 'S-002')],
    });
    const result = await evaluateWithNLI(claim);

    expect(result.verdict).toBe('invalid');
  });

  it('mixed entail + neutral → uncertain', async () => {
    fetchMock.mockReturnValueOnce(
      mockNLIBatch([
        { label: 'entailment', entailment: 0.92, neutral: 0.05, contradiction: 0.03 },
        { label: 'neutral', entailment: 0.3, neutral: 0.6, contradiction: 0.1 },
      ]),
    );

    const claim = makeEntry({
      claim_type: ClaimType.Statistical,
      sources: [makeSource('Chunk A', 'S-001'), makeSource('Chunk B', 'S-002')],
    });
    const result = await evaluateWithNLI(claim);

    expect(result.verdict).toBe('uncertain');
  });
});

// ---------------------------------------------------------------------------
// evaluateWithNLI: HTTP call verification
// ---------------------------------------------------------------------------

describe('evaluateWithNLI HTTP call', () => {
  it('sends POST to /api/herald/nli/batch with correct payload', async () => {
    fetchMock.mockReturnValueOnce(
      mockNLIBatch([{ label: 'entailment', entailment: 0.95, neutral: 0.03, contradiction: 0.02 }]),
    );

    const claim = makeEntry({
      sources: [makeSource('The unemployment rate is 5.2%.', 'S-001')],
    });
    await evaluateWithNLI(claim);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toMatch(/\/api\/herald\/nli\/batch$/);
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body as string) as {
      pairs: Array<{ premise: string; hypothesis: string }>;
    };
    expect(body.pairs).toHaveLength(1);
    expect(body.pairs[0]!.premise).toBe('The unemployment rate is 5.2%.');
    expect(body.pairs[0]!.hypothesis).toBe(claim.claim_text);
  });

  it('throws when the NLI service returns a non-200 status', async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve(
        new Response(JSON.stringify({ detail: 'not loaded' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(evaluateWithNLI(makeEntry())).rejects.toThrow(/503/);
  });
});

// ---------------------------------------------------------------------------
// evaluateClaim: predictive/normative/synthesis skip Tier 1
// ---------------------------------------------------------------------------

describe('evaluateClaim routing', () => {
  it.each([ClaimType.Predictive, ClaimType.Normative, ClaimType.Synthesis])(
    'never calls fetch for skipNLI type: %s',
    async (claimType) => {
      const claim = makeEntry({ claim_type: claimType });
      // evaluateClaim will hit the Tier 2 stub (no fetch needed)
      const result = await evaluateClaim(claim);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.tier_details.tier_1).toBeNull();
      expect(result.tier_details.tier_2).not.toBeNull();
    },
  );

  it('statistical claim with entailment exits at Tier 1 without calling Tier 2', async () => {
    fetchMock.mockReturnValueOnce(
      mockNLIBatch([{ label: 'entailment', entailment: 0.96, neutral: 0.02, contradiction: 0.02 }]),
    );

    const claim = makeEntry({ claim_type: ClaimType.Statistical });
    const result = await evaluateClaim(claim);

    expect(result.tier_reached).toBe(1);
    expect(result.verdict).toBe('valid');
    expect(result.tier_details.tier_1).not.toBeNull();
    expect(result.tier_details.tier_2).toBeNull();
    // fetch called exactly once (the NLI batch call)
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('statistical claim with uncertain Tier 1 escalates to Tier 2', async () => {
    fetchMock.mockReturnValueOnce(
      mockNLIBatch([{ label: 'neutral', entailment: 0.5, neutral: 0.4, contradiction: 0.1 }]),
    );

    const claim = makeEntry({ claim_type: ClaimType.Statistical });
    const result = await evaluateClaim(claim);

    expect(result.tier_details.tier_1).not.toBeNull();
    expect(result.tier_details.tier_2).not.toBeNull();
    // Tier 2 stub returns 'uncertain', so the router escalates to Tier 3.
    // The deciding tier (and therefore tier_reached) is 3.
    expect(result.tier_reached).toBe(3);
  });
});
