/**
 * analyze-experiment.ts — HERALD Experiment Metrics Analyzer
 *
 * Reads the JSON output from run-experiment.ts and produces a markdown
 * report with confusion matrices, per-system metrics, tier distribution,
 * latency, and agreement analysis.
 *
 * Usage:
 *   npx tsx scripts/analyze-experiment.ts --results results/experiment-YYYY-MM-DD.json [--output results/analysis-YYYY-MM-DD.md]
 *
 * Exit codes:
 *   0  Completed successfully
 *   1  Fatal error (missing file, bad format)
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types (mirrors run-experiment.ts output schema)
// ---------------------------------------------------------------------------

type Verdict = 'valid' | 'invalid' | 'uncertain';

interface SystemResult {
  verdict: Verdict;
  tier_reached: number;
  confidence: number;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  api_calls: number;
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
// Metrics helpers
// ---------------------------------------------------------------------------

interface ConfusionMatrix {
  tp: number; // predicted invalid, ground truth invalid (caught bad claim)
  fp: number; // predicted invalid, ground truth valid (false accusation)
  tn: number; // predicted valid, ground truth valid (correctly passed)
  fn: number; // predicted valid, ground truth invalid (missed bad claim)
  errors: number; // evaluation errors (uncertain verdict)
  total: number;
}

function emptyMatrix(): ConfusionMatrix {
  return { tp: 0, fp: 0, tn: 0, fn: 0, errors: 0, total: 0 };
}

function updateMatrix(m: ConfusionMatrix, gt: Verdict, pred: Verdict): void {
  m.total++;
  if (pred === 'uncertain') { m.errors++; return; }
  if (gt === 'invalid' && pred === 'invalid') m.tp++;
  else if (gt === 'valid' && pred === 'invalid') m.fp++;
  else if (gt === 'valid' && pred === 'valid') m.tn++;
  else if (gt === 'invalid' && pred === 'valid') m.fn++;
}

interface Metrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  false_invalid_rate: number; // FP / (FP + TN) — valid claims wrongly rejected
  false_valid_rate: number;   // FN / (FN + TP) — invalid claims slipping through
  total: number;
  errors: number;
}

function computeMetrics(m: ConfusionMatrix): Metrics {
  const effective = m.total - m.errors;
  const accuracy = effective === 0 ? 0 : (m.tp + m.tn) / effective;
  const precision = (m.tp + m.fp) === 0 ? 0 : m.tp / (m.tp + m.fp);
  const recall = (m.tp + m.fn) === 0 ? 0 : m.tp / (m.tp + m.fn);
  const f1 = (precision + recall) === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const false_invalid_rate = (m.fp + m.tn) === 0 ? 0 : m.fp / (m.fp + m.tn);
  const false_valid_rate = (m.fn + m.tp) === 0 ? 0 : m.fn / (m.fn + m.tp);
  return {
    accuracy: r(accuracy), precision: r(precision), recall: r(recall), f1: r(f1),
    false_invalid_rate: r(false_invalid_rate), false_valid_rate: r(false_valid_rate),
    total: m.total, errors: m.errors,
  };
}

function r(n: number): number { return Math.round(n * 1000) / 1000; }
function pct(n: number): string { return `${(n * 100).toFixed(1)}%`; }
function avg(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { resultsPath: string; outputPath: string } {
  let resultsPath = '';
  let outputPath = '';

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--results' && next !== undefined) { resultsPath = next; i++; }
    else if (arg === '--output' && next !== undefined) { outputPath = next; i++; }
  }

  if (resultsPath.length === 0) {
    console.error('[ERROR] --results <path> is required.');
    process.exit(1);
  }

  if (outputPath.length === 0) {
    outputPath = resultsPath.replace(/\.json$/, '-analysis.md');
  }

  return { resultsPath, outputPath };
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

function buildReport(data: ExperimentOutput): string {
  const lines: string[] = [];
  const { per_claim_results: claims, systems_run } = data;

  const hasA = systems_run.includes('A');
  const hasB = systems_run.includes('B');
  const hasC = systems_run.includes('C');

  lines.push(`# HERALD Experiment Analysis`);
  lines.push('');
  lines.push(`**Run timestamp:** ${data.run_timestamp}`);
  lines.push(`**Git commit:** \`${data.git_commit}\``);
  lines.push(`**Eval set:** \`${data.eval_set_path}\``);
  lines.push(`**Systems run:** ${systems_run.join(', ')}`);
  lines.push(`**Total claims:** ${data.total_claims}`);
  if (data.dry_run) lines.push(`**⚠ DRY RUN — mock verdicts only**`);
  lines.push('');

  // -------------------------------------------------------------------------
  // 1. Overall confusion matrices
  // -------------------------------------------------------------------------
  lines.push('## 1. Overall Results');
  lines.push('');

  const overallA = emptyMatrix();
  const overallB = emptyMatrix();
  const overallC = emptyMatrix();

  for (const c of claims) {
    if (hasA && c.system_a != null) updateMatrix(overallA, c.ground_truth, c.system_a.verdict);
    if (hasB && c.system_b != null) updateMatrix(overallB, c.ground_truth, c.system_b.verdict);
    if (hasC && c.system_c != null) updateMatrix(overallC, c.ground_truth, c.system_c.verdict);
  }

  const mA = hasA ? computeMetrics(overallA) : null;
  const mB = hasB ? computeMetrics(overallB) : null;
  const mC = hasC ? computeMetrics(overallC) : null;

  lines.push('| Metric | System A (HERALD) | System B (Tier 2 only) | System C (No NLI) |');
  lines.push('|--------|:-----------------:|:----------------------:|:-----------------:|');

  const row = (label: string, fn: (m: Metrics) => string) =>
    `| ${label} | ${mA != null ? fn(mA) : '—'} | ${mB != null ? fn(mB) : '—'} | ${mC != null ? fn(mC) : '—'} |`;

  lines.push(row('Accuracy', (m) => pct(m.accuracy)));
  lines.push(row('Precision', (m) => pct(m.precision)));
  lines.push(row('Recall', (m) => pct(m.recall)));
  lines.push(row('F1', (m) => pct(m.f1)));
  lines.push(row('False Invalid Rate', (m) => pct(m.false_invalid_rate)));
  lines.push(row('False Valid Rate', (m) => pct(m.false_valid_rate)));
  lines.push(row('Eval Errors', (m) => String(m.errors)));
  lines.push('');

  // Decision criteria verdict
  if (mA != null && mB != null) {
    const f1Delta = mA.f1 - mB.f1;
    lines.push('### Decision: Is HERALD worth the complexity?');
    lines.push('');
    if (f1Delta >= 0.03) {
      lines.push(`✅ **Yes** — F1(A) > F1(B) by ${pct(f1Delta)} (≥ 3pp threshold met)`);
    } else if (f1Delta > 0) {
      lines.push(`⚠️ **Marginal** — F1(A) > F1(B) by only ${pct(f1Delta)} (< 3pp threshold)`);
    } else {
      lines.push(`❌ **No** — F1(A) ≤ F1(B) (delta: ${pct(f1Delta)})`);
    }
    if (mA != null && mC != null) {
      const nliDelta = mA.f1 - mC.f1;
      lines.push('');
      lines.push('### Decision: Does Tier 1 NLI contribute accuracy?');
      lines.push('');
      if (Math.abs(nliDelta) < 0.02) {
        lines.push(`⚠️ **Marginal** — F1(A) ≈ F1(C) (delta: ${pct(nliDelta)}). NLI adds cost without clear accuracy gain.`);
      } else if (nliDelta > 0) {
        lines.push(`✅ **Yes** — F1(A) > F1(C) by ${pct(nliDelta)}`);
      } else {
        lines.push(`❌ **No** — F1(A) < F1(C) by ${pct(Math.abs(nliDelta))} — NLI is hurting accuracy`);
      }
    }
    lines.push('');
  }

  // -------------------------------------------------------------------------
  // 2. Per claim type breakdown
  // -------------------------------------------------------------------------
  lines.push('## 2. Per Claim Type');
  lines.push('');

  const claimTypes = [...new Set(claims.map((c) => c.claim_type))].sort();

  for (const ct of claimTypes) {
    const subset = claims.filter((c) => c.claim_type === ct);
    const mxA = emptyMatrix(); const mxB = emptyMatrix(); const mxC = emptyMatrix();
    for (const c of subset) {
      if (hasA && c.system_a != null) updateMatrix(mxA, c.ground_truth, c.system_a.verdict);
      if (hasB && c.system_b != null) updateMatrix(mxB, c.ground_truth, c.system_b.verdict);
      if (hasC && c.system_c != null) updateMatrix(mxC, c.ground_truth, c.system_c.verdict);
    }
    const mmA = hasA ? computeMetrics(mxA) : null;
    const mmB = hasB ? computeMetrics(mxB) : null;
    const mmC = hasC ? computeMetrics(mxC) : null;

    lines.push(`### ${ct} (n=${subset.length})`);
    lines.push('');
    lines.push('| Metric | System A | System B | System C |');
    lines.push('|--------|:--------:|:--------:|:--------:|');

    const row2 = (label: string, fn: (m: Metrics) => string) =>
      `| ${label} | ${mmA != null ? fn(mmA) : '—'} | ${mmB != null ? fn(mmB) : '—'} | ${mmC != null ? fn(mmC) : '—'} |`;

    lines.push(row2('Accuracy', (m) => pct(m.accuracy)));
    lines.push(row2('F1', (m) => pct(m.f1)));
    lines.push(row2('False Invalid Rate', (m) => pct(m.false_invalid_rate)));
    lines.push(row2('False Valid Rate', (m) => pct(m.false_valid_rate)));
    lines.push('');
  }

  // -------------------------------------------------------------------------
  // 3. Tier distribution
  // -------------------------------------------------------------------------
  if (hasA || hasC) {
    lines.push('## 3. Tier Distribution');
    lines.push('');

    for (const [sysLabel, results] of [['System A', claims.map((c) => c.system_a)], ['System C', claims.map((c) => c.system_c)]] as Array<[string, Array<SystemResult | null>]>) {
      const hasSystem = sysLabel === 'System A' ? hasA : hasC;
      if (!hasSystem) continue;

      const tierCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
      let total = 0;
      for (const r of results) {
        if (r != null) { tierCounts[r.tier_reached] = (tierCounts[r.tier_reached] ?? 0) + 1; total++; }
      }

      lines.push(`**${sysLabel}** (${total} claims)`);
      lines.push('');
      lines.push('| Tier | Claims | % |');
      lines.push('|------|-------:|--:|');
      for (const tier of [1, 2, 3, 4]) {
        const count = tierCounts[tier] ?? 0;
        const pct_ = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
        lines.push(`| Tier ${tier} | ${count} | ${pct_}% |`);
      }
      lines.push('');
    }
  }

  // -------------------------------------------------------------------------
  // 4. Latency
  // -------------------------------------------------------------------------
  lines.push('## 4. Latency');
  lines.push('');
  lines.push('| System | Mean (ms) | Median (ms) | p95 (ms) |');
  lines.push('|--------|----------:|------------:|---------:|');

  for (const [label, getter] of [
    ['System A (HERALD)', (c: PerClaimResult) => c.system_a],
    ['System B (Tier 2 only)', (c: PerClaimResult) => c.system_b],
    ['System C (No NLI)', (c: PerClaimResult) => c.system_c],
  ] as Array<[string, (c: PerClaimResult) => SystemResult | null]>) {
    const latencies = claims.map(getter).filter((r): r is SystemResult => r != null).map((r) => r.latency_ms).filter((ms) => ms > 0).sort((a, b) => a - b);
    if (latencies.length === 0) continue;
    const mean = Math.round(avg(latencies));
    const median = latencies[Math.floor(latencies.length / 2)] ?? 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
    lines.push(`| ${label} | ${mean} | ${median} | ${p95} |`);
  }
  lines.push('');

  // -------------------------------------------------------------------------
  // 5. Cost Analysis
  // -------------------------------------------------------------------------
  // gpt-4o-mini pricing: $0.15/1M input tokens, $0.60/1M output tokens
  const INPUT_COST_PER_TOKEN = 0.15 / 1_000_000;
  const OUTPUT_COST_PER_TOKEN = 0.60 / 1_000_000;

  function computeCost(r: SystemResult): number {
    return r.input_tokens * INPUT_COST_PER_TOKEN + r.output_tokens * OUTPUT_COST_PER_TOKEN;
  }

  lines.push('## 5. Cost Analysis');
  lines.push('');
  lines.push(`> Pricing: $0.15/1M input tokens, $0.60/1M output tokens (gpt-4o-mini)`);
  lines.push('');
  lines.push('| System | Total Input Tokens | Total Output Tokens | Total API Calls | Total Cost (USD) | Mean Cost/Claim | Mean API Calls/Claim |');
  lines.push('|--------|-------------------:|--------------------:|----------------:|-----------------:|----------------:|---------------------:|');

  for (const [label, getter] of [
    ['System A (HERALD)', (c: PerClaimResult) => c.system_a],
    ['System B (Tier 2 only)', (c: PerClaimResult) => c.system_b],
    ['System C (No NLI)', (c: PerClaimResult) => c.system_c],
  ] as Array<[string, (c: PerClaimResult) => SystemResult | null]>) {
    const results = claims.map(getter).filter((r): r is SystemResult => r != null);
    if (results.length === 0) continue;
    const totalIn = results.reduce((s, r) => s + (r.input_tokens ?? 0), 0);
    const totalOut = results.reduce((s, r) => s + (r.output_tokens ?? 0), 0);
    const totalCalls = results.reduce((s, r) => s + (r.api_calls ?? 0), 0);
    const totalCost = totalIn * INPUT_COST_PER_TOKEN + totalOut * OUTPUT_COST_PER_TOKEN;
    const meanCost = totalCost / results.length;
    const meanCalls = totalCalls / results.length;
    lines.push(`| ${label} | ${totalIn.toLocaleString()} | ${totalOut.toLocaleString()} | ${totalCalls} | $${totalCost.toFixed(4)} | $${meanCost.toFixed(5)} | ${meanCalls.toFixed(2)} |`);
  }
  lines.push('');

  // Cost-adjusted F1
  lines.push('### Cost-Adjusted F1 (F1 / mean cost per claim)');
  lines.push('');
  lines.push('> Higher = more quality per dollar. Only meaningful when cost > 0.');
  lines.push('');
  lines.push('| System | F1 | Mean Cost/Claim | Cost-Adjusted F1 |');
  lines.push('|--------|:--:|----------------:|-----------------:|');

  for (const [label, getter, metrics] of [
    ['System A (HERALD)', (c: PerClaimResult) => c.system_a, mA],
    ['System B (Tier 2 only)', (c: PerClaimResult) => c.system_b, mB],
    ['System C (No NLI)', (c: PerClaimResult) => c.system_c, mC],
  ] as Array<[string, (c: PerClaimResult) => SystemResult | null, Metrics | null]>) {
    if (metrics == null) continue;
    const results = claims.map(getter).filter((r): r is SystemResult => r != null);
    if (results.length === 0) continue;
    const totalIn = results.reduce((s, r) => s + (r.input_tokens ?? 0), 0);
    const totalOut = results.reduce((s, r) => s + (r.output_tokens ?? 0), 0);
    const meanCost = (totalIn * INPUT_COST_PER_TOKEN + totalOut * OUTPUT_COST_PER_TOKEN) / results.length;
    const costAdjF1 = meanCost > 0 ? metrics.f1 / meanCost : 0;
    lines.push(`| ${label} | ${pct(metrics.f1)} | $${meanCost.toFixed(5)} | ${costAdjF1.toFixed(1)} |`);
  }
  lines.push('');

  // Scale projection
  lines.push('### Scale Projection — 1,000 Claims/Day');
  lines.push('');
  lines.push('| System | Est. Daily Cost (USD) | Est. Monthly Cost (USD) |');
  lines.push('|--------|-----------------------:|------------------------:|');

  for (const [label, getter] of [
    ['System A (HERALD)', (c: PerClaimResult) => c.system_a],
    ['System B (Tier 2 only)', (c: PerClaimResult) => c.system_b],
    ['System C (No NLI)', (c: PerClaimResult) => c.system_c],
  ] as Array<[string, (c: PerClaimResult) => SystemResult | null]>) {
    const results = claims.map(getter).filter((r): r is SystemResult => r != null);
    if (results.length === 0) continue;
    const totalIn = results.reduce((s, r) => s + (r.input_tokens ?? 0), 0);
    const totalOut = results.reduce((s, r) => s + (r.output_tokens ?? 0), 0);
    const meanCost = (totalIn * INPUT_COST_PER_TOKEN + totalOut * OUTPUT_COST_PER_TOKEN) / results.length;
    const daily = meanCost * 1000;
    const monthly = daily * 30;
    lines.push(`| ${label} | $${daily.toFixed(2)} | $${monthly.toFixed(2)} |`);
  }
  lines.push('');

  // -------------------------------------------------------------------------
  // 6. Agreement matrix (A vs B)
  // -------------------------------------------------------------------------
  if (hasA && hasB) {
    lines.push('## 6. Agreement: System A vs System B');
    lines.push('');

    let agree = 0, disagree = 0;
    const disagreements: Array<{ claim_id: string; claim_type: string; gt: Verdict; a: Verdict; b: Verdict }> = [];

    for (const c of claims) {
      if (c.system_a == null || c.system_b == null) continue;
      if (c.system_a.verdict === c.system_b.verdict) { agree++; }
      else { disagree++; disagreements.push({ claim_id: c.claim_id, claim_type: c.claim_type, gt: c.ground_truth, a: c.system_a.verdict, b: c.system_b.verdict }); }
    }

    const total = agree + disagree;
    lines.push(`Agreement rate: **${pct(total > 0 ? agree / total : 0)}** (${agree}/${total} claims)`);
    lines.push('');

    if (disagreements.length > 0) {
      lines.push(`**Disagreements (${disagreements.length} claims):**`);
      lines.push('');
      lines.push('| Claim ID | Type | Ground Truth | System A | System B | Winner |');
      lines.push('|----------|------|:------------:|:--------:|:--------:|:------:|');
      for (const d of disagreements) {
        const winner = d.a === d.gt ? 'A ✓' : d.b === d.gt ? 'B ✓' : 'Neither';
        lines.push(`| ${d.claim_id} | ${d.claim_type} | ${d.gt} | ${d.a} | ${d.b} | ${winner} |`);
      }
      lines.push('');
    }
  }

  // -------------------------------------------------------------------------
  // 7. Wrong claims (all systems)
  // -------------------------------------------------------------------------
  lines.push('## 7. Wrong Claims');
  lines.push('');

  for (const [sysLabel, getter] of [
    ['System A', (c: PerClaimResult) => c.system_a],
    ['System B', (c: PerClaimResult) => c.system_b],
    ['System C', (c: PerClaimResult) => c.system_c],
  ] as Array<[string, (c: PerClaimResult) => SystemResult | null]>) {
    const hasSystem = sysLabel === 'System A' ? hasA : sysLabel === 'System B' ? hasB : hasC;
    if (!hasSystem) continue;

    const wrong = claims.filter((c) => { const r = getter(c); return r != null && r.verdict !== c.ground_truth; });
    lines.push(`### ${sysLabel} — ${wrong.length} wrong`);
    lines.push('');

    if (wrong.length === 0) {
      lines.push('No wrong claims.');
    } else {
      lines.push('| Claim | Type | Derivation | GT | Predicted | Error Type |');
      lines.push('|-------|------|------------|:--:|:---------:|:----------:|');
      for (const c of wrong) {
        const r = getter(c)!;
        const errorType = c.ground_truth === 'valid' && r.verdict === 'invalid' ? 'False Invalid' : 'False Valid';
        lines.push(`| ${c.claim_id} | ${c.claim_type} | ${c.derivation} | ${c.ground_truth} | ${r.verdict} | ${errorType} |`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const { resultsPath, outputPath } = parseArgs(process.argv);

  const abs = path.resolve(resultsPath);
  if (!fs.existsSync(abs)) { console.error(`[ERROR] Results file not found: ${abs}`); process.exit(1); }

  const data = JSON.parse(fs.readFileSync(abs, 'utf-8')) as ExperimentOutput;
  const report = buildReport(data);

  fs.mkdirSync(path.resolve(path.dirname(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), report);

  console.log(`Analysis written to: ${outputPath}`);

  // Print quick summary to stdout
  const claims = data.per_claim_results;
  for (const [label, getter] of [
    ['System A (HERALD)', (c: PerClaimResult) => c.system_a],
    ['System B (Tier 2 only)', (c: PerClaimResult) => c.system_b],
    ['System C (No NLI)', (c: PerClaimResult) => c.system_c],
  ] as Array<[string, (c: PerClaimResult) => SystemResult | null]>) {
    const m = emptyMatrix();
    for (const c of claims) { const r = getter(c); if (r != null) updateMatrix(m, c.ground_truth, r.verdict); }
    if (m.total === 0) continue;
    const metrics = computeMetrics(m);
    console.log(`${label}: Accuracy=${pct(metrics.accuracy)} F1=${pct(metrics.f1)} Precision=${pct(metrics.precision)} Recall=${pct(metrics.recall)}`);
  }
}

main();
