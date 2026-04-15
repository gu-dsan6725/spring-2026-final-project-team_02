/**
 * High-level span helpers for the HERALD pipeline.
 *
 * These wrappers live on top of braintrust.ts and give each subsystem a
 * typed, single-line logging API. Import from here — never import Braintrust
 * directly in business-logic modules.
 */

import { type ClaimType, type DerivationMethod } from '../types/claims.js';
import { type HeraldResult, type Verdict } from '../types/herald.js';
import { logToolCall, logWarn, startSpan, type Span, type SpanAttributes } from './braintrust.js';

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

export interface AgentLoopMeta {
  topic: string;
  maxToolCalls: number;
  maxTokens: number;
}

/** Open a span that tracks the entire agent research loop. */
export function logAgentLoop(meta: AgentLoopMeta): Span {
  return startSpan('agent_loop', {
    topic: meta.topic,
    max_tool_calls: meta.maxToolCalls,
    max_tokens: meta.maxTokens,
  });
}

// ---------------------------------------------------------------------------
// Tool calls (MCP servers)
// ---------------------------------------------------------------------------

/**
 * Log a single MCP tool call.
 *
 * @param toolName   Name from TOOL_REGISTRY (e.g. "web_search", "arxiv_search")
 * @param input      Raw input object passed to the tool
 * @param output     Serialised output string (first 2000 chars)
 * @param latencyMs  Wall-clock time for the call
 * @param success    Whether the tool returned without an error key
 */
export function logMcpToolCall(
  toolName: string,
  input: SpanAttributes,
  output: string,
  latencyMs: number,
  success: boolean,
): void {
  if (!success) {
    logWarn(`tool_call_failed:${toolName}`, { input, output_preview: output.slice(0, 200) });
  }
  logToolCall(toolName, input, output, latencyMs);
}

// ---------------------------------------------------------------------------
// Claim extraction
// ---------------------------------------------------------------------------

export interface ClaimExtractionResult {
  claimId: string;
  claimType: ClaimType;
  derivation: DerivationMethod;
  sourceCount: number;
}

/** Log a single claim extracted from research output. */
export function logClaimExtraction(claims: ClaimExtractionResult[]): void {
  const span = startSpan('claim_extraction', {
    claim_count: claims.length,
  });
  span.log({
    claims: claims.map((c) => ({
      id: c.claimId,
      type: c.claimType,
      derivation: c.derivation,
      source_count: c.sourceCount,
    })),
  });
  span.end({ claim_count: claims.length });
}

// ---------------------------------------------------------------------------
// HERALD evaluation tiers
// ---------------------------------------------------------------------------

export interface Tier1Log {
  claimId: string;
  claimText: string;
  premiseChunk: string;
  label: 'entailment' | 'neutral' | 'contradiction';
  entailmentScore: number;
  neutralScore: number;
  contradictionScore: number;
  latencyMs: number;
}

/** Log a Tier 1 NLI inference call. */
export function logTier1NLI(entry: Tier1Log): void {
  const span = startSpan('herald_tier1_nli', {
    claim_id: entry.claimId,
    claim_text: entry.claimText.slice(0, 300),
    premise_preview: entry.premiseChunk.slice(0, 200),
  });
  span.log({
    label: entry.label,
    entailment_score: entry.entailmentScore,
    neutral_score: entry.neutralScore,
    contradiction_score: entry.contradictionScore,
  });
  span.end({ latency_ms: entry.latencyMs });
}

export interface Tier2Log {
  claimId: string;
  claimType: ClaimType;
  verdict: Verdict;
  confidence: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

/** Log a Tier 2 LLM-as-Judge evaluation. */
export function logTier2Judge(entry: Tier2Log): void {
  const span = startSpan('herald_tier2_judge', {
    claim_id: entry.claimId,
    claim_type: entry.claimType,
  });
  span.log({
    verdict: entry.verdict,
    confidence: entry.confidence,
    input_tokens: entry.inputTokens,
    output_tokens: entry.outputTokens,
  });
  span.end({ latency_ms: entry.latencyMs });
}

export interface Tier3Log {
  claimId: string;
  claimType: ClaimType;
  personaVerdicts: Record<string, Verdict>;
  judgeVerdict: Verdict;
  confidence: number;
  latencyMs: number;
}

/** Log a Tier 3 multi-agent debate. */
export function logTier3Debate(entry: Tier3Log): void {
  const span = startSpan('herald_tier3_debate', {
    claim_id: entry.claimId,
    claim_type: entry.claimType,
  });
  span.log({
    persona_verdicts: entry.personaVerdicts,
    judge_verdict: entry.judgeVerdict,
    confidence: entry.confidence,
  });
  span.end({ latency_ms: entry.latencyMs });
}

// ---------------------------------------------------------------------------
// Full HERALD result
// ---------------------------------------------------------------------------

/** Log the final HERALD evaluation result for a claim. */
export function logHeraldEvaluation(result: HeraldResult, latencyMs: number): void {
  const span = startSpan('herald_evaluation', {
    claim_id: result.claim_id,
    tier_reached: result.tier_reached,
  });
  span.log({
    verdict: result.verdict,
    confidence: result.confidence,
    has_revision: result.suggested_revision !== null,
  });
  span.end({ latency_ms: latencyMs });
}
