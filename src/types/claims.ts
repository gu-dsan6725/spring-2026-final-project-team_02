/**
 * Claim taxonomy types — mirrors Python Pydantic models in backend/src/policy_memo_agent/models/claims.py
 * There are exactly 6 claim types. Do not add new types without updating CLAUDE.md and the Python models.
 */

export enum ClaimType {
  Statistical = 'statistical',
  Causal = 'causal',
  Comparative = 'comparative',
  Predictive = 'predictive',
  Normative = 'normative',
  Synthesis = 'synthesis',
}

export enum DerivationMethod {
  DirectExtraction = 'direct_extraction',
  Paraphrase = 'paraphrase',
  CrossSource = 'cross_source',
  AgentInference = 'agent_inference',
}

export interface ClaimTypeConfig {
  label: string;
  color: string;
  icon: string;
  skipNLI: boolean;
  nliEscalationThreshold: number | null;
}

export interface DerivationConfig {
  label: string;
  riskLevel: 'low' | 'medium' | 'high';
}

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

export const CLAIM_TYPE_CONFIG: Record<ClaimType, ClaimTypeConfig> = {
  [ClaimType.Statistical]: {
    label: 'Statistical / Numeric',
    color: '#3B82F6',
    icon: '📊',
    skipNLI: false,
    nliEscalationThreshold: 0.99,
  },
  [ClaimType.Causal]: {
    label: 'Causal',
    color: '#F59E0B',
    icon: '🔗',
    skipNLI: false,
    nliEscalationThreshold: 0.94,
  },
  [ClaimType.Comparative]: {
    label: 'Comparative',
    color: '#8B5CF6',
    icon: '⚖️',
    skipNLI: false,
    nliEscalationThreshold: 0.99,
  },
  [ClaimType.Predictive]: {
    label: 'Predictive / Projective',
    color: '#10B981',
    icon: '🔮',
    skipNLI: true,
    nliEscalationThreshold: null,
  },
  [ClaimType.Normative]: {
    label: 'Normative / Prescriptive',
    color: '#EC4899',
    icon: '📋',
    skipNLI: true,
    nliEscalationThreshold: null,
  },
  [ClaimType.Synthesis]: {
    label: 'Synthesis',
    color: '#EF4444',
    icon: '🧩',
    skipNLI: true,
    nliEscalationThreshold: null,
  },
};

export const DERIVATION_CONFIG: Record<DerivationMethod, DerivationConfig> = {
  [DerivationMethod.DirectExtraction]: {
    label: 'Direct Extraction',
    riskLevel: 'low',
  },
  [DerivationMethod.Paraphrase]: {
    label: 'Paraphrase',
    riskLevel: 'low',
  },
  [DerivationMethod.CrossSource]: {
    label: 'Cross-Source',
    riskLevel: 'medium',
  },
  [DerivationMethod.AgentInference]: {
    label: 'Agent Inference',
    riskLevel: 'high',
  },
};
