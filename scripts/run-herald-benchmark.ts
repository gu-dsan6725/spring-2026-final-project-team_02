/**
 * run-herald-benchmark.ts — HERALD Threshold Calibration Benchmark
 *
 * Loads a ground-truth eval set, runs each claim through the HERALD pipeline,
 * and computes precision/recall/F1 overall and per claim type.
 *
 * Usage:
 *   npx tsx scripts/run-herald-benchmark.ts [options]
 *
 * Flags:
 *   --eval-set <path>      Path to ground-truth JSON (default: data/eval-set.json)
 *   --output <dir>         Directory to write results (default: results/)
 *   --dry-run              Use deterministic mock verdicts — no API calls
 *   --claim-types <types>  Comma-separated filter, e.g. "causal,synthesis"
 *   --concurrency <n>      Max parallel evaluations (default: 3)
 *
 * Exit codes:
 *   0  Benchmark completed successfully
 *   1  Fatal error (missing eval set, API failure, etc.)
 */

import fs from 'node:fs';
import path from 'node:path';

import { ClaimType, DerivationMethod, type NotesLogEntry } from '../src/types/claims';
import type { HeraldResult, Verdict } from '../src/types/herald';
import { evaluateClaim } from '../src/herald/router';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvalEntry extends NotesLogEntry {
  ground_truth_verdict: Verdict;
  ground_truth_rationale: string;
}

interface ClaimMetrics {
  total: number;
  correct: number; // exact match
  truePositives: number; // predicted valid, ground truth valid
  falsePositives: number; // predicted valid, ground truth invalid
  falseNegatives: number; // predicted invalid, ground truth valid
  trueNegatives: number; // predicted invalid, ground truth invalid
  skepticFalseInvalids: number; // valid claim marked invalid (skeptic over-fire signal)
  tierCounts: Record<1 | 2 | 3 | 4, number>;
}

interface BenchmarkResult {
  run_timestamp: string;
  eval_set_path: string;
  dry_run: boolean;
  claim_type_filter: string[] | null;
  total_claims: number;
  overall: Metrics;
  by_claim_type: Record<string, Metrics>;
  by_derivation: Record<string, Metrics>;
  skeptic_false_invalid_rate: number;
  tier_distribution: Record<string, number>;
  per_claim_results: PerClaimResult[];
}

interface Metrics {
  total: number;
  accuracy: number; // exact verdict match (valid vs invalid vs uncertain)
  error_rate: number; // valid ↔ invalid — the errors that matter
  precision: number;
  recall: number;
  f1: number;
  skeptic_false_invalid_rate: number;
}

interface PerClaimResult {
  claim_id: string;
  claim_type: string;
  derivation: string;
  ground_truth_verdict: Verdict;
  predicted_verdict: Verdict;
  correct: boolean;
  tier_reached: number;
  confidence: number;
  is_skeptic_trap: boolean;
  skeptic_false_invalid: boolean;
  evaluation_error?: string;
}

function resolveBenchmarkOutputPath(outputDir: string, datestamp: string): string {
  const baseName = `benchmark-${datestamp}`;
  const firstCandidate = path.join(outputDir, `${baseName}.json`);

  if (!fs.existsSync(path.resolve(firstCandidate))) {
    return firstCandidate;
  }

  let suffix = 2;
  while (true) {
    const candidate = path.join(outputDir, `${baseName}.${suffix}.json`);
    if (!fs.existsSync(path.resolve(candidate))) {
      return candidate;
    }
    suffix++;
  }
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  evalSetPath: string;
  outputDir: string;
  dryRun: boolean;
  claimTypeFilter: string[] | null;
  concurrency: number;
} {
  let evalSetPath = 'data/eval-set.json';
  let outputDir = 'results';
  let dryRun = false;
  let claimTypeFilter: string[] | null = null;
  let concurrency = 3;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--eval-set' && next !== undefined) {
      evalSetPath = next;
      i++;
    } else if (arg === '--output' && next !== undefined) {
      outputDir = next;
      i++;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--claim-types' && next !== undefined) {
      claimTypeFilter = next.split(',').map((t) => t.trim());
      i++;
    } else if (arg === '--concurrency' && next !== undefined) {
      concurrency = parseInt(next, 10);
      i++;
    }
  }

  return { evalSetPath, outputDir, dryRun, claimTypeFilter, concurrency };
}

// ---------------------------------------------------------------------------
// Eval set loading & validation
// ---------------------------------------------------------------------------

const VALID_CLAIM_TYPES = new Set(Object.values(ClaimType));
const VALID_DERIVATIONS = new Set(Object.values(DerivationMethod));
const VALID_VERDICTS = new Set<string>(['valid', 'invalid', 'uncertain']);

function loadEvalSet(filePath: string, claimTypeFilter: string[] | null): EvalEntry[] {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    console.error(`[ERROR] Eval set not found: ${abs}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(abs, 'utf-8')) as unknown[];
  if (!Array.isArray(raw)) {
    console.error('[ERROR] Eval set must be a JSON array.');
    process.exit(1);
  }

  const entries: EvalEntry[] = [];
  for (const item of raw) {
    const entry = item as Record<string, unknown>;

    // Minimal validation
    const missingFields = [
      'claim_id',
      'claim_text',
      'claim_type',
      'derivation',
      'sources',
      'reasoning',
      'ground_truth_verdict',
      'ground_truth_rationale',
    ].filter((f) => entry[f] === undefined);
    if (missingFields.length > 0) {
      console.warn(
        `[WARN] Skipping entry missing fields: ${missingFields.join(', ')}`,
        entry['claim_id'] ?? '?',
      );
      continue;
    }

    if (!VALID_CLAIM_TYPES.has(entry['claim_type'] as ClaimType)) {
      console.warn(
        `[WARN] Unknown claim_type '${String(entry['claim_type'])}' on ${String(entry['claim_id'])} — skipping`,
      );
      continue;
    }
    if (!VALID_DERIVATIONS.has(entry['derivation'] as DerivationMethod)) {
      console.warn(
        `[WARN] Unknown derivation '${String(entry['derivation'])}' on ${String(entry['claim_id'])} — skipping`,
      );
      continue;
    }
    if (!VALID_VERDICTS.has(entry['ground_truth_verdict'] as string)) {
      console.warn(
        `[WARN] Unknown ground_truth_verdict '${String(entry['ground_truth_verdict'])}' on ${String(entry['claim_id'])} — skipping`,
      );
      continue;
    }

    entries.push(entry as unknown as EvalEntry);
  }

  if (claimTypeFilter !== null) {
    return entries.filter((e) => claimTypeFilter.includes(e.claim_type));
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Dry-run mock evaluator
// ---------------------------------------------------------------------------

/**
 * Returns a deterministic mock HeraldResult without making API calls.
 * Mimics the distribution of verdicts you'd expect from the pipeline.
 */
function mockEvaluate(entry: EvalEntry): HeraldResult {
  // Deterministic: use claim_id hash to vary tier reached
  const idNum = parseInt(entry.claim_id.replace(/\D/g, ''), 10) || 1;
  const tierReached = ([1, 2, 2, 3] as const)[idNum % 4];

  // In dry-run, always predict the ground truth verdict so accuracy = 100%
  // This lets you verify the metrics machinery without spending API credits.
  const verdict =
    entry.ground_truth_verdict === 'uncertain' ? 'uncertain' : entry.ground_truth_verdict;

  return {
    claim_id: entry.claim_id,
    tier_reached: tierReached,
    verdict,
    confidence: 0.88,
    feedback: '[DRY RUN] Mock verdict — no API call made.',
    suggested_revision: null,
    tier_details: {
      tier_1:
        tierReached === 1
          ? { tier_id: 1, verdict, confidence: 0.92, reasoning: '[DRY RUN]' }
          : null,
      tier_2:
        tierReached >= 2 ? { tier_id: 2, verdict, confidence: 0.88, reasoning: '[DRY RUN]' } : null,
      tier_3:
        tierReached === 3
          ? { tier_id: 3, verdict, confidence: 0.85, reasoning: '[DRY RUN]' }
          : null,
      tier_4: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Retry helper (handles Groq 429 rate limit errors)
// ---------------------------------------------------------------------------

function isRateLimitError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('429');
}

async function evaluateWithRetry(entry: EvalEntry, maxRetries = 4): Promise<HeraldResult> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await evaluateClaim(entry);
    } catch (err) {
      if (isRateLimitError(err) && attempt < maxRetries) {
        // Extract retry-after from the error message if present, else back off exponentially
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
      if (task !== undefined) {
        results[taskIndex] = await task();
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Metrics computation
// ---------------------------------------------------------------------------

/** Treat valid as "positive", invalid/uncertain as "negative". */
function isPositive(verdict: Verdict): boolean {
  return verdict === 'valid';
}

function computeMetrics(claimMetrics: ClaimMetrics): Metrics {
  const { total, correct, truePositives, falsePositives, falseNegatives, skepticFalseInvalids } =
    claimMetrics;
  const accuracy = total === 0 ? 0 : correct / total;
  const errorRate = total === 0 ? 0 : (total - correct) / total;
  const precision =
    truePositives + falsePositives === 0 ? 0 : truePositives / (truePositives + falsePositives);
  const recall =
    truePositives + falseNegatives === 0 ? 0 : truePositives / (truePositives + falseNegatives);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const skepticFalseInvalidRate = total === 0 ? 0 : skepticFalseInvalids / total;

  return {
    total,
    accuracy: round(accuracy),
    error_rate: round(errorRate),
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    skeptic_false_invalid_rate: round(skepticFalseInvalidRate),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function emptyMetrics(): ClaimMetrics {
  return {
    total: 0,
    correct: 0,
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    trueNegatives: 0,
    skepticFalseInvalids: 0,
    tierCounts: { 1: 0, 2: 0, 3: 0, 4: 0 },
  };
}

function updateMetrics(
  m: ClaimMetrics,
  groundTruth: Verdict,
  predicted: Verdict,
  tierReached: 1 | 2 | 3 | 4,
  isSkepticTrap: boolean,
): void {
  m.total++;
  m.tierCounts[tierReached]++;

  if (groundTruth === predicted) m.correct++;

  // Precision/recall: valid = positive class, invalid/uncertain = negative
  if (isPositive(groundTruth) && isPositive(predicted)) m.truePositives++;
  if (!isPositive(groundTruth) && isPositive(predicted)) m.falsePositives++;
  if (isPositive(groundTruth) && !isPositive(predicted)) m.falseNegatives++;
  if (!isPositive(groundTruth) && !isPositive(predicted)) m.trueNegatives++;

  // Skeptic false-invalid: valid claim predicted as invalid (over-firing skeptic signal)
  if (groundTruth === 'valid' && predicted === 'invalid') m.skepticFalseInvalids++;
  if (isSkepticTrap && predicted === 'invalid') m.skepticFalseInvalids++;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { evalSetPath, outputDir, dryRun, claimTypeFilter, concurrency } = parseArgs(process.argv);

  console.log('='.repeat(60));
  console.log('HERALD Threshold Calibration Benchmark');
  console.log('='.repeat(60));
  console.log(`Eval set:    ${evalSetPath}`);
  console.log(`Output dir:  ${outputDir}`);
  console.log(
    `Dry run:     ${dryRun ? 'YES (mock verdicts, no API calls)' : 'NO (real API calls)'}`,
  );
  console.log(`Filter:      ${claimTypeFilter?.join(', ') ?? 'all claim types'}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log('');

  // Load eval set
  const entries = loadEvalSet(evalSetPath, claimTypeFilter);
  console.log(`Loaded ${entries.length} claims from eval set.`);
  if (entries.length === 0) {
    console.error('[ERROR] No claims to evaluate after filtering.');
    process.exit(1);
  }
  console.log('');

  // Run evaluations
  const overall = emptyMetrics();
  const byClaimType: Record<string, ClaimMetrics> = {};
  const byDerivation: Record<string, ClaimMetrics> = {};
  const perClaimResults: PerClaimResult[] = [];

  console.log('Running evaluations...');

  const tasks = entries.map((entry, i) => async () => {
    const isSkepticTrap = entry.ground_truth_rationale.startsWith('SKEPTIC TRAP:');
    process.stdout.write(
      `  [${i + 1}/${entries.length}] ${entry.claim_id} (${entry.claim_type})... `,
    );

    let result: HeraldResult;
    let evaluationError: string | undefined;
    if (dryRun) {
      result = mockEvaluate(entry);
    } else {
      try {
        result = await evaluateWithRetry(entry);
      } catch (err) {
        evaluationError = err instanceof Error ? err.message : String(err);
        console.error(`\n[ERROR] Failed to evaluate ${entry.claim_id}:`, evaluationError);
        // Record as uncertain on error
        result = {
          claim_id: entry.claim_id,
          tier_reached: 2,
          verdict: 'uncertain',
          confidence: 0,
          feedback: `Evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
          suggested_revision: null,
          tier_details: { tier_1: null, tier_2: null, tier_3: null, tier_4: null },
        };
      }
    }

    const correct = result.verdict === entry.ground_truth_verdict;
    const isSkepticFalseInvalid =
      (entry.ground_truth_verdict === 'valid' && result.verdict === 'invalid') ||
      (isSkepticTrap && result.verdict === 'invalid');

    process.stdout.write(
      `${correct ? '✓' : '✗'} predicted=${result.verdict} (gt=${entry.ground_truth_verdict}) tier=${result.tier_reached}\n`,
    );

    // Accumulate metrics
    const gt = entry.ground_truth_verdict;
    const pred = result.verdict;
    const tier = result.tier_reached;

    updateMetrics(overall, gt, pred, tier, isSkepticTrap);

    if (byClaimType[entry.claim_type] === undefined) byClaimType[entry.claim_type] = emptyMetrics();
    updateMetrics(byClaimType[entry.claim_type]!, gt, pred, tier, isSkepticTrap);

    if (byDerivation[entry.derivation] === undefined)
      byDerivation[entry.derivation] = emptyMetrics();
    updateMetrics(byDerivation[entry.derivation]!, gt, pred, tier, isSkepticTrap);

    perClaimResults.push({
      claim_id: entry.claim_id,
      claim_type: entry.claim_type,
      derivation: entry.derivation,
      ground_truth_verdict: gt,
      predicted_verdict: pred,
      correct,
      tier_reached: tier,
      confidence: result.confidence,
      is_skeptic_trap: isSkepticTrap,
      skeptic_false_invalid: isSkepticFalseInvalid,
      ...(evaluationError !== undefined ? { evaluation_error: evaluationError } : {}),
    });

    return result;
  });

  await runWithConcurrency(tasks, concurrency);
  console.log('');

  // Build output
  const tierDistribution: Record<string, number> = {};
  for (const [tier, count] of Object.entries(overall.tierCounts)) {
    tierDistribution[`tier_${tier}`] = count;
  }

  const benchmarkResult: BenchmarkResult = {
    run_timestamp: new Date().toISOString(),
    eval_set_path: evalSetPath,
    dry_run: dryRun,
    claim_type_filter: claimTypeFilter,
    total_claims: overall.total,
    overall: computeMetrics(overall),
    by_claim_type: Object.fromEntries(
      Object.entries(byClaimType).map(([k, v]) => [k, computeMetrics(v)]),
    ),
    by_derivation: Object.fromEntries(
      Object.entries(byDerivation).map(([k, v]) => [k, computeMetrics(v)]),
    ),
    skeptic_false_invalid_rate: round(overall.skepticFalseInvalids / Math.max(overall.total, 1)),
    tier_distribution: tierDistribution,
    per_claim_results: perClaimResults,
  };

  // Write results
  fs.mkdirSync(path.resolve(outputDir), { recursive: true });
  const datestamp = new Date().toISOString().slice(0, 10);
  const outFile = resolveBenchmarkOutputPath(outputDir, datestamp);
  fs.writeFileSync(path.resolve(outFile), JSON.stringify(benchmarkResult, null, 2));

  // Print summary
  printSummary(benchmarkResult);

  console.log(`\nFull results written to: ${outFile}`);
}

// ---------------------------------------------------------------------------
// Summary printer
// ---------------------------------------------------------------------------

function printSummary(result: BenchmarkResult): void {
  const { overall, by_claim_type, skeptic_false_invalid_rate, tier_distribution } = result;

  console.log('='.repeat(60));
  console.log('RESULTS SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total claims evaluated: ${result.total_claims}`);
  console.log(`Run timestamp:          ${result.run_timestamp}`);
  if (result.dry_run) console.log('(DRY RUN — mock verdicts only)');
  console.log('');

  console.log('Overall Metrics:');
  console.log(`  Accuracy:                   ${pct(overall.accuracy)}  ← the number that matters`);
  console.log(`  Error rate (valid↔invalid): ${pct(overall.error_rate)}`);
  console.log(
    `  Precision: ${pct(overall.precision)}  Recall: ${pct(overall.recall)}  F1: ${pct(overall.f1)}`,
  );
  console.log(`  Skeptic false-invalid rate: ${pct(skeptic_false_invalid_rate)}`);
  console.log('');

  console.log('By Claim Type:');
  const typeHeader = '  Type           Total  Accuracy  ErrorRate  F1';
  console.log(typeHeader);
  console.log('  ' + '-'.repeat(typeHeader.length - 2));
  for (const [type, m] of Object.entries(by_claim_type)) {
    console.log(
      `  ${type.padEnd(14)} ${String(m.total).padStart(5)}  ${pct(m.accuracy).padEnd(9)} ${pct(m.error_rate).padEnd(10)} ${pct(m.f1)}`,
    );
  }
  console.log('');

  console.log('Tier Distribution:');
  for (const [tier, count] of Object.entries(tier_distribution)) {
    const pct_ = result.total_claims > 0 ? Math.round((count / result.total_claims) * 100) : 0;
    console.log(`  ${tier}: ${count} claims (${pct_}%)`);
  }
  console.log('');

  // Threshold recommendations
  console.log('Threshold Calibration Notes:');
  if (skeptic_false_invalid_rate > 0.1) {
    console.log(
      '  ⚠ Skeptic false-invalid rate > 10% — consider tuning src/herald/prompts/skeptic.ts',
    );
  } else {
    console.log('  ✓ Skeptic false-invalid rate within acceptable range');
  }
  if (overall.error_rate > 0.15) {
    console.log(`  ⚠ Error rate ${pct(overall.error_rate)} > 15% — valid claims being mis-routed`);
  } else {
    console.log(`  ✓ Error rate ${pct(overall.error_rate)} — pipeline routing is sound`);
  }
  if (overall.f1 < 0.75) {
    console.log(
      '  ⚠ Overall F1 < 0.75 — threshold sweep recommended (see Step 3 of calibration plan)',
    );
  } else {
    console.log(`  ✓ Overall F1 ${pct(overall.f1)} — thresholds appear reasonable`);
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((err: unknown) => {
  console.error('[FATAL]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
