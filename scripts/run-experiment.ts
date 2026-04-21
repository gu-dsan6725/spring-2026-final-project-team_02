/**
 * run-experiment.ts — HERALD vs. LLM-as-Judge Experiment Runner
 *
 * Runs three systems against the eval set and records per-claim results:
 *   System A — Full HERALD pipeline (src/herald/router.ts)
 *   System B — Tier 2 only / LLM-as-Judge baseline (src/herald/tier2-llm-judge.ts)
 *   System C — HERALD without Tier 1 NLI (ablation)
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/run-experiment.ts [options]
 *
 * Flags:
 *   --eval-set <path>      Path to ground-truth JSON (default: data/eval-set.json)
 *   --systems <A,B,C>      Comma-separated systems to run (default: A,B,C)
 *   --concurrency <n>      Max parallel claim evaluations (default: 3)
 *   --output <path>        Output JSON path (default: results/experiment-YYYY-MM-DD.json)
 *   --dry-run              Use mock verdicts — no API calls
 *
 * Exit codes:
 *   0  Completed successfully
 *   1  Fatal error
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { ClaimType, DerivationMethod, type NotesLogEntry } from '../src/types/claims';
import type { HeraldResult, TierOutput, Verdict } from '../src/types/herald';
import { evaluateClaim } from '../src/herald/router';
import { evaluateWithLLMJudge } from '../src/herald/tier2-llm-judge';
import { evaluateWithDebate } from '../src/herald/tier3-debate';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvalEntry extends NotesLogEntry {
  ground_truth_verdict: Verdict;
  ground_truth_rationale: string;
}

interface SystemResult {
  verdict: Verdict;
  tier_reached: number;
  confidence: number;
  latency_ms: number;
  error?: string;
}

interface PerClaimResult {
  claim_id: string;
  claim_type: string;
  derivation: string;
  ground_truth: Verdict;
  is_skeptic_trap: boolean;
  system_a: SystemResult | null;
  system_b: SystemResult | null;
  system_c: SystemResult | null;
}

interface ExperimentOutput {
  run_timestamp: string;
  git_commit: string;
  eval_set_path: string;
  systems_run: string[];
  dry_run: boolean;
  total_claims: number;
  per_claim_results: PerClaimResult[];
}

// ---------------------------------------------------------------------------
// System C: HERALD without Tier 1 (mirrors router.ts but skips NLI)
// ---------------------------------------------------------------------------

async function evaluateClaimNoNLI(claim: NotesLogEntry): Promise<HeraldResult> {
  const tierDetails: HeraldResult['tier_details'] = {
    tier_1: null,
    tier_2: null,
    tier_3: null,
    tier_4: null,
  };

  const tier2Output: TierOutput = await evaluateWithLLMJudge(claim);
  tierDetails.tier_2 = tier2Output;

  if (tier2Output.verdict !== 'uncertain') {
    return {
      claim_id: claim.claim_id,
      tier_reached: 2,
      verdict: tier2Output.verdict,
      confidence: tier2Output.confidence,
      feedback: tier2Output.reasoning,
      suggested_revision: tier2Output.suggested_revision ?? null,
      tier_details: tierDetails,
    };
  }

  const tier3Output: TierOutput = await evaluateWithDebate(claim, tier2Output);
  tierDetails.tier_3 = tier3Output;

  return {
    claim_id: claim.claim_id,
    tier_reached: 3,
    verdict: tier3Output.verdict,
    confidence: tier3Output.confidence,
    feedback: tier3Output.reasoning,
    suggested_revision: tier3Output.suggested_revision ?? null,
    tier_details: tierDetails,
  };
}

// ---------------------------------------------------------------------------
// System B: Tier 2 only
// ---------------------------------------------------------------------------

async function evaluateWithTier2Only(claim: NotesLogEntry): Promise<HeraldResult> {
  const tier2Output: TierOutput = await evaluateWithLLMJudge(claim);

  // Treat 'uncertain' as 'invalid' — no Tier 3 to escalate to in this baseline
  const verdict: Verdict = tier2Output.verdict === 'uncertain' ? 'invalid' : tier2Output.verdict;

  return {
    claim_id: claim.claim_id,
    tier_reached: 2,
    verdict,
    confidence: tier2Output.confidence,
    feedback: tier2Output.reasoning,
    suggested_revision: tier2Output.suggested_revision ?? null,
    tier_details: {
      tier_1: null,
      tier_2: tier2Output,
      tier_3: null,
      tier_4: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Mock evaluator (dry-run)
// ---------------------------------------------------------------------------

function mockResult(entry: EvalEntry, tierReached: 1 | 2 | 3): HeraldResult {
  return {
    claim_id: entry.claim_id,
    tier_reached: tierReached,
    verdict: entry.ground_truth_verdict === 'uncertain' ? 'uncertain' : entry.ground_truth_verdict,
    confidence: 0.9,
    feedback: '[DRY RUN]',
    suggested_revision: null,
    tier_details: { tier_1: null, tier_2: null, tier_3: null, tier_4: null },
  };
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

function isRateLimitError(err: unknown): boolean {
  return err instanceof Error && (err.message.includes('429') || err.message.includes('rate limit'));
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isRateLimitError(err) && attempt < maxRetries) {
        const match = /Please try again in ([\d.]+)s/.exec(err instanceof Error ? err.message : '');
        const waitMs =
          match?.[1] !== undefined
            ? Math.ceil(parseFloat(match[1]) * 1000) + 500
            : Math.pow(2, attempt + 1) * 2000;
        process.stdout.write(` [rate-limited, waiting ${(waitMs / 1000).toFixed(1)}s]`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Max retries exceeded');
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const taskIndex = index++;
      const task = tasks[taskIndex];
      if (task !== undefined) results[taskIndex] = await task();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Run a single system against a claim
// ---------------------------------------------------------------------------

async function runSystem(
  system: string,
  entry: EvalEntry,
  dryRun: boolean,
): Promise<SystemResult> {
  if (dryRun) {
    const idNum = parseInt(entry.claim_id.replace(/\D/g, ''), 10) || 1;
    const tier = ([1, 2, 2, 3] as const)[idNum % 4];
    const mock = mockResult(entry, tier);
    return { verdict: mock.verdict, tier_reached: mock.tier_reached, confidence: mock.confidence, latency_ms: 0 };
  }

  const start = Date.now();
  try {
    let result: HeraldResult;
    if (system === 'A') {
      result = await withRetry(() => evaluateClaim(entry));
    } else if (system === 'B') {
      result = await withRetry(() => evaluateWithTier2Only(entry));
    } else {
      result = await withRetry(() => evaluateClaimNoNLI(entry));
    }
    return {
      verdict: result.verdict,
      tier_reached: result.tier_reached,
      confidence: result.confidence,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      verdict: 'uncertain',
      tier_reached: 2,
      confidence: 0,
      latency_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  evalSetPath: string;
  systems: string[];
  concurrency: number;
  outputPath: string;
  dryRun: boolean;
} {
  let evalSetPath = 'data/eval-set.json';
  let systems = ['A', 'B', 'C'];
  let concurrency = 3;
  const datestamp = new Date().toISOString().slice(0, 10);
  let outputPath = `results/experiment-${datestamp}.json`;
  let dryRun = false;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--eval-set' && next !== undefined) { evalSetPath = next; i++; }
    else if (arg === '--systems' && next !== undefined) { systems = next.split(',').map((s) => s.trim().toUpperCase()); i++; }
    else if (arg === '--concurrency' && next !== undefined) { concurrency = parseInt(next, 10); i++; }
    else if (arg === '--output' && next !== undefined) { outputPath = next; i++; }
    else if (arg === '--dry-run') { dryRun = true; }
  }

  return { evalSetPath, systems, concurrency, outputPath, dryRun };
}

// ---------------------------------------------------------------------------
// Eval set loader
// ---------------------------------------------------------------------------

const VALID_CLAIM_TYPES = new Set(Object.values(ClaimType));
const VALID_DERIVATIONS = new Set(Object.values(DerivationMethod));

function loadEvalSet(filePath: string): EvalEntry[] {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    console.error(`[ERROR] Eval set not found: ${abs}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(abs, 'utf-8')) as unknown[];
  if (!Array.isArray(raw)) { console.error('[ERROR] Eval set must be a JSON array.'); process.exit(1); }

  const entries: EvalEntry[] = [];
  for (const item of raw) {
    const entry = item as Record<string, unknown>;
    const missing = ['claim_id', 'claim_text', 'claim_type', 'derivation', 'sources', 'reasoning', 'ground_truth_verdict', 'ground_truth_rationale']
      .filter((f) => entry[f] === undefined);
    if (missing.length > 0) { console.warn(`[WARN] Skipping entry missing fields: ${missing.join(', ')}`, entry['claim_id'] ?? '?'); continue; }
    if (!VALID_CLAIM_TYPES.has(entry['claim_type'] as ClaimType)) { console.warn(`[WARN] Unknown claim_type on ${String(entry['claim_id'])} — skipping`); continue; }
    if (!VALID_DERIVATIONS.has(entry['derivation'] as DerivationMethod)) { console.warn(`[WARN] Unknown derivation on ${String(entry['claim_id'])} — skipping`); continue; }
    entries.push(entry as unknown as EvalEntry);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { evalSetPath, systems, concurrency, outputPath, dryRun } = parseArgs(process.argv);

  let gitCommit = 'unknown';
  try { gitCommit = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* ignore */ }

  console.log('='.repeat(60));
  console.log('HERALD vs. LLM-as-Judge Experiment');
  console.log('='.repeat(60));
  console.log(`Eval set:    ${evalSetPath}`);
  console.log(`Systems:     ${systems.join(', ')}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Output:      ${outputPath}`);
  console.log(`Git commit:  ${gitCommit}`);
  console.log(`Dry run:     ${dryRun ? 'YES (mock verdicts)' : 'NO (real API calls)'}`);
  console.log('');

  const entries = loadEvalSet(evalSetPath);

  // Shuffle for ordering effect control
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [entries[i], entries[j]] = [entries[j]!, entries[i]!];
  }

  console.log(`Loaded ${entries.length} claims (shuffled).\n`);

  const perClaimResults: PerClaimResult[] = [];

  const tasks = entries.map((entry, i) => async () => {
    const isSkepticTrap = entry.ground_truth_rationale.startsWith('SKEPTIC TRAP:');
    process.stdout.write(`  [${i + 1}/${entries.length}] ${entry.claim_id} (${entry.claim_type})`);

    const [resultA, resultB, resultC] = await Promise.all([
      systems.includes('A') ? runSystem('A', entry, dryRun) : Promise.resolve(null),
      systems.includes('B') ? runSystem('B', entry, dryRun) : Promise.resolve(null),
      systems.includes('C') ? runSystem('C', entry, dryRun) : Promise.resolve(null),
    ]);

    const verdictStr = [
      resultA != null ? `A=${resultA.verdict}` : null,
      resultB != null ? `B=${resultB.verdict}` : null,
      resultC != null ? `C=${resultC.verdict}` : null,
    ].filter(Boolean).join(' ');

    process.stdout.write(` → ${verdictStr} (gt=${entry.ground_truth_verdict})\n`);

    perClaimResults.push({
      claim_id: entry.claim_id,
      claim_type: entry.claim_type,
      derivation: entry.derivation,
      ground_truth: entry.ground_truth_verdict,
      is_skeptic_trap: isSkepticTrap,
      system_a: resultA,
      system_b: resultB,
      system_c: resultC,
    });
  });

  await runWithConcurrency(tasks, concurrency);

  const output: ExperimentOutput = {
    run_timestamp: new Date().toISOString(),
    git_commit: gitCommit,
    eval_set_path: evalSetPath,
    systems_run: systems,
    dry_run: dryRun,
    total_claims: entries.length,
    per_claim_results: perClaimResults,
  };

  fs.mkdirSync(path.resolve(path.dirname(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), JSON.stringify(output, null, 2));

  console.log(`\nResults written to: ${outputPath}`);
  console.log(`Run: npx tsx --env-file=.env scripts/analyze-experiment.ts --results ${outputPath}`);
}

main().catch((err: unknown) => {
  console.error('[FATAL]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
