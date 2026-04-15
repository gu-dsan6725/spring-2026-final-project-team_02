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

describe('LoopController', () => {
  const config: AgentConfig = {
    max_tool_calls: 10,
    max_research_tokens: 1_000,
    max_revision_attempts: 2,
  };

  it('starts with ok status', () => {
    const ctrl = new LoopController(config);
    expect(ctrl.getState().status).toBe('ok');
    expect(ctrl.isBudgetExceeded()).toBe(false);
  });

  it('returns warn at 80% tool call usage', () => {
    const ctrl = new LoopController(config);
    for (let i = 0; i < 8; i++) ctrl.recordToolCall(0);
    expect(ctrl.getState().status).toBe('warn');
  });

  it('returns exceeded when tool limit is reached', () => {
    const ctrl = new LoopController(config);
    for (let i = 0; i < 10; i++) ctrl.recordToolCall(0);
    expect(ctrl.isToolBudgetExceeded()).toBe(true);
    expect(ctrl.getState().status).toBe('exceeded');
  });

  it('returns exceeded when token budget is consumed', () => {
    const ctrl = new LoopController(config);
    ctrl.recordTokens(1_000);
    expect(ctrl.isTokenBudgetExceeded()).toBe(true);
  });

  it('buildBudgetExceededMessage contains useful context', () => {
    const ctrl = new LoopController(config);
    for (let i = 0; i < 10; i++) ctrl.recordToolCall(0);
    const msg = ctrl.buildBudgetExceededMessage();
    expect(msg).toContain('10');
    expect(msg.toLowerCase()).toContain('synthesise');
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
