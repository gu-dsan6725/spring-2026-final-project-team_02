/**
 * HERALD evaluation pipeline types — mirrors Python Pydantic models in
 * backend/src/policy_memo_agent/models/herald.py
 */

export type Verdict = 'valid' | 'invalid' | 'uncertain' | 'plausible_but_unsupported';

export type DebatePersona = 'domain_expert' | 'methodologist' | 'skeptic';

export interface TierOneOutput {
  entailment_score: number;
  neutral_score: number;
  contradiction_score: number;
  verdict: Verdict;
  confidence: number;
  reasoning: string;
}

export interface TierTwoOutput {
  verdict: Verdict;
  confidence: number;
  accuracy_assessment: string;
  relevance_assessment: string;
  completeness_assessment: string;
  specialized_assessment: string;
  reasoning: string;
  suggested_revision: string | null;
}

export interface PersonaOutput {
  persona: DebatePersona;
  verdict: Verdict;
  reasoning: string;
}

export interface DebateOutput {
  domain_expert: PersonaOutput;
  methodologist: PersonaOutput;
  skeptic: PersonaOutput;
  judge_synthesis: string;
  final_verdict: Verdict;
  confidence: number;
  suggested_revision: string | null;
}

export interface TierOutput {
  tier: 1 | 2 | 3 | 4;
  output: TierOneOutput | TierTwoOutput | DebateOutput | null;
  skipped: boolean;
  skip_reason: string | null;
}

export interface HeraldResult {
  claim_id: string;
  tier_reached: 1 | 2 | 3 | 4;
  verdict: Verdict;
  confidence: number;
  feedback: string;
  suggested_revision: string | null;
  tier_details: Record<string, TierOutput | null>;
}
