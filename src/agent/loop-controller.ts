/**
 * Budget enforcement, deduplication, research plan generation, and quality
 * gating for the research agent loop.
 *
 * Responsibilities:
 *  1. Generate a ResearchPlan before the agent starts (budget-distributed
 *     queries in priority order).
 *  2. Enforce tool-call and token budgets with three thresholds:
 *       60% → log warning, agent should start prioritising high-value queries
 *       80% → inject synthesis prompt into the conversation
 *      100% → hard stop, force memo from available evidence
 *  3. Deduplicate tool calls: cache (tool, normalised_query) → result.
 *  4. Run a quality gate after research and before writing; trigger an extra
 *     search round if the minimum evidence bar is not met.
 *
 * The controller never throws — callers check the returned state and decide
 * how to proceed.
 */

import { logWarn, startSpan } from '../observability/braintrust';
import type { AgentConfig, PlannedQuery, QualityGateResult, ResearchPlan } from '../types/agent';
import type { ClaimType } from '../types/claims';
import type { NotesLogEntry } from '../types/claims';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BudgetStatus = 'ok' | 'warn_60' | 'warn_80' | 'exceeded';

export interface BudgetState {
  toolCallsUsed: number;
  toolCallsRemaining: number;
  tokensUsed: number;
  tokensRemaining: number;
  status: BudgetStatus;
}

export interface CacheHit {
  hit: true;
  result: unknown;
}

export interface CacheMiss {
  hit: false;
}

export type CacheLookup = CacheHit | CacheMiss;

// ---------------------------------------------------------------------------
// Quality gate thresholds
// ---------------------------------------------------------------------------

const QUALITY_GATE = {
  minUniqueSources: 3,
  minClaims: 4,
  minClaimTypes: 2,
  minClaimsForLowEvidenceFlag: 3,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a query string for deduplication:
 * lowercase, strip non-alphanumeric (except spaces), collapse spaces, sort words.
 */
function normaliseQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .sort()
    .join(' ');
}

function deduplicationKey(toolName: string, query: string): string {
  return `${toolName}::${normaliseQuery(query)}`;
}

// ---------------------------------------------------------------------------
// LoopController
// ---------------------------------------------------------------------------

export class LoopController {
  private toolCallsUsed = 0;
  private tokensUsed = 0;

  /** Deduplication cache: normalised key → raw tool result. */
  private readonly cache = new Map<string, unknown>();

  /** Extra search round already triggered by the quality gate. */
  private extraRoundTriggered = false;

  constructor(private readonly config: AgentConfig) {}

  // ─── Research Plan ──────────────────────────────────────────────────────────

  /**
   * Build a structured ResearchPlan from the topic and optional seed queries.
   *
   * The plan is intentionally lightweight — it gives the agent a starting
   * scaffold, not a rigid script. The agent may deviate as it discovers leads,
   * as long as it stays within budget.
   *
   * @param topic - The policy topic being researched.
   * @param seedQueries - Caller-supplied query hints (e.g. from user input).
   * @returns A ResearchPlan with budget-distributed, prioritised queries.
   */
  buildResearchPlan(topic: string, seedQueries: PlannedQuery[] = []): ResearchPlan {
    const span = startSpan('loop_controller:build_research_plan', { topic });

    const base: PlannedQuery[] = [
      {
        tool: 'web_search',
        query: `${topic} policy overview`,
        expected_claim_types: ['statistical', 'normative'] as ClaimType[],
        priority: 1,
      },
      {
        tool: 'arxiv_search',
        query: `${topic} evidence impact evaluation`,
        expected_claim_types: ['statistical', 'causal', 'comparative'] as ClaimType[],
        priority: 2,
      },
      {
        tool: 'worldbank_data',
        query: topic,
        expected_claim_types: ['statistical', 'comparative'] as ClaimType[],
        priority: 3,
      },
      {
        tool: 'arxiv_search',
        query: `${topic} systematic review meta-analysis`,
        expected_claim_types: ['comparative', 'causal'] as ClaimType[],
        priority: 4,
      },
      {
        tool: 'semantic_scholar_search',
        query: `${topic} outcomes projections`,
        expected_claim_types: ['predictive', 'causal'] as ClaimType[],
        priority: 5,
      },
      {
        tool: 'govreport_search',
        query: `${topic} government report`,
        expected_claim_types: ['normative', 'statistical'] as ClaimType[],
        priority: 6,
      },
    ];

    // Merge caller-supplied seeds (lower priority than base plan)
    const merged: PlannedQuery[] = [...base];
    let nextPriority = base.length + 1;
    for (const seed of seedQueries) {
      merged.push({ ...seed, priority: seed.priority > 0 ? seed.priority : nextPriority++ });
    }

    // Sort by priority and truncate to fit safely within budget
    // Leave 20% of budget for synthesis / unexpected follow-up queries
    const maxPlanned = Math.floor(this.config.max_tool_calls * 0.8);
    const planned = merged.sort((a, b) => a.priority - b.priority).slice(0, maxPlanned);

    const callsPerQuery =
      planned.length > 0 ? Math.floor(this.config.max_tool_calls / planned.length) : 0;

    const plan: ResearchPlan = {
      planned_queries: planned,
      budget: {
        max_tool_calls: this.config.max_tool_calls,
        max_tokens: this.config.max_research_tokens,
        calls_per_query: callsPerQuery,
      },
      total_queries: planned.length,
    };

    span.end({ total_queries: planned.length, calls_per_query: callsPerQuery });
    return plan;
  }

  // ─── Budget Tracking ────────────────────────────────────────────────────────

  /**
   * Record a completed tool call and return the new status.
   * Should be called AFTER the tool response is received.
   */
  recordToolCall(tokensConsumed: number): BudgetStatus {
    this.toolCallsUsed += 1;
    this.tokensUsed += tokensConsumed;
    const status = this.computeStatus();
    this.emitBudgetWarningIfNeeded(status);
    return status;
  }

  /** Record token usage without a tool call (e.g. the synthesis turn). */
  recordTokens(tokensConsumed: number): BudgetStatus {
    this.tokensUsed += tokensConsumed;
    const status = this.computeStatus();
    this.emitBudgetWarningIfNeeded(status);
    return status;
  }

  /** Current budget state snapshot. */
  getState(): BudgetState {
    return {
      toolCallsUsed: this.toolCallsUsed,
      toolCallsRemaining: Math.max(0, this.config.max_tool_calls - this.toolCallsUsed),
      tokensUsed: this.tokensUsed,
      tokensRemaining: Math.max(0, this.config.max_research_tokens - this.tokensUsed),
      status: this.computeStatus(),
    };
  }

  /** True when no more tool calls are permitted. */
  isToolBudgetExceeded(): boolean {
    return this.toolCallsUsed >= this.config.max_tool_calls;
  }

  /** True when the token budget has been exhausted. */
  isTokenBudgetExceeded(): boolean {
    return this.tokensUsed >= this.config.max_research_tokens;
  }

  /** True when either budget is exceeded. */
  isBudgetExceeded(): boolean {
    return this.isToolBudgetExceeded() || this.isTokenBudgetExceeded();
  }

  /**
   * Build the message injected into the agent conversation when the budget is
   * at 80% — instructs the agent to start synthesising.
   */
  buildSynthesisPromptMessage(): string {
    const remaining = Math.max(0, this.config.max_tool_calls - this.toolCallsUsed);
    return (
      `You have ${String(remaining)} tool call${remaining === 1 ? '' : 's'} remaining. ` +
      `Begin synthesising from the evidence you have already collected. ` +
      `Only make additional tool calls for critical gaps that cannot be addressed from existing sources.`
    );
  }

  /**
   * Build the budget-exceeded instruction injected when the hard limit is hit.
   */
  buildBudgetExceededMessage(): string {
    const state = this.getState();
    const reasons: string[] = [];
    if (this.isToolBudgetExceeded()) {
      reasons.push(`tool call limit (${String(this.config.max_tool_calls)}) reached`);
    }
    if (this.isTokenBudgetExceeded()) {
      reasons.push(`token limit (${String(this.config.max_research_tokens)}) reached`);
    }
    return (
      `Research budget exceeded (${reasons.join(', ')}). ` +
      `Used ${String(state.toolCallsUsed)} tool calls and ${String(state.tokensUsed)} tokens. ` +
      `Stop making tool calls immediately and synthesise the policy memo from the ` +
      `evidence already gathered. Output the final JSON now.`
    );
  }

  // ─── Deduplication Cache ────────────────────────────────────────────────────

  /**
   * Look up a (tool, query) pair in the deduplication cache.
   * Queries are normalised before comparison.
   */
  lookupCache(toolName: string, query: string): CacheLookup {
    const key = deduplicationKey(toolName, query);
    if (this.cache.has(key)) {
      return { hit: true, result: this.cache.get(key) };
    }
    return { hit: false };
  }

  /**
   * Store a tool result in the deduplication cache.
   * Should be called after every successful tool call.
   */
  storeCache(toolName: string, query: string, result: unknown): void {
    const key = deduplicationKey(toolName, query);
    this.cache.set(key, result);
  }

  /** Number of entries currently in the deduplication cache. */
  get cacheSize(): number {
    return this.cache.size;
  }

  // ─── Quality Gate ───────────────────────────────────────────────────────────

  /**
   * Evaluate whether the collected notes log meets the minimum evidence bar
   * required before the agent can write the memo.
   *
   * Thresholds:
   *  - At least 3 unique source IDs across all notes log entries
   *  - At least 4 claims in total
   *  - At least 2 different claim types
   *
   * Returns a QualityGateResult. If `needs_extra_round` is true the caller
   * should give the agent one more targeted search round. This extra round is
   * only triggered once — subsequent failures proceed with a user-facing flag.
   */
  checkQualityGate(notesLog: NotesLogEntry[]): QualityGateResult {
    const span = startSpan('loop_controller:quality_gate', {
      notes_log_length: notesLog.length,
    });

    const uniqueSources = new Set<string>();
    const claimTypes = new Set<string>();

    for (const entry of notesLog) {
      claimTypes.add(entry.claim_type);
      for (const src of entry.sources) {
        uniqueSources.add(src.source_id);
      }
    }

    const uniqueSourceCount = uniqueSources.size;
    const totalClaims = notesLog.length;
    const claimTypeCount = claimTypes.size;

    const sourcesOk = uniqueSourceCount >= QUALITY_GATE.minUniqueSources;
    const claimsOk = totalClaims >= QUALITY_GATE.minClaims;
    const typesOk = claimTypeCount >= QUALITY_GATE.minClaimTypes;
    const passed = sourcesOk && claimsOk && typesOk;

    const flags: string[] = [];

    if (!sourcesOk) {
      flags.push(
        `Only ${String(uniqueSourceCount)} unique source(s) found; minimum is ${String(QUALITY_GATE.minUniqueSources)}.`,
      );
    }
    if (!claimsOk) {
      flags.push(
        `Only ${String(totalClaims)} claim(s) collected; minimum is ${String(QUALITY_GATE.minClaims)}.`,
      );
    }
    if (!typesOk) {
      flags.push(
        `Only ${String(claimTypeCount)} claim type(s) present; minimum is ${String(QUALITY_GATE.minClaimTypes)}.`,
      );
    }

    // Low-evidence memo flag (emitted even if we try an extra round)
    if (totalClaims < QUALITY_GATE.minClaimsForLowEvidenceFlag) {
      flags.push(
        `Low-evidence memo: fewer than ${String(QUALITY_GATE.minClaimsForLowEvidenceFlag)} claims collected. ` +
          `Results may not support the policy argument adequately.`,
      );
    }

    // Only allow one extra search round per session
    const needsExtraRound = !passed && !this.extraRoundTriggered && !this.isBudgetExceeded();
    if (needsExtraRound) {
      this.extraRoundTriggered = true;
      logWarn('quality_gate:extra_round_triggered', {
        unique_sources: uniqueSourceCount,
        total_claims: totalClaims,
        claim_type_count: claimTypeCount,
        flags,
      });
    }

    span.end({ passed, needs_extra_round: needsExtraRound, flags });

    return {
      passed,
      unique_sources: uniqueSourceCount,
      total_claims: totalClaims,
      claim_type_count: claimTypeCount,
      needs_extra_round: needsExtraRound,
      flags,
    };
  }

  /** True if the extra quality-gate search round has already been used. */
  get hasUsedExtraRound(): boolean {
    return this.extraRoundTriggered;
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  private computeStatus(): BudgetStatus {
    if (this.isBudgetExceeded()) return 'exceeded';

    const toolPct = this.toolCallsUsed / this.config.max_tool_calls;
    const tokenPct = this.tokensUsed / this.config.max_research_tokens;
    const pct = Math.max(toolPct, tokenPct);

    if (pct >= 0.8) return 'warn_80';
    if (pct >= 0.6) return 'warn_60';
    return 'ok';
  }

  private emitBudgetWarningIfNeeded(status: BudgetStatus): void {
    if (status === 'warn_60' || status === 'warn_80' || status === 'exceeded') {
      logWarn(`budget:${status}`, {
        tool_calls_used: this.toolCallsUsed,
        tool_calls_max: this.config.max_tool_calls,
        tokens_used: this.tokensUsed,
        tokens_max: this.config.max_research_tokens,
        tool_pct: this.toolCallsUsed / this.config.max_tool_calls,
        token_pct: this.tokensUsed / this.config.max_research_tokens,
      });
    }
  }
}
