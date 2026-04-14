/**
 * Claim taxonomy types — mirrors Python Pydantic models in backend/src/policy_memo_agent/models/claims.py
 * There are exactly 6 claim types. Do not add new types without updating CLAUDE.md and the Python models.
 */

export type ClaimType =
  | 'statistical'
  | 'causal'
  | 'comparative'
  | 'predictive'
  | 'normative'
  | 'synthesis';

export type DerivationMethod =
  | 'direct_extraction'
  | 'paraphrase'
  | 'cross_source'
  | 'agent_inference';

export interface Source {
  source_id: string;
  source_title: string;
  source_url: string;
  relevant_chunk: string;
}

export interface NotesLogEntry {
  claim_id: string;
  claim_text: string;
  claim_type: ClaimType;
  derivation: DerivationMethod;
  sources: Source[];
  reasoning: string;
}

export interface ClaimTypeConfig {
  claim_type: ClaimType;
  start_tier: 1 | 2 | 3 | 4;
  skip_nli: boolean;
  nli_threshold: number | null;
  rationale: string;
}
