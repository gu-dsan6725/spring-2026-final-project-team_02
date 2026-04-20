/**
 * Full pipeline integration test — no real API calls.
 *
 * All external dependencies are mocked deterministically:
 *   - groq-sdk     → controls agent output AND revision agent output
 *   - tier1-nli    → NLI evaluation (mock returns uncertain by default)
 *   - tier2-llm-judge → LLM judge (mock returns specific verdicts)
 *   - tier3-debate → Multi-agent debate (mock, only called when tier2 escalates)
 *
 * The test chain verifies:
 *   1. runResearchAgent → produces MemoOutput with notes_log
 *   2. evaluateClaim    → produces HeraldResult for each claim (routing + verdict)
 *   3. reviseClaimsFromHerald → rewrites invalid claims, flags unresolvable ones
 *   4. submitForHumanReview   → queues unresolvable claims for human review
 *   5. submitHumanVerdict     → builds a final HeraldResult from human decision
 *
 * Coverage goals (from TESTING_STATUS.md):
 *   - Groq mocked with deterministic responses
 *   - Gemini search mocked (no real HTTP)
 *   - Runs evaluateClaim → reviseClaimsFromHerald → submitForHumanReview
 *   - Verifies final output structure matches HeraldResult schema
 *   - Verifies memo markdown is rewritten where claims are revised
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ClaimType, DerivationMethod, type NotesLogEntry } from '../../src/types/claims';
import type { HeraldResult } from '../../src/types/herald';
import type { MemoOutput } from '../../src/types/memo';

// ---------------------------------------------------------------------------
// Mock: Groq SDK (used by research agent, revision agent)
// ---------------------------------------------------------------------------

const mockGroqCreate = vi.hoisted(() => vi.fn());

vi.mock('groq-sdk', () => ({
  default: vi.fn(function () {
    return { chat: { completions: { create: mockGroqCreate } } };
  }),
}));

// ---------------------------------------------------------------------------
// Mock: NLI evaluation (Tier 1 — returns uncertain by default)
// ---------------------------------------------------------------------------

const mockEvaluateWithNLI = vi.hoisted(() => vi.fn());

vi.mock('../../src/herald/tier1-nli', () => ({
  evaluateWithNLI: mockEvaluateWithNLI,
}));

// ---------------------------------------------------------------------------
// Mock: LLM Judge (Tier 2)
// ---------------------------------------------------------------------------

const mockEvaluateWithLLMJudge = vi.hoisted(() => vi.fn());

vi.mock('../../src/herald/tier2-llm-judge', () => ({
  evaluateWithLLMJudge: mockEvaluateWithLLMJudge,
}));

// ---------------------------------------------------------------------------
// Mock: Debate (Tier 3)
// ---------------------------------------------------------------------------

const mockEvaluateWithDebate = vi.hoisted(() => vi.fn());

vi.mock('../../src/herald/tier3-debate', () => ({
  evaluateWithDebate: mockEvaluateWithDebate,
}));

// ---------------------------------------------------------------------------
// Mock: Braintrust observability
// ---------------------------------------------------------------------------

vi.mock('../../src/observability/braintrust', () => ({
  startSpan: vi.fn(() => ({ id: 'test', name: 'test', startTime: 0, log: vi.fn(), end: vi.fn() })),
  logError: vi.fn(),
  logToolCall: vi.fn(),
  logWarn: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after all mocks are declared)
// ---------------------------------------------------------------------------

import { runResearchAgent } from '../../src/agent/research-agent';
import { evaluateClaim } from '../../src/herald/router';
import { reviseClaimsFromHerald } from '../../src/herald/feedback-loop';
import {
  clearQueue,
  submitForHumanReview,
  getHumanReviewQueue,
  submitHumanVerdict,
  type HumanVerdictSubmission,
} from '../../src/herald/tier4-human';

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const STATISTICAL_CLAIM: NotesLogEntry = {
  claim_id: 'C-001',
  claim_text: 'Maternal mortality in Chad stands at 2,000 per 100,000 live births.',
  claim_type: ClaimType.Statistical,
  derivation: DerivationMethod.DirectExtraction,
  sources: [
    {
      source_id: 'S-001',
      source_title: 'WHO Global Health Observatory 2023',
      source_url: 'https://www.who.int/data/gho',
      relevant_chunk: 'Maternal mortality ratio for Chad: 1,140 per 100,000 live births (2020).',
    },
  ],
  reasoning: 'Extracted directly from WHO GHO.',
};

const SYNTHESIS_CLAIM: NotesLogEntry = {
  claim_id: 'C-002',
  claim_text: 'Declining enrollment and rising child labor suggest subsidy programs failed.',
  claim_type: ClaimType.Synthesis,
  derivation: DerivationMethod.AgentInference,
  sources: [
    {
      source_id: 'S-002',
      source_title: 'UNICEF Chad 2023',
      source_url: 'https://unicef.org/chad',
      relevant_chunk: 'Enrollment declined 4.1% year-over-year.',
    },
  ],
  reasoning: 'Agent inference combining two trend sources.',
};

/** Produces a MemoOutput with both test claims in the markdown. */
function makeMemo(overrides: Partial<MemoOutput> = {}): MemoOutput {
  return {
    memo_markdown: `# Chad Policy Memo\n\n${STATISTICAL_CLAIM.claim_text} [C-001]\n\n${SYNTHESIS_CLAIM.claim_text} [C-002]`,
    notes_log: [STATISTICAL_CLAIM, SYNTHESIS_CLAIM],
    metadata: {
      generation_timestamp: new Date().toISOString(),
      token_usage: 2500,
      tool_calls_count: 8,
    },
    ...overrides,
  };
}

function makeGroqAgentResponse(json: object) {
  return {
    id: 'chatcmpl_agent',
    object: 'chat.completion',
    created: Date.now(),
    model: 'llama-3.3-70b-versatile',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: JSON.stringify(json), tool_calls: undefined },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 800, completion_tokens: 400, total_tokens: 1200 },
  };
}

function makeGroqRevisionResponse(revisedText: string) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            revised_claim_text: revisedText,
            reasoning: `Corrected to match source: ${revisedText}`,
            derivation_update: 'direct_extraction',
          }),
        },
      },
    ],
  };
}

function makeTierOutput(tier: 1 | 2 | 3 | 4, verdict: HeraldResult['verdict'], confidence = 0.92) {
  return { tier_id: tier, verdict, confidence, reasoning: `Tier ${String(tier)} reasoning.` };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  clearQueue();
  process.env['GROQ_API_KEY'] = 'test-groq-key';
  delete process.env['OPENAI_API_KEY'];
  delete process.env['RESEARCH_LLM_PROVIDER'];
  delete process.env['RESEARCH_GROQ_MODEL'];
  delete process.env['RESEARCH_OPENAI_MODEL'];
  delete process.env['REVISION_LLM_PROVIDER'];
  delete process.env['REVISION_GROQ_MODEL'];
  delete process.env['REVISION_OPENAI_MODEL'];
});

// ---------------------------------------------------------------------------
// Phase 1 → Phase 2: Agent produces memo
// ---------------------------------------------------------------------------

describe('Pipeline Phase 1→2: Research agent produces MemoOutput', () => {
  it('runResearchAgent returns memo_markdown and notes_log', async () => {
    const agentJson = {
      memo: {
        title: 'Policy Memo: Chad Health',
        sections: [
          {
            title: 'Executive Summary',
            content: `${STATISTICAL_CLAIM.claim_text} [C-001]`,
            claim_ids: ['C-001'],
          },
        ],
      },
      notes_log: [STATISTICAL_CLAIM],
    };

    mockGroqCreate.mockResolvedValueOnce(makeGroqAgentResponse(agentJson));

    const output = await runResearchAgent(
      { topic: 'Maternal health in Chad' },
      { max_tool_calls: 5, max_research_tokens: 10000, max_revision_attempts: 2 },
    );

    expect(output.memo_markdown).toContain('Policy Memo');
    expect(output.notes_log).toHaveLength(1);
    expect(output.notes_log[0]?.claim_id).toBe('C-001');
    expect(output.metadata.tool_calls_count).toBeGreaterThanOrEqual(0);
    expect(typeof output.metadata.generation_timestamp).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Phase 4: HERALD evaluation pipeline
// ---------------------------------------------------------------------------

describe('Pipeline Phase 4: evaluateClaim routing and verdicts', () => {
  it('statistical claim starts at Tier 1 — valid NLI exits at tier 1', async () => {
    mockEvaluateWithNLI.mockResolvedValueOnce(makeTierOutput(1, 'valid', 0.95));

    const result = await evaluateClaim(STATISTICAL_CLAIM);

    expect(result.tier_reached).toBe(1);
    expect(result.verdict).toBe('valid');
    expect(result.claim_id).toBe('C-001');
    expect(result.tier_details.tier_1).not.toBeNull();
    expect(result.tier_details.tier_2).toBeNull();
    expect(result.tier_details.tier_3).toBeNull();
  });

  it('statistical claim escalates Tier1→Tier2 when NLI returns uncertain', async () => {
    mockEvaluateWithNLI.mockResolvedValueOnce(makeTierOutput(1, 'uncertain', 0.65));
    mockEvaluateWithLLMJudge.mockResolvedValueOnce(makeTierOutput(2, 'valid', 0.91));

    const result = await evaluateClaim(STATISTICAL_CLAIM);

    expect(result.tier_reached).toBe(2);
    expect(result.verdict).toBe('valid');
    expect(result.tier_details.tier_1).not.toBeNull();
    expect(result.tier_details.tier_2).not.toBeNull();
  });

  it('synthesis claim skips Tier 1 and starts at Tier 2', async () => {
    mockEvaluateWithLLMJudge.mockResolvedValueOnce(makeTierOutput(2, 'invalid', 0.88));

    const result = await evaluateClaim(SYNTHESIS_CLAIM);

    expect(result.tier_reached).toBe(2);
    expect(result.verdict).toBe('invalid');
    // Synthesis skips NLI — tier_1 is null in the TS router (no separate skipped field)
    expect(result.tier_details.tier_1).toBeNull();
    expect(mockEvaluateWithNLI).not.toHaveBeenCalled();
  });

  it('claim escalates Tier2→Tier3 when LLM judge returns uncertain', async () => {
    mockEvaluateWithLLMJudge.mockResolvedValueOnce(makeTierOutput(2, 'uncertain', 0.68));
    mockEvaluateWithDebate.mockResolvedValueOnce(makeTierOutput(3, 'invalid', 0.85));

    const result = await evaluateClaim(SYNTHESIS_CLAIM);

    expect(result.tier_reached).toBe(3);
    expect(result.verdict).toBe('invalid');
    expect(result.tier_details.tier_3).not.toBeNull();
  });

  it('HeraldResult schema is complete with all 4 tier_details keys', async () => {
    mockEvaluateWithNLI.mockResolvedValueOnce(makeTierOutput(1, 'valid', 0.97));

    const result = await evaluateClaim(STATISTICAL_CLAIM);

    expect(result).toHaveProperty('claim_id');
    expect(result).toHaveProperty('tier_reached');
    expect(result).toHaveProperty('verdict');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('feedback');
    expect(result).toHaveProperty('suggested_revision');
    expect(result).toHaveProperty('tier_details');
    expect(result.tier_details).toHaveProperty('tier_1');
    expect(result.tier_details).toHaveProperty('tier_2');
    expect(result.tier_details).toHaveProperty('tier_3');
    expect(result.tier_details).toHaveProperty('tier_4');
  });
});

// ---------------------------------------------------------------------------
// Phase 4→revision: reviseClaimsFromHerald rewrites invalid claims
// ---------------------------------------------------------------------------

describe('Pipeline Phase 4→revision: reviseClaimsFromHerald rewrites memo', () => {
  it('invalid claim is revised and memo markdown is updated', async () => {
    const memo = makeMemo();
    const heraldResult: HeraldResult = {
      claim_id: 'C-001',
      tier_reached: 1,
      verdict: 'invalid',
      confidence: 0.93,
      feedback: 'Source says 1,140, not 2,000.',
      suggested_revision: 'Maternal mortality in Chad stands at 1,140 per 100,000 live births.',
      tier_details: {
        tier_1: makeTierOutput(1, 'invalid', 0.93),
        tier_2: null,
        tier_3: null,
        tier_4: null,
      },
    };

    const correctedText = 'Maternal mortality in Chad stands at 1,140 per 100,000 live births.';
    mockGroqCreate.mockResolvedValueOnce(makeGroqRevisionResponse(correctedText));

    // Re-evaluation of revised claim passes
    mockEvaluateWithNLI.mockResolvedValueOnce(makeTierOutput(1, 'valid', 0.97));

    const result = await reviseClaimsFromHerald(memo, [heraldResult], {
      max_tool_calls: 25,
      max_research_tokens: 50000,
      max_revision_attempts: 2,
    });

    expect(result.memo_markdown).toContain(correctedText);
    expect(result.memo_markdown).not.toContain('2,000 per 100,000');
    expect(result.revision_states[0]?.status).toBe('revised');
    expect(result.requires_human_intervention).toHaveLength(0);
  });

  it('unresolvable claim is flagged and notes_log preserves original claim', async () => {
    const memo = makeMemo();
    const heraldResult: HeraldResult = {
      claim_id: 'C-002',
      tier_reached: 3,
      verdict: 'invalid',
      confidence: 0.88,
      feedback: 'Synthesis conclusion is not supported.',
      suggested_revision: null,
      tier_details: {
        tier_1: null,
        tier_2: makeTierOutput(2, 'uncertain', 0.55),
        tier_3: makeTierOutput(3, 'invalid', 0.88),
        tier_4: null,
      },
    };

    // Both revision attempts fail
    mockGroqCreate
      .mockResolvedValueOnce(makeGroqRevisionResponse('Revised attempt 1.'))
      .mockResolvedValueOnce(makeGroqRevisionResponse('Revised attempt 2.'));

    // Re-evaluation returns invalid both times
    mockEvaluateWithLLMJudge
      .mockResolvedValueOnce(makeTierOutput(2, 'invalid', 0.9))
      .mockResolvedValueOnce(makeTierOutput(2, 'invalid', 0.9));

    const result = await reviseClaimsFromHerald(memo, [heraldResult], {
      max_tool_calls: 25,
      max_research_tokens: 50000,
      max_revision_attempts: 2,
    });

    expect(result.requires_human_intervention).toContain('C-002');
    // Original claim text preserved in memo
    expect(result.memo_markdown).toContain(SYNTHESIS_CLAIM.claim_text);
  });

  it('valid claims are unchanged — no Groq revision calls made', async () => {
    const memo = makeMemo();
    const validResult: HeraldResult = {
      claim_id: 'C-001',
      tier_reached: 1,
      verdict: 'valid',
      confidence: 0.97,
      feedback: 'Entailment confirmed.',
      suggested_revision: null,
      tier_details: {
        tier_1: makeTierOutput(1, 'valid', 0.97),
        tier_2: null,
        tier_3: null,
        tier_4: null,
      },
    };

    const result = await reviseClaimsFromHerald(memo, [validResult]);

    expect(mockGroqCreate).not.toHaveBeenCalled();
    expect(result.revision_states).toHaveLength(0);
    expect(result.requires_human_intervention).toHaveLength(0);
    expect(result.memo_markdown).toBe(memo.memo_markdown);
  });
});

// ---------------------------------------------------------------------------
// Phase 4 Tier 4: Human review queue
// ---------------------------------------------------------------------------

describe('Pipeline Phase 4 Tier 4: Human review queue', () => {
  it('submitForHumanReview queues a claim and getHumanReviewQueue returns it', async () => {
    const prevTierResults = [
      makeTierOutput(2, 'uncertain', 0.55),
      makeTierOutput(3, 'invalid', 0.85),
    ];

    const entry = submitForHumanReview(SYNTHESIS_CLAIM, prevTierResults, 'memo-001');

    expect(entry.claim.claim_id).toBe('C-002');
    expect(entry.status).toBe('pending');
    expect(entry.verdict).toBeNull();

    const queue = getHumanReviewQueue('memo-001');
    expect(queue).toHaveLength(1);
    expect(queue[0]?.claim.claim_id).toBe('C-002');
  });

  it('submitHumanVerdict builds a valid HeraldResult', async () => {
    const prevTierResults = [makeTierOutput(2, 'uncertain', 0.55)];
    const entry = submitForHumanReview(SYNTHESIS_CLAIM, prevTierResults, 'memo-002');

    const submission: HumanVerdictSubmission = {
      verdict: 'invalid',
      notes: 'Logical gap identified.',
    };
    const reviewResult = submitHumanVerdict(entry.claim.claim_id, submission, 'memo-002');
    const result = reviewResult.resolved_herald_result!;

    expect(result.claim_id).toBe('C-002');
    expect(result.tier_reached).toBe(4);
    expect(result.verdict).toBe('invalid');
    expect(result.feedback).toContain('Logical gap identified.');
    expect(result.tier_details.tier_4).not.toBeNull();
  });

  it('full cycle: agent → evaluate → revise → human queue → verdict', async () => {
    // Step 1: HERALD evaluation — synthesis claim comes back invalid from Tier 2
    mockEvaluateWithLLMJudge.mockResolvedValueOnce(makeTierOutput(2, 'invalid', 0.91));

    const heraldResult = await evaluateClaim(SYNTHESIS_CLAIM);
    expect(heraldResult.verdict).toBe('invalid');

    // Step 2: Revision fails twice
    const memo = makeMemo();
    mockGroqCreate
      .mockResolvedValueOnce(makeGroqRevisionResponse('Revised synthesis v1.'))
      .mockResolvedValueOnce(makeGroqRevisionResponse('Revised synthesis v2.'));
    mockEvaluateWithLLMJudge
      .mockResolvedValueOnce(makeTierOutput(2, 'invalid', 0.88))
      .mockResolvedValueOnce(makeTierOutput(2, 'invalid', 0.9));

    const revisionResult = await reviseClaimsFromHerald(memo, [heraldResult], {
      max_tool_calls: 25,
      max_research_tokens: 50000,
      max_revision_attempts: 2,
    });

    expect(revisionResult.requires_human_intervention).toContain('C-002');

    // Step 3: Submit to human review queue
    const prevTiers = [heraldResult.tier_details.tier_2!];
    const queueEntry = submitForHumanReview(SYNTHESIS_CLAIM, prevTiers, 'memo-full-test');

    const queue = getHumanReviewQueue('memo-full-test');
    expect(queue).toHaveLength(1);
    expect(queue[0]?.status).toBe('pending');

    // Step 4: Human submits verdict
    const submission: HumanVerdictSubmission = {
      verdict: 'invalid',
      notes: 'The claim omits important qualifiers about population scope.',
    };
    const reviewResult = submitHumanVerdict('C-002', submission, 'memo-full-test');
    const finalResult = reviewResult.resolved_herald_result!;

    expect(finalResult.tier_reached).toBe(4);
    expect(finalResult.verdict).toBe('invalid');
    expect(finalResult.claim_id).toBe('C-002');

    // Queue entry is now marked reviewed
    const updatedQueue = getHumanReviewQueue('memo-full-test');
    expect(updatedQueue[0]?.status).toBe('reviewed');
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: HeraldResult schema compliance
// ---------------------------------------------------------------------------

describe('Pipeline: HeraldResult schema compliance across all paths', () => {
  const REQUIRED_FIELDS: Array<keyof HeraldResult> = [
    'claim_id',
    'tier_reached',
    'verdict',
    'confidence',
    'feedback',
    'suggested_revision',
    'tier_details',
  ];

  it('evaluateClaim result has all required HeraldResult fields (Tier 1 exit)', async () => {
    mockEvaluateWithNLI.mockResolvedValueOnce(makeTierOutput(1, 'valid', 0.97));

    const result = await evaluateClaim(STATISTICAL_CLAIM);

    for (const field of REQUIRED_FIELDS) {
      expect(result).toHaveProperty(field);
    }
  });

  it('evaluateClaim result has all required HeraldResult fields (Tier 2 exit)', async () => {
    mockEvaluateWithLLMJudge.mockResolvedValueOnce(makeTierOutput(2, 'invalid', 0.88));

    const result = await evaluateClaim(SYNTHESIS_CLAIM);

    for (const field of REQUIRED_FIELDS) {
      expect(result).toHaveProperty(field);
    }
  });

  it('human verdict result has all required HeraldResult fields (Tier 4 exit)', async () => {
    submitForHumanReview(SYNTHESIS_CLAIM, [], 'memo-schema-test');
    const submission: HumanVerdictSubmission = {
      verdict: 'valid',
      notes: 'Looks fine after review.',
    };
    const reviewResult = submitHumanVerdict('C-002', submission, 'memo-schema-test');
    const result = reviewResult.resolved_herald_result!;

    for (const field of REQUIRED_FIELDS) {
      expect(result).toHaveProperty(field);
    }
  });

  it('verdict is always one of the 3 valid values across all tier exits', async () => {
    const validVerdicts = new Set(['valid', 'invalid', 'uncertain']);

    // Tier 1
    mockEvaluateWithNLI.mockResolvedValueOnce(makeTierOutput(1, 'valid', 0.97));
    const r1 = await evaluateClaim(STATISTICAL_CLAIM);
    expect(validVerdicts.has(r1.verdict)).toBe(true);

    // Tier 2
    mockEvaluateWithLLMJudge.mockResolvedValueOnce(makeTierOutput(2, 'invalid', 0.88));
    const r2 = await evaluateClaim(SYNTHESIS_CLAIM);
    expect(validVerdicts.has(r2.verdict)).toBe(true);

    // Tier 4
    submitForHumanReview(STATISTICAL_CLAIM, [], 'memo-verdict-test');
    const sub4: HumanVerdictSubmission = { verdict: 'invalid', notes: 'Review notes.' };
    const rr4 = submitHumanVerdict('C-001', sub4, 'memo-verdict-test');
    const r4 = rr4.resolved_herald_result!;
    expect(validVerdicts.has(r4.verdict)).toBe(true);
  });
});
