/**
 * run-full-pipeline.ts — End-to-End HERALD Pipeline Orchestration
 *
 * Demonstrates the complete evaluation + revision + human-review pipeline.
 *
 * Usage:
 *   npx tsx scripts/run-full-pipeline.ts [--topic <str>] [--memo <path>] [--output <dir>]
 *
 * Flags:
 *   --topic <str>       Research topic; triggers real agent memo generation.
 *   --background <str>  Optional background/framing for the agent (use with --topic).
 *   --sources <url,...> Comma-separated list of known source URLs (use with --topic).
 *   --memo <path>       Path to a JSON file containing { memo_markdown, notes_log }.
 *                       Skips agent generation; evaluates the provided memo directly.
 *                       If neither --topic nor --memo is provided, built-in sample data is used.
 *   --output <dir>      Directory to write HERALD-report.json and notes-log.json.
 *                       Defaults to ./pipeline-output/
 *   --dry-run           Skip actual LLM calls; use placeholder verdicts.
 *
 * Exit codes:
 *   0  All claims resolved (valid or revised)
 *   1  Some claims require human intervention
 *   2  Fatal error during pipeline run
 */

import fs from 'node:fs';
import path from 'node:path';

import { ClaimType, DerivationMethod, type NotesLogEntry } from '../src/types/claims';
import type { MemoInput, MemoOutput } from '../src/types/memo';
import type { HeraldResult } from '../src/types/herald';
import { evaluateClaim } from '../src/herald/router';
import { reviseClaimsFromHerald } from '../src/herald/feedback-loop';
import {
  submitForHumanReview,
  getPendingCount,
  getHumanReviewQueue,
} from '../src/herald/tier4-human';
import type { AgentConfig } from '../src/types/agent';
import { DEFAULT_AGENT_CONFIG } from '../src/types/agent';
import { runResearchAgent } from '../src/agent/research-agent';

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  topic: string | null;
  background: string | null;
  sources: string[];
  memoPath: string | null;
  outputDir: string;
  dryRun: boolean;
} {
  let topic: string | null = null;
  let background: string | null = null;
  let sources: string[] = [];
  let memoPath: string | null = null;
  let outputDir = 'pipeline-output';
  let dryRun = false;

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--topic' && argv[i + 1] !== undefined) {
      topic = argv[i + 1] ?? null;
      i++;
    } else if (argv[i] === '--background' && argv[i + 1] !== undefined) {
      background = argv[i + 1] ?? null;
      i++;
    } else if (argv[i] === '--sources' && argv[i + 1] !== undefined) {
      sources = (argv[i + 1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      i++;
    } else if (argv[i] === '--memo' && argv[i + 1] !== undefined) {
      memoPath = argv[i + 1] ?? null;
      i++;
    } else if (argv[i] === '--output' && argv[i + 1] !== undefined) {
      outputDir = argv[i + 1] ?? 'pipeline-output';
      i++;
    } else if (argv[i] === '--dry-run') {
      dryRun = true;
    }
  }

  return { topic, background, sources, memoPath, outputDir, dryRun };
}

// ---------------------------------------------------------------------------
// Sample data (used when no --memo flag is provided)
// ---------------------------------------------------------------------------

const SAMPLE_NOTES_LOG: NotesLogEntry[] = [
  {
    claim_id: 'C-001',
    claim_text:
      'Global average temperatures have risen by approximately 1.1°C since pre-industrial times.',
    claim_type: ClaimType.Statistical,
    derivation: DerivationMethod.DirectExtraction,
    sources: [
      {
        source_id: 'S-001',
        source_title: 'IPCC Sixth Assessment Report (2021)',
        source_url: 'https://www.ipcc.ch/report/ar6/wg1/',
        relevant_chunk:
          'Human-induced climate change has already affected many weather and climate extremes in every region across the globe. ' +
          'Global surface temperature has increased faster since 1970 than in any other 50-year period over at least the last 2000 years. ' +
          'Global surface temperature was 1.09 [0.95 to 1.20] °C higher in 2011–2020 than 1850–1900.',
      },
    ],
    reasoning: 'Directly extracted figure from IPCC AR6 Summary for Policymakers.',
  },
  {
    claim_id: 'C-002',
    claim_text:
      'Renewable energy capacity is projected to triple globally by 2030 under current policy trajectories.',
    claim_type: ClaimType.Predictive,
    derivation: DerivationMethod.Paraphrase,
    sources: [
      {
        source_id: 'S-002',
        source_title: 'IEA World Energy Outlook 2023',
        source_url: 'https://www.iea.org/reports/world-energy-outlook-2023',
        relevant_chunk:
          'In the Stated Policies Scenario, global renewable power capacity more than doubles by 2030. ' +
          'The Announced Pledges Scenario sees capacity grow 2.5x by 2030. ' +
          'Only in the Net Zero Emissions by 2050 scenario does capacity reach tripling.',
      },
    ],
    reasoning:
      'Claim states "triple by 2030" but source only supports this under NZE scenario, not current policy trajectory.',
  },
  {
    claim_id: 'C-003',
    claim_text:
      'Carbon pricing mechanisms have demonstrated superior emissions reductions compared to command-and-control regulations in industrial sectors.',
    claim_type: ClaimType.Comparative,
    derivation: DerivationMethod.CrossSource,
    sources: [
      {
        source_id: 'S-003',
        source_title: 'World Bank Carbon Pricing Dashboard 2023',
        source_url: 'https://carbonpricingdashboard.worldbank.org/',
        relevant_chunk:
          'Carbon pricing instruments now cover 23% of global greenhouse gas emissions. ' +
          'Regions with carbon pricing show 3-5% faster emissions intensity reductions on average.',
      },
      {
        source_id: 'S-004',
        source_title: 'OECD Environmental Policy Effectiveness Review 2022',
        source_url: 'https://www.oecd.org/env/tools-evaluation/',
        relevant_chunk:
          'Market-based instruments including carbon pricing demonstrate cost-effective emissions reductions. ' +
          'Command-and-control approaches provide emissions certainty but at higher abatement costs.',
      },
    ],
    reasoning:
      'Synthesized from World Bank and OECD data comparing policy instrument effectiveness.',
  },
  {
    claim_id: 'C-004',
    claim_text:
      'Fossil fuel subsidies globally exceeded $7 trillion in 2022, crowding out clean energy investment.',
    claim_type: ClaimType.Causal,
    derivation: DerivationMethod.AgentInference,
    sources: [
      {
        source_id: 'S-005',
        source_title: 'IMF Working Paper: Still Not Getting Energy Prices Right (2023)',
        source_url: 'https://www.imf.org/en/Publications/WP/Issues/2023/09/',
        relevant_chunk:
          'Global fossil fuel subsidies (explicit and implicit) amounted to $7.0 trillion in 2022, or 7.1 percent of GDP. ' +
          'Explicit subsidies (below cost pricing) account for $1.3 trillion; implicit subsidies (unpriced externalities) $5.7 trillion.',
      },
    ],
    reasoning:
      'The $7T figure is correct, but "crowding out clean energy investment" is an agent inference not stated in the source.',
  },
  {
    claim_id: 'C-005',
    claim_text:
      'Multilateral development banks should prioritize concessional financing for climate adaptation in least-developed countries.',
    claim_type: ClaimType.Normative,
    derivation: DerivationMethod.Paraphrase,
    sources: [
      {
        source_id: 'S-006',
        source_title: 'Bridgetown Initiative — MDB Reform Framework (2023)',
        source_url: 'https://www.un.org/en/climatechange/bridgetown-initiative',
        relevant_chunk:
          'The Bridgetown Initiative calls for a fundamental reform of the international financial architecture ' +
          'to unlock greater concessional finance for vulnerable nations. ' +
          'MDBs are urged to triple adaptation financing for Small Island Developing States and Least Developed Countries.',
      },
    ],
    reasoning: 'Paraphrased normative recommendation from the Bridgetown Initiative.',
  },
];

const SAMPLE_MEMO: MemoOutput = {
  memo_markdown: `# Climate Finance Policy Memo

## Executive Summary

Global average temperatures have risen by approximately 1.1°C since pre-industrial times [C-001], driving urgent need for accelerated climate action.

## Mitigation Landscape

Renewable energy capacity is projected to triple globally by 2030 under current policy trajectories [C-002].

Carbon pricing mechanisms have demonstrated superior emissions reductions compared to command-and-control regulations in industrial sectors [C-003].

## Subsidy Reform

Fossil fuel subsidies globally exceeded $7 trillion in 2022, crowding out clean energy investment [C-004].

## Recommendations

Multilateral development banks should prioritize concessional financing for climate adaptation in least-developed countries [C-005].`,
  notes_log: SAMPLE_NOTES_LOG,
  metadata: {
    generation_timestamp: new Date().toISOString(),
    token_usage: 0,
    tool_calls_count: 0,
  },
};

// ---------------------------------------------------------------------------
// Dry-run stub (returns mock verdicts without LLM calls)
// ---------------------------------------------------------------------------

async function evaluateClaimDryRun(claim: NotesLogEntry): Promise<HeraldResult> {
  await new Promise<void>((resolve) => setTimeout(resolve, 50)); // simulate latency
  const mockVerdicts: Record<string, HeraldResult['verdict']> = {
    'C-001': 'valid',
    'C-002': 'invalid',
    'C-003': 'valid',
    'C-004': 'invalid',
    'C-005': 'valid',
  };
  const verdict = mockVerdicts[claim.claim_id] ?? 'uncertain';
  const feedback: Record<string, string> = {
    'C-001': 'Figure matches IPCC AR6 SPM directly.',
    'C-002':
      'Source states tripling only under NZE scenario, not stated policies. Claim overstates projection.',
    'C-003': 'Cross-source comparison is fair and well-supported.',
    'C-004':
      'The $7T subsidy figure is correct. The causal link to "crowding out" clean investment is not supported by the cited source.',
    'C-005': 'Normative claim accurately paraphrases Bridgetown Initiative recommendation.',
  };

  return {
    claim_id: claim.claim_id,
    tier_reached: 2,
    verdict,
    confidence: verdict === 'valid' ? 0.92 : 0.81,
    feedback: feedback[claim.claim_id] ?? 'No feedback.',
    suggested_revision:
      claim.claim_id === 'C-002'
        ? 'Renewable energy capacity is projected to triple by 2030 only under the Net Zero Emissions by 2050 scenario, according to the IEA.'
        : claim.claim_id === 'C-004'
          ? 'Fossil fuel subsidies globally exceeded $7 trillion in 2022; addressing these subsidies is widely considered essential to freeing capital for clean energy investment.'
          : null,
    tier_details: {
      tier_1: null,
      tier_2: {
        tier_id: 2,
        verdict,
        confidence: 0.88,
        reasoning: feedback[claim.claim_id] ?? '',
        suggested_revision: undefined,
      },
      tier_3: null,
      tier_4: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Progress logging helpers
// ---------------------------------------------------------------------------

function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

function logSection(title: string): void {
  log('');
  log(`${'─'.repeat(60)}`);
  log(`  ${title}`);
  log(`${'─'.repeat(60)}`);
}

function verdictSymbol(verdict: HeraldResult['verdict']): string {
  if (verdict === 'valid') return '✓';
  if (verdict === 'invalid') return '✕';
  return '?';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { topic, background, sources, memoPath, outputDir, dryRun } = parseArgs(process.argv);

  log('');
  log('╔══════════════════════════════════════════════════════════╗');
  log('║       HERALD Full Pipeline — Orchestration Script        ║');
  log('╚══════════════════════════════════════════════════════════╝');

  if (dryRun) {
    log('  [DRY RUN] LLM calls are stubbed with placeholder verdicts.');
  }

  const config: AgentConfig = {
    ...DEFAULT_AGENT_CONFIG,
    max_revision_attempts: 2,
  };

  // Load or generate memo
  let memo: MemoOutput;
  if (topic !== null) {
    logSection('Phase 0 — Research Agent (memo generation)');
    log(`  Topic:      ${topic}`);
    if (background !== null) log(`  Background: ${background}`);
    if (sources.length > 0) log(`  Sources:    ${sources.join(', ')}`);
    log('');

    const input: MemoInput = {
      topic,
      ...(background !== null ? { background } : {}),
      ...(sources.length > 0 ? { known_sources: sources } : {}),
    };

    log('  Running research agent… (this may take a few minutes)');
    memo = await runResearchAgent(input, config);
    log(`  Agent complete. ${memo.notes_log.length.toString()} claims extracted.`);
    log(
      `  Tokens used: ${memo.metadata.token_usage.toString()}, tool calls: ${memo.metadata.tool_calls_count.toString()}`,
    );

    // Persist the generated memo so it can be re-evaluated later with --memo
    fs.mkdirSync(outputDir, { recursive: true });
    const generatedMemoPath = path.join(outputDir, 'memo-input.json');
    fs.writeFileSync(generatedMemoPath, JSON.stringify(memo, null, 2));
    log(`  Saved generated memo → ${generatedMemoPath}`);
  } else if (memoPath !== null) {
    log(`\nLoading memo from: ${memoPath}`);
    const raw = fs.readFileSync(memoPath, 'utf-8');
    memo = JSON.parse(raw) as MemoOutput;
  } else {
    log('\nUsing built-in sample memo (5 claims across all types).');
    memo = SAMPLE_MEMO;
  }

  log(`\nClaims to evaluate: ${memo.notes_log.length.toString()}`);
  log(`Max revision attempts: ${config.max_revision_attempts.toString()}`);

  // ── Phase 1: HERALD Evaluation ───────────────────────────────────────────

  logSection('Phase 1 — HERALD Evaluation');

  const evaluator = dryRun ? evaluateClaimDryRun : evaluateClaim;
  const heraldResults: HeraldResult[] = [];

  for (const claim of memo.notes_log) {
    process.stdout.write(`  [${claim.claim_id}] ${claim.claim_type.padEnd(12)} Evaluating… `);
    const result = await evaluator(claim);
    heraldResults.push(result);
    log(
      `${verdictSymbol(result.verdict)} ${result.verdict.padEnd(14)} (Tier ${result.tier_reached.toString()}, conf ${Math.round(result.confidence * 100).toString()}%)`,
    );
    if (result.verdict !== 'valid') {
      log(`           ↳ ${result.feedback.slice(0, 90)}…`);
    }
  }

  const validCount = heraldResults.filter((r) => r.verdict === 'valid').length;
  const needsWorkCount = heraldResults.length - validCount;
  log(`\n  Summary: ${validCount.toString()} valid, ${needsWorkCount.toString()} need attention.`);

  if (needsWorkCount === 0) {
    log('\n  All claims pass HERALD. No revisions needed.');
    writeOutputs(outputDir, memo, heraldResults, []);
    log('\nPipeline complete. Exit 0.');
    return;
  }

  // ── Phase 2: Feedback Loop (Revision) ───────────────────────────────────

  logSection('Phase 2 — Feedback Loop (Revision)');

  const revisedOutput = await reviseClaimsFromHerald(memo, heraldResults, config);

  for (const state of revisedOutput.revision_states) {
    if (state.status === 'revised') {
      log(`  [${state.claim_id}] REVISED after ${state.revision_count.toString()} attempt(s). ✓`);
    } else if (state.status === 'failed_max_attempts') {
      log(
        `  [${state.claim_id}] FAILED after ${state.revision_count.toString()} attempt(s) — flagged for human review.`,
      );
    }
  }

  // ── Phase 3: Human Review Queue ─────────────────────────────────────────

  if (revisedOutput.requires_human_intervention.length > 0) {
    logSection('Phase 3 — Human Review Queue');

    for (const claimId of revisedOutput.requires_human_intervention) {
      const notesEntry = revisedOutput.notes_log.find((e) => e.claim_id === claimId);
      const heraldResult = heraldResults.find((r) => r.claim_id === claimId);
      if (notesEntry === undefined || heraldResult === undefined) continue;

      submitForHumanReview(
        notesEntry,
        heraldResult.tier_details.tier_2 !== null ? [heraldResult.tier_details.tier_2] : [],
        'pipeline-run',
      );
      log(`  [${claimId}] Submitted to human review queue.`);
    }

    const pendingCount = getPendingCount('pipeline-run');
    log(`\n  ${pendingCount.toString()} claim(s) pending human review.`);

    const queue = getHumanReviewQueue('pipeline-run');
    log('\n  Human Review Queue:');
    for (const entry of queue) {
      log(`    • [${entry.claim.claim_id}] ${entry.escalation_reason.slice(0, 80)}…`);
    }
  } else {
    log('\n  No claims require human review.');
  }

  // ── Output ───────────────────────────────────────────────────────────────

  logSection('Writing Output Files');
  writeOutputs(outputDir, revisedOutput, heraldResults, revisedOutput.requires_human_intervention);

  const requiresIntervention = revisedOutput.requires_human_intervention.length > 0;
  log('\nPipeline complete.');
  if (requiresIntervention) {
    log(
      `  ${revisedOutput.requires_human_intervention.length.toString()} claim(s) require human review — exiting with code 1.`,
    );
    process.exit(1);
  }
  log('  All claims resolved. Exit 0.');
}

// ---------------------------------------------------------------------------
// Output writer
// ---------------------------------------------------------------------------

interface MemoLike {
  memo_markdown: string;
  notes_log: NotesLogEntry[];
}

function writeOutputs(
  outputDir: string,
  memo: MemoLike,
  heraldResults: HeraldResult[],
  requiresIntervention: string[],
): void {
  fs.mkdirSync(outputDir, { recursive: true });

  // Memo markdown
  const memoPath = path.join(outputDir, 'memo.md');
  fs.writeFileSync(memoPath, memo.memo_markdown);
  log(`  memo.md           → ${memoPath}`);

  // Notes log
  const notesPath = path.join(outputDir, 'notes-log.json');
  fs.writeFileSync(notesPath, JSON.stringify(memo.notes_log, null, 2));
  log(`  notes-log.json    → ${notesPath}`);

  // HERALD report
  const heraldReport = {
    generated_at: new Date().toISOString(),
    total_claims: heraldResults.length,
    valid_count: heraldResults.filter((r) => r.verdict === 'valid').length,
    invalid_count: heraldResults.filter((r) => r.verdict === 'invalid').length,
    invalid_with_revision_count: heraldResults.filter(
      (r) => r.verdict === 'invalid' && r.suggested_revision !== null,
    ).length,
    uncertain_count: heraldResults.filter((r) => r.verdict === 'uncertain').length,
    requires_human_intervention: requiresIntervention,
    results: heraldResults,
  };
  const heraldPath = path.join(outputDir, 'HERALD-report.json');
  fs.writeFileSync(heraldPath, JSON.stringify(heraldReport, null, 2));
  log(`  HERALD-report.json → ${heraldPath}`);

  // Summary
  const summaryPath = path.join(outputDir, 'pipeline-summary.txt');
  const summaryLines = [
    `HERALD Pipeline Summary`,
    `Generated: ${new Date().toISOString()}`,
    '',
    `Total claims evaluated: ${heraldResults.length.toString()}`,
    `  Valid:              ${heraldReport.valid_count.toString()}`,
    `  Invalid:            ${heraldReport.invalid_count.toString()}`,
    `  Invalid w/revision: ${heraldReport.invalid_with_revision_count.toString()}`,
    `  Uncertain:          ${heraldReport.uncertain_count.toString()}`,
    `  Human intervention: ${requiresIntervention.length.toString()}`,
    '',
    'Claim Results:',
    ...heraldResults.map(
      (r) =>
        `  [${r.claim_id}] ${verdictSymbol(r.verdict)} ${r.verdict.padEnd(14)} Tier ${r.tier_reached.toString()} — ${r.feedback.slice(0, 60)}`,
    ),
  ];
  fs.writeFileSync(summaryPath, summaryLines.join('\n'));
  log(`  pipeline-summary.txt → ${summaryPath}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\nFATAL: ${msg}\n`);
  process.exit(2);
});
