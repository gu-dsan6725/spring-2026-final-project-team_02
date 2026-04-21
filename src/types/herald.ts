/**
 * HERALD evaluation pipeline types — mirrors Python Pydantic models in
 * backend/src/policy_memo_agent/models/herald.py
 */

export type Verdict = 'valid' | 'invalid' | 'uncertain' | 'needs_revision';
export type MeaningDriftLabel =
  | 'no_drift'
  | 'hedging_drift'
  | 'scope_drift'
  | 'attribution_drift'
  | 'causal_strength_drift'
  | 'normative_strength_drift'
  | 'quantification_drift';

export type DebatePersona = 'domain_expert' | 'methodologist' | 'skeptic';

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  api_calls: number;
}

export interface TierOutput {
  tier_id: 1 | 2 | 3 | 4;
  verdict: Verdict;
  confidence: number;
  reasoning: string;
  suggested_revision?: string;
  meaning_drift_label?: MeaningDriftLabel | null;
  usage?: TokenUsage;
}

export interface DebateOutput {
  persona: DebatePersona;
  verdict: Verdict;
  reasoning: string;
}

export interface HeraldResult {
  claim_id: string;
  tier_reached: 1 | 2 | 3 | 4;
  verdict: Verdict;
  confidence: number;
  feedback: string;
  suggested_revision: string | null;
  usage?: TokenUsage;
  tier_details: {
    tier_1: TierOutput | null;
    tier_2: TierOutput | null;
    tier_3: TierOutput | null;
    tier_4: TierOutput | null;
  };
}
