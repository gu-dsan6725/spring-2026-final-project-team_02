/**
 * Agent configuration and observability types — mirrors Python Pydantic models in
 * backend/src/policy_memo_agent/models/agent.py
 */

export interface ResearchQuery {
  tool: string;
  query: string;
  expected_claim_types: string[];
  rationale: string;
}

export interface ResearchPlan {
  memo_id: string;
  topic: string;
  queries: ResearchQuery[];
  target_source_count: number;
  notes?: string;
}

export interface ToolCallLog {
  tool_call_id: string;
  memo_id: string;
  tool_name: string;
  input_params: Record<string, unknown>;
  output_summary: string;
  success: boolean;
  error_message: string | null;
  retry_count: number;
  latency_ms: number;
  timestamp: string;
}

export interface AgentConfig {
  model: string;
  max_tool_calls: number;
  max_research_tokens: number;
  max_revision_attempts: number;
  tool_timeout_seconds: number;
  tool_retry_count: number;
}
