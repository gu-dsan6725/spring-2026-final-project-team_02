/**
 * LoopController tests.
 *
 * Covers:
 *   Budget tracking:
 *   - Status transitions: ok → warn_60 → warn_80 → exceeded
 *   - Boundary conditions at exactly 60%, 80%, 100%
 *   - Token budget and tool-call budget independently trigger exceeded
 *   - getState() reflects current counts and remaining
 *   - buildSynthesisPromptMessage() mentions remaining calls
 *   - buildBudgetExceededMessage() names the exceeded limit(s)
 *
 *   Deduplication cache:
 *   - Cache miss on first call, hit on repeat
 *   - Normalisation: case, punctuation, word-order variants all deduplicate
 *   - Different tools with same query are separate cache entries
 *   - cacheSize reflects stored entries
 *
 *   Quality gate:
 *   - Passes with sufficient sources / claims / types
 *   - Fails on too few sources, claims, or types individually
 *   - needs_extra_round only fires once (extraRoundTriggered flag)
 *   - needs_extra_round is false when budget is already exceeded
 *   - Exact boundary: exactly 3 sources / 4 claims / 2 types passes
 *   - Low-evidence flag emitted when claims < 3
 *
 *   Research plan:
 *   - buildResearchPlan() includes base queries
 *   - Seed queries are merged and appended
 *   - Plan is capped at 80% of max_tool_calls
 *   - calls_per_query is computed correctly
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoopController } from '../../src/agent/loop-controller';
import {
  ClaimType,
  DerivationMethod,
  type NotesLogEntry,
  type Source,
} from '../../src/types/claims';
import type { AgentConfig } from '../../src/types/agent';

// ---------------------------------------------------------------------------
// Silence braintrust in tests
// ---------------------------------------------------------------------------

vi.mock('../../src/observability/braintrust', () => ({
  startSpan: vi.fn(() => ({ log: vi.fn(), end: vi.fn(), id: 'test', name: 'test', startTime: 0 })),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    max_tool_calls: 10,
    max_research_tokens: 1000,
    max_revision_attempts: 2,
    ...overrides,
  };
}

function makeSource(id: string): Source {
  return {
    source_id: id,
    source_title: `Source ${id}`,
    source_url: `https://example.com/${id}`,
    relevant_chunk: 'Some evidence.',
  };
}

function makeEntry(claimId: string, claimType: ClaimType, sourceIds: string[]): NotesLogEntry {
  return {
    claim_id: claimId,
    claim_text: `Claim ${claimId}`,
    claim_type: claimType,
    derivation: DerivationMethod.DirectExtraction,
    sources: sourceIds.map(makeSource),
    reasoning: 'test',
  };
}

// ---------------------------------------------------------------------------
// Budget status transitions
// ---------------------------------------------------------------------------

describe('LoopController — budget status transitions', () => {
  it('starts at ok', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 10 }));
    expect(ctrl.getState().status).toBe('ok');
  });

  it('transitions to warn_60 at exactly 60% tool calls', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 10 }));
    // 6 / 10 = 60%
    for (let i = 0; i < 5; i++) ctrl.recordToolCall(0);
    expect(ctrl.getState().status).toBe('ok');
    ctrl.recordToolCall(0); // 6th call → 60%
    expect(ctrl.getState().status).toBe('warn_60');
  });

  it('transitions to warn_80 at exactly 80% tool calls', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 10 }));
    for (let i = 0; i < 7; i++) ctrl.recordToolCall(0);
    expect(ctrl.getState().status).toBe('warn_60');
    ctrl.recordToolCall(0); // 8th call → 80%
    expect(ctrl.getState().status).toBe('warn_80');
  });

  it('transitions to exceeded at 100% tool calls', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 5 }));
    for (let i = 0; i < 5; i++) ctrl.recordToolCall(0);
    expect(ctrl.getState().status).toBe('exceeded');
    expect(ctrl.isBudgetExceeded()).toBe(true);
  });

  it('exceeded takes priority over warn_80 when both apply', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 5 }));
    for (let i = 0; i < 5; i++) ctrl.recordToolCall(0);
    expect(ctrl.getState().status).toBe('exceeded');
  });

  it('token budget independently triggers warn_60', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 100, max_research_tokens: 100 }));
    ctrl.recordTokens(60); // 60%
    expect(ctrl.getState().status).toBe('warn_60');
  });

  it('token budget independently triggers exceeded', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 100, max_research_tokens: 100 }));
    ctrl.recordTokens(100);
    expect(ctrl.isBudgetExceeded()).toBe(true);
    expect(ctrl.isTokenBudgetExceeded()).toBe(true);
    expect(ctrl.isToolBudgetExceeded()).toBe(false);
  });

  it('tool-call budget independently triggers exceeded', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 3, max_research_tokens: 100000 }));
    for (let i = 0; i < 3; i++) ctrl.recordToolCall(0);
    expect(ctrl.isBudgetExceeded()).toBe(true);
    expect(ctrl.isToolBudgetExceeded()).toBe(true);
    expect(ctrl.isTokenBudgetExceeded()).toBe(false);
  });

  it('status uses the higher of tool-pct and token-pct', () => {
    // 5% tool calls used, 65% tokens used → should be warn_60
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 100, max_research_tokens: 1000 }));
    ctrl.recordToolCall(0); // 1%
    ctrl.recordTokens(650); // 65%
    expect(ctrl.getState().status).toBe('warn_60');
  });
});

// ---------------------------------------------------------------------------
// getState()
// ---------------------------------------------------------------------------

describe('LoopController — getState()', () => {
  it('reflects correct counts and remaining after tool calls', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 10, max_research_tokens: 1000 }));
    ctrl.recordToolCall(200);
    ctrl.recordToolCall(300);

    const state = ctrl.getState();
    expect(state.toolCallsUsed).toBe(2);
    expect(state.toolCallsRemaining).toBe(8);
    expect(state.tokensUsed).toBe(500);
    expect(state.tokensRemaining).toBe(500);
  });

  it('toolCallsRemaining never goes below 0', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 2 }));
    for (let i = 0; i < 5; i++) ctrl.recordToolCall(0);
    expect(ctrl.getState().toolCallsRemaining).toBe(0);
  });

  it('tokensRemaining never goes below 0', () => {
    const ctrl = new LoopController(makeConfig({ max_research_tokens: 100 }));
    ctrl.recordTokens(999);
    expect(ctrl.getState().tokensRemaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Prompt messages
// ---------------------------------------------------------------------------

describe('LoopController — prompt messages', () => {
  it('buildSynthesisPromptMessage mentions the remaining tool call count', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 10 }));
    ctrl.recordToolCall(0); // 9 remaining
    ctrl.recordToolCall(0); // 8 remaining
    const msg = ctrl.buildSynthesisPromptMessage();
    expect(msg).toContain('8');
  });

  it('buildBudgetExceededMessage names the tool call limit when exceeded by calls', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 3, max_research_tokens: 100000 }));
    for (let i = 0; i < 3; i++) ctrl.recordToolCall(0);
    const msg = ctrl.buildBudgetExceededMessage();
    expect(msg).toMatch(/tool call limit/i);
    expect(msg).toContain('3');
  });

  it('buildBudgetExceededMessage names the token limit when exceeded by tokens', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 100, max_research_tokens: 500 }));
    ctrl.recordTokens(500);
    const msg = ctrl.buildBudgetExceededMessage();
    expect(msg).toMatch(/token limit/i);
    expect(msg).toContain('500');
  });

  it('buildBudgetExceededMessage names both limits when both exceeded', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 1, max_research_tokens: 50 }));
    ctrl.recordToolCall(50);
    const msg = ctrl.buildBudgetExceededMessage();
    expect(msg).toMatch(/tool call limit/i);
    expect(msg).toMatch(/token limit/i);
  });
});

// ---------------------------------------------------------------------------
// Deduplication cache
// ---------------------------------------------------------------------------

describe('LoopController — deduplication cache', () => {
  it('returns cache miss on first lookup', () => {
    const ctrl = new LoopController(makeConfig());
    const result = ctrl.lookupCache('arxiv_search', 'climate policy');
    expect(result.hit).toBe(false);
  });

  it('returns cache hit after storing', () => {
    const ctrl = new LoopController(makeConfig());
    ctrl.storeCache('arxiv_search', 'climate policy', { results: [] });
    const result = ctrl.lookupCache('arxiv_search', 'climate policy');
    expect(result.hit).toBe(true);
    if (result.hit) expect(result.result).toEqual({ results: [] });
  });

  it('normalises case — same query in different cases is a hit', () => {
    const ctrl = new LoopController(makeConfig());
    ctrl.storeCache('web_search', 'Climate Policy', { data: 1 });
    expect(ctrl.lookupCache('web_search', 'climate policy').hit).toBe(true);
    expect(ctrl.lookupCache('web_search', 'CLIMATE POLICY').hit).toBe(true);
  });

  it('normalises punctuation — stripped punctuation matches original', () => {
    const ctrl = new LoopController(makeConfig());
    ctrl.storeCache('arxiv_search', 'education, policy — review', {});
    expect(ctrl.lookupCache('arxiv_search', 'education policy review').hit).toBe(true);
  });

  it('normalises word order — reordered query is a hit', () => {
    const ctrl = new LoopController(makeConfig());
    ctrl.storeCache('web_search', 'housing policy reform', {});
    expect(ctrl.lookupCache('web_search', 'reform housing policy').hit).toBe(true);
    expect(ctrl.lookupCache('web_search', 'policy reform housing').hit).toBe(true);
  });

  it('treats different tools as separate cache entries', () => {
    const ctrl = new LoopController(makeConfig());
    ctrl.storeCache('arxiv_search', 'climate', { source: 'arxiv' });
    expect(ctrl.lookupCache('web_search', 'climate').hit).toBe(false);
    expect(ctrl.lookupCache('arxiv_search', 'climate').hit).toBe(true);
  });

  it('cacheSize increments with each unique entry stored', () => {
    const ctrl = new LoopController(makeConfig());
    expect(ctrl.cacheSize).toBe(0);
    ctrl.storeCache('arxiv_search', 'topic a', {});
    ctrl.storeCache('arxiv_search', 'topic b', {});
    ctrl.storeCache('web_search', 'topic a', {});
    expect(ctrl.cacheSize).toBe(3);
  });

  it('overwriting a key does not change cacheSize', () => {
    const ctrl = new LoopController(makeConfig());
    ctrl.storeCache('web_search', 'query', { v: 1 });
    ctrl.storeCache('web_search', 'query', { v: 2 });
    expect(ctrl.cacheSize).toBe(1);
    const hit = ctrl.lookupCache('web_search', 'query');
    if (hit.hit) expect((hit.result as { v: number }).v).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Quality gate
// ---------------------------------------------------------------------------

describe('LoopController — checkQualityGate()', () => {
  it('passes with exactly 3 unique sources, 4 claims, 2 types', () => {
    const ctrl = new LoopController(makeConfig());
    const log: NotesLogEntry[] = [
      makeEntry('C-001', ClaimType.Statistical, ['S-001']),
      makeEntry('C-002', ClaimType.Statistical, ['S-002']),
      makeEntry('C-003', ClaimType.Causal, ['S-003']),
      makeEntry('C-004', ClaimType.Causal, ['S-001']),
    ];
    const result = ctrl.checkQualityGate(log);
    expect(result.passed).toBe(true);
    expect(result.needs_extra_round).toBe(false);
  });

  it('fails when fewer than 3 unique sources', () => {
    const ctrl = new LoopController(makeConfig());
    const log: NotesLogEntry[] = [
      makeEntry('C-001', ClaimType.Statistical, ['S-001']),
      makeEntry('C-002', ClaimType.Statistical, ['S-001']),
      makeEntry('C-003', ClaimType.Causal, ['S-002']),
      makeEntry('C-004', ClaimType.Causal, ['S-002']),
    ];
    const result = ctrl.checkQualityGate(log);
    expect(result.passed).toBe(false);
    expect(result.unique_sources).toBe(2);
  });

  it('fails when fewer than 4 claims', () => {
    const ctrl = new LoopController(makeConfig());
    const log: NotesLogEntry[] = [
      makeEntry('C-001', ClaimType.Statistical, ['S-001']),
      makeEntry('C-002', ClaimType.Causal, ['S-002']),
      makeEntry('C-003', ClaimType.Comparative, ['S-003']),
    ];
    const result = ctrl.checkQualityGate(log);
    expect(result.passed).toBe(false);
    expect(result.total_claims).toBe(3);
  });

  it('fails when fewer than 2 claim types', () => {
    const ctrl = new LoopController(makeConfig());
    const log: NotesLogEntry[] = [
      makeEntry('C-001', ClaimType.Statistical, ['S-001']),
      makeEntry('C-002', ClaimType.Statistical, ['S-002']),
      makeEntry('C-003', ClaimType.Statistical, ['S-003']),
      makeEntry('C-004', ClaimType.Statistical, ['S-004']),
    ];
    const result = ctrl.checkQualityGate(log);
    expect(result.passed).toBe(false);
    expect(result.claim_type_count).toBe(1);
  });

  it('needs_extra_round is true on first failure when budget not exceeded', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 20 }));
    const log: NotesLogEntry[] = [makeEntry('C-001', ClaimType.Statistical, ['S-001'])];
    const result = ctrl.checkQualityGate(log);
    expect(result.needs_extra_round).toBe(true);
  });

  it('needs_extra_round is false on second failure (only one extra round allowed)', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 20 }));
    const shortLog: NotesLogEntry[] = [makeEntry('C-001', ClaimType.Statistical, ['S-001'])];
    ctrl.checkQualityGate(shortLog); // first call — triggers extra round
    const result = ctrl.checkQualityGate(shortLog); // second call
    expect(result.needs_extra_round).toBe(false);
  });

  it('hasUsedExtraRound is true after triggering extra round', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 20 }));
    ctrl.checkQualityGate([makeEntry('C-001', ClaimType.Statistical, ['S-001'])]);
    expect(ctrl.hasUsedExtraRound).toBe(true);
  });

  it('needs_extra_round is false when budget is already exceeded', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 2 }));
    ctrl.recordToolCall(0);
    ctrl.recordToolCall(0); // budget exceeded
    const shortLog: NotesLogEntry[] = [makeEntry('C-001', ClaimType.Statistical, ['S-001'])];
    const result = ctrl.checkQualityGate(shortLog);
    expect(result.needs_extra_round).toBe(false);
  });

  it('emits a low-evidence flag when claims < 3', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 20 }));
    const log: NotesLogEntry[] = [
      makeEntry('C-001', ClaimType.Statistical, ['S-001']),
      makeEntry('C-002', ClaimType.Causal, ['S-002']),
    ];
    const result = ctrl.checkQualityGate(log);
    const hasLowEvidenceFlag = result.flags.some((f) => /low-evidence/i.test(f));
    expect(hasLowEvidenceFlag).toBe(true);
  });

  it('counts unique sources across entries (shared source IDs deduplicated)', () => {
    const ctrl = new LoopController(makeConfig());
    const log: NotesLogEntry[] = [
      makeEntry('C-001', ClaimType.Statistical, ['S-001', 'S-002']),
      makeEntry('C-002', ClaimType.Causal, ['S-002', 'S-003']),
      makeEntry('C-003', ClaimType.Comparative, ['S-001']),
      makeEntry('C-004', ClaimType.Normative, ['S-003']),
    ];
    const result = ctrl.checkQualityGate(log);
    expect(result.unique_sources).toBe(3); // S-001, S-002, S-003
    expect(result.passed).toBe(true);
  });

  it('empty notes log fails all three conditions', () => {
    const ctrl = new LoopController(makeConfig());
    const result = ctrl.checkQualityGate([]);
    expect(result.passed).toBe(false);
    expect(result.unique_sources).toBe(0);
    expect(result.total_claims).toBe(0);
    expect(result.claim_type_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Research plan
// ---------------------------------------------------------------------------

describe('LoopController — buildResearchPlan()', () => {
  it('includes base queries for the given topic', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 20 }));
    const plan = ctrl.buildResearchPlan('climate adaptation');
    const queries = plan.planned_queries.map((q) => q.query);
    expect(queries.some((q) => q.includes('climate adaptation'))).toBe(true);
  });

  it('merges seed queries into the plan', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 20 }));
    const plan = ctrl.buildResearchPlan('housing policy', [
      {
        tool: 'govreport_search',
        query: 'HUD Section 8 vouchers',
        expected_claim_types: [ClaimType.Statistical],
        priority: 1,
      },
    ]);
    const queries = plan.planned_queries.map((q) => q.query);
    expect(queries).toContain('HUD Section 8 vouchers');
  });

  it('caps planned queries at 80% of max_tool_calls', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 10 }));
    const plan = ctrl.buildResearchPlan('fiscal policy');
    expect(plan.planned_queries.length).toBeLessThanOrEqual(8); // 80% of 10
  });

  it('plan total_queries matches planned_queries length', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 20 }));
    const plan = ctrl.buildResearchPlan('education reform');
    expect(plan.total_queries).toBe(plan.planned_queries.length);
  });

  it('calls_per_query is max_tool_calls divided by query count', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 20 }));
    const plan = ctrl.buildResearchPlan('tax policy');
    const expected = Math.floor(20 / plan.planned_queries.length);
    expect(plan.budget.calls_per_query).toBe(expected);
  });

  it('budget in plan reflects config values', () => {
    const ctrl = new LoopController(makeConfig({ max_tool_calls: 15, max_research_tokens: 40000 }));
    const plan = ctrl.buildResearchPlan('water governance');
    expect(plan.budget.max_tool_calls).toBe(15);
    expect(plan.budget.max_tokens).toBe(40000);
  });
});
