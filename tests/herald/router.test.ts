/**
 * HERALD Router tests.
 *
 * Covers:
 *   routeClaim():
 *   - Correct startTier / skipNLI / nliThreshold for all 6 claim types
 *   - Unknown / hallucinated claim type defaults to Tier 2
 *
 *   claimTypesSkippingNLI() / claimTypesUsingNLI():
 *   - Correct partition of the 6 claim types
 *
 *   evaluateClaim() pipeline:
 *   - Statistical/comparative/causal → Tier 1 first; exits at Tier 1 on valid/invalid
 *   - Tier 1 uncertain → escalates to Tier 2
 *   - Tier 2 confident → exits at Tier 2 (no Tier 3)
 *   - Tier 2 uncertain → escalates to Tier 3
 *   - Predictive/normative/synthesis skip Tier 1 → start at Tier 2
 *   - Tier 1 NLI service unavailable → falls back to Tier 2 silently
 *   - tier_details records each tier that ran
 *   - HeraldResult shape is correct for each exit point
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ClaimType,
  DerivationMethod,
  type NotesLogEntry,
  type Source,
} from '../../src/types/claims';
import {
  claimTypesSkippingNLI,
  claimTypesUsingNLI,
  evaluateClaim,
  routeClaim,
} from '../../src/herald/router';
import type { TierOutput } from '../../src/types/herald';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockEvaluateWithNLI = vi.hoisted(() => vi.fn<() => Promise<TierOutput>>());
const mockEvaluateWithLLMJudge = vi.hoisted(() => vi.fn<() => Promise<TierOutput>>());
const mockEvaluateWithDebate = vi.hoisted(() => vi.fn<() => Promise<TierOutput>>());

vi.mock('../../src/herald/tier1-nli', () => ({ evaluateWithNLI: mockEvaluateWithNLI }));
vi.mock('../../src/herald/tier2-llm-judge', () => ({
  evaluateWithLLMJudge: mockEvaluateWithLLMJudge,
}));
vi.mock('../../src/herald/tier3-debate', () => ({ evaluateWithDebate: mockEvaluateWithDebate }));

vi.mock('../../src/observability/braintrust', () => ({
  startSpan: vi.fn(() => ({ log: vi.fn(), end: vi.fn(), id: 'test', name: 'test', startTime: 0 })),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSource(): Source {
  return {
    source_id: 'S-001',
    source_title: 'Test Source',
    source_url: 'https://example.com',
    relevant_chunk: 'The value is 42%.',
  };
}

function makeClaim(overrides: Partial<NotesLogEntry> = {}): NotesLogEntry {
  return {
    claim_id: 'C-001',
    claim_text: 'The unemployment rate is 5.2%.',
    claim_type: ClaimType.Statistical,
    derivation: DerivationMethod.DirectExtraction,
    sources: [makeSource()],
    reasoning: 'Direct extraction.',
    ...overrides,
  };
}

function makeTierOutput(
  tier_id: 1 | 2 | 3 | 4,
  verdict: 'valid' | 'invalid' | 'uncertain',
  confidence = 0.92,
): TierOutput {
  return { tier_id, verdict, confidence, reasoning: `Tier ${tier_id} result.` };
}

// ---------------------------------------------------------------------------
// routeClaim()
// ---------------------------------------------------------------------------

describe('routeClaim — NLI-using claim types', () => {
  it('routes statistical claims to Tier 1 with threshold 0.9', () => {
    const route = routeClaim(makeClaim({ claim_type: ClaimType.Statistical }));
    expect(route.startTier).toBe(1);
    expect(route.skipNLI).toBe(false);
    expect(route.nliThreshold).toBeCloseTo(0.9);
  });

  it('routes comparative claims to Tier 1 with threshold 0.9', () => {
    const route = routeClaim(makeClaim({ claim_type: ClaimType.Comparative }));
    expect(route.startTier).toBe(1);
    expect(route.skipNLI).toBe(false);
    expect(route.nliThreshold).toBeCloseTo(0.9);
  });

  it('routes causal claims to Tier 1 with lower threshold 0.85', () => {
    const route = routeClaim(makeClaim({ claim_type: ClaimType.Causal }));
    expect(route.startTier).toBe(1);
    expect(route.skipNLI).toBe(false);
    expect(route.nliThreshold).toBeCloseTo(0.85);
  });

  it('causal threshold is strictly lower than statistical threshold', () => {
    const causal = routeClaim(makeClaim({ claim_type: ClaimType.Causal }));
    const statistical = routeClaim(makeClaim({ claim_type: ClaimType.Statistical }));
    expect(causal.nliThreshold!).toBeLessThan(statistical.nliThreshold!);
  });
});

describe('routeClaim — NLI-skipping claim types', () => {
  it.each([ClaimType.Predictive, ClaimType.Normative, ClaimType.Synthesis])(
    'routes %s to Tier 2 (skipNLI=true)',
    (claimType) => {
      const route = routeClaim(makeClaim({ claim_type: claimType }));
      expect(route.startTier).toBe(2);
      expect(route.skipNLI).toBe(true);
      expect(route.nliThreshold).toBeNull();
    },
  );
});

describe('routeClaim — unknown claim type', () => {
  it('defaults to Tier 2 for an unrecognised claim type', () => {
    const claim = makeClaim({ claim_type: 'correlational' as ClaimType });
    const route = routeClaim(claim);
    expect(route.startTier).toBe(2);
    expect(route.skipNLI).toBe(true);
    expect(route.nliThreshold).toBeNull();
    expect(route.rationale).toMatch(/unknown claim type/i);
  });

  it('includes the unknown type name in the rationale', () => {
    const claim = makeClaim({ claim_type: 'descriptive' as ClaimType });
    const route = routeClaim(claim);
    expect(route.rationale).toContain('descriptive');
  });
});

// ---------------------------------------------------------------------------
// claimTypesSkippingNLI / claimTypesUsingNLI
// ---------------------------------------------------------------------------

describe('claimTypesSkippingNLI', () => {
  it('returns exactly predictive, normative, synthesis', () => {
    const skipping = claimTypesSkippingNLI();
    expect(skipping).toHaveLength(3);
    expect(skipping).toContain(ClaimType.Predictive);
    expect(skipping).toContain(ClaimType.Normative);
    expect(skipping).toContain(ClaimType.Synthesis);
  });
});

describe('claimTypesUsingNLI', () => {
  it('returns exactly statistical, causal, comparative', () => {
    const using = claimTypesUsingNLI();
    expect(using).toHaveLength(3);
    expect(using).toContain(ClaimType.Statistical);
    expect(using).toContain(ClaimType.Causal);
    expect(using).toContain(ClaimType.Comparative);
  });

  it('skipping and using are disjoint and cover all 6 types', () => {
    const skipping = new Set(claimTypesSkippingNLI());
    const using = new Set(claimTypesUsingNLI());
    const allTypes = Object.values(ClaimType);

    expect(skipping.size + using.size).toBe(allTypes.length);
    for (const t of allTypes) {
      expect(skipping.has(t) !== using.has(t)).toBe(true); // XOR
    }
  });
});

// ---------------------------------------------------------------------------
// evaluateClaim() — Tier 1 exits
// ---------------------------------------------------------------------------

describe('evaluateClaim — Tier 1 valid exit', () => {
  beforeEach(() => {
    mockEvaluateWithNLI.mockReset();
    mockEvaluateWithLLMJudge.mockReset();
    mockEvaluateWithDebate.mockReset();
  });

  it('exits at Tier 1 when NLI returns valid — does not call Tier 2', async () => {
    mockEvaluateWithNLI.mockResolvedValue(makeTierOutput(1, 'valid', 0.95));

    const result = await evaluateClaim(makeClaim({ claim_type: ClaimType.Statistical }));

    expect(result.verdict).toBe('valid');
    expect(result.tier_reached).toBe(1);
    expect(result.tier_details.tier_1).not.toBeNull();
    expect(result.tier_details.tier_2).toBeNull();
    expect(result.tier_details.tier_3).toBeNull();
    expect(mockEvaluateWithLLMJudge).not.toHaveBeenCalled();
  });

  it('exits at Tier 1 when NLI returns invalid — does not call Tier 2', async () => {
    mockEvaluateWithNLI.mockResolvedValue(makeTierOutput(1, 'invalid', 0.91));

    const result = await evaluateClaim(makeClaim({ claim_type: ClaimType.Causal }));

    expect(result.verdict).toBe('invalid');
    expect(result.tier_reached).toBe(1);
    expect(mockEvaluateWithLLMJudge).not.toHaveBeenCalled();
  });

  it('populates tier_details.tier_1 with the NLI output', async () => {
    const t1 = makeTierOutput(1, 'valid', 0.97);
    mockEvaluateWithNLI.mockResolvedValue(t1);

    const result = await evaluateClaim(makeClaim());

    expect(result.tier_details.tier_1).toEqual(t1);
  });
});

// ---------------------------------------------------------------------------
// evaluateClaim() — Tier 1 uncertain → Tier 2
// ---------------------------------------------------------------------------

describe('evaluateClaim — Tier 1 uncertain escalates to Tier 2', () => {
  beforeEach(() => {
    mockEvaluateWithNLI.mockReset();
    mockEvaluateWithLLMJudge.mockReset();
    mockEvaluateWithDebate.mockReset();
  });

  it('calls Tier 2 when Tier 1 returns uncertain', async () => {
    mockEvaluateWithNLI.mockResolvedValue(makeTierOutput(1, 'uncertain', 0.6));
    mockEvaluateWithLLMJudge.mockResolvedValue(makeTierOutput(2, 'valid', 0.9));

    const result = await evaluateClaim(makeClaim({ claim_type: ClaimType.Statistical }));

    expect(mockEvaluateWithLLMJudge).toHaveBeenCalledOnce();
    expect(result.verdict).toBe('valid');
    expect(result.tier_reached).toBe(2);
    expect(result.tier_details.tier_1).not.toBeNull();
    expect(result.tier_details.tier_2).not.toBeNull();
  });

  it('passes Tier 1 output as context to Tier 2', async () => {
    const t1 = makeTierOutput(1, 'uncertain', 0.58);
    mockEvaluateWithNLI.mockResolvedValue(t1);
    mockEvaluateWithLLMJudge.mockResolvedValue(makeTierOutput(2, 'valid', 0.88));

    await evaluateClaim(makeClaim());

    const [, tier1Arg] = mockEvaluateWithLLMJudge.mock.calls[0] as unknown as [unknown, TierOutput];
    expect(tier1Arg).toEqual(t1);
  });
});

// ---------------------------------------------------------------------------
// evaluateClaim() — Tier 2 confident exit (no Tier 3)
// ---------------------------------------------------------------------------

describe('evaluateClaim — Tier 2 confident exit', () => {
  beforeEach(() => {
    mockEvaluateWithNLI.mockReset();
    mockEvaluateWithLLMJudge.mockReset();
    mockEvaluateWithDebate.mockReset();
  });

  it('exits at Tier 2 valid without calling Tier 3', async () => {
    mockEvaluateWithNLI.mockResolvedValue(makeTierOutput(1, 'uncertain', 0.55));
    mockEvaluateWithLLMJudge.mockResolvedValue(makeTierOutput(2, 'valid', 0.92));

    const result = await evaluateClaim(makeClaim());

    expect(result.verdict).toBe('valid');
    expect(result.tier_reached).toBe(2);
    expect(mockEvaluateWithDebate).not.toHaveBeenCalled();
  });

  it('exits at Tier 2 invalid without calling Tier 3', async () => {
    mockEvaluateWithNLI.mockResolvedValue(makeTierOutput(1, 'uncertain', 0.55));
    mockEvaluateWithLLMJudge.mockResolvedValue(makeTierOutput(2, 'invalid', 0.88));

    const result = await evaluateClaim(makeClaim());

    expect(result.verdict).toBe('invalid');
    expect(result.tier_reached).toBe(2);
    expect(mockEvaluateWithDebate).not.toHaveBeenCalled();
  });

  it('includes suggested_revision from Tier 2 in result', async () => {
    mockEvaluateWithNLI.mockResolvedValue(makeTierOutput(1, 'uncertain', 0.5));
    mockEvaluateWithLLMJudge.mockResolvedValue({
      ...makeTierOutput(2, 'invalid', 0.9),
      suggested_revision: 'Replace 5.2% with 5.1%.',
    });

    const result = await evaluateClaim(makeClaim());

    expect(result.suggested_revision).toBe('Replace 5.2% with 5.1%.');
  });
});

// ---------------------------------------------------------------------------
// evaluateClaim() — Tier 2 uncertain → Tier 3
// ---------------------------------------------------------------------------

describe('evaluateClaim — Tier 2 uncertain escalates to Tier 3', () => {
  beforeEach(() => {
    mockEvaluateWithNLI.mockReset();
    mockEvaluateWithLLMJudge.mockReset();
    mockEvaluateWithDebate.mockReset();
  });

  it('calls Tier 3 when Tier 2 is uncertain', async () => {
    mockEvaluateWithNLI.mockResolvedValue(makeTierOutput(1, 'uncertain', 0.5));
    mockEvaluateWithLLMJudge.mockResolvedValue(makeTierOutput(2, 'uncertain', 0.65));
    mockEvaluateWithDebate.mockResolvedValue(makeTierOutput(3, 'valid', 0.9));

    const result = await evaluateClaim(makeClaim());

    expect(mockEvaluateWithDebate).toHaveBeenCalledOnce();
    expect(result.verdict).toBe('valid');
    expect(result.tier_reached).toBe(3);
    expect(result.tier_details.tier_3).not.toBeNull();
  });

  it('passes Tier 2 output to Tier 3', async () => {
    mockEvaluateWithNLI.mockResolvedValue(makeTierOutput(1, 'uncertain', 0.5));
    const t2 = makeTierOutput(2, 'uncertain', 0.62);
    mockEvaluateWithLLMJudge.mockResolvedValue(t2);
    mockEvaluateWithDebate.mockResolvedValue(makeTierOutput(3, 'invalid', 0.87));

    await evaluateClaim(makeClaim());

    const [, tier2Arg] = mockEvaluateWithDebate.mock.calls[0] as unknown as [unknown, TierOutput];
    expect(tier2Arg).toEqual(t2);
  });

  it('exits at Tier 3 even if verdict is uncertain (no Tier 4 in automated path)', async () => {
    mockEvaluateWithNLI.mockResolvedValue(makeTierOutput(1, 'uncertain', 0.5));
    mockEvaluateWithLLMJudge.mockResolvedValue(makeTierOutput(2, 'uncertain', 0.6));
    mockEvaluateWithDebate.mockResolvedValue(makeTierOutput(3, 'uncertain', 0.45));

    const result = await evaluateClaim(makeClaim());

    expect(result.tier_reached).toBe(3);
    expect(result.verdict).toBe('uncertain');
  });
});

// ---------------------------------------------------------------------------
// evaluateClaim() — NLI-skipping types go directly to Tier 2
// ---------------------------------------------------------------------------

describe('evaluateClaim — NLI-skipping types bypass Tier 1', () => {
  beforeEach(() => {
    mockEvaluateWithNLI.mockReset();
    mockEvaluateWithLLMJudge.mockReset();
    mockEvaluateWithDebate.mockReset();
  });

  it.each([ClaimType.Predictive, ClaimType.Normative, ClaimType.Synthesis])(
    '%s skips Tier 1 and calls Tier 2 directly',
    async (claimType) => {
      mockEvaluateWithLLMJudge.mockResolvedValue(makeTierOutput(2, 'valid', 0.91));

      await evaluateClaim(makeClaim({ claim_type: claimType }));

      expect(mockEvaluateWithNLI).not.toHaveBeenCalled();
      expect(mockEvaluateWithLLMJudge).toHaveBeenCalledOnce();
    },
  );

  it('tier_details.tier_1 is null for synthesis claims', async () => {
    mockEvaluateWithLLMJudge.mockResolvedValue(makeTierOutput(2, 'valid', 0.93));

    const result = await evaluateClaim(makeClaim({ claim_type: ClaimType.Synthesis }));

    expect(result.tier_details.tier_1).toBeNull();
  });

  it('passes undefined as tier1Result to Tier 2 when NLI was skipped', async () => {
    mockEvaluateWithLLMJudge.mockResolvedValue(makeTierOutput(2, 'valid', 0.9));

    await evaluateClaim(makeClaim({ claim_type: ClaimType.Predictive }));

    const [, tier1Arg] = mockEvaluateWithLLMJudge.mock.calls[0] as unknown as [unknown, unknown];
    expect(tier1Arg).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// evaluateClaim() — Tier 1 NLI service unavailable (fallback)
// ---------------------------------------------------------------------------

describe('evaluateClaim — Tier 1 service unavailable fallback', () => {
  beforeEach(() => {
    mockEvaluateWithNLI.mockReset();
    mockEvaluateWithLLMJudge.mockReset();
    mockEvaluateWithDebate.mockReset();
  });

  it('falls back to Tier 2 when NLI service throws', async () => {
    mockEvaluateWithNLI.mockRejectedValue(new Error('NLI service unavailable'));
    mockEvaluateWithLLMJudge.mockResolvedValue(makeTierOutput(2, 'valid', 0.9));

    const result = await evaluateClaim(makeClaim({ claim_type: ClaimType.Statistical }));

    expect(result.verdict).toBe('valid');
    expect(result.tier_reached).toBe(2);
    expect(mockEvaluateWithLLMJudge).toHaveBeenCalledOnce();
  });

  it('tier_details.tier_1 is null after NLI fallback', async () => {
    mockEvaluateWithNLI.mockRejectedValue(new Error('503'));
    mockEvaluateWithLLMJudge.mockResolvedValue(makeTierOutput(2, 'invalid', 0.88));

    const result = await evaluateClaim(makeClaim());

    expect(result.tier_details.tier_1).toBeNull();
  });

  it('passes undefined tier1Result to Tier 2 after NLI fallback', async () => {
    mockEvaluateWithNLI.mockRejectedValue(new Error('timeout'));
    mockEvaluateWithLLMJudge.mockResolvedValue(makeTierOutput(2, 'valid', 0.91));

    await evaluateClaim(makeClaim());

    const [, tier1Arg] = mockEvaluateWithLLMJudge.mock.calls[0] as unknown as [unknown, unknown];
    expect(tier1Arg).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// evaluateClaim() — HeraldResult shape
// ---------------------------------------------------------------------------

describe('evaluateClaim — HeraldResult shape', () => {
  beforeEach(() => {
    mockEvaluateWithNLI.mockReset();
    mockEvaluateWithLLMJudge.mockReset();
    mockEvaluateWithDebate.mockReset();
  });

  it('result always carries the claim_id from the input', async () => {
    mockEvaluateWithNLI.mockResolvedValue(makeTierOutput(1, 'valid', 0.95));

    const result = await evaluateClaim(makeClaim({ claim_id: 'C-042' }));

    expect(result.claim_id).toBe('C-042');
  });

  it('confidence mirrors the deciding tier output', async () => {
    mockEvaluateWithNLI.mockResolvedValue(makeTierOutput(1, 'valid', 0.97));

    const result = await evaluateClaim(makeClaim());

    expect(result.confidence).toBeCloseTo(0.97);
  });

  it('feedback mirrors the deciding tier reasoning', async () => {
    mockEvaluateWithNLI.mockResolvedValue({
      tier_id: 1,
      verdict: 'valid',
      confidence: 0.95,
      reasoning: 'Source entails claim perfectly.',
    });

    const result = await evaluateClaim(makeClaim());

    expect(result.feedback).toBe('Source entails claim perfectly.');
  });

  it('suggested_revision is null when deciding tier has none', async () => {
    mockEvaluateWithNLI.mockResolvedValue(makeTierOutput(1, 'valid', 0.95));

    const result = await evaluateClaim(makeClaim());

    expect(result.suggested_revision).toBeNull();
  });

  it('policyTopic and memoSummary are forwarded to Tier 2', async () => {
    mockEvaluateWithNLI.mockResolvedValue(makeTierOutput(1, 'uncertain', 0.5));
    mockEvaluateWithLLMJudge.mockResolvedValue(makeTierOutput(2, 'valid', 0.9));

    await evaluateClaim(makeClaim(), 'maternal health in Chad', 'This memo covers...');

    const [, , topic, summary] = mockEvaluateWithLLMJudge.mock.calls[0] as unknown as [
      unknown,
      unknown,
      string,
      string,
    ];
    expect(topic).toBe('maternal health in Chad');
    expect(summary).toBe('This memo covers...');
  });
});
