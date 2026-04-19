/**
 * HERALD Tier 2 — LLM-as-Judge tests.
 *
 * These tests mock the Groq SDK so no real API call is made.  They verify:
 *
 *   Prompt selection:
 *   - Each of the 6 claim types produces a distinct, non-empty system prompt
 *   - Each prompt contains the claim-type-specific evaluation criteria from CLAUDE.md
 *   - Prompts for different claim types are not identical
 *
 *   Decision logic (confidence thresholds):
 *   - confidence > 0.85 → verdict returned as-is (valid / invalid / needs_revision)
 *   - confidence 0.6–0.85 → verdict overridden to 'uncertain', reasoning notes escalation
 *   - confidence < 0.6 → verdict overridden to 'uncertain', reasoning notes HIGH-PRIORITY
 *
 *   Tier 1 context injection:
 *   - When tier1Result is provided, the user message includes NLI result details
 *   - When tier1Result is omitted, the user message has no NLI context section
 *
 *   Robustness:
 *   - Unknown verdict string from model is coerced to 'uncertain'
 *   - API error is re-thrown (not swallowed)
 *   - Missing tool_calls in response throws a descriptive error
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ClaimType,
  DerivationMethod,
  type NotesLogEntry,
  type Source,
} from '../../src/types/claims';
import { evaluateWithLLMJudge } from '../../src/herald/tier2-llm-judge';
import { getJudgePrompt, _CLAIM_CRITERIA } from '../../src/herald/prompts/judge-system';
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
    claim_text: 'The unemployment rate is 5.2%.',
    claim_type: ClaimType.Statistical,
    derivation: DerivationMethod.DirectExtraction,
    sources: [makeSource('The unemployment rate stood at 5.2% in 2023.')],
    reasoning: 'Direct extraction from source.',
    ...overrides,
  };
}

/**
 * Build a fake Groq chat completion response containing a tool_call.
 */
function mockJudgeResponse(input: {
  verdict: string;
  confidence: number;
  reasoning: string;
  suggested_revision?: string;
}) {
  return {
    id: 'chatcmpl_test',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_test',
              type: 'function',
              function: {
                name: 'submit_evaluation',
                arguments: JSON.stringify(input),
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 },
  };
}

const TIER1_UNCERTAIN: TierOutput = {
  tier_id: 1,
  verdict: 'uncertain',
  confidence: 0.62,
  reasoning: 'NLI returned neutral with 0.62 confidence across 2 sources.',
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockCreate.mockReset();
});

// ---------------------------------------------------------------------------
// getJudgePrompt: prompt selection per claim type
// ---------------------------------------------------------------------------

describe('getJudgePrompt — prompt selection', () => {
  it('returns a non-empty string for every claim type', () => {
    for (const claimType of Object.values(ClaimType)) {
      const prompt = getJudgePrompt(claimType);
      expect(prompt.length).toBeGreaterThan(200);
    }
  });

  it('produces different prompts for different claim types', () => {
    const prompts = Object.values(ClaimType).map((ct) => getJudgePrompt(ct));
    const unique = new Set(prompts);
    expect(unique.size).toBe(Object.values(ClaimType).length);
  });

  it('statistical prompt focuses on exact numbers, units, and time periods', () => {
    const prompt = getJudgePrompt(ClaimType.Statistical);
    expect(prompt).toMatch(/exact number/i);
    expect(prompt).toMatch(/unit/i);
    expect(prompt).toContain('time period');
    expect(prompt).toMatch(/population/i);
  });

  it('causal prompt emphasizes causal mechanism vs. correlation distinction', () => {
    const prompt = getJudgePrompt(ClaimType.Causal);
    expect(prompt).toMatch(/causal mechanism/i);
    expect(prompt).toContain('correlation');
    expect(prompt).toContain('hedging');
    expect(prompt).toMatch(/direction of causality/i);
  });

  it('comparative prompt checks timeframe, population, and methodology comparability', () => {
    const prompt = getJudgePrompt(ClaimType.Comparative);
    expect(prompt).toContain('timeframe');
    expect(prompt).toContain('population');
    expect(prompt).toContain('methodolog');
  });

  it('predictive prompt checks attribution, assumptions, and uncertainty ranges', () => {
    const prompt = getJudgePrompt(ClaimType.Predictive);
    expect(prompt).toContain('projection');
    expect(prompt).toContain('assumption');
    expect(prompt).toMatch(/uncertainty/i);
    expect(prompt).toContain('hedg');
  });

  it('normative prompt checks consensus vs. one viewpoint and dissenting views', () => {
    const prompt = getJudgePrompt(ClaimType.Normative);
    expect(prompt).toContain('consensus');
    expect(prompt).toContain('dissent');
    expect(prompt).toContain('best practice');
  });

  it('synthesis prompt checks logical validity and alternative explanations', () => {
    const prompt = getJudgePrompt(ClaimType.Synthesis);
    expect(prompt).toContain('logical');
    expect(prompt).toContain('alternative explanation');
    expect(prompt).toContain('premises');
  });

  it('all prompts include base instructions about valid/invalid/needs_revision/uncertain', () => {
    for (const claimType of Object.values(ClaimType)) {
      const prompt = getJudgePrompt(claimType);
      expect(prompt).toContain('VALID');
      expect(prompt).toContain('INVALID');
      expect(prompt).toContain('NEEDS_REVISION');
      expect(prompt).toContain('UNCERTAIN');
    }
  });

  it('all prompts include output format instructions for submit_evaluation tool', () => {
    for (const claimType of Object.values(ClaimType)) {
      const prompt = getJudgePrompt(claimType);
      expect(prompt).toContain('submit_evaluation');
    }
  });

  it('_CLAIM_CRITERIA exposes all 6 claim types', () => {
    const types = Object.keys(_CLAIM_CRITERIA);
    expect(types).toHaveLength(6);
    for (const ct of Object.values(ClaimType)) {
      expect(types).toContain(ct);
    }
  });
});

// ---------------------------------------------------------------------------
// evaluateWithLLMJudge: decision logic — confidence > 0.80
// ---------------------------------------------------------------------------

describe('evaluateWithLLMJudge — high-confidence exit (> 0.80)', () => {
  it('returns "valid" verdict as-is when confidence is 0.92', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({ verdict: 'valid', confidence: 0.92, reasoning: 'Source matches.' }),
    );

    const result = await evaluateWithLLMJudge(makeEntry());

    expect(result.tier_id).toBe(2);
    expect(result.verdict).toBe('valid');
    expect(result.confidence).toBeCloseTo(0.92);
    expect(result.suggested_revision).toBeUndefined();
  });

  it('returns "invalid" with suggested_revision when confidence is 0.91', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({
        verdict: 'invalid',
        confidence: 0.91,
        reasoning: 'Source says 5.1%, not 5.2%.',
        suggested_revision: 'Change "5.2%" to "5.1%" to match source.',
      }),
    );

    const result = await evaluateWithLLMJudge(makeEntry());

    expect(result.verdict).toBe('invalid');
    expect(result.confidence).toBeCloseTo(0.91);
    expect(result.suggested_revision).toBe('Change "5.2%" to "5.1%" to match source.');
  });

  it('returns "needs_revision" at exactly 0.81 (above threshold)', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({
        verdict: 'needs_revision',
        confidence: 0.81,
        reasoning: 'Missing qualifier.',
        suggested_revision: 'Add "approximately" before the statistic.',
      }),
    );

    const result = await evaluateWithLLMJudge(makeEntry());

    expect(result.verdict).toBe('needs_revision');
    expect(result.confidence).toBeCloseTo(0.81);
  });

  it('escalates at exactly 0.80 (boundary is exclusive — 0.80 is NOT > 0.80)', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({ verdict: 'valid', confidence: 0.8, reasoning: 'Borderline.' }),
    );

    const result = await evaluateWithLLMJudge(makeEntry());

    expect(result.verdict).toBe('uncertain');
  });
});

// ---------------------------------------------------------------------------
// evaluateWithLLMJudge: decision logic — mid-band (0.6–0.80)
// ---------------------------------------------------------------------------

describe('evaluateWithLLMJudge — mid-band escalation (0.6–0.80)', () => {
  it('overrides verdict to "uncertain" when model returns 0.75 confidence', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({ verdict: 'valid', confidence: 0.75, reasoning: 'Somewhat supported.' }),
    );

    const result = await evaluateWithLLMJudge(makeEntry());

    expect(result.verdict).toBe('uncertain');
    expect(result.confidence).toBeCloseTo(0.75);
    expect(result.tier_id).toBe(2);
  });

  it('reasoning notes ESCALATING TO TIER 3 in mid-band', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({ verdict: 'invalid', confidence: 0.7, reasoning: 'Ambiguous.' }),
    );

    const result = await evaluateWithLLMJudge(makeEntry());

    expect(result.reasoning).toMatch(/ESCALATING TO TIER 3/i);
  });

  it('does NOT flag HIGH-PRIORITY for 0.65 confidence', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({ verdict: 'valid', confidence: 0.65, reasoning: 'Mixed evidence.' }),
    );

    const result = await evaluateWithLLMJudge(makeEntry());

    expect(result.verdict).toBe('uncertain');
    expect(result.reasoning).not.toMatch(/HIGH-PRIORITY/i);
    expect(result.reasoning).toMatch(/ESCALATING TO TIER 3/i);
  });

  it('overrides verdict to uncertain even when model says "invalid" at 0.72', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({ verdict: 'invalid', confidence: 0.72, reasoning: 'Slightly off.' }),
    );

    const result = await evaluateWithLLMJudge(makeEntry());

    expect(result.verdict).toBe('uncertain');
  });
});

// ---------------------------------------------------------------------------
// evaluateWithLLMJudge: decision logic — low-confidence (< 0.6)
// ---------------------------------------------------------------------------

describe('evaluateWithLLMJudge — low-confidence high-priority escalation (< 0.6)', () => {
  it('overrides verdict to "uncertain" and flags HIGH-PRIORITY at 0.55', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({
        verdict: 'valid',
        confidence: 0.55,
        reasoning: 'Source chunk too short to fully evaluate.',
      }),
    );

    const result = await evaluateWithLLMJudge(makeEntry());

    expect(result.verdict).toBe('uncertain');
    expect(result.confidence).toBeCloseTo(0.55);
    expect(result.reasoning).toMatch(/HIGH-PRIORITY/i);
  });

  it('flags HIGH-PRIORITY at 0.0 confidence', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({ verdict: 'uncertain', confidence: 0.0, reasoning: 'Cannot evaluate.' }),
    );

    const result = await evaluateWithLLMJudge(makeEntry());

    expect(result.verdict).toBe('uncertain');
    expect(result.reasoning).toMatch(/HIGH-PRIORITY/i);
  });

  it('flags HIGH-PRIORITY at exactly 0.59 (just below threshold)', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({ verdict: 'valid', confidence: 0.59, reasoning: 'Barely below.' }),
    );

    const result = await evaluateWithLLMJudge(makeEntry());

    expect(result.reasoning).toMatch(/HIGH-PRIORITY/i);
  });

  it('does NOT flag HIGH-PRIORITY at exactly 0.6 (boundary)', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({ verdict: 'valid', confidence: 0.6, reasoning: 'At boundary.' }),
    );

    const result = await evaluateWithLLMJudge(makeEntry());

    expect(result.verdict).toBe('uncertain');
    expect(result.reasoning).not.toMatch(/HIGH-PRIORITY/i);
    expect(result.reasoning).toMatch(/ESCALATING TO TIER 3/i);
  });
});

// ---------------------------------------------------------------------------
// evaluateWithLLMJudge: Tier 1 context injection
// ---------------------------------------------------------------------------

describe('evaluateWithLLMJudge — Tier 1 context injection', () => {
  it('includes NLI result in user message when tier1Result is provided', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({ verdict: 'valid', confidence: 0.9, reasoning: 'Confirmed by review.' }),
    );

    await evaluateWithLLMJudge(makeEntry(), TIER1_UNCERTAIN);

    const [params] = mockCreate.mock.calls[0] as [
      { messages: Array<{ role: string; content: string }> },
    ];
    // messages[0] = system, messages[1] = user
    const userContent = params.messages[1]?.content ?? '';

    expect(userContent).toContain('Tier 1 NLI Result');
    expect(userContent).toContain('0.62');
    expect(userContent).toContain('uncertain');
    expect(userContent).toContain(TIER1_UNCERTAIN.reasoning);
  });

  it('omits NLI section when tier1Result is not provided', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({ verdict: 'valid', confidence: 0.9, reasoning: 'Source matches.' }),
    );

    await evaluateWithLLMJudge(makeEntry());

    const [params] = mockCreate.mock.calls[0] as [
      { messages: Array<{ role: string; content: string }> },
    ];
    const userContent = params.messages[1]?.content ?? '';

    expect(userContent).not.toContain('Tier 1 NLI Result');
  });

  it('user message includes claim text, source chunks, and derivation method', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({ verdict: 'valid', confidence: 0.92, reasoning: 'OK.' }),
    );

    const claim = makeEntry({
      claim_text: 'Urban poverty increased by 12%.',
      derivation: DerivationMethod.AgentInference,
      sources: [makeSource('Urban poverty rose sharply over the decade.', 'S-007')],
    });

    await evaluateWithLLMJudge(claim);

    const [params] = mockCreate.mock.calls[0] as [
      { messages: Array<{ role: string; content: string }> },
    ];
    const userContent = params.messages[1]?.content ?? '';

    expect(userContent).toContain('Urban poverty increased by 12%.');
    expect(userContent).toContain('agent_inference');
    expect(userContent).toContain('Urban poverty rose sharply over the decade.');
    expect(userContent).toContain('S-007');
  });
});

// ---------------------------------------------------------------------------
// evaluateWithLLMJudge: Groq API call structure
// ---------------------------------------------------------------------------

describe('evaluateWithLLMJudge — Groq API call structure', () => {
  it('calls chat.completions.create with correct model and temperature', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({ verdict: 'valid', confidence: 0.9, reasoning: 'OK.' }),
    );

    await evaluateWithLLMJudge(makeEntry());

    const [params] = mockCreate.mock.calls[0] as [Record<string, unknown>];
    expect(params['model']).toBe('gpt-4o-mini');
    expect(params['temperature']).toBe(0.2);
  });

  it('uses the submit_evaluation function with tool_choice forced', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({ verdict: 'valid', confidence: 0.9, reasoning: 'OK.' }),
    );

    await evaluateWithLLMJudge(makeEntry());

    const [params] = mockCreate.mock.calls[0] as [Record<string, unknown>];
    const tools = params['tools'] as Array<{ type: string; function: { name: string } }>;
    const toolChoice = params['tool_choice'] as { type: string; function: { name: string } };

    expect(tools).toHaveLength(1);
    expect(tools[0]?.type).toBe('function');
    expect(tools[0]?.function.name).toBe('submit_evaluation');
    expect(toolChoice.type).toBe('function');
    expect(toolChoice.function.name).toBe('submit_evaluation');
  });

  it('sends system prompt as first message with role "system"', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({ verdict: 'valid', confidence: 0.9, reasoning: 'OK.' }),
    );

    await evaluateWithLLMJudge(makeEntry({ claim_type: ClaimType.Causal }));

    const [params] = mockCreate.mock.calls[0] as [
      { messages: Array<{ role: string; content: string }> },
    ];

    expect(params.messages[0]?.role).toBe('system');
    // Should contain causal-specific criteria
    expect(params.messages[0]?.content).toContain('causal');
  });

  it('uses distinct system prompts for each claim type', async () => {
    const capturedSystemPrompts: string[] = [];

    for (const claimType of Object.values(ClaimType)) {
      mockCreate.mockResolvedValueOnce(
        mockJudgeResponse({ verdict: 'valid', confidence: 0.9, reasoning: 'OK.' }),
      );

      await evaluateWithLLMJudge(makeEntry({ claim_type: claimType }));

      const [params] = mockCreate.mock.calls.at(-1) as [
        { messages: Array<{ role: string; content: string }> },
      ];
      capturedSystemPrompts.push(params.messages[0]?.content ?? '');
    }

    const unique = new Set(capturedSystemPrompts);
    expect(unique.size).toBe(Object.values(ClaimType).length);
  });
});

// ---------------------------------------------------------------------------
// evaluateWithLLMJudge: robustness
// ---------------------------------------------------------------------------

describe('evaluateWithLLMJudge — robustness', () => {
  it('coerces unknown verdict string to "uncertain"', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({
        verdict: 'probably_valid',
        confidence: 0.9,
        reasoning: 'Looks fine.',
      }),
    );

    const result = await evaluateWithLLMJudge(makeEntry());

    expect(result.verdict).toBe('uncertain');
  });

  it('re-throws when the API call fails', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Connection refused'));

    await expect(evaluateWithLLMJudge(makeEntry())).rejects.toThrow('Connection refused');
  });

  it('throws descriptively when model does not call submit_evaluation', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'chatcmpl_x',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'I think this is valid.', tool_calls: null },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    });

    await expect(evaluateWithLLMJudge(makeEntry())).rejects.toThrow(/submit_evaluation/);
  });

  it('uses plain-text JSON fallback when model ignores tool_choice', async () => {
    // Groq occasionally returns valid JSON in content instead of a tool call
    const jsonBody = JSON.stringify({
      verdict: 'valid',
      confidence: 0.91,
      reasoning: 'Source entails claim.',
    });
    mockCreate.mockResolvedValueOnce({
      id: 'chatcmpl_fallback',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: jsonBody, tool_calls: null },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 150, completion_tokens: 40, total_tokens: 190 },
    });

    const result = await evaluateWithLLMJudge(makeEntry());

    expect(result.verdict).toBe('valid');
    expect(result.confidence).toBeCloseTo(0.91);
    expect(result.tier_id).toBe(2);
  });

  it('uses plain-text JSON fallback when JSON is embedded in prose', async () => {
    // Model wraps JSON in explanation text — regex extracts the JSON object
    const content =
      'Here is my evaluation:\n```json\n' +
      JSON.stringify({ verdict: 'invalid', confidence: 0.88, reasoning: 'Mismatch found.' }) +
      '\n```';
    mockCreate.mockResolvedValueOnce({
      id: 'chatcmpl_prose',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content, tool_calls: null },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 60, total_tokens: 180 },
    });

    const result = await evaluateWithLLMJudge(makeEntry());

    expect(result.verdict).toBe('invalid');
    expect(result.confidence).toBeCloseTo(0.88);
  });

  it('throws when plain-text response contains no JSON object', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'chatcmpl_no_json',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'I think this claim looks fine to me.',
            tool_calls: null,
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 15, total_tokens: 115 },
    });

    await expect(evaluateWithLLMJudge(makeEntry())).rejects.toThrow(/submit_evaluation/);
  });

  it('clamps confidence above 1.0 to 1.0', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({ verdict: 'valid', confidence: 1.5, reasoning: 'Very sure.' }),
    );

    const result = await evaluateWithLLMJudge(makeEntry());

    expect(result.confidence).toBeLessThanOrEqual(1.0);
  });

  it('clamps confidence below 0.0 to 0.0', async () => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({ verdict: 'invalid', confidence: -0.3, reasoning: 'Clearly wrong.' }),
    );

    const result = await evaluateWithLLMJudge(makeEntry());

    expect(result.confidence).toBeGreaterThanOrEqual(0.0);
  });

  it('tier_id is always 2', async () => {
    for (const confidence of [0.95, 0.72, 0.45]) {
      mockCreate.mockResolvedValueOnce(
        mockJudgeResponse({ verdict: 'valid', confidence, reasoning: 'OK.' }),
      );

      const result = await evaluateWithLLMJudge(makeEntry());
      expect(result.tier_id).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// evaluateWithLLMJudge: per-claim-type smoke tests
// ---------------------------------------------------------------------------

describe('evaluateWithLLMJudge — claim type coverage', () => {
  it.each(Object.values(ClaimType))('runs successfully for claim type: %s', async (claimType) => {
    mockCreate.mockResolvedValueOnce(
      mockJudgeResponse({
        verdict: 'valid',
        confidence: 0.9,
        reasoning: `Claim type ${claimType} evaluated successfully.`,
      }),
    );

    const result = await evaluateWithLLMJudge(makeEntry({ claim_type: claimType }));

    expect(result.tier_id).toBe(2);
    expect(result.verdict).toBe('valid');
    expect(result.confidence).toBeCloseTo(0.9);
  });
});
