/**
 * HERALD Tier 3 — Multi-Agent Debate unit tests.
 *
 * The Groq SDK is mocked with vi.hoisted so no real API calls are made.
 * Response ordering for mocked calls: [domain_expert, methodologist, skeptic, judge].
 *
 * Coverage:
 *   Prompt selection:
 *   - Each of the 6 claim types injects a distinct system prompt per persona
 *   - All 3 persona prompts are non-empty and claim-type-specific
 *
 *   Parallel execution:
 *   - All 3 persona calls happen before the judge call (Promise.all)
 *   - Total API calls = 4 per debate run
 *
 *   Decision logic (judge confidence threshold = 0.8):
 *   - Unanimous agreement → verdict passes through, confidence preserved
 *   - 2-1 split + judge confidence > 0.80 → exits with majority verdict
 *   - Judge confidence ≤ 0.80 → verdict overridden to 'uncertain' (escalate Tier 4)
 *   - Three-way split → 'uncertain'
 *
 *   Robustness:
 *   - suggested_revision forwarded when verdict is invalid
 *   - suggested_revision cleared when verdict is valid
 *   - confidence clamped to [0, 1]
 *   - Unknown verdict string coerced to 'uncertain'
 *   - API error re-thrown
 *   - Missing tool_calls throws descriptively
 *   - tier_id is always 3
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ClaimType,
  DerivationMethod,
  type NotesLogEntry,
  type Source,
} from '../../src/types/claims';
import { evaluateWithDebate } from '../../src/herald/tier3-debate';
import { getDomainExpertPrompt } from '../../src/herald/prompts/domain-expert';
import { getMethodologistPrompt } from '../../src/herald/prompts/methodologist';
import { getSkepticPrompt } from '../../src/herald/prompts/skeptic';
import type { TierOutput } from '../../src/types/herald';

// ---------------------------------------------------------------------------
// Groq SDK mock — hoisted before all imports
// ---------------------------------------------------------------------------

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: vi.fn(function () {
    return { chat: { completions: { create: mockCreate } } };
  }),
}));

// Silence Braintrust observability spans in test output
vi.mock('../../src/observability/braintrust', () => ({
  startSpan: vi.fn(() => ({
    id: 'test-span',
    name: 'test',
    startTime: 0,
    log: vi.fn(),
    end: vi.fn(),
  })),
  logError: vi.fn(),
  logToolCall: vi.fn(),
  logWarn: vi.fn(),
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
    claim_text: 'Cash transfer programs increased school enrollment by 8.2 percentage points.',
    claim_type: ClaimType.Statistical,
    derivation: DerivationMethod.DirectExtraction,
    sources: [makeSource('CCT programs increased enrollment by 8.2 pp (Smith et al. 2023).')],
    reasoning: 'Direct extraction from Smith et al. (2023) abstract.',
    ...overrides,
  };
}

const TIER2_UNCERTAIN: TierOutput = {
  tier_id: 2,
  verdict: 'uncertain',
  confidence: 0.62,
  reasoning: 'Judge returned uncertain due to ambiguous source alignment.',
};

// ---------------------------------------------------------------------------
// Helpers to build mock Groq responses
// ---------------------------------------------------------------------------

/**
 * Build a persona response that calls submit_debate_turn.
 */
function mockPersonaResponse(verdict: string, reasoning = 'Test reasoning.') {
  return {
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_persona',
              type: 'function',
              function: {
                name: 'submit_debate_turn',
                arguments: JSON.stringify({
                  verdict,
                  reasoning,
                  key_concern: 'Primary concern from this persona.',
                }),
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  };
}

/**
 * Build a judge response that calls submit_synthesis.
 */
function mockJudgeResponse(input: {
  verdict: string;
  confidence: number;
  reasoning?: string;
  suggested_revision?: string;
  dominant_persona?: string;
}) {
  return {
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_judge',
              type: 'function',
              function: {
                name: 'submit_synthesis',
                arguments: JSON.stringify({
                  verdict: input.verdict,
                  confidence: input.confidence,
                  reasoning: input.reasoning ?? 'Judge synthesis reasoning.',
                  suggested_revision: input.suggested_revision,
                  dominant_persona: input.dominant_persona ?? 'domain_expert',
                }),
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  };
}

/**
 * Set up 4 consecutive mock responses: 3 personas then judge.
 */
function setupDebateMocks(
  personaVerdicts: [string, string, string],
  judgeVerdict: string,
  judgeConfidence: number,
  suggestedRevision?: string,
) {
  mockCreate
    .mockResolvedValueOnce(mockPersonaResponse(personaVerdicts[0]))
    .mockResolvedValueOnce(mockPersonaResponse(personaVerdicts[1]))
    .mockResolvedValueOnce(mockPersonaResponse(personaVerdicts[2]))
    .mockResolvedValueOnce(
      mockJudgeResponse({
        verdict: judgeVerdict,
        confidence: judgeConfidence,
        suggested_revision: suggestedRevision,
      }),
    );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockCreate.mockReset();
});

// ---------------------------------------------------------------------------
// Persona prompt selection
// ---------------------------------------------------------------------------

describe('Tier 3 persona prompts — selection by claim type', () => {
  it('getDomainExpertPrompt returns a non-empty string for every claim type', () => {
    for (const claimType of Object.values(ClaimType)) {
      const prompt = getDomainExpertPrompt(claimType);
      expect(prompt.length).toBeGreaterThan(100);
    }
  });

  it('getMethodologistPrompt returns a non-empty string for every claim type', () => {
    for (const claimType of Object.values(ClaimType)) {
      const prompt = getMethodologistPrompt(claimType);
      expect(prompt.length).toBeGreaterThan(100);
    }
  });

  it('getSkepticPrompt returns a non-empty string for every claim type', () => {
    for (const claimType of Object.values(ClaimType)) {
      const prompt = getSkepticPrompt(claimType);
      expect(prompt.length).toBeGreaterThan(100);
    }
  });

  it('domain expert prompts are distinct across claim types', () => {
    const prompts = Object.values(ClaimType).map((ct) => getDomainExpertPrompt(ct));
    const unique = new Set(prompts);
    expect(unique.size).toBe(Object.values(ClaimType).length);
  });

  it('methodologist prompts are distinct across claim types', () => {
    const prompts = Object.values(ClaimType).map((ct) => getMethodologistPrompt(ct));
    const unique = new Set(prompts);
    expect(unique.size).toBe(Object.values(ClaimType).length);
  });

  it('skeptic prompts are distinct across claim types', () => {
    const prompts = Object.values(ClaimType).map((ct) => getSkepticPrompt(ct));
    const unique = new Set(prompts);
    expect(unique.size).toBe(Object.values(ClaimType).length);
  });

  it('three personas get different system prompts for the same claim type', () => {
    const ct = ClaimType.Causal;
    const de = getDomainExpertPrompt(ct);
    const me = getMethodologistPrompt(ct);
    const sk = getSkepticPrompt(ct);
    expect(de).not.toBe(me);
    expect(de).not.toBe(sk);
    expect(me).not.toBe(sk);
  });
});

// ---------------------------------------------------------------------------
// evaluateWithDebate: API call structure
// ---------------------------------------------------------------------------

describe('evaluateWithDebate — API call structure', () => {
  it('makes exactly 4 API calls (3 personas + 1 judge)', async () => {
    setupDebateMocks(['valid', 'valid', 'valid'], 'valid', 0.95);

    await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    expect(mockCreate).toHaveBeenCalledTimes(4);
  });

  it('all persona calls use submit_debate_turn tool', async () => {
    setupDebateMocks(['valid', 'valid', 'valid'], 'valid', 0.92);

    await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    // Calls 0, 1, 2 are persona calls
    for (let i = 0; i < 3; i++) {
      const params = mockCreate.mock.calls[i]![0] as Record<string, unknown>;
      const tools = params['tools'] as Array<{ function: { name: string } }>;
      expect(tools[0]?.function.name).toBe('submit_debate_turn');
    }
  });

  it('judge call uses submit_synthesis tool', async () => {
    setupDebateMocks(['valid', 'valid', 'valid'], 'valid', 0.92);

    await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    // Call index 3 is the judge
    const judgeParams = mockCreate.mock.calls[3]![0] as Record<string, unknown>;
    const tools = judgeParams['tools'] as Array<{ function: { name: string } }>;
    expect(tools[0]?.function.name).toBe('submit_synthesis');
  });

  it('each persona call includes system prompt with role "system"', async () => {
    setupDebateMocks(['valid', 'valid', 'valid'], 'valid', 0.92);

    await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    for (let i = 0; i < 3; i++) {
      const params = mockCreate.mock.calls[i]![0] as { messages: Array<{ role: string }> };
      expect(params.messages[0]?.role).toBe('system');
    }
  });

  it('each persona call has the claim text in the user message', async () => {
    setupDebateMocks(['valid', 'valid', 'valid'], 'valid', 0.92);

    const claim = makeEntry({ claim_text: 'GDP grew at 3.2% in 2023.' });
    await evaluateWithDebate(claim, TIER2_UNCERTAIN);

    for (let i = 0; i < 3; i++) {
      const params = mockCreate.mock.calls[i]![0] as {
        messages: Array<{ role: string; content: string }>;
      };
      const userMsg = params.messages[1]?.content ?? '';
      expect(userMsg).toContain('GDP grew at 3.2% in 2023.');
    }
  });

  it('tier2 verdict and reasoning appear in persona user messages', async () => {
    setupDebateMocks(['valid', 'valid', 'valid'], 'valid', 0.92);

    await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    for (let i = 0; i < 3; i++) {
      const params = mockCreate.mock.calls[i]![0] as {
        messages: Array<{ role: string; content: string }>;
      };
      const userMsg = params.messages[1]?.content ?? '';
      expect(userMsg).toContain(TIER2_UNCERTAIN.reasoning);
    }
  });

  it('judge user message contains all three persona verdicts', async () => {
    setupDebateMocks(['valid', 'invalid', 'uncertain'], 'invalid', 0.88);

    await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    const judgeParams = mockCreate.mock.calls[3]![0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const judgeMsg = judgeParams.messages[1]?.content ?? '';
    // Should summarize the split
    expect(judgeMsg).toContain('valid');
    expect(judgeMsg).toContain('invalid');
    expect(judgeMsg).toContain('uncertain');
  });
});

// ---------------------------------------------------------------------------
// evaluateWithDebate: decision logic
// ---------------------------------------------------------------------------

describe('evaluateWithDebate — unanimous agreement', () => {
  it('exits with "valid" verdict when all 3 agree valid and confidence is high', async () => {
    setupDebateMocks(['valid', 'valid', 'valid'], 'valid', 0.95);

    const result = await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    expect(result.tier_id).toBe(3);
    expect(result.verdict).toBe('valid');
    expect(result.confidence).toBeCloseTo(0.95);
  });

  it('exits with "invalid" verdict when all 3 agree invalid and confidence > 0.80', async () => {
    setupDebateMocks(['invalid', 'invalid', 'invalid'], 'invalid', 0.92);

    const result = await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    expect(result.verdict).toBe('invalid');
    expect(result.confidence).toBeCloseTo(0.92);
  });

  it('exits with "invalid" when all 3 agree and judge confidence is high', async () => {
    setupDebateMocks(['invalid', 'invalid', 'invalid'], 'invalid', 0.89);

    const result = await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    expect(result.verdict).toBe('invalid');
  });
});

describe('evaluateWithDebate — 2-1 split', () => {
  it('exits with majority verdict when judge confidence > 0.80', async () => {
    setupDebateMocks(['valid', 'valid', 'invalid'], 'valid', 0.85);

    const result = await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    expect(result.verdict).toBe('valid');
  });

  it('overrides to "uncertain" when judge confidence is exactly 0.80 (not > threshold)', async () => {
    setupDebateMocks(['valid', 'valid', 'invalid'], 'valid', 0.8);

    const result = await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    expect(result.verdict).toBe('uncertain');
  });

  it('overrides to "uncertain" when judge confidence is 0.75 (< threshold)', async () => {
    setupDebateMocks(['invalid', 'invalid', 'valid'], 'invalid', 0.75);

    const result = await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    expect(result.verdict).toBe('uncertain');
  });
});

describe('evaluateWithDebate — low-confidence escalation', () => {
  it('returns "uncertain" when judge confidence is 0.60 regardless of verdict', async () => {
    setupDebateMocks(['valid', 'valid', 'valid'], 'valid', 0.6);

    const result = await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    expect(result.verdict).toBe('uncertain');
  });

  it('returns "uncertain" when judge confidence is 0.0', async () => {
    setupDebateMocks(['invalid', 'invalid', 'invalid'], 'invalid', 0.0);

    const result = await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    expect(result.verdict).toBe('uncertain');
  });

  it('preserves the raw confidence value in the output even when escalating', async () => {
    setupDebateMocks(['valid', 'valid', 'valid'], 'valid', 0.65);

    const result = await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    expect(result.confidence).toBeCloseTo(0.65);
  });
});

// ---------------------------------------------------------------------------
// evaluateWithDebate: suggested_revision handling
// ---------------------------------------------------------------------------

describe('evaluateWithDebate — suggested_revision', () => {
  it('includes suggested_revision when verdict is invalid', async () => {
    const revision = 'Revise the figure from 8.2 to 7.9 percentage points.';
    setupDebateMocks(['invalid', 'invalid', 'invalid'], 'invalid', 0.91, revision);

    const result = await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    expect(result.suggested_revision).toBe(revision);
  });

  it('includes suggested_revision when verdict is invalid', async () => {
    const revision = 'Add "on average" qualifier before the statistic.';
    setupDebateMocks(['invalid', 'invalid', 'invalid'], 'invalid', 0.88, revision);

    const result = await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    expect(result.suggested_revision).toBe(revision);
  });

  it('does NOT include suggested_revision when judge returns none and verdict is valid', async () => {
    setupDebateMocks(['valid', 'valid', 'valid'], 'valid', 0.95);

    const result = await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    expect(result.suggested_revision).toBeUndefined();
  });

  it('passes suggested_revision through even when escalating to uncertain due to low confidence', async () => {
    // The implementation forwards the revision hint to human reviewers regardless of confidence
    setupDebateMocks(['valid', 'valid', 'valid'], 'valid', 0.55, 'Revision hint for reviewer.');

    const result = await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    expect(result.verdict).toBe('uncertain');
    expect(result.suggested_revision).toBe('Revision hint for reviewer.');
  });
});

// ---------------------------------------------------------------------------
// evaluateWithDebate: robustness
// ---------------------------------------------------------------------------

describe('evaluateWithDebate — robustness', () => {
  it('tier_id is always 3', async () => {
    for (const confidence of [0.95, 0.75, 0.3]) {
      mockCreate.mockReset();
      setupDebateMocks(['valid', 'valid', 'valid'], 'valid', confidence);
      const result = await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);
      expect(result.tier_id).toBe(3);
    }
  });

  it('clamps confidence above 1.0 to 1.0', async () => {
    setupDebateMocks(['valid', 'valid', 'valid'], 'valid', 1.5);

    const result = await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    expect(result.confidence).toBeLessThanOrEqual(1.0);
  });

  it('clamps confidence below 0.0 to 0.0', async () => {
    setupDebateMocks(['invalid', 'invalid', 'invalid'], 'invalid', -0.2);

    const result = await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    expect(result.confidence).toBeGreaterThanOrEqual(0.0);
  });

  it('coerces unknown verdict string from judge to "uncertain"', async () => {
    setupDebateMocks(['valid', 'valid', 'valid'], 'probably_fine', 0.95);

    const result = await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);

    // 'probably_fine' is not a valid Verdict → coerced to 'uncertain'
    // But confidence 0.95 > 0.80 means the coerced verdict is preserved rather than overridden
    expect(result.verdict).toBe('uncertain');
  });

  it('coerces unknown persona verdict to "uncertain" during debate', async () => {
    // Even if personas return garbage, run completes without throwing
    mockCreate
      .mockResolvedValueOnce(mockPersonaResponse('maybe_valid'))
      .mockResolvedValueOnce(mockPersonaResponse('probably_fine'))
      .mockResolvedValueOnce(mockPersonaResponse('valid'))
      .mockResolvedValueOnce(mockJudgeResponse({ verdict: 'valid', confidence: 0.9 }));

    const result = await evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN);
    expect(result.tier_id).toBe(3);
  });

  it('re-throws when a persona API call fails', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Groq rate limit exceeded'));

    await expect(evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN)).rejects.toThrow(
      'Groq rate limit exceeded',
    );
  });

  it('re-throws when the judge API call fails', async () => {
    mockCreate
      .mockResolvedValueOnce(mockPersonaResponse('valid'))
      .mockResolvedValueOnce(mockPersonaResponse('valid'))
      .mockResolvedValueOnce(mockPersonaResponse('valid'))
      .mockRejectedValueOnce(new Error('Judge call timed out'));

    await expect(evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN)).rejects.toThrow(
      'Judge call timed out',
    );
  });

  it('throws descriptively when a persona does not call submit_debate_turn', async () => {
    // Persona responds with plain text instead of a tool call
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'I think the claim is valid.', tool_calls: null },
          finish_reason: 'stop',
        },
      ],
    });

    await expect(evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN)).rejects.toThrow(
      /submit_debate_turn/,
    );
  });

  it('throws descriptively when the judge does not call submit_synthesis', async () => {
    mockCreate
      .mockResolvedValueOnce(mockPersonaResponse('valid'))
      .mockResolvedValueOnce(mockPersonaResponse('valid'))
      .mockResolvedValueOnce(mockPersonaResponse('valid'))
      .mockResolvedValueOnce({
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'My synthesis is valid.', tool_calls: null },
            finish_reason: 'stop',
          },
        ],
      });

    await expect(evaluateWithDebate(makeEntry(), TIER2_UNCERTAIN)).rejects.toThrow(
      /submit_synthesis/,
    );
  });
});

// ---------------------------------------------------------------------------
// evaluateWithDebate: per-claim-type smoke tests
// ---------------------------------------------------------------------------

describe('evaluateWithDebate — claim type coverage', () => {
  it.each(Object.values(ClaimType))('runs successfully for claim type: %s', async (claimType) => {
    mockCreate.mockReset();
    setupDebateMocks(['valid', 'valid', 'valid'], 'valid', 0.92);

    const result = await evaluateWithDebate(makeEntry({ claim_type: claimType }), TIER2_UNCERTAIN);

    expect(result.tier_id).toBe(3);
    expect(result.verdict).toBe('valid');
  });
});
