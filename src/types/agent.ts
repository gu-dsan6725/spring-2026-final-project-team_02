/**
 * Agent configuration and observability types — mirrors Python Pydantic models in
 * backend/src/policy_memo_agent/models/agent.py
 */

import type { ClaimType } from './claims';

export interface ResearchPlan {
  planned_queries: Array<{
    tool: string;
    query: string;
    expected_claim_types: ClaimType[];
  }>;
  budget: {
    max_tool_calls: number;
    max_tokens: number;
  };
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
  max_research_tokens: 50000,
  max_revision_attempts: 2,
};
