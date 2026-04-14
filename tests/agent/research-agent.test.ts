/**
 * Tests for the research agent.
 *
 * All tests use vi.mock to stub the Anthropic SDK so no real API calls are
 * made. The mock simulates a two-turn agentic loop:
 *   turn 1 → stop_reason: 'tool_use'  (agent calls arxiv_search)
 *   turn 2 → stop_reason: 'end_turn'  (agent outputs the final JSON)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runResearchAgent } from '../../src/agent/research-agent';
import { LoopController } from '../../src/agent/loop-controller';
import type { AgentConfig } from '../../src/types/agent';
import type { MemoInput } from '../../src/types/memo';
import { ClaimType, DerivationMethod } from '../../src/types/claims';

// ---------------------------------------------------------------------------
// Mock the Anthropic SDK
//
// vi.mock factories are hoisted above imports, so we cannot reference a
// module-level `const mockCreate` inside the factory. Instead we attach the
// fn to the constructor and retrieve it in a beforeEach.
// ---------------------------------------------------------------------------

vi.mock('@anthropic-ai/sdk', () => {
  const create = vi.fn();
  function MockAnthropic() {
    return { messages: { create } };
  }
  (MockAnthropic as unknown as Record<string, unknown>)._create = create;
  return { default: MockAnthropic };
});

// Lazily resolved after the mock is set up.
async function getCreate(): Promise<ReturnType<typeof vi.fn>> {
  const mod = await import('@anthropic-ai/sdk');

  return (mod.default as any)._create as ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const testConfig: AgentConfig = {
  max_tool_calls: 5,
  max_research_tokens: 10000,
  max_revision_attempts: 2,
};

const testInput: MemoInput = {
  topic: 'Universal basic income in sub-Saharan Africa',
  background: 'For the Minister of Finance ahead of the 2026 budget.',
};

const VALID_NOTES_LOG_ENTRY = {
  claim_id: 'C-001',
  claim_text: 'Cash transfer programs increased enrollment by 8.2 percentage points.',
  claim_type: ClaimType.Statistical,
  derivation: DerivationMethod.DirectExtraction,
  sources: [
    {
      source_id: 'S-001',
      source_title: 'Smith et al. (2023) — Cash Transfers and Education',
      source_url: 'https://arxiv.org/abs/2311.10000',
      relevant_chunk: 'We find conditional cash transfers increased enrollment by 8.2 pp.',
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

/**
 * Build a minimal Anthropic Message. Cast through unknown to avoid having to
 * populate every optional field the SDK added in newer versions.
 */
function makeResponse(
  stopReason: 'tool_use' | 'end_turn',
  content: unknown[],
  inputTokens = 500,
  outputTokens = 300,
): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content,
    model: 'claude-sonnet-4-6',
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
}

function makeToolUse(id: string, name: string, input: Record<string, unknown>): unknown {
  return { type: 'tool_use', id, name, input };
}

function makeText(text: string): unknown {
  return { type: 'text', text };
}

// ---------------------------------------------------------------------------
// Tests: agent loop completes and produces memo + notes log
// ---------------------------------------------------------------------------

describe('runResearchAgent — happy path', () => {
  let create: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    create = await getCreate();
    create.mockReset();
  });

  it('completes after a single tool call and returns memo + notes_log', async () => {
    create.mockResolvedValueOnce(
      makeResponse('tool_use', [makeToolUse('tu_001', 'arxiv_search', { query: 'UBI Africa' })]),
    );
    create.mockResolvedValueOnce(makeResponse('end_turn', [makeText(VALID_FINAL_JSON)]));

    const output = await runResearchAgent(testInput, testConfig);

    expect(output.memo_markdown).toContain('Universal Basic Income');
    expect(output.notes_log).toHaveLength(1);
    expect(output.notes_log[0]?.claim_id).toBe('C-001');
    expect(output.metadata.tool_calls_count).toBe(1);
  });

  it('returns valid MemoOutput shape', async () => {
    create.mockResolvedValueOnce(makeResponse('end_turn', [makeText(VALID_FINAL_JSON)]));

    const output = await runResearchAgent(testInput, testConfig);

    expect(typeof output.memo_markdown).toBe('string');
    expect(output.memo_markdown.length).toBeGreaterThan(0);
    expect(Array.isArray(output.notes_log)).toBe(true);
    expect(typeof output.metadata.generation_timestamp).toBe('string');
    expect(typeof output.metadata.token_usage).toBe('number');
    expect(typeof output.metadata.tool_calls_count).toBe('number');
  });

  it('handles direct end_turn with no tool calls', async () => {
    create.mockResolvedValueOnce(makeResponse('end_turn', [makeText(VALID_FINAL_JSON)]));

    const output = await runResearchAgent(testInput, testConfig);

    expect(output.notes_log).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('includes web_search in the tools list sent to the API', async () => {
    create.mockResolvedValueOnce(makeResponse('end_turn', [makeText(VALID_FINAL_JSON)]));

    await runResearchAgent(testInput, testConfig);

    const callArgs = create.mock.calls[0]?.[0] as { tools: Array<{ name: string }> };
    const toolNames = callArgs.tools.map((t) => t.name);
    expect(toolNames).toContain('web_search');
    expect(toolNames).toContain('arxiv_search');
    expect(toolNames).toContain('worldbank_data');
    expect(toolNames).toContain('read_uploaded_file');
  });
});

// ---------------------------------------------------------------------------
// Tests: budget enforcement
// ---------------------------------------------------------------------------

describe('runResearchAgent — budget enforcement', () => {
  let create: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    create = await getCreate();
    create.mockReset();
  });

  it('stops making tool calls once the tool budget is reached', async () => {
    const tightConfig: AgentConfig = { ...testConfig, max_tool_calls: 2 };

    const toolTurn = makeResponse('tool_use', [
      makeToolUse('tu_001', 'arxiv_search', { query: 'UBI Africa' }),
    ]);
    const finalTurn = makeResponse('end_turn', [makeText(VALID_FINAL_JSON)]);

    create
      .mockResolvedValueOnce(toolTurn)
      .mockResolvedValueOnce(toolTurn)
      .mockResolvedValue(finalTurn); // fallback for any additional calls

    const output = await runResearchAgent(testInput, tightConfig);

    expect(output.metadata.tool_calls_count).toBeLessThanOrEqual(tightConfig.max_tool_calls + 1);
    expect(output.memo_markdown).toBeTruthy();
  });

  it('stops when token budget is exceeded', async () => {
    const tightConfig: AgentConfig = { ...testConfig, max_research_tokens: 100 };

    // Turn 1: 300 tokens total → exceeds the 100-token budget
    create.mockResolvedValueOnce(
      makeResponse(
        'tool_use',
        [makeToolUse('tu_001', 'arxiv_search', { query: 'UBI Africa' })],
        150,
        150,
      ),
    );
    // Turn 2: final output (returned after budget-exceeded message is injected)
    create.mockResolvedValue(makeResponse('end_turn', [makeText(VALID_FINAL_JSON)]));

    const output = await runResearchAgent(testInput, tightConfig);

    expect(output.metadata.token_usage).toBeGreaterThan(tightConfig.max_research_tokens);
    expect(output.memo_markdown).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Tests: LoopController unit tests
// ---------------------------------------------------------------------------

describe('LoopController', () => {
  const config: AgentConfig = {
    max_tool_calls: 10,
    max_research_tokens: 1000,
    max_revision_attempts: 2,
  };

  it('starts with ok status', () => {
    const ctrl = new LoopController(config);
    expect(ctrl.getState().status).toBe('ok');
    expect(ctrl.isBudgetExceeded()).toBe(false);
  });

  it('returns warn at 80% tool call usage', () => {
    const ctrl = new LoopController(config);
    for (let i = 0; i < 8; i++) ctrl.recordToolCall(10);
    expect(ctrl.getState().status).toBe('warn');
  });

  it('returns exceeded when tool call limit is reached', () => {
    const ctrl = new LoopController(config);
    for (let i = 0; i < 10; i++) ctrl.recordToolCall(10);
    expect(ctrl.getState().status).toBe('exceeded');
    expect(ctrl.isToolBudgetExceeded()).toBe(true);
  });

  it('returns exceeded when token budget is consumed', () => {
    const ctrl = new LoopController(config);
    ctrl.recordTokens(1000);
    expect(ctrl.getState().status).toBe('exceeded');
    expect(ctrl.isTokenBudgetExceeded()).toBe(true);
  });

  it('buildBudgetExceededMessage contains budget numbers', () => {
    const ctrl = new LoopController(config);
    for (let i = 0; i < 10; i++) ctrl.recordToolCall(10);
    const msg = ctrl.buildBudgetExceededMessage();
    expect(msg).toContain('10');
    expect(msg).toContain('synthesise');
  });
});

// ---------------------------------------------------------------------------
// Tests: tool call failure handling
// ---------------------------------------------------------------------------

describe('runResearchAgent — tool failure handling', () => {
  let create: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    create = await getCreate();
    create.mockReset();
  });

  it('handles an unknown tool name gracefully', async () => {
    create.mockResolvedValueOnce(
      makeResponse('tool_use', [makeToolUse('tu_001', 'unknown_tool', { query: 'test' })]),
    );
    create.mockResolvedValueOnce(makeResponse('end_turn', [makeText(VALID_FINAL_JSON)]));

    // Should not throw — unknown tool returns an error payload
    const output = await runResearchAgent(testInput, testConfig);
    expect(output.memo_markdown).toBeTruthy();
  });

  it('passes tool_result back to agent when tool call returns', async () => {
    create.mockResolvedValueOnce(
      makeResponse('tool_use', [makeToolUse('tu_001', 'unknown_tool', {})]),
    );
    create.mockResolvedValueOnce(makeResponse('end_turn', [makeText(VALID_FINAL_JSON)]));

    await runResearchAgent(testInput, testConfig);

    // Second API call should carry a tool_result block with matching tool_use_id
    const secondCallMessages = (
      create.mock.calls[1]?.[0] as { messages: Array<{ role: string; content: unknown }> }
    ).messages;
    const userMessages = secondCallMessages.filter((m) => m.role === 'user');
    const lastUser = userMessages[userMessages.length - 1];
    expect(lastUser).toBeDefined();
    const content = lastUser?.content;
    expect(Array.isArray(content)).toBe(true);
    if (Array.isArray(content)) {
      const toolResult = content.find(
        (b): b is { type: string; tool_use_id: string } =>
          typeof b === 'object' &&
          b !== null &&
          (b as Record<string, unknown>).type === 'tool_result',
      );
      expect(toolResult).toBeDefined();
      expect(toolResult?.tool_use_id).toBe('tu_001');
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: completeness check (orphaned claims)
// ---------------------------------------------------------------------------

describe('runResearchAgent — completeness check', () => {
  let create: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    create = await getCreate();
    create.mockReset();
  });

  it('produces output even when memo has orphaned claims', async () => {
    // Memo references C-002 but notes_log only has C-001
    const jsonWithOrphan = JSON.stringify({
      memo: {
        title: 'Policy Memo',
        sections: [
          {
            title: 'Summary',
            content: 'Key finding [C-001]. Another finding [C-002].',
            claim_ids: ['C-001', 'C-002'],
          },
        ],
      },
      notes_log: [VALID_NOTES_LOG_ENTRY],
    });

    create.mockResolvedValueOnce(makeResponse('end_turn', [makeText(jsonWithOrphan)]));

    // Should not throw — orphaned claims emit a warning, not an error
    const output = await runResearchAgent(testInput, testConfig);
    expect(output.memo_markdown).toContain('[C-002]');
    expect(output.notes_log).toHaveLength(1);
  });
});
