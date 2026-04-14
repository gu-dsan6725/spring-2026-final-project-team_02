import { describe, it, expect } from 'vitest';
import {
  validateNotesLog,
  checkMemoCompleteness,
  classifyClaim,
  getHeraldRoutingForClaim,
} from '../../src/agent/claim-extractor';
import { ClaimType, DerivationMethod } from '../../src/types/claims';
import type { NotesLogEntry, Source } from '../../src/types/claims';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    source_id: 'S-001',
    source_title: 'World Bank Report 2023',
    source_url: 'https://worldbank.org/report',
    relevant_chunk: 'Maternal mortality in Chad stands at 1,140 per 100,000 live births.',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<NotesLogEntry> = {}): NotesLogEntry {
  return {
    claim_id: 'C-001',
    claim_text: 'Maternal mortality in Chad stands at 1,140 per 100,000 live births.',
    claim_type: ClaimType.Statistical,
    derivation: DerivationMethod.DirectExtraction,
    sources: [makeSource()],
    reasoning: 'Directly lifted from the World Bank report.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateNotesLog
// ---------------------------------------------------------------------------

describe('validateNotesLog — valid log', () => {
  it('returns valid=true for a well-formed log', () => {
    const result = validateNotesLog([makeEntry()]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns a warning for agent_inference derivation', () => {
    const result = validateNotesLog([makeEntry({ derivation: DerivationMethod.AgentInference })]);
    expect(result.valid).toBe(true); // warnings don't block
    expect(result.warnings.some((w) => w.field === 'derivation')).toBe(true);
  });

  it('returns a warning for empty reasoning', () => {
    const result = validateNotesLog([makeEntry({ reasoning: '' })]);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.field === 'reasoning')).toBe(true);
  });
});

describe('validateNotesLog — invalid claim_type', () => {
  it('returns an error for an unrecognised claim_type', () => {
    const bad = makeEntry({ claim_type: 'anecdotal' as ClaimType });
    const result = validateNotesLog([bad]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'claim_type')).toBe(true);
  });
});

describe('validateNotesLog — invalid derivation', () => {
  it('returns an error for an unrecognised derivation method', () => {
    const bad = makeEntry({ derivation: 'hallucination' as DerivationMethod });
    const result = validateNotesLog([bad]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'derivation')).toBe(true);
  });
});

describe('validateNotesLog — empty sources', () => {
  it('returns an error when sources array is empty', () => {
    const result = validateNotesLog([makeEntry({ sources: [] })]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'sources')).toBe(true);
  });
});

describe('validateNotesLog — empty relevant_chunk', () => {
  it('returns an error when relevant_chunk is empty', () => {
    const result = validateNotesLog([makeEntry({ sources: [makeSource({ relevant_chunk: '' })] })]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes('relevant_chunk'))).toBe(true);
  });

  it('accepts "Source unavailable — retrieval failed." as a valid chunk', () => {
    const result = validateNotesLog([
      makeEntry({
        sources: [makeSource({ relevant_chunk: 'Source unavailable — retrieval failed.' })],
      }),
    ]);
    expect(result.valid).toBe(true);
  });
});

describe('validateNotesLog — empty claim_text', () => {
  it('returns an error when claim_text is empty', () => {
    const result = validateNotesLog([makeEntry({ claim_text: '   ' })]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'claim_text')).toBe(true);
  });
});

describe('validateNotesLog — multiple entries', () => {
  it('collects errors from all entries', () => {
    const log = [
      makeEntry({ claim_id: 'C-001', sources: [] }),
      makeEntry({ claim_id: 'C-002', claim_type: 'bad' as ClaimType }),
    ];
    const result = validateNotesLog(log);
    expect(result.valid).toBe(false);
    const ids = result.errors.map((e) => e.claim_id);
    expect(ids).toContain('C-001');
    expect(ids).toContain('C-002');
  });
});

// ---------------------------------------------------------------------------
// checkMemoCompleteness
// ---------------------------------------------------------------------------

describe('checkMemoCompleteness — complete', () => {
  it('reports complete when all markers match the log', () => {
    const memo = 'Water scarcity is worsening [C-001] due to climate change [C-002].';
    const log = [makeEntry({ claim_id: 'C-001' }), makeEntry({ claim_id: 'C-002' })];
    const report = checkMemoCompleteness(memo, log);
    expect(report.is_complete).toBe(true);
    expect(report.orphaned_claim_ids).toHaveLength(0);
    expect(report.unused_claim_ids).toHaveLength(0);
  });
});

describe('checkMemoCompleteness — orphaned markers', () => {
  it('reports claim IDs in memo but absent from the log', () => {
    const memo = 'See [C-001] and [C-099].';
    const log = [makeEntry({ claim_id: 'C-001' })];
    const report = checkMemoCompleteness(memo, log);
    expect(report.is_complete).toBe(false);
    expect(report.orphaned_claim_ids).toContain('C-099');
    expect(report.unused_claim_ids).toHaveLength(0);
  });
});

describe('checkMemoCompleteness — unused log entries', () => {
  it('reports log entries never referenced in the memo', () => {
    const memo = 'See [C-001].';
    const log = [makeEntry({ claim_id: 'C-001' }), makeEntry({ claim_id: 'C-002' })];
    const report = checkMemoCompleteness(memo, log);
    expect(report.is_complete).toBe(false);
    expect(report.unused_claim_ids).toContain('C-002');
    expect(report.orphaned_claim_ids).toHaveLength(0);
  });
});

describe('checkMemoCompleteness — empty memo', () => {
  it('marks all log entries as unused when memo has no markers', () => {
    const log = [makeEntry({ claim_id: 'C-001' })];
    const report = checkMemoCompleteness('No claims here.', log);
    expect(report.is_complete).toBe(false);
    expect(report.unused_claim_ids).toContain('C-001');
  });
});

describe('checkMemoCompleteness — empty log', () => {
  it('marks all markers as orphaned when log is empty', () => {
    const report = checkMemoCompleteness('See [C-001].', []);
    expect(report.is_complete).toBe(false);
    expect(report.orphaned_claim_ids).toContain('C-001');
  });
});

// ---------------------------------------------------------------------------
// classifyClaim — type classification
// ---------------------------------------------------------------------------

describe('classifyClaim — statistical', () => {
  it('classifies a claim with a percentage', () => {
    const { type } = classifyClaim('Child mortality fell by 42% between 2000 and 2020.', [
      makeSource(),
    ]);
    expect(type).toBe(ClaimType.Statistical);
  });

  it('classifies a claim with "per 100,000"', () => {
    const { type } = classifyClaim(
      'Maternal mortality in Chad stands at 1,140 per 100,000 live births.',
      [makeSource()],
    );
    expect(type).toBe(ClaimType.Statistical);
  });

  it('classifies a claim containing a dollar amount', () => {
    const { type } = classifyClaim('The program cost $4.2 billion annually.', [makeSource()]);
    expect(type).toBe(ClaimType.Statistical);
  });
});

describe('classifyClaim — causal', () => {
  it('classifies a claim with "contributed to"', () => {
    const { type } = classifyClaim(
      'Removal of fuel subsidies contributed to a 15% increase in rural transportation costs.',
      [makeSource()],
    );
    expect(type).toBe(ClaimType.Causal);
  });

  it('classifies a claim with "led to"', () => {
    const { type } = classifyClaim('Policy changes led to improved sanitation outcomes.', [
      makeSource(),
    ]);
    expect(type).toBe(ClaimType.Causal);
  });

  it('classifies a claim with "driven by"', () => {
    const { type } = classifyClaim('Urban migration is driven by rural poverty.', [makeSource()]);
    expect(type).toBe(ClaimType.Causal);
  });
});

describe('classifyClaim — comparative', () => {
  it('classifies a claim with "stronger"', () => {
    const { type } = classifyClaim(
      'Cash transfers have shown stronger effects on enrollment than fee waivers.',
      [makeSource()],
    );
    expect(type).toBe(ClaimType.Comparative);
  });

  it('classifies a claim with "more than"', () => {
    const { type } = classifyClaim('Urban hospitals received more than twice the funding.', [
      makeSource(),
    ]);
    expect(type).toBe(ClaimType.Comparative);
  });

  it('classifies a claim with "outperformed"', () => {
    const { type } = classifyClaim(
      'Community health workers outperformed hospital staff on retention rates.',
      [makeSource()],
    );
    expect(type).toBe(ClaimType.Comparative);
  });
});

describe('classifyClaim — predictive', () => {
  it('classifies a claim with "projected"', () => {
    const { type } = classifyClaim(
      'Urban water demand is projected to exceed supply capacity by 2032.',
      [makeSource()],
    );
    expect(type).toBe(ClaimType.Predictive);
  });

  it('classifies a claim with "expected to"', () => {
    const { type } = classifyClaim('The population is expected to double by 2050.', [makeSource()]);
    expect(type).toBe(ClaimType.Predictive);
  });

  it('classifies a claim with "by 2040"', () => {
    const { type } = classifyClaim('Food insecurity could affect 600 million people by 2040.', [
      makeSource(),
    ]);
    expect(type).toBe(ClaimType.Predictive);
  });
});

describe('classifyClaim — normative', () => {
  it('classifies a claim with "best practice"', () => {
    const { type } = classifyClaim(
      'Multi-stakeholder frameworks are considered best practice for transboundary water management.',
      [makeSource()],
    );
    expect(type).toBe(ClaimType.Normative);
  });

  it('classifies a claim with "should"', () => {
    const { type } = classifyClaim('Governments should prioritize primary healthcare investment.', [
      makeSource(),
    ]);
    expect(type).toBe(ClaimType.Normative);
  });

  it('classifies a claim with "recommended"', () => {
    const { type } = classifyClaim('WHO recommended a minimum of 10 doctors per 10,000 people.', [
      makeSource(),
    ]);
    expect(type).toBe(ClaimType.Normative);
  });
});

describe('classifyClaim — synthesis', () => {
  it('classifies as synthesis when multiple sources and no close match', () => {
    const sources = [
      makeSource({ source_id: 'S-001', relevant_chunk: 'Enrollment rates declined in 2022.' }),
      makeSource({ source_id: 'S-002', relevant_chunk: 'Child labour increased in rural areas.' }),
    ];
    // Claim text does not closely match either chunk
    const { type } = classifyClaim(
      'Declining enrollment and rising child labour suggest subsidies have not reached vulnerable populations.',
      sources,
    );
    expect(type).toBe(ClaimType.Synthesis);
  });
});

// ---------------------------------------------------------------------------
// classifyClaim — derivation method
// ---------------------------------------------------------------------------

describe('classifyClaim — derivation: direct_extraction', () => {
  it('assigns direct_extraction when single source has >70% token overlap', () => {
    const chunk =
      'Maternal mortality in Chad stands at 1,140 per 100,000 live births according to WHO.';
    const claim = 'Maternal mortality in Chad stands at 1,140 per 100,000 live births.';
    const { derivation } = classifyClaim(claim, [makeSource({ relevant_chunk: chunk })]);
    expect(derivation).toBe(DerivationMethod.DirectExtraction);
  });
});

describe('classifyClaim — derivation: paraphrase', () => {
  it('assigns paraphrase when single source has <70% token overlap', () => {
    const chunk = 'The incidence of maternal death remains extremely high in sub-Saharan nations.';
    const claim = 'Maternal mortality in Chad stands at 1,140 per 100,000 live births.';
    const { derivation } = classifyClaim(claim, [makeSource({ relevant_chunk: chunk })]);
    expect(derivation).toBe(DerivationMethod.Paraphrase);
  });
});

describe('classifyClaim — derivation: cross_source', () => {
  it('assigns cross_source when two or more sources are provided', () => {
    const sources = [
      makeSource({ source_id: 'S-001' }),
      makeSource({ source_id: 'S-002', relevant_chunk: 'Fee waiver programs showed 3-5pp gains.' }),
    ];
    const { derivation } = classifyClaim('Cash transfers outperformed fee waivers.', sources);
    expect(derivation).toBe(DerivationMethod.CrossSource);
  });
});

describe('classifyClaim — derivation: agent_inference', () => {
  it('assigns agent_inference when reasoning contains "infer"', () => {
    const { derivation } = classifyClaim(
      'Subsidies appear to be ineffective.',
      [makeSource()],
      'We can infer from the data that subsidies are not working.',
    );
    expect(derivation).toBe(DerivationMethod.AgentInference);
  });

  it('assigns agent_inference when reasoning contains "combination"', () => {
    const { derivation } = classifyClaim(
      'The situation is deteriorating.',
      [makeSource()],
      'This is a combination of several factors identified in the literature.',
    );
    expect(derivation).toBe(DerivationMethod.AgentInference);
  });

  it('assigns agent_inference when no sources are provided', () => {
    const { derivation } = classifyClaim('Things are getting worse.', []);
    expect(derivation).toBe(DerivationMethod.AgentInference);
  });
});

// ---------------------------------------------------------------------------
// getHeraldRoutingForClaim
// ---------------------------------------------------------------------------

describe('getHeraldRoutingForClaim — Tier 1 claims', () => {
  it('routes statistical claims to Tier 1 with threshold 0.9', () => {
    const routing = getHeraldRoutingForClaim(makeEntry({ claim_type: ClaimType.Statistical }));
    expect(routing.startTier).toBe(1);
    expect(routing.nliThreshold).toBe(0.9);
  });

  it('routes comparative claims to Tier 1 with threshold 0.9', () => {
    const routing = getHeraldRoutingForClaim(makeEntry({ claim_type: ClaimType.Comparative }));
    expect(routing.startTier).toBe(1);
    expect(routing.nliThreshold).toBe(0.9);
  });

  it('routes causal claims to Tier 1 with lower threshold 0.85', () => {
    const routing = getHeraldRoutingForClaim(makeEntry({ claim_type: ClaimType.Causal }));
    expect(routing.startTier).toBe(1);
    expect(routing.nliThreshold).toBe(0.85);
  });
});

describe('getHeraldRoutingForClaim — Tier 2 claims (skip NLI)', () => {
  it('routes predictive claims to Tier 2 with no NLI threshold', () => {
    const routing = getHeraldRoutingForClaim(makeEntry({ claim_type: ClaimType.Predictive }));
    expect(routing.startTier).toBe(2);
    expect(routing.nliThreshold).toBeNull();
  });

  it('routes normative claims to Tier 2 with no NLI threshold', () => {
    const routing = getHeraldRoutingForClaim(makeEntry({ claim_type: ClaimType.Normative }));
    expect(routing.startTier).toBe(2);
    expect(routing.nliThreshold).toBeNull();
  });

  it('routes synthesis claims to Tier 2 with no NLI threshold', () => {
    const routing = getHeraldRoutingForClaim(makeEntry({ claim_type: ClaimType.Synthesis }));
    expect(routing.startTier).toBe(2);
    expect(routing.nliThreshold).toBeNull();
  });
});

describe('getHeraldRoutingForClaim — routing table completeness', () => {
  const ALL_CLAIM_TYPES = Object.values(ClaimType);

  it('returns a defined routing for all 6 claim types', () => {
    for (const claimType of ALL_CLAIM_TYPES) {
      const routing = getHeraldRoutingForClaim(makeEntry({ claim_type: claimType }));
      expect(routing.startTier, `Missing routing for ${claimType}`).toBeOneOf([1, 2]);
    }
  });

  it('only Tier 2 claims have null nliThreshold', () => {
    for (const claimType of ALL_CLAIM_TYPES) {
      const routing = getHeraldRoutingForClaim(makeEntry({ claim_type: claimType }));
      if (routing.startTier === 1) {
        expect(
          routing.nliThreshold,
          `Tier 1 claim ${claimType} should have a threshold`,
        ).not.toBeNull();
      } else {
        expect(
          routing.nliThreshold,
          `Tier 2 claim ${claimType} should have null threshold`,
        ).toBeNull();
      }
    }
  });
});
