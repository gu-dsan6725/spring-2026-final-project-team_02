/**
 * analyze-experiment.ts — HERALD Experiment Metrics Analyzer
 *
 * Reads the JSON output from run-experiment.ts and produces a markdown
 * report covering:
 *   1. Overall accuracy metrics per system
 *   2. Per claim type breakdown
 *   3. Tier distribution (Systems A and C)
 *   4. Latency summary
 *   5. Cost analysis — actual tokens, USD per claim, cost at scale
 *   6. Agreement / disagreement matrix (System A vs B)
 *   7. Wrong claims per system
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
  /** New schema: separate per-tier model and pricing fields. */
  tier2_model?: string;
  tier3_model?: string;
  tier2_pricing?: { input_per_million: number; output_per_million: number };
  tier3_pricing?: { input_per_million: number; output_per_million: number };
  /** Legacy schema (pre-dual-model): kept for backward compatibility with old result files. */
  model?: string;
  pricing?: { input_per_million: number; output_per_million: number };
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
  if (pred === 'uncertain') {
    m.errors++;
    return;
  }
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
  false_invalid_rate: number;
  false_valid_rate: number;
  total: number;
  errors: number;
}

function computeMetrics(m: ConfusionMatrix): Metrics {
  const effective = m.total - m.errors;
  const accuracy = effective === 0 ? 0 : (m.tp + m.tn) / effective;
  const precision = m.tp + m.fp === 0 ? 0 : m.tp / (m.tp + m.fp);
  const recall = m.tp + m.fn === 0 ? 0 : m.tp / (m.tp + m.fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const false_invalid_rate = m.fp + m.tn === 0 ? 0 : m.fp / (m.fp + m.tn);
  const false_valid_rate = m.fn + m.tp === 0 ? 0 : m.fn / (m.fn + m.tp);
  return {
    accuracy: r(accuracy),
    precision: r(precision),
    recall: r(recall),
    f1: r(f1),
    false_invalid_rate: r(false_invalid_rate),
    false_valid_rate: r(false_valid_rate),
    total: m.total,
    errors: m.errors,
  };
}

interface CostStats {
  mean_input_tokens: number;
  mean_output_tokens: number;
  mean_api_calls: number;
  mean_cost_usd: number;
  total_cost_usd: number;
  n: number;
}

function computeCostStats(
  results: Array<SystemResult | null>,
  pricing: { input_per_million: number; output_per_million: number },
): CostStats {
  const valid = results.filter((r): r is SystemResult => r != null && r.api_calls > 0);
  if (valid.length === 0) {
    return {
      mean_input_tokens: 0,
      mean_output_tokens: 0,
      mean_api_calls: 0,
      mean_cost_usd: 0,
      total_cost_usd: 0,
      n: 0,
    };
  }
  const totalInput = valid.reduce((s, r) => s + r.input_tokens, 0);
  const totalOutput = valid.reduce((s, r) => s + r.output_tokens, 0);
  const totalCalls = valid.reduce((s, r) => s + r.api_calls, 0);
  const totalCost =
    (totalInput / 1_000_000) * pricing.input_per_million +
    (totalOutput / 1_000_000) * pricing.output_per_million;
  return {
    mean_input_tokens: Math.round(totalInput / valid.length),
    mean_output_tokens: Math.round(totalOutput / valid.length),
    mean_api_calls: r(totalCalls / valid.length),
    mean_cost_usd: r(totalCost / valid.length),
    total_cost_usd: r(totalCost),
    n: valid.length,
  };
}

function r(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
function usd(n: number): string {
  if (n < 0.0001) return `$${(n * 1000).toFixed(4)}m`;
  return `$${n.toFixed(4)}`;
}
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
    if (arg === '--results' && next !== undefined) {
      resultsPath = next;
      i++;
    } else if (arg === '--output' && next !== undefined) {
      outputPath = next;
      i++;
    }
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

  // Support both new (tier2_pricing) and legacy (pricing) schema.
  const tier2Pricing = data.tier2_pricing ?? data.pricing ?? { input_per_million: 0.15, output_per_million: 0.60 };
  const tier3Pricing = data.tier3_pricing ?? null;
  const tier2Model = data.tier2_model ?? data.model ?? 'gpt-4o-mini';
  const tier3Model = data.tier3_model ?? null;
  // Cost stats use tier2Pricing only — Tier 3 usage is not tracked in TierOutput.usage.
  const pricing = tier2Pricing;
  const model = tier2Model;

  lines.push(`# HERALD Experiment Analysis`);
  lines.push('');
  lines.push(`**Run timestamp:** ${data.run_timestamp}`);
  lines.push(`**Git commit:** \`${data.git_commit}\``);
  lines.push(`**Eval set:** \`${data.eval_set_path}\``);
  lines.push(`**Systems run:** ${systems_run.join(', ')}`);
  lines.push(`**Total claims:** ${data.total_claims}`);
  lines.push(
    `**Tier 2 model:** ${tier2Model} (input: $${tier2Pricing.input_per_million}/1M, output: $${tier2Pricing.output_per_million}/1M)`,
  );
  if (tier3Model !== null && tier3Pricing !== null) {
    lines.push(
      `**Tier 3 model:** ${tier3Model} (input: $${tier3Pricing.input_per_million}/1M, output: $${tier3Pricing.output_per_million}/1M) — usage not tracked`,
    );
  }
  if (data.dry_run) lines.push(`**⚠ DRY RUN — mock verdicts only, token counts are zero**`);
  lines.push('');

  // -------------------------------------------------------------------------
  // 1. Overall accuracy
  // -------------------------------------------------------------------------
  lines.push('## 1. Overall Accuracy');
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

  // -------------------------------------------------------------------------
  // 2. Per claim type breakdown
  // -------------------------------------------------------------------------
  lines.push('## 2. Per Claim Type');
  lines.push('');

  const claimTypes = [...new Set(claims.map((c) => c.claim_type))].sort();

  for (const ct of claimTypes) {
    const subset = claims.filter((c) => c.claim_type === ct);
    const mxA = emptyMatrix();
    const mxB = emptyMatrix();
    const mxC = emptyMatrix();
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

    for (const [sysLabel, results] of [
      ['System A', claims.map((c) => c.system_a)],
      ['System C', claims.map((c) => c.system_c)],
    ] as Array<[string, Array<SystemResult | null>]>) {
      const hasSystem = sysLabel === 'System A' ? hasA : hasC;
      if (!hasSystem) continue;

      const tierCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
      let total = 0;
      for (const result of results) {
        if (result != null) {
          tierCounts[result.tier_reached] = (tierCounts[result.tier_reached] ?? 0) + 1;
          total++;
        }
      }

      lines.push(`**${sysLabel}** (${total} claims)`);
      lines.push('');
      lines.push('| Tier | Claims | % |');
      lines.push('|------|-------:|--:|');
      for (const tier of [1, 2, 3, 4]) {
        const count = tierCounts[tier] ?? 0;
        const tierPct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
        lines.push(`| Tier ${tier} | ${count} | ${tierPct}% |`);
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
    const latencies = claims
      .map(getter)
      .filter((result): result is SystemResult => result != null)
      .map((result) => result.latency_ms)
      .filter((ms) => ms > 0)
      .sort((a, b) => a - b);
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
  lines.push('## 5. Cost Analysis');
  lines.push('');
  lines.push(
    `*Tier 2 model: ${model}. Pricing: $${pricing.input_per_million}/1M input, $${pricing.output_per_million}/1M output.*`,
  );
  if (tier3Model !== null && tier3Pricing !== null) {
    lines.push(
      `*Tier 3 model: ${tier3Model} ($${tier3Pricing.input_per_million}/1M input, $${tier3Pricing.output_per_million}/1M output) — Tier 3 token usage is not tracked; cost stats reflect Tier 2 only.*`,
    );
  }
  lines.push('');

  const costA = hasA
    ? computeCostStats(
        claims.map((c) => c.system_a),
        pricing,
      )
    : null;
  const costB = hasB
    ? computeCostStats(
        claims.map((c) => c.system_b),
        pricing,
      )
    : null;
  const costC = hasC
    ? computeCostStats(
        claims.map((c) => c.system_c),
        pricing,
      )
    : null;

  lines.push('### 5.1 Token Usage per Claim (mean)');
  lines.push('');
  lines.push(
    '| System | Mean Input Tokens | Mean Output Tokens | Mean API Calls | Mean Cost/Claim |',
  );
  lines.push(
    '|--------|------------------:|-------------------:|---------------:|----------------:|',
  );

  for (const [label, cost] of [
    ['System A (HERALD)', costA],
    ['System B (Tier 2 only)', costB],
    ['System C (No NLI)', costC],
  ] as Array<[string, CostStats | null]>) {
    if (cost == null || cost.n === 0) continue;
    lines.push(
      `| ${label} | ${cost.mean_input_tokens} | ${cost.mean_output_tokens} | ${cost.mean_api_calls.toFixed(1)} | ${usd(cost.mean_cost_usd)} |`,
    );
  }
  lines.push('');

  // Cost breakdown by claim type
  lines.push('### 5.2 Cost per Claim by Type');
  lines.push('');
  lines.push(
    '| Claim Type | System A Cost/Claim | System B Cost/Claim | System A API Calls | System B API Calls |',
  );
  lines.push(
    '|------------|:-------------------:|:-------------------:|:-----------------:|:-----------------:|',
  );

  for (const ct of claimTypes) {
    const subset = claims.filter((c) => c.claim_type === ct);
    const ctCostA = hasA
      ? computeCostStats(
          subset.map((c) => c.system_a),
          pricing,
        )
      : null;
    const ctCostB = hasB
      ? computeCostStats(
          subset.map((c) => c.system_b),
          pricing,
        )
      : null;
    lines.push(
      `| ${ct} | ${ctCostA != null && ctCostA.n > 0 ? usd(ctCostA.mean_cost_usd) : '—'} | ${ctCostB != null && ctCostB.n > 0 ? usd(ctCostB.mean_cost_usd) : '—'} | ${ctCostA != null && ctCostA.n > 0 ? ctCostA.mean_api_calls.toFixed(1) : '—'} | ${ctCostB != null && ctCostB.n > 0 ? ctCostB.mean_api_calls.toFixed(1) : '—'} |`,
    );
  }
  lines.push('');

  // Accuracy per dollar
  lines.push('### 5.3 Accuracy per Dollar (F1 / mean cost per claim)');
  lines.push('');
  lines.push('*Higher is better. Measures how much accuracy each dollar buys.*');
  lines.push('');
  lines.push('| System | F1 | Mean Cost/Claim | F1 per Dollar |');
  lines.push('|--------|:--:|----------------:|--------------:|');

  for (const [label, metrics, cost] of [
    ['System A (HERALD)', mA, costA],
    ['System B (Tier 2 only)', mB, costB],
    ['System C (No NLI)', mC, costC],
  ] as Array<[string, Metrics | null, CostStats | null]>) {
    if (metrics == null || cost == null || cost.mean_cost_usd === 0) continue;
    const f1PerDollar = metrics.f1 / cost.mean_cost_usd;
    lines.push(
      `| ${label} | ${pct(metrics.f1)} | ${usd(cost.mean_cost_usd)} | ${f1PerDollar.toFixed(1)} |`,
    );
  }
  lines.push('');

  // At-scale projection
  lines.push('### 5.4 Cost at Scale (1,000 claims/day)');
  lines.push('');
  lines.push('| System | Daily Cost | Monthly Cost (30d) |');
  lines.push('|--------|:----------:|:-----------------:|');

  for (const [label, cost] of [
    ['System A (HERALD)', costA],
    ['System B (Tier 2 only)', costB],
    ['System C (No NLI)', costC],
  ] as Array<[string, CostStats | null]>) {
    if (cost == null || cost.n === 0) continue;
    const dailyCost = cost.mean_cost_usd * 1000;
    const monthlyCost = dailyCost * 30;
    lines.push(`| ${label} | $${dailyCost.toFixed(2)} | $${monthlyCost.toFixed(2)} |`);
  }
  lines.push('');

  // Decision criteria
  if (mA != null && mB != null && costA != null && costB != null) {
    const f1Delta = mA.f1 - mB.f1;
    const costDelta = costA.mean_cost_usd - costB.mean_cost_usd;
    const f1PerDollarA = costA.mean_cost_usd > 0 ? mA.f1 / costA.mean_cost_usd : 0;
    const f1PerDollarB = costB.mean_cost_usd > 0 ? mB.f1 / costB.mean_cost_usd : 0;

    lines.push('### 5.5 Decision: Cost-Performance Verdict');
    lines.push('');
    lines.push(`- **F1 delta (A − B):** ${pct(f1Delta)}`);
    lines.push(
      `- **Cost delta (A − B):** ${usd(costDelta)} per claim (${costDelta > 0 ? 'HERALD costs more' : 'HERALD costs less'})`,
    );
    lines.push(
      `- **F1/$ System A:** ${f1PerDollarA.toFixed(1)} vs System B: ${f1PerDollarB.toFixed(1)}`,
    );
    lines.push('');

    if (f1Delta >= 0.03 && f1PerDollarA >= f1PerDollarB) {
      lines.push(
        `✅ **HERALD wins on both axes** — higher accuracy (+${pct(f1Delta)}) AND better accuracy-per-dollar.`,
      );
    } else if (f1Delta >= 0.03 && f1PerDollarA < f1PerDollarB) {
      lines.push(
        `⚠️ **HERALD wins on accuracy but not on cost-efficiency** — F1 is +${pct(f1Delta)} higher but costs ${pct(costDelta / (costB.mean_cost_usd || 1))} more per claim. Worthwhile only if accuracy gains are critical.`,
      );
    } else if (f1Delta > 0 && f1PerDollarA >= f1PerDollarB) {
      lines.push(
        `⚠️ **HERALD marginal** — small F1 gain (+${pct(f1Delta)}) but better accuracy-per-dollar. Lean toward HERALD for high-volume or cost-sensitive deployments.`,
      );
    } else if (f1Delta <= 0) {
      lines.push(
        `❌ **LLM-as-Judge wins** — HERALD achieves no accuracy gain (F1 delta: ${pct(f1Delta)}) while costing ${usd(Math.abs(costDelta))} more per claim.`,
      );
    } else {
      lines.push(
        `❌ **LLM-as-Judge wins on cost-efficiency** — HERALD F1 gain (+${pct(f1Delta)}) does not compensate for higher cost. Use Tier 2-only baseline.`,
      );
    }
    lines.push('');

    if (mA != null && mC != null) {
      const nliDelta = mA.f1 - mC.f1;
      lines.push('### Does Tier 1 NLI contribute accuracy?');
      lines.push('');
      if (Math.abs(nliDelta) < 0.02) {
        lines.push(
          `⚠️ **Marginal** — F1(A) ≈ F1(C) (delta: ${pct(nliDelta)}). NLI adds infrastructure cost without clear accuracy gain.`,
        );
      } else if (nliDelta > 0) {
        lines.push(`✅ **Yes** — F1(A) > F1(C) by ${pct(nliDelta)}`);
      } else {
        lines.push(`❌ **NLI is hurting accuracy** — F1(A) < F1(C) by ${pct(Math.abs(nliDelta))}`);
      }
      lines.push('');
    }
  }

  // -------------------------------------------------------------------------
  // 6. Agreement matrix (A vs B)
  // -------------------------------------------------------------------------
  if (hasA && hasB) {
    lines.push('## 6. Agreement: System A vs System B');
    lines.push('');

    let agree = 0,
      disagree = 0;
    const disagreements: Array<{
      claim_id: string;
      claim_type: string;
      gt: Verdict;
      a: Verdict;
      b: Verdict;
    }> = [];

    for (const c of claims) {
      if (c.system_a == null || c.system_b == null) continue;
      if (c.system_a.verdict === c.system_b.verdict) {
        agree++;
      } else {
        disagree++;
        disagreements.push({
          claim_id: c.claim_id,
          claim_type: c.claim_type,
          gt: c.ground_truth,
          a: c.system_a.verdict,
          b: c.system_b.verdict,
        });
      }
    }

    const total = agree + disagree;
    lines.push(
      `Agreement rate: **${pct(total > 0 ? agree / total : 0)}** (${agree}/${total} claims)`,
    );
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

    const wrong = claims.filter((c) => {
      const result = getter(c);
      return result != null && result.verdict !== c.ground_truth;
    });
    lines.push(`### ${sysLabel} — ${wrong.length} wrong`);
    lines.push('');

    if (wrong.length === 0) {
      lines.push('No wrong claims.');
    } else {
      lines.push('| Claim | Type | Derivation | GT | Predicted | Error Type |');
      lines.push('|-------|------|------------|:--:|:---------:|:----------:|');
      for (const c of wrong) {
        const result = getter(c)!;
        const errorType =
          c.ground_truth === 'valid' && result.verdict === 'invalid'
            ? 'False Invalid'
            : 'False Valid';
        lines.push(
          `| ${c.claim_id} | ${c.claim_type} | ${c.derivation} | ${c.ground_truth} | ${result.verdict} | ${errorType} |`,
        );
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
  if (!fs.existsSync(abs)) {
    console.error(`[ERROR] Results file not found: ${abs}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(abs, 'utf-8')) as ExperimentOutput;
  const report = buildReport(data);

  fs.mkdirSync(path.resolve(path.dirname(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), report);

  console.log(`Analysis written to: ${outputPath}`);

  // Quick summary to stdout (Tier 2 pricing only — Tier 3 usage not tracked)
  const pricing = data.tier2_pricing ?? data.pricing ?? { input_per_million: 0.15, output_per_million: 0.60 };
  const claims = data.per_claim_results;
  for (const [label, getter] of [
    ['System A (HERALD)', (c: PerClaimResult) => c.system_a],
    ['System B (Tier 2 only)', (c: PerClaimResult) => c.system_b],
    ['System C (No NLI)', (c: PerClaimResult) => c.system_c],
  ] as Array<[string, (c: PerClaimResult) => SystemResult | null]>) {
    const m = emptyMatrix();
    for (const c of claims) {
      const result = getter(c);
      if (result != null) updateMatrix(m, c.ground_truth, result.verdict);
    }
    if (m.total === 0) continue;
    const metrics = computeMetrics(m);
    const cost = computeCostStats(claims.map(getter), pricing);
    const f1PerDollar =
      cost.mean_cost_usd > 0 ? (metrics.f1 / cost.mean_cost_usd).toFixed(1) : 'N/A (dry run)';
    console.log(
      `${label}: Acc=${pct(metrics.accuracy)} F1=${pct(metrics.f1)} Cost/claim=${usd(cost.mean_cost_usd)} F1/$=${f1PerDollar}`,
    );
  }
}

main();
