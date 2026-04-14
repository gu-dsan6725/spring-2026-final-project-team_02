/**
 * Budget enforcement for the research agent loop.
 *
 * Tracks tool-call count and token usage; emits warnings at 80% and
 * signals abort at 100%. The controller never throws — callers check
 * the returned state and decide how to proceed.
 */

import { logWarn } from '../observability/braintrust';
import type { AgentConfig } from '../types/agent';

export type BudgetStatus = 'ok' | 'warn' | 'exceeded';

export interface BudgetState {
  toolCallsUsed: number;
  tokensUsed: number;
  status: BudgetStatus;
}

export class LoopController {
  private toolCallsUsed = 0;
  private tokensUsed = 0;

  constructor(private readonly config: AgentConfig) {}

  /** Record a completed tool call. Returns the updated budget status. */
  recordToolCall(tokensConsumed: number): BudgetStatus {
    this.toolCallsUsed += 1;
    this.tokensUsed += tokensConsumed;
    return this.computeStatus();
  }

  /** Record token usage without a tool call (e.g., the synthesis turn). */
  recordTokens(tokensConsumed: number): BudgetStatus {
    this.tokensUsed += tokensConsumed;
    return this.computeStatus();
  }

  /** Current budget state snapshot. */
  getState(): BudgetState {
    return {
      toolCallsUsed: this.toolCallsUsed,
      tokensUsed: this.tokensUsed,
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
   * Build the budget-exceeded instruction injected into the final API turn
   * so the agent synthesises from what it has already gathered.
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

  private computeStatus(): BudgetStatus {
    if (this.isBudgetExceeded()) {
      return 'exceeded';
    }

    const toolPct = this.toolCallsUsed / this.config.max_tool_calls;
    const tokenPct = this.tokensUsed / this.config.max_research_tokens;

    if (toolPct >= 0.8 || tokenPct >= 0.8) {
      logWarn('budget:warn', {
        tool_calls_used: this.toolCallsUsed,
        tool_calls_max: this.config.max_tool_calls,
        tokens_used: this.tokensUsed,
        tokens_max: this.config.max_research_tokens,
        tool_pct: toolPct,
        token_pct: tokenPct,
      });
      return 'warn';
    }

    return 'ok';
  }
}
