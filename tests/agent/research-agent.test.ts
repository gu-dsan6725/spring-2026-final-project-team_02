/**
 * Tests for the research agent and MCP tool registry.
 *
 * Unit tests mock the Groq SDK — no real API calls.
 * The mock simulates a two-turn agentic loop:
 *   turn 1 → finish_reason: 'tool_calls'  (agent calls arxiv_search)
 *   turn 2 → finish_reason: 'stop'        (agent outputs the final JSON)
 *
 * Integration tests are marked @integration and require GROQ_API_KEY +
 * BRAVE_SEARCH_API_KEY to run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runResearchAgent } from '../../src/agent/research-agent';
import { LoopController } from '../../src/agent/loop-controller';
import { TOOL_REGISTRY, getToolDefinitions, callTool } from '../../src/mcp/tool-registry';
import type { AgentConfig } from '../../src/types/agent';
import type { MemoInput } from '../../src/types/memo';
import { ClaimType, DerivationMethod } from '../../src/types/claims';

// ---------------------------------------------------------------------------
// Mock the Groq SDK
//
// vi.mock factories are hoisted above imports. We attach the mock fn to the
// constructor so it can be retrieved in tests.
// ---------------------------------------------------------------------------

vi.mock('groq-sdk', () => {
  const create = vi.fn();
  function MockGroq(_opts?: unknown) {
    return { chat: { completions: { create } } };
  }
  (MockGroq as unknown as Record<string, unknown>)._create = create;
  return { default: MockGroq };
});

async function getCreate(): Promise<ReturnType<typeof vi.fn>> {
  const mod = await import('groq-sdk');
  return (mod.default as unknown as Record<string, ReturnType<typeof vi.fn>>)['_create'];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const testConfig: AgentConfig = {
  max_tool_calls: 5,
  max_research_tokens: 10_000,
  max_revision_attempts: 2,
};

const testInput: MemoInput = {
  topic: 'Universal basic income in sub-Saharan Africa',
  background: 'For the Minister of Finance ahead of the 2026 budget.',
};

const VALID_NOTES_LOG_ENTRY = {
  claim_id: 'C-001',
  claim_text: 'Cash transfer programs increased school enrollment by 8.2 percentage points.',
  claim_type: ClaimType.Statistical,
  derivation: DerivationMethod.DirectExtraction,
  sources: [
    {
      source_id: 'S-001',
      source_title: 'Smith et al. (2023) — Cash Transfers and Education',
      source_url: 'https://arxiv.org/abs/2311.10000',
      relevant_chunk: 'Conditional cash transfers increased enrollment by 8.2 pp.',
    },
  ],
  reasoning: 'Directly extracted from the abstract of Smith et al. (2023).',
};

const VALID_FINAL_JSON = JSON.stringify({
  memo: {
    title: 'Policy Memo: Universal Basic Income in sub-Saharan Africa',
    sections: [
      {
        title: 'Executive Summary',
        content: 'Cash transfer programs have shown strong results [C-001].',
        claim_ids: ['C-001'],
      },
    ],
  },
  notes_log: [VALID_NOTES_LOG_ENTRY],
});

/** Build a minimal Groq ChatCompletion response. */
function makeGroqResponse(
  finishReason: 'stop' | 'tool_calls' | 'length',
  content: string | null,
  toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>,
  promptTokens = 500,
  completionTokens = 300,
) {
  return {
    id: 'chatcmpl_test',
    object: 'chat.completion',
    created: Date.now(),
    model: 'llama-3.3-70b-versatile',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
          tool_calls: toolCalls,
        },
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

function makeToolCall(id: string, name: string, args: Record<string, unknown>) {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

// ---------------------------------------------------------------------------
// Unit: happy path
// ---------------------------------------------------------------------------

describe('runResearchAgent — happy path', () => {
  let create: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    create = await getCreate();
    create.mockReset();
  });

  it('completes after a single tool call and returns memo + notes_log', async () => {
    create.mockResolvedValueOnce(
      makeGroqResponse('tool_calls', null, [
        makeToolCall('tc_001', 'arxiv_search', { query: 'UBI Africa' }),
      ]),
    );
    create.mockResolvedValueOnce(makeGroqResponse('stop', VALID_FINAL_JSON));

    const output = await runResearchAgent(testInput, testConfig);

    expect(output.memo_markdown).toContain('Universal Basic Income');
    expect(output.notes_log).toHaveLength(1);
    expect(output.notes_log[0]?.claim_id).toBe('C-001');
    expect(output.metadata.tool_calls_count).toBe(1);
  });

  it('returns valid MemoOutput shape', async () => {
    create.mockResolvedValueOnce(makeGroqResponse('stop', VALID_FINAL_JSON));

    const output = await runResearchAgent(testInput, testConfig);

    expect(typeof output.memo_markdown).toBe('string');
    expect(output.memo_markdown.length).toBeGreaterThan(0);
    expect(Array.isArray(output.notes_log)).toBe(true);
    expect(typeof output.metadata.generation_timestamp).toBe('string');
    expect(typeof output.metadata.token_usage).toBe('number');
    expect(typeof output.metadata.tool_calls_count).toBe('number');
  });

  it('handles direct stop with no tool calls', async () => {
    create.mockResolvedValueOnce(makeGroqResponse('stop', VALID_FINAL_JSON));

    const output = await runResearchAgent(testInput, testConfig);

    expect(output.notes_log).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('sends system prompt as first message', async () => {
    create.mockResolvedValueOnce(makeGroqResponse('stop', VALID_FINAL_JSON));

    await runResearchAgent(testInput, testConfig);

    const callArgs = create.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(callArgs.messages[0]?.role).toBe('system');
    expect(callArgs.messages[0]?.content).toContain(testInput.topic);
  });
});

// ---------------------------------------------------------------------------
// Unit: tool registry wired correctly
// ---------------------------------------------------------------------------

describe('runResearchAgent — tool definitions', () => {
  let create: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    create = await getCreate();
    create.mockReset();
  });

  it('includes all 8 tools in the request to Groq', async () => {
    create.mockResolvedValueOnce(makeGroqResponse('stop', VALID_FINAL_JSON));

    await runResearchAgent(testInput, testConfig);

    const callArgs = create.mock.calls[0]?.[0] as {
      tools: Array<{ type: string; function: { name: string } }>;
    };
    const toolNames = callArgs.tools.map((t) => t.function.name);

    expect(toolNames).toContain('web_search');
    expect(toolNames).toContain('arxiv_search');
    expect(toolNames).toContain('worldbank_data');
    expect(toolNames).toContain('govreport_search');
    expect(toolNames).toContain('govinfo_search');
    expect(toolNames).toContain('fred_data');
    expect(toolNames).toContain('semantic_scholar_search');
    expect(toolNames).toContain('read_uploaded_file');
    expect(toolNames).toHaveLength(8);
  });

  it('sends tools in Groq function format', async () => {
    create.mockResolvedValueOnce(makeGroqResponse('stop', VALID_FINAL_JSON));

    await runResearchAgent(testInput, testConfig);

    const callArgs = create.mock.calls[0]?.[0] as {
      tools: Array<{
        type: string;
        function: { name: string; description: string; parameters: unknown };
      }>;
    };
    const tool = callArgs.tools[0];
    expect(tool?.type).toBe('function');
    expect(typeof tool?.function.name).toBe('string');
    expect(typeof tool?.function.description).toBe('string');
    expect(typeof tool?.function.parameters).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// Unit: tool result forwarding
// ---------------------------------------------------------------------------

describe('runResearchAgent — tool result forwarding', () => {
  let create: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    create = await getCreate();
    create.mockReset();
  });

  it('appends tool result message with matching tool_call_id', async () => {
    create.mockResolvedValueOnce(
      makeGroqResponse('tool_calls', null, [
        makeToolCall('tc_abc', 'arxiv_search', { query: 'test' }),
      ]),
    );
    create.mockResolvedValueOnce(makeGroqResponse('stop', VALID_FINAL_JSON));

    await runResearchAgent(testInput, testConfig);

    // Second API call messages should include a tool role message
    const secondMessages = (
      create.mock.calls[1]?.[0] as { messages: Array<{ role: string; tool_call_id?: string }> }
    ).messages;

    const toolMsg = secondMessages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.tool_call_id).toBe('tc_abc');
  });

  it('handles unknown tool name gracefully', async () => {
    create.mockResolvedValueOnce(
      makeGroqResponse('tool_calls', null, [
        makeToolCall('tc_001', 'nonexistent_tool', { query: 'test' }),
      ]),
    );
    create.mockResolvedValueOnce(makeGroqResponse('stop', VALID_FINAL_JSON));

    const output = await runResearchAgent(testInput, testConfig);
    expect(output.memo_markdown).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Unit: budget enforcement
// ---------------------------------------------------------------------------

describe('runResearchAgent — budget enforcement', () => {
  let create: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    create = await getCreate();
    create.mockReset();
  });

  it('stops making tool calls once tool budget is reached', async () => {
    const tightConfig: AgentConfig = { ...testConfig, max_tool_calls: 2 };

    create
      .mockResolvedValueOnce(
        makeGroqResponse('tool_calls', null, [
          makeToolCall('tc_1', 'arxiv_search', { query: 'a' }),
        ]),
      )
      .mockResolvedValueOnce(
        makeGroqResponse('tool_calls', null, [
          makeToolCall('tc_2', 'arxiv_search', { query: 'b' }),
        ]),
      )
      .mockResolvedValue(makeGroqResponse('stop', VALID_FINAL_JSON));

    const output = await runResearchAgent(testInput, tightConfig);

    expect(output.metadata.tool_calls_count).toBeLessThanOrEqual(tightConfig.max_tool_calls + 1);
    expect(output.memo_markdown).toBeTruthy();
  });

  it('stops when token budget is exceeded', async () => {
    const tightConfig: AgentConfig = { ...testConfig, max_research_tokens: 100 };

    create
      .mockResolvedValueOnce(
        makeGroqResponse(
          'tool_calls',
          null,
          [makeToolCall('tc_1', 'arxiv_search', { query: 'test' })],
          50,
          70, // 120 total → exceeds 100 token budget
        ),
      )
      .mockResolvedValue(makeGroqResponse('stop', VALID_FINAL_JSON));

    const output = await runResearchAgent(testInput, tightConfig);
    expect(output.metadata.token_usage).toBeGreaterThan(tightConfig.max_research_tokens);
  });
});

// ---------------------------------------------------------------------------
// Unit: completeness check
// ---------------------------------------------------------------------------

describe('runResearchAgent — completeness', () => {
  let create: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    create = await getCreate();
    create.mockReset();
  });

  it('produces output even when memo has orphaned claim IDs', async () => {
    const jsonWithOrphan = JSON.stringify({
      memo: {
        title: 'Memo',
        sections: [
          {
            title: 'Summary',
            content: 'Finding [C-001]. Other [C-002].',
            claim_ids: ['C-001', 'C-002'],
          },
        ],
      },
      notes_log: [VALID_NOTES_LOG_ENTRY], // only C-001
    });

    create.mockResolvedValueOnce(makeGroqResponse('stop', jsonWithOrphan));

    const output = await runResearchAgent(testInput, testConfig);
    expect(output.memo_markdown).toContain('[C-002]');
    expect(output.notes_log).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Unit: LoopController
// ---------------------------------------------------------------------------

describe('LoopController — budget thresholds', () => {
  const config: AgentConfig = {
    max_tool_calls: 10,
    max_research_tokens: 1_000,
    max_revision_attempts: 2,
  };

  it('starts with ok status and full remaining budget', () => {
    const ctrl = new LoopController(config);
    const state = ctrl.getState();
    expect(state.status).toBe('ok');
    expect(state.toolCallsUsed).toBe(0);
    expect(state.toolCallsRemaining).toBe(10);
    expect(state.tokensRemaining).toBe(1_000);
    expect(ctrl.isBudgetExceeded()).toBe(false);
  });

  it('returns warn_60 at 60% tool call usage', () => {
    const ctrl = new LoopController(config);
    for (let i = 0; i < 6; i++) ctrl.recordToolCall(0);
    expect(ctrl.getState().status).toBe('warn_60');
  });

  it('returns warn_60 at exactly 60% token usage', () => {
    const ctrl = new LoopController(config);
    ctrl.recordTokens(600); // 60% of 1_000
    expect(ctrl.getState().status).toBe('warn_60');
  });

  it('returns warn_80 at 80% tool call usage', () => {
    const ctrl = new LoopController(config);
    for (let i = 0; i < 8; i++) ctrl.recordToolCall(0);
    expect(ctrl.getState().status).toBe('warn_80');
  });

  it('returns warn_80 at 80% token usage', () => {
    const ctrl = new LoopController(config);
    ctrl.recordTokens(800);
    expect(ctrl.getState().status).toBe('warn_80');
  });

  it('returns exceeded when tool limit is reached (hard stop)', () => {
    const ctrl = new LoopController(config);
    for (let i = 0; i < 10; i++) ctrl.recordToolCall(0);
    expect(ctrl.isToolBudgetExceeded()).toBe(true);
    expect(ctrl.getState().status).toBe('exceeded');
    expect(ctrl.getState().toolCallsRemaining).toBe(0);
  });

  it('returns exceeded when token budget is consumed', () => {
    const ctrl = new LoopController(config);
    ctrl.recordTokens(1_000);
    expect(ctrl.isTokenBudgetExceeded()).toBe(true);
    expect(ctrl.getState().status).toBe('exceeded');
  });

  it('isBudgetExceeded is true when only tool calls are exhausted', () => {
    const ctrl = new LoopController(config);
    for (let i = 0; i < 10; i++) ctrl.recordToolCall(0);
    expect(ctrl.isBudgetExceeded()).toBe(true);
  });

  it('isBudgetExceeded is true when only tokens are exhausted', () => {
    const ctrl = new LoopController(config);
    ctrl.recordTokens(1_001);
    expect(ctrl.isBudgetExceeded()).toBe(true);
  });

  it('buildBudgetExceededMessage contains limit and synthesise instruction', () => {
    const ctrl = new LoopController(config);
    for (let i = 0; i < 10; i++) ctrl.recordToolCall(0);
    const msg = ctrl.buildBudgetExceededMessage();
    expect(msg).toContain('10');
    expect(msg.toLowerCase()).toContain('synthesise');
  });

  it('buildSynthesisPromptMessage includes remaining call count', () => {
    const ctrl = new LoopController(config);
    for (let i = 0; i < 8; i++) ctrl.recordToolCall(0); // 2 remaining
    const msg = ctrl.buildSynthesisPromptMessage();
    expect(msg).toContain('2');
    expect(msg.toLowerCase()).toContain('synthesising');
  });

  it('buildSynthesisPromptMessage handles singular remaining call', () => {
    const ctrl = new LoopController(config);
    for (let i = 0; i < 9; i++) ctrl.recordToolCall(0); // 1 remaining
    const msg = ctrl.buildSynthesisPromptMessage();
    expect(msg).toContain('1 tool call remaining');
  });
});

// ---------------------------------------------------------------------------
// Unit: LoopController — deduplication cache
// ---------------------------------------------------------------------------

describe('LoopController — deduplication cache', () => {
  const config: AgentConfig = {
    max_tool_calls: 10,
    max_research_tokens: 10_000,
    max_revision_attempts: 2,
  };

  it('returns cache miss for unseen (tool, query) pair', () => {
    const ctrl = new LoopController(config);
    const result = ctrl.lookupCache('arxiv_search', 'UBI Africa');
    expect(result.hit).toBe(false);
  });

  it('returns cache hit after storing a result', () => {
    const ctrl = new LoopController(config);
    const payload = { results: ['some result'] };
    ctrl.storeCache('arxiv_search', 'UBI Africa', payload);
    const result = ctrl.lookupCache('arxiv_search', 'UBI Africa');
    expect(result.hit).toBe(true);
    if (result.hit) {
      expect(result.result).toEqual(payload);
    }
  });

  it('normalises query before comparing — case insensitive', () => {
    const ctrl = new LoopController(config);
    ctrl.storeCache('arxiv_search', 'UBI Africa', { data: 1 });
    const result = ctrl.lookupCache('arxiv_search', 'ubi africa');
    expect(result.hit).toBe(true);
  });

  it('normalises query before comparing — punctuation stripped', () => {
    const ctrl = new LoopController(config);
    ctrl.storeCache('arxiv_search', 'UBI, Africa!', { data: 1 });
    const result = ctrl.lookupCache('arxiv_search', 'ubi africa');
    expect(result.hit).toBe(true);
  });

  it('normalises query before comparing — word order independent', () => {
    const ctrl = new LoopController(config);
    ctrl.storeCache('arxiv_search', 'Africa UBI policy', { data: 1 });
    const result = ctrl.lookupCache('arxiv_search', 'policy ubi africa');
    expect(result.hit).toBe(true);
  });

  it('different tool names do not collide in cache', () => {
    const ctrl = new LoopController(config);
    ctrl.storeCache('arxiv_search', 'UBI Africa', { source: 'arxiv' });
    const result = ctrl.lookupCache('web_search', 'UBI Africa');
    expect(result.hit).toBe(false);
  });

  it('cacheSize reflects number of stored entries', () => {
    const ctrl = new LoopController(config);
    expect(ctrl.cacheSize).toBe(0);
    ctrl.storeCache('arxiv_search', 'query one', {});
    ctrl.storeCache('web_search', 'query two', {});
    expect(ctrl.cacheSize).toBe(2);
  });

  it('storing the same normalised key twice does not increase cache size', () => {
    const ctrl = new LoopController(config);
    ctrl.storeCache('arxiv_search', 'UBI Africa', { v: 1 });
    ctrl.storeCache('arxiv_search', 'ubi africa', { v: 2 }); // same normalised key
    expect(ctrl.cacheSize).toBe(1);
    const result = ctrl.lookupCache('arxiv_search', 'UBI Africa');
    expect(result.hit).toBe(true);
    if (result.hit) {
      // second write wins
      expect((result.result as { v: number }).v).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Unit: LoopController — research plan generation
// ---------------------------------------------------------------------------

describe('LoopController — buildResearchPlan', () => {
  const config: AgentConfig = {
    max_tool_calls: 25,
    max_research_tokens: 50_000,
    max_revision_attempts: 2,
  };

  it('returns a ResearchPlan with at least one query', () => {
    const ctrl = new LoopController(config);
    const plan = ctrl.buildResearchPlan('Universal basic income in sub-Saharan Africa');
    expect(plan.planned_queries.length).toBeGreaterThan(0);
    expect(plan.total_queries).toBe(plan.planned_queries.length);
  });

  it('budget.max_tool_calls matches config', () => {
    const ctrl = new LoopController(config);
    const plan = ctrl.buildResearchPlan('Climate adaptation in the Sahel');
    expect(plan.budget.max_tool_calls).toBe(config.max_tool_calls);
    expect(plan.budget.max_tokens).toBe(config.max_research_tokens);
  });

  it('queries do not exceed 80% of max_tool_calls', () => {
    const ctrl = new LoopController(config);
    const plan = ctrl.buildResearchPlan('Healthcare financing in low-income countries');
    expect(plan.planned_queries.length).toBeLessThanOrEqual(
      Math.floor(config.max_tool_calls * 0.8),
    );
  });

  it('queries are sorted by ascending priority', () => {
    const ctrl = new LoopController(config);
    const plan = ctrl.buildResearchPlan('Education policy outcomes');
    const priorities = plan.planned_queries.map((q) => q.priority);
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i - 1] as number);
    }
  });

  it('each planned query has required fields', () => {
    const ctrl = new LoopController(config);
    const plan = ctrl.buildResearchPlan('Water sanitation policy');
    for (const q of plan.planned_queries) {
      expect(typeof q.tool).toBe('string');
      expect(q.tool.length).toBeGreaterThan(0);
      expect(typeof q.query).toBe('string');
      expect(q.query.length).toBeGreaterThan(0);
      expect(Array.isArray(q.expected_claim_types)).toBe(true);
      expect(typeof q.priority).toBe('number');
    }
  });

  it('incorporates caller-supplied seed queries', () => {
    const ctrl = new LoopController(config);
    const seed: import('../../src/types/agent').PlannedQuery = {
      tool: 'read_uploaded_file',
      query: 'uploaded-report.pdf',
      expected_claim_types: ['normative' as ClaimType],
      priority: 1,
    };
    const plan = ctrl.buildResearchPlan('Fiscal policy reform', [seed]);
    const toolNames = plan.planned_queries.map((q) => q.tool);
    expect(toolNames).toContain('read_uploaded_file');
  });

  it('calls_per_query is a positive integer', () => {
    const ctrl = new LoopController(config);
    const plan = ctrl.buildResearchPlan('Rural electrification subsidies');
    expect(plan.budget.calls_per_query).toBeGreaterThan(0);
    expect(Number.isInteger(plan.budget.calls_per_query)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit: LoopController — quality gate
// ---------------------------------------------------------------------------

describe('LoopController — quality gate', () => {
  const config: AgentConfig = {
    max_tool_calls: 25,
    max_research_tokens: 50_000,
    max_revision_attempts: 2,
  };

  function makeEntry(
    claimId: string,
    claimType: ClaimType,
    sourceIds: string[],
  ): import('../../src/types/claims').NotesLogEntry {
    return {
      claim_id: claimId,
      claim_text: `Claim text for ${claimId}`,
      claim_type: claimType,
      derivation: DerivationMethod.DirectExtraction,
      sources: sourceIds.map((id) => ({
        source_id: id,
        source_title: `Source ${id}`,
        source_url: `https://example.com/${id}`,
        relevant_chunk: 'Relevant text.',
      })),
      reasoning: 'Test reasoning.',
    };
  }

  it('passes when minimum evidence is met', () => {
    const ctrl = new LoopController(config);
    const log = [
      makeEntry('C-001', ClaimType.Statistical, ['S-001', 'S-002']),
      makeEntry('C-002', ClaimType.Causal, ['S-003']),
      makeEntry('C-003', ClaimType.Comparative, ['S-004']),
      makeEntry('C-004', ClaimType.Statistical, ['S-005']),
    ];
    const result = ctrl.checkQualityGate(log);
    expect(result.passed).toBe(true);
    expect(result.needs_extra_round).toBe(false);
    expect(result.flags).toHaveLength(0);
  });

  it('fails and triggers extra round when too few sources', () => {
    const ctrl = new LoopController(config);
    const log = [
      makeEntry('C-001', ClaimType.Statistical, ['S-001']),
      makeEntry('C-002', ClaimType.Causal, ['S-001']), // same source
      makeEntry('C-003', ClaimType.Comparative, ['S-001']),
      makeEntry('C-004', ClaimType.Statistical, ['S-001']),
    ];
    const result = ctrl.checkQualityGate(log);
    expect(result.passed).toBe(false);
    expect(result.unique_sources).toBe(1);
    expect(result.needs_extra_round).toBe(true);
  });

  it('fails and triggers extra round when too few claims', () => {
    const ctrl = new LoopController(config);
    const log = [
      makeEntry('C-001', ClaimType.Statistical, ['S-001']),
      makeEntry('C-002', ClaimType.Causal, ['S-002']),
      makeEntry('C-003', ClaimType.Comparative, ['S-003']),
      // only 3 claims — need 4
    ];
    const result = ctrl.checkQualityGate(log);
    expect(result.passed).toBe(false);
    expect(result.total_claims).toBe(3);
    expect(result.needs_extra_round).toBe(true);
  });

  it('fails and triggers extra round when only one claim type', () => {
    const ctrl = new LoopController(config);
    const log = [
      makeEntry('C-001', ClaimType.Statistical, ['S-001']),
      makeEntry('C-002', ClaimType.Statistical, ['S-002']),
      makeEntry('C-003', ClaimType.Statistical, ['S-003']),
      makeEntry('C-004', ClaimType.Statistical, ['S-004']),
    ];
    const result = ctrl.checkQualityGate(log);
    expect(result.passed).toBe(false);
    expect(result.claim_type_count).toBe(1);
    expect(result.needs_extra_round).toBe(true);
  });

  it('extra round is only triggered once — second failure sets needs_extra_round=false', () => {
    const ctrl = new LoopController(config);
    const thinLog = [
      makeEntry('C-001', ClaimType.Statistical, ['S-001']),
      makeEntry('C-002', ClaimType.Statistical, ['S-001']),
    ];

    const first = ctrl.checkQualityGate(thinLog);
    expect(first.needs_extra_round).toBe(true);
    expect(ctrl.hasUsedExtraRound).toBe(true);

    // Second call — extra round already used
    const second = ctrl.checkQualityGate(thinLog);
    expect(second.needs_extra_round).toBe(false);
  });

  it('flags low-evidence memo when fewer than 3 claims collected', () => {
    const ctrl = new LoopController(config);
    const log = [
      makeEntry('C-001', ClaimType.Statistical, ['S-001']),
      makeEntry('C-002', ClaimType.Causal, ['S-002']),
    ];
    const result = ctrl.checkQualityGate(log);
    const hasLowEvidenceFlag = result.flags.some((f) => f.toLowerCase().includes('low-evidence'));
    expect(hasLowEvidenceFlag).toBe(true);
  });

  it('does not trigger extra round when budget is already exceeded', () => {
    const ctrl = new LoopController(config);
    // Exhaust the budget
    for (let i = 0; i < config.max_tool_calls; i++) ctrl.recordToolCall(0);

    const thinLog = [makeEntry('C-001', ClaimType.Statistical, ['S-001'])];
    const result = ctrl.checkQualityGate(thinLog);
    expect(result.needs_extra_round).toBe(false);
  });

  it('reports correct unique source count across entries with shared sources', () => {
    const ctrl = new LoopController(config);
    const log = [
      makeEntry('C-001', ClaimType.Statistical, ['S-001', 'S-002']),
      makeEntry('C-002', ClaimType.Causal, ['S-002', 'S-003']),
      makeEntry('C-003', ClaimType.Comparative, ['S-003', 'S-004']),
      makeEntry('C-004', ClaimType.Normative, ['S-004', 'S-005']),
    ];
    const result = ctrl.checkQualityGate(log);
    expect(result.unique_sources).toBe(5);
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit: TOOL_REGISTRY
// ---------------------------------------------------------------------------

describe('TOOL_REGISTRY', () => {
  const EXPECTED_TOOLS = [
    'web_search',
    'arxiv_search',
    'worldbank_data',
    'govreport_search',
    'govinfo_search',
    'fred_data',
    'semantic_scholar_search',
    'read_uploaded_file',
  ];

  it('registers exactly 8 tools', () => {
    expect(Object.keys(TOOL_REGISTRY)).toHaveLength(8);
  });

  it.each(EXPECTED_TOOLS)('"%s" has required fields', (toolName) => {
    const tool = TOOL_REGISTRY[toolName];
    expect(tool).toBeDefined();
    expect(typeof tool?.name).toBe('string');
    expect(typeof tool?.description).toBe('string');
    expect(typeof tool?.handler).toBe('function');
    expect(typeof tool?.timeout_ms).toBe('number');
    expect(typeof tool?.max_retries).toBe('number');
    expect(tool?.parameters).toBeDefined();
  });

  it('getToolDefinitions returns Groq-compatible format', () => {
    const defs = getToolDefinitions();
    expect(defs).toHaveLength(8);
    for (const def of defs) {
      expect(def.type).toBe('function');
      expect(typeof def.function.name).toBe('string');
      expect(typeof def.function.description).toBe('string');
      expect(typeof def.function.parameters).toBe('object');
    }
  });
});

// ---------------------------------------------------------------------------
// Unit: callTool — unknown tool
// ---------------------------------------------------------------------------

describe('callTool', () => {
  it('returns { error } for unknown tool name', async () => {
    const result = await callTool('nonexistent_tool', { query: 'test' });
    expect(result).toHaveProperty('error');
    expect(typeof result['error']).toBe('string');
  });

  it('routes web_search to handler and returns result shape', async () => {
    // Mock fetch for Brave Search
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: 'Test Result', url: 'https://example.com', description: 'A test result.' },
          ],
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    // Set a dummy API key so the handler doesn't short-circuit
    process.env['BRAVE_SEARCH_API_KEY'] = 'test_key';

    const result = await callTool('web_search', { query: 'universal basic income' });

    expect(result).toHaveProperty('results');
    expect(Array.isArray(result['results'])).toBe(true);

    vi.unstubAllGlobals();
    delete process.env['BRAVE_SEARCH_API_KEY'];
  });
});
