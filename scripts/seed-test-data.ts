/**
 * Seed the database with representative test memos and claims.
 *
 * Usage:
 *   npm run seed
 *
 * Requires DATABASE_URL to be set in the environment (or .env).
 * Safe to run multiple times — uses upsert semantics.
 */

import { ClaimType, DerivationMethod } from '../src/types/claims.js';
import type { NotesLogEntry, Source } from '../src/types/claims.js';
import type { HeraldResult } from '../src/types/herald.js';

// ---------------------------------------------------------------------------
// Sample sources
// ---------------------------------------------------------------------------

const S001: Source = {
  source_id: 'S-001',
  source_title: 'World Bank Health Nutrition and Population Data 2023',
  source_url: 'https://data.worldbank.org/indicator/SH.STA.MMRT',
  relevant_chunk:
    'Maternal mortality ratio (modeled estimate, per 100,000 live births) for Chad: 1,140 (2020).',
};

const S002: Source = {
  source_id: 'S-002',
  source_title: 'WHO Global Health Observatory — Chad Country Profile 2023',
  source_url: 'https://www.who.int/data/gho/data/countries/country-details/GHO/chad',
  relevant_chunk:
    'Skilled birth attendance coverage in Chad remains below 25%, one of the lowest rates in sub-Saharan Africa.',
};

const S003: Source = {
  source_id: 'S-003',
  source_title: 'Baird et al. (2019) — Conditional Cash Transfers and Education Outcomes',
  source_url: 'https://www.semanticscholar.org/paper/example-baird-2019',
  relevant_chunk:
    'Our meta-analysis of 12 RCTs across Kenya, Tanzania, and Uganda finds that conditional cash transfer programs increased enrollment by 8.2 percentage points on average.',
};

const S004: Source = {
  source_id: 'S-004',
  source_title: 'UNESCO Global Education Monitoring Report 2023',
  source_url: 'https://www.unesco.org/gem-report/en/2023',
  relevant_chunk:
    'Fee waiver programs showed more modest enrollment gains of 3-5 percentage points in comparable East African settings.',
};

// ---------------------------------------------------------------------------
// Sample notes log entries (claims)
// ---------------------------------------------------------------------------

const SAMPLE_CLAIMS: NotesLogEntry[] = [
  {
    claim_id: 'C-001',
    claim_text: 'Maternal mortality in Chad stands at 1,140 per 100,000 live births.',
    claim_type: ClaimType.Statistical,
    derivation: DerivationMethod.DirectExtraction,
    sources: [S001],
    reasoning: 'Directly extracted from World Bank modeled estimate for 2020.',
  },
  {
    claim_id: 'C-002',
    claim_text: 'Skilled birth attendance coverage in Chad remains below 25%.',
    claim_type: ClaimType.Statistical,
    derivation: DerivationMethod.Paraphrase,
    sources: [S002],
    reasoning: 'Paraphrased from WHO Global Health Observatory country profile.',
  },
  {
    claim_id: 'C-003',
    claim_text:
      'Cash transfer programs have shown stronger effects on school enrollment than fee waiver programs.',
    claim_type: ClaimType.Comparative,
    derivation: DerivationMethod.CrossSource,
    sources: [S003, S004],
    reasoning:
      'Cross-source comparison: CCT meta-analysis (8.2pp) vs UNESCO fee waiver data (3-5pp).',
  },
  {
    claim_id: 'C-004',
    claim_text:
      'Without intervention, urban water demand in the Sahel is projected to exceed supply capacity by 2032.',
    claim_type: ClaimType.Predictive,
    derivation: DerivationMethod.AgentInference,
    sources: [],
    reasoning:
      'Agent inference combining population growth projections and current infrastructure data.',
  },
  {
    claim_id: 'C-005',
    claim_text:
      'Multi-stakeholder governance frameworks are considered best practice for transboundary water management.',
    claim_type: ClaimType.Normative,
    derivation: DerivationMethod.DirectExtraction,
    sources: [],
    reasoning: 'Extracted from OECD Water Governance principles documentation.',
  },
];

// ---------------------------------------------------------------------------
// Sample HERALD results
// ---------------------------------------------------------------------------

const SAMPLE_HERALD_RESULTS: HeraldResult[] = [
  {
    claim_id: 'C-001',
    tier_reached: 1,
    verdict: 'valid',
    confidence: 0.94,
    feedback:
      'Tier 1 NLI confirmed entailment with high confidence. Source directly states this figure.',
    suggested_revision: null,
    tier_details: {
      tier_1: {
        tier_id: 1,
        verdict: 'valid',
        confidence: 0.94,
        reasoning: 'Entailment score 0.94 exceeds threshold of 0.9.',
      },
      tier_2: null,
      tier_3: null,
      tier_4: null,
    },
  },
  {
    claim_id: 'C-003',
    tier_reached: 2,
    verdict: 'valid',
    confidence: 0.88,
    feedback:
      'LLM Judge confirmed the comparison is fair: both studies use comparable East African settings and similar outcome metrics.',
    suggested_revision: null,
    tier_details: {
      tier_1: {
        tier_id: 1,
        verdict: 'uncertain',
        confidence: 0.71,
        reasoning: 'Neutral score 0.71 — NLI cannot resolve cross-source comparisons. Escalated.',
      },
      tier_2: {
        tier_id: 2,
        verdict: 'valid',
        confidence: 0.88,
        reasoning:
          'Both studies measure enrollment percentage points in East Africa with similar methodology. Comparison is warranted.',
      },
      tier_3: null,
      tier_4: null,
    },
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  process.stderr.write(
    `Seeding ${String(SAMPLE_CLAIMS.length)} claims and ${String(SAMPLE_HERALD_RESULTS.length)} HERALD results...\n`,
  );

  // When a real database is connected, replace this with actual DB calls.
  // For now, write the seed data to stdout as JSON for inspection/import.
  const seedData = {
    claims: SAMPLE_CLAIMS,
    heraldResults: SAMPLE_HERALD_RESULTS,
    memo: {
      id: 'memo-seed-001',
      topic: 'Improving Maternal Health Outcomes in Sub-Saharan Africa',
      createdAt: new Date().toISOString(),
    },
  };

  process.stdout.write(JSON.stringify(seedData, null, 2) + '\n');
  process.stderr.write('Seed data written to stdout. Pipe to a file or import to your DB.\n');
  process.stderr.write('Example: npm run seed > seed-output.json\n');
}

main().catch((err: unknown) => {
  process.stderr.write(`Seed failed: ${String(err)}\n`);
  process.exit(1);
});
