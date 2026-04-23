/**
 * t2-threshold-sweep.ts — T2 (gpt-4o-mini) confidence threshold calibration
 *
 * Strategy:
 *   1. Load all eval sets + the existing comprehensive results (to know T1 exit claims
 *      and to get existing T3 verdicts as the "T3 fallback" for each claim).
 *   2. For every claim that didn't exit at T1, call T2 (mini) and capture the raw
 *      confidence BEFORE any threshold is applied.
 *   3. Sweep thresholds from 0.50 to 0.95 in 0.05 steps.
 *      At each threshold: if T2 confidence ≥ threshold → use T2 verdict;
 *                         else → use the T3 verdict from existing results.
 *   4. Report accuracy, T2 exit rate, and cost at each threshold per eval set.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/t2-threshold-sweep.ts
 *
 * Output:
 *   results/t2-threshold-sweep-<timestamp>.json
 */

import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';

import { evaluateWithNLI } from '../src/herald/tier1-nli';
import { getJudgePrompt } from '../src/herald/prompts/judge-system';
import { DERIVATION_CONFIG, DerivationMethod, type NotesLogEntry } from '../src/types/claims';
import type { Verdict } from '../src/types/herald';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JUDGE_MODEL = 'gpt-4o-mini';
const JUDGE_TEMPERATURE = 0.2;
const JUDGE_MAX_TOKENS = 1024;
const THRESHOLDS = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95];

const EVAL_SETS = [
  { key: '1', path: 'data/eval-set.json', label: 'eval-set-1' },
  { key: '2', path: 'data/eval-set-2.json', label: 'eval-set-2' },
  { key: '3', path: 'data/eval-set-3.json', label: 'eval-set-3' },
  { key: 'human', path: 'data/human-eval-set-2.json', label: 'human-eval-2' },
];

const EXISTING_RESULTS_PATH = 'results/comprehensive-eval-2026-04-23.json';

// T3 haiku cost per claim (approximate from the existing results)
const T3_COST_PER_CLAIM = 0.005; // haiku with longer context
const T2_MINI_COST_PER_1K_INPUT = 0.00015;
const T2_MINI_COST_PER_1K_OUTPUT = 0.0006;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvalEntry extends NotesLogEntry {
  ground_truth_verdict: Verdict;
  ground_truth_rationale: string;
}

interface RawT2Result {
  claim_id: string;
  t2_verdict: Verdict;
  t2_confidence: number;
  t2_reasoning: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

interface ExistingClaimResult {
  claim_id: string;
  tier_reached: number;
  predicted: Verdict;
  correct: boolean;
  confidence: number;
  ground_truth: Verdict;
}

interface ThresholdResult {
  threshold: number;
  t2_exit_count: number;
  t2_exit_pct: number;
  t3_fallback_count: number;
  correct: number;
  accuracy: number;
  t2_correct: number;
  t2_accuracy: number;
  t3_correct: number;
  t3_accuracy: number;
  avg_cost_per_claim: number;
  total_cost: number;
}

// ---------------------------------------------------------------------------
// OpenAI client
// ---------------------------------------------------------------------------

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (_client === null) {
    _client = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Raw T2 call (bypasses threshold — just get the model's confidence)
// ---------------------------------------------------------------------------

const SUBMIT_FUNCTION: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'submit_evaluation',
    description: 'Submit the structured claim evaluation result.',
    parameters: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['valid', 'invalid', 'uncertain'] },
        confidence: { type: 'number' },
        reasoning: { type: 'string' },
        suggested_revision: { type: ['string', 'null'] },
        meaning_drift_label: {
          type: ['string', 'null'],
          enum: ['no_drift', 'hedging_drift', 'scope_drift', 'attribution_drift',
                 'causal_strength_drift', 'normative_strength_drift', 'quantification_drift', null],
        },
      },
      required: ['verdict', 'confidence', 'reasoning'],
    },
  },
};

function buildUserMessage(claim: NotesLogEntry): string {
  const derivationConfig = DERIVATION_CONFIG[claim.derivation];
  const riskLabel = `${derivationConfig.riskLevel} risk`;
  const lines: string[] = [
    '## Claim to Evaluate', '',
    `**Claim ID**: ${claim.claim_id}`,
    `**Claim type**: ${claim.claim_type}`,
    `**Derivation method**: ${claim.derivation} (${riskLabel})`,
    `**Claim text**: "${claim.claim_text}"`,
    '', '## Cited Sources', '',
  ];
  for (const [i, src] of claim.sources.entries()) {
    lines.push(`### Source ${String(i + 1)}: ${src.source_title} (${src.source_id})`);
    lines.push(`URL: ${src.source_url}`);
    lines.push('Relevant excerpt:\n```');
    lines.push(src.relevant_chunk);
    lines.push('```\n');
  }
  lines.push('## Agent Reasoning', '', claim.reasoning, '');
  if (claim.derivation === DerivationMethod.Paraphrase) {
    lines.push(
      '## Paraphrase Fidelity Checklist', '',
      'This is a paraphrase claim. Compare proposition, scope, timeframe, attribution, modality, and causal strength.',
      'If those elements are preserved, prefer `valid` over `invalid`.',
      '',
    );
  }
  lines.push('Call `submit_evaluation` with your assessment.');
  return lines.join('\n');
}

function parseRawVerdict(raw: string): Verdict {
  if (raw === 'valid' || raw === 'invalid' || raw === 'uncertain') return raw;
  if (raw === 'needs_revision') return 'invalid';
  return 'uncertain';
}

async function callT2Raw(claim: NotesLogEntry): Promise<RawT2Result> {
  const systemPrompt = getJudgePrompt(claim.claim_type);
  const userMessage = buildUserMessage(claim);

  const response = await getClient().chat.completions.create({
    model: JUDGE_MODEL,
    temperature: JUDGE_TEMPERATURE,
    max_tokens: JUDGE_MAX_TOKENS,
    tools: [SUBMIT_FUNCTION],
    tool_choice: { type: 'function', function: { name: 'submit_evaluation' } },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });

  const inputTokens = response.usage?.prompt_tokens ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;
  const costUsd =
    (inputTokens / 1000) * T2_MINI_COST_PER_1K_INPUT +
    (outputTokens / 1000) * T2_MINI_COST_PER_1K_OUTPUT;

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (toolCall == null) {
    throw new Error(`T2 did not call submit_evaluation for ${claim.claim_id}`);
  }

  if (toolCall.type !== 'function') {
    throw new Error(`T2 tool call is not a function for ${claim.claim_id}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
  } catch {
    throw new Error(`T2 JSON parse failed for ${claim.claim_id}: ${toolCall.function.arguments.slice(0, 200)}`);
  }

  if (typeof parsed['verdict'] !== 'string' || typeof parsed['confidence'] !== 'number') {
    throw new Error(`T2 missing verdict/confidence for ${claim.claim_id}: ${JSON.stringify(parsed)}`);
  }

  return {
    claim_id: claim.claim_id,
    t2_verdict: parseRawVerdict(parsed['verdict'] as string),
    t2_confidence: Math.max(0, Math.min(1, parsed['confidence'] as number)),
    t2_reasoning: typeof parsed['reasoning'] === 'string' ? (parsed['reasoning'] as string) : '',
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costUsd,
  };
}

// ---------------------------------------------------------------------------
// Load existing results — extract T1-exited and T3 verdict per claim
// ---------------------------------------------------------------------------

function loadExistingResults(): Map<string, ExistingClaimResult> {
  const raw = fs.readFileSync(EXISTING_RESULTS_PATH, 'utf-8');
  const data = JSON.parse(raw) as {
    eval_results: Array<{
      system: string;
      per_claim: Array<{
        claim_id: string;
        tier_reached: number;
        predicted: Verdict;
        correct: boolean;
        confidence: number;
        ground_truth: Verdict;
      }>;
    }>;
  };

  const map = new Map<string, ExistingClaimResult>();
  for (const run of data.eval_results) {
    if (run.system !== 'herald') continue;
    for (const c of run.per_claim) {
      // Keep the latest entry if claim appears in multiple sets
      map.set(c.claim_id, {
        claim_id: c.claim_id,
        tier_reached: c.tier_reached,
        predicted: c.predicted,
        correct: c.correct,
        confidence: c.confidence,
        ground_truth: c.ground_truth,
      });
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Threshold simulation
// ---------------------------------------------------------------------------

function simulateThreshold(
  rawT2Results: RawT2Result[],
  existingByClaimId: Map<string, ExistingClaimResult>,
  t2CostTotal: number,
  nT1Exits: number,
  nTotal: number,
  threshold: number,
): ThresholdResult {
  let t2ExitCount = 0;
  let t2Correct = 0;
  let t3FallbackCount = 0;
  let t3Correct = 0;
  let t2Cost = 0;
  let t3Cost = 0;

  for (const r of rawT2Results) {
    const existing = existingByClaimId.get(r.claim_id);
    if (existing == null) continue;

    const gt = existing.ground_truth;
    t2Cost += r.cost_usd;

    if (r.t2_confidence >= threshold) {
      // T2 exits
      t2ExitCount++;
      if (r.t2_verdict === gt) t2Correct++;
    } else {
      // Falls through to T3
      t3FallbackCount++;
      t3Cost += T3_COST_PER_CLAIM;
      if (existing.tier_reached === 3 && existing.correct) t3Correct++;
      else if (existing.tier_reached === 3 && !existing.correct) {
        // wrong
      } else if (existing.tier_reached === 2) {
        // This claim originally exited at T2 (high threshold). At a lower threshold
        // it would still exit at T2, so we track it there. But if we're simulating
        // a threshold where it falls through, use the T2 verdict we got.
        // Actually: if original tier was 2, it had confidence ≥ 0.90 in the original run,
        // meaning it will also exit at any threshold ≤ 0.90. So this case shouldn't arise
        // at thresholds ≤ 0.90. At threshold > 0.90, these might fall through.
        // Use the existing T2 result as a T2 exit (it would have exited earlier).
        t3FallbackCount--;
        t2ExitCount++;
        t3Cost -= T3_COST_PER_CLAIM;
        if (existing.correct) t2Correct++;
      }
    }
  }

  const totalEvaluated = t2ExitCount + t3FallbackCount;
  const totalCorrect = t2Correct + t3Correct;
  // T1 exits are always correct (same as in the existing eval) — add them back
  const t1Correct = nT1Exits; // T1 exits had ~100% accuracy on these sets
  const totalWithT1 = totalCorrect + t1Correct;
  const totalCost = t2Cost + t3Cost;

  return {
    threshold,
    t2_exit_count: t2ExitCount,
    t2_exit_pct: totalEvaluated > 0 ? t2ExitCount / totalEvaluated : 0,
    t3_fallback_count: t3FallbackCount,
    correct: totalWithT1,
    accuracy: nTotal > 0 ? totalWithT1 / nTotal : 0,
    t2_correct: t2Correct,
    t2_accuracy: t2ExitCount > 0 ? t2Correct / t2ExitCount : 0,
    t3_correct: t3Correct,
    t3_accuracy: t3FallbackCount > 0 ? t3Correct / t3FallbackCount : 0,
    avg_cost_per_claim: nTotal > 0 ? totalCost / nTotal : 0,
    total_cost: totalCost,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Loading existing results...');
  const existingByClaimId = loadExistingResults();

  const timestamp = new Date().toISOString();
  const allSetResults: Record<string, {
    label: string;
    n_total: number;
    n_t1_exits: number;
    n_non_t1: number;
    raw_t2_results: RawT2Result[];
    threshold_sweep: ThresholdResult[];
  }> = {};

  for (const evalSet of EVAL_SETS) {
    console.log(`\n=== Processing ${evalSet.label} ===`);

    const raw = fs.readFileSync(evalSet.path, 'utf-8');
    const claims = JSON.parse(raw) as EvalEntry[];

    // Identify T1-exited claims
    const t1ExitIds = new Set<string>();
    let t1CorrectCount = 0;
    for (const claim of claims) {
      const existing = existingByClaimId.get(claim.claim_id);
      if (existing?.tier_reached === 1) {
        t1ExitIds.add(claim.claim_id);
        if (existing.correct) t1CorrectCount++;
      }
    }

    const nonT1Claims = claims.filter((c) => !t1ExitIds.has(c.claim_id));
    console.log(`  T1 exits: ${t1ExitIds.size}/${claims.length}, running T2 on ${nonT1Claims.length} claims...`);

    // Run T2 on all non-T1 claims
    const rawT2Results: RawT2Result[] = [];
    let processed = 0;

    for (const claim of nonT1Claims) {
      try {
        process.stdout.write(`\r  T2 raw: ${String(++processed)}/${String(nonT1Claims.length)} (${claim.claim_id})`);
        const result = await callT2Raw(claim);
        rawT2Results.push(result);
        // Small delay to avoid rate limits
        await new Promise((r) => setTimeout(r, 100));
      } catch (err) {
        console.error(`\n  ERROR on ${claim.claim_id}:`, err instanceof Error ? err.message : String(err));
      }
    }
    console.log('');

    // Print confidence distribution
    const confidences = rawT2Results.map((r) => r.t2_confidence).sort((a, b) => a - b);
    console.log(`  T2 confidence distribution:`);
    const bins = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.01];
    for (let i = 0; i < bins.length - 1; i++) {
      const lo = bins[i]!;
      const hi = bins[i + 1]!;
      const count = confidences.filter((c) => c >= lo && c < hi).length;
      const bar = '█'.repeat(count);
      console.log(`    [${lo.toFixed(2)}–${hi.toFixed(2)}): ${String(count).padStart(3)} ${bar}`);
    }

    // Sweep thresholds
    const t2CostTotal = rawT2Results.reduce((s, r) => s + r.cost_usd, 0);
    const sweepResults = THRESHOLDS.map((t) =>
      simulateThreshold(rawT2Results, existingByClaimId, t2CostTotal, t1CorrectCount, claims.length, t),
    );

    console.log(`\n  Threshold sweep results:`);
    console.log(`  ${'Threshold'.padEnd(10)} ${'T2 exit%'.padEnd(10)} ${'Accuracy'.padEnd(10)} ${'Cost/claim'.padEnd(12)} T2acc   T3acc`);
    for (const r of sweepResults) {
      const marker = r.threshold === 0.90 ? ' ← current' : '';
      console.log(
        `  ${r.threshold.toFixed(2).padEnd(10)} ` +
        `${(r.t2_exit_pct * 100).toFixed(1).padEnd(10)} ` +
        `${(r.accuracy * 100).toFixed(1).padEnd(10)} ` +
        `$${r.avg_cost_per_claim.toFixed(5).padEnd(12)} ` +
        `${(r.t2_accuracy * 100).toFixed(1).padEnd(8)} ` +
        `${(r.t3_accuracy * 100).toFixed(1)}${marker}`,
      );
    }

    allSetResults[evalSet.key] = {
      label: evalSet.label,
      n_total: claims.length,
      n_t1_exits: t1ExitIds.size,
      n_non_t1: nonT1Claims.length,
      raw_t2_results: rawT2Results,
      threshold_sweep: sweepResults,
    };
  }

  // Write output
  const outPath = path.join('results', `t2-threshold-sweep-${timestamp.replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync('results', { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ run_timestamp: timestamp, sets: allSetResults }, null, 2));
  console.log(`\nResults written to ${outPath}`);

  // Cross-set summary
  console.log('\n\n=== CROSS-SET SUMMARY: Best threshold per set ===');
  for (const [key, setResult] of Object.entries(allSetResults)) {
    const best = setResult.threshold_sweep.reduce((prev, cur) =>
      cur.accuracy > prev.accuracy ? cur : prev,
    );
    const current = setResult.threshold_sweep.find((r) => r.threshold === 0.90)!;
    console.log(`\n${setResult.label}:`);
    console.log(`  Current (0.90): ${(current.accuracy * 100).toFixed(1)}% accuracy, $${current.avg_cost_per_claim.toFixed(5)}/claim, ${(current.t2_exit_pct * 100).toFixed(1)}% T2 exit`);
    console.log(`  Best (${best.threshold.toFixed(2)}):    ${(best.accuracy * 100).toFixed(1)}% accuracy, $${best.avg_cost_per_claim.toFixed(5)}/claim, ${(best.t2_exit_pct * 100).toFixed(1)}% T2 exit`);
  }
}

main().catch((err: unknown) => {
  console.error('Fatal:', err);
  process.exit(1);
});
