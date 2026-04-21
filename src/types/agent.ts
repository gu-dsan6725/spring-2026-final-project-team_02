/**
 * Agent configuration and observability types — mirrors Python Pydantic models in
 * backend/src/policy_memo_agent/models/agent.py
 */

import type { ClaimType } from './claims';

export interface PlannedQuery {
  tool: string;
  query: string;
  expected_claim_types: ClaimType[];
  priority: number; // 1 = highest priority, higher numbers = lower priority
}

export interface ResearchPlan {
  planned_queries: PlannedQuery[];
  budget: {
    max_tool_calls: number;
    max_tokens: number;
    calls_per_query: number; // approximate budget allocation per query
  };
  total_queries: number;
}

export interface QualityGateResult {
  passed: boolean;
  unique_sources: number;
  total_claims: number;
  claim_type_count: number;
  needs_extra_round: boolean;
  flags: string[];
}

export interface ToolCallLog {
  tool_name: string;
  query: string;
  raw_response: string;
  extracted_claims: string[];
  latency_ms: number;
  timestamp: string;
}

export interface AgentConfig {
  max_tool_calls: number;
  max_research_tokens: number;
  max_revision_attempts: number;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  max_tool_calls: 25,
  max_research_tokens: 100000,
  max_revision_attempts: 2,
};
