/**
 * run-comprehensive-eval.ts — Holistic HERALD Evaluation Suite
 *
 * Tests every measurable dimension of the HERALD system:
 *   1. Accuracy across all 4 eval sets (cross-set generalization)
 *   2. HERALD vs LLM-only-judge baseline (marginal value of multi-tier)
 *   3. Per-claim-type and per-derivation breakdowns
 *   4. Confidence calibration (stated confidence vs actual accuracy)
 *   5. Tier distribution and cost-per-claim estimates
 *   6. Variance / stochasticity (repeat runs on eval-set-3)
 *   7. False-positive vs false-negative asymmetry (F2 score)
 *   8. Error pattern taxonomy
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/run-comprehensive-eval.ts
 *
 * Flags:
 *   --concurrency <n>    Parallel evaluations (default: 2)
 *   --variance-reps <n>  Repeat runs for variance test (default: 2, set 0 to skip)
 *   --skip-herald        Skip HERALD; only run LLM baseline (faster / cheaper)
 *   --skip-baseline      Skip LLM baseline; only run HERALD
 *   --eval-sets <list>   Comma-separated: 1,2,3,human (default: all)
 *   --output <path>      Output JSON path (default: results/comprehensive-eval-YYYY-MM-DD.json)
 */

import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

import { ClaimType, type NotesLogEntry } from '../src/types/claims';
import type { HeraldResult, Verdict } from '../src/types/herald';
import { evaluateClaim } from '../src/herald/router';
import { getJudgePrompt } from '../src/herald/prompts/judge-system';

// ─── Model pricing (USD per token, 2025 list price) ──────────────────────
const MINI_INPUT_COST_PER_TOKEN = 0.15 / 1_000_000;
const MINI_OUTPUT_COST_PER_TOKEN = 0.60 / 1_000_000;
const HAIKU_INPUT_COST_PER_TOKEN = 0.80 / 1_000_000;
const HAIKU_OUTPUT_COST_PER_TOKEN = 4.00 / 1_000_000;

// ─── Eval set registry ─────────────────────────────────────────────────────
const EVAL_SETS: Record<string, { path: string; label: string; notes: string }> = {
  '1': {
    path: 'data/eval-set.json',
    label: 'eval-set-1 (primary)',
    notes: 'Original 50-claim set. Used for iterative prompt tuning — may be overfit.',
  },
  '2': {
    path: 'data/eval-set-2.json',
    label: 'eval-set-2 (tuned)',
    notes: '53 claims. Prompts were adjusted while observing failures on this set — contaminated.',
  },
  '3': {
    path: 'data/eval-set-3.json',
    label: 'eval-set-3 (holdout)',
    notes: '50 claims. First run on fresh data after eval-set-2 tuning — closest to honest holdout.',
  },
  human: {
    path: 'data/human-eval-set-2.json',
    label: 'human-eval-set-2 (independent)',
    notes: '53 claims. Same topic domain as eval-set-2 but with independently reviewed labels.',
  },
};

// ─── Types ─────────────────────────────────────────────────────────────────

interface EvalEntry extends NotesLogEntry {
  ground_truth_verdict: Verdict;
  ground_truth_rationale: string;
}

interface ClaimResult {
  claim_id: string;
  claim_type: string;
  derivation: string;
  ground_truth: Verdict;
  predicted: Verdict;
  correct: boolean;
  confidence: number;
  tier_reached: number;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  error?: string;
}

type SystemName = 'herald' | 'llm_only' | 'llm_only_strong';

interface EvalSetResult {
  eval_set_key: string;
  label: string;
  notes: string;
  n_claims: number;
  run_timestamp: string;
  system: SystemName;
  per_claim: ClaimResult[];
  metrics: AggregatedMetrics;
}

interface AggregatedMetrics {
  accuracy: number;
  precision: number;         // valid = positive class
  recall: number;
  f1: number;
  f2: number;                // recall-weighted: FN cost > FP cost in policy context
  false_positive_rate: number; // valid claims marked invalid (over-flagging)
  false_negative_rate: number; // invalid claims marked valid (under-flagging)
  skeptic_false_invalid_rate: number;
  avg_confidence: number;
  calibration_error: number; // mean |confidence - accuracy| across bins
  tier_distribution: Record<string, number>;
  total_cost_usd: number;
  avg_cost_per_claim_usd: number;
  avg_latency_ms: number;
  by_claim_type: Record<string, TypeMetrics>;
  by_derivation: Record<string, TypeMetrics>;
  confidence_bins: CalibrationBin[];
  error_pattern_counts: Record<string, number>;
}

interface TypeMetrics {
  total: number;
  correct: number;
  accuracy: number;
  false_positive_rate: number;
  false_negative_rate: number;
  f1: number;
}

interface CalibrationBin {
  bin_label: string;        // e.g. "0.80–0.90"
  confidence_low: number;
  confidence_high: number;
  n_claims: number;
  accuracy: number;
  avg_confidence: number;
}

interface VarianceResult {
  eval_set_key: string;
  system: SystemName;
  n_reps: number;
  per_rep_accuracy: number[];
  mean_accuracy: number;
  std_accuracy: number;
  flip_rate: number;         // fraction of claims that changed verdict across reps
}

interface ComprehensiveReport {
  run_timestamp: string;
  config: {
    concurrency: number;
    variance_reps: number;
    eval_sets_run: string[];
  };
  nli_backend_available: boolean;
  eval_results: EvalSetResult[];
  baseline_comparisons: BaselineComparison[];
  variance_results: VarianceResult[];
  cross_set_summary: CrossSetSummary;
}

interface BaselineComparison {
  eval_set_key: string;
  herald_accuracy: number;
  llm_only_accuracy: number;
  llm_only_strong_accuracy: number;
  delta_pp: number;           // HERALD vs llm_only, percentage-point
  herald_f2: number;
  llm_only_f2: number;
  llm_only_strong_f2: number;
  herald_false_negative_rate: number;
  llm_only_false_negative_rate: number;
  llm_only_strong_false_negative_rate: number;
  herald_avg_cost_usd: number;
  llm_only_avg_cost_usd: number;
  llm_only_strong_avg_cost_usd: number;
  herald_tier_distribution: Record<string, number>;
}

interface CrossSetSummary {
  herald_accuracies: Record<string, number>;
  llm_only_accuracies: Record<string, number>;
  llm_only_strong_accuracies: Record<string, number>;
  honest_holdout_accuracy: number | null;   // eval-set-3
  contaminated_accuracy: number | null;     // eval-set-2 (tuned on it)
  accuracy_gap_pp: number | null;           // contaminated - holdout
}

// ─── CLI Parsing ───────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2);
  let concurrency = 2;
  let varianceReps = 2;
  let skipHerald = false;
  let skipBaseline = false;
  let skipStrongBaseline = false;
  let evalSetsToRun = Object.keys(EVAL_SETS);
  let outputPath: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const n = argv[i + 1];
    if (a === '--concurrency' && n) { concurrency = parseInt(n, 10); i++; }
    else if (a === '--variance-reps' && n) { varianceReps = parseInt(n, 10); i++; }
    else if (a === '--skip-herald') skipHerald = true;
    else if (a === '--skip-baseline') skipBaseline = true;
    else if (a === '--skip-strong-baseline') skipStrongBaseline = true;
    else if (a === '--eval-sets' && n) { evalSetsToRun = n.split(',').map(s => s.trim()); i++; }
    else if (a === '--output' && n) { outputPath = n; i++; }
  }

  if (outputPath === null) {
    const date = new Date().toISOString().slice(0, 10);
    outputPath = `results/comprehensive-eval-${date}.json`;
  }

  return { concurrency, varianceReps, skipHerald, skipBaseline, skipStrongBaseline, evalSetsToRun, outputPath };
}

// ─── Eval set loader ───────────────────────────────────────────────────────

function loadEvalSet(filePath: string): EvalEntry[] {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`Eval set not found: ${abs}`);
  const raw = JSON.parse(fs.readFileSync(abs, 'utf-8')) as unknown[];
  return raw as EvalEntry[];
}

// ─── NLI backend probe ─────────────────────────────────────────────────────

async function checkNLIBackend(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:8000/health', { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── OpenAI client (lazy) ──────────────────────────────────────────────────

let _oai: OpenAI | null = null;
function getOAI(): OpenAI {
  if (_oai === null)
    _oai = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });
  return _oai;
}

// ─── LLM-only baseline ─────────────────────────────────────────────────────

// LLM-only baseline uses the identical per-type criteria prompt as HERALD Tier 2,
// ensuring the comparison isolates architecture value (NLI + escalation) from prompt quality.
function getLLMOnlySystem(claimType: ClaimType): string {
  // getJudgePrompt references submit_evaluation — rewrite the tool name to match submit_verdict.
  return getJudgePrompt(claimType).replace(/submit_evaluation/g, 'submit_verdict');
}

const LLM_ONLY_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'submit_verdict',
    description: 'Submit the claim verification result.',
    parameters: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['valid', 'invalid'], description: 'Your verdict.' },
        confidence: { type: 'number', description: 'Confidence from 0.0 to 1.0.' },
        reasoning: { type: 'string', description: 'Brief reasoning citing the source.' },
      },
      required: ['verdict', 'confidence', 'reasoning'],
    },
  },
};

async function llmOnlyEvaluate(
  entry: EvalEntry,
): Promise<{ verdict: Verdict; confidence: number; reasoning: string; input_tokens: number; output_tokens: number }> {
  const sourceBlock = entry.sources.map((s, i) =>
    `### Source ${i + 1}: ${s.source_title}\n\`\`\`\n${s.relevant_chunk}\n\`\`\``
  ).join('\n\n');

  const userMsg = `## Claim\n"${entry.claim_text}"\n\nClaim type: ${entry.claim_type}\nDerivation: ${entry.derivation}\n\n## Sources\n${sourceBlock}\n\n## Agent Reasoning\n${entry.reasoning}\n\nPlease evaluate and call submit_verdict.`;

  const res = await getOAI().chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 512,
    tools: [LLM_ONLY_TOOL],
    tool_choice: { type: 'function', function: { name: 'submit_verdict' } },
    messages: [
      { role: 'system', content: getLLMOnlySystem(entry.claim_type as ClaimType) },
      { role: 'user', content: userMsg },
    ],
  });

  const toolCall = res.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.type !== 'function') {
    throw new Error('LLM baseline: no tool call returned');
  }
  const parsed = JSON.parse(toolCall.function.arguments) as { verdict: string; confidence: number; reasoning: string };
  const verdict: Verdict = parsed.verdict === 'valid' ? 'valid' : 'invalid';
  return {
    verdict,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
    input_tokens: res.usage?.prompt_tokens ?? 0,
    output_tokens: res.usage?.completion_tokens ?? 0,
  };
}

// ─── Anthropic client (lazy) ───────────────────────────────────────────────

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (_anthropic === null)
    _anthropic = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });
  return _anthropic;
}

// ─── LLM-only-strong baseline (claude-haiku-4-5) ─────────────────────────

const LLM_STRONG_VERDICT_TOOL: Anthropic.Tool = {
  name: 'submit_verdict',
  description: 'Submit the claim verification result.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['valid', 'invalid'], description: 'Your verdict.' },
      confidence: { type: 'number', description: 'Confidence from 0.0 to 1.0.' },
      reasoning: { type: 'string', description: 'Brief reasoning citing the source.' },
    },
    required: ['verdict', 'confidence', 'reasoning'],
  },
};

async function llmOnlyStrongEvaluate(
  entry: EvalEntry,
): Promise<{ verdict: Verdict; confidence: number; reasoning: string; input_tokens: number; output_tokens: number }> {
  const sourceBlock = entry.sources.map((s, i) =>
    `### Source ${i + 1}: ${s.source_title}\n\`\`\`\n${s.relevant_chunk}\n\`\`\``
  ).join('\n\n');

  const userMsg = `## Claim\n"${entry.claim_text}"\n\nClaim type: ${entry.claim_type}\nDerivation: ${entry.derivation}\n\n## Sources\n${sourceBlock}\n\n## Agent Reasoning\n${entry.reasoning}\n\nPlease evaluate and call submit_verdict.`;

  const systemPrompt = getLLMOnlySystem(entry.claim_type as ClaimType)
    .replace(/submit_verdict/g, 'submit_verdict');

  const res = await getAnthropic().messages.create({
    model: 'claude-haiku-4-5',
    temperature: 0.2,
    max_tokens: 512,
    system: systemPrompt,
    tools: [LLM_STRONG_VERDICT_TOOL],
    tool_choice: { type: 'tool', name: 'submit_verdict' },
    messages: [{ role: 'user', content: userMsg }],
  });

  const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (toolUse == null) {
    throw new Error('LLM-strong baseline: no tool_use block returned');
  }
  const parsed = toolUse.input as { verdict: string; confidence: number; reasoning: string };
  const verdict: Verdict = parsed.verdict === 'valid' ? 'valid' : 'invalid';
  return {
    verdict,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
  };
}

// ─── Concurrency helper ────────────────────────────────────────────────────

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, n: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]!();
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return results;
}

// ─── Rate-limit retry ──────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if ((msg.includes('429') || msg.includes('rate')) && attempt < maxAttempts) {
        const match = /try again in ([\d.]+)s/i.exec(msg);
        const waitMs = match ? Math.ceil(parseFloat(match[1]) * 1000) + 500 : Math.pow(2, attempt + 1) * 2000;
        process.stdout.write(` [rate-limit, wait ${(waitMs / 1000).toFixed(1)}s]`);
        await new Promise(r => setTimeout(r, waitMs));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Max retries exceeded');
}

// ─── Token-cost extraction from HERALD result ─────────────────────────────

// We cannot easily extract token counts from HeraldResult today (it doesn't
// expose them). We estimate from model pricing using rough token estimates
// based on context length. This is annotated as an estimate in the output.
function estimateHeraldCost(result: HeraldResult, entry: EvalEntry): { input: number; output: number } {
  // Rough token estimates per tier call
  const systemPromptTokens = 600;
  const userMsgTokens = Math.ceil(
    (entry.claim_text.length + entry.sources.reduce((a, s) => a + s.relevant_chunk.length, 0) + entry.reasoning.length) / 4
  );
  const outputTokensPerCall = 300;

  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  if (result.tier_details.tier_2 !== null) {
    calls++;
    inputTokens += systemPromptTokens + userMsgTokens;
    outputTokens += outputTokensPerCall;
  }
  if (result.tier_details.tier_3 !== null) {
    // 3 persona calls + 1 judge call
    calls += 4;
    inputTokens += 4 * (systemPromptTokens + userMsgTokens);
    outputTokens += 4 * outputTokensPerCall;
  }

  return { input: inputTokens, output: outputTokens };
}

// ─── Metrics computation ───────────────────────────────────────────────────

function computeMetrics(results: ClaimResult[]): AggregatedMetrics {
  const n = results.length;
  if (n === 0) return emptyMetrics();

  let tp = 0, fp = 0, tn = 0, fn = 0;
  let totalConf = 0;
  let totalCost = 0;
  let totalLatency = 0;
  let skepticFI = 0;

  const byType: Record<string, { tp: number; fp: number; tn: number; fn: number; n: number }> = {};
  const byDeriv: Record<string, { tp: number; fp: number; tn: number; fn: number; n: number }> = {};
  const tierCounts: Record<string, number> = {};
  const errorCounts: Record<string, number> = {};

  // Confidence calibration bins (0.5–0.6, 0.6–0.7, ..., 0.9–1.0)
  const bins: { lo: number; hi: number; correct: number; n: number; confSum: number }[] = [
    { lo: 0.0, hi: 0.6, correct: 0, n: 0, confSum: 0 },
    { lo: 0.6, hi: 0.7, correct: 0, n: 0, confSum: 0 },
    { lo: 0.7, hi: 0.8, correct: 0, n: 0, confSum: 0 },
    { lo: 0.8, hi: 0.9, correct: 0, n: 0, confSum: 0 },
    { lo: 0.9, hi: 1.01, correct: 0, n: 0, confSum: 0 },
  ];

  for (const r of results) {
    const posGT = r.ground_truth === 'valid';
    const posPred = r.predicted === 'valid';

    if (posGT && posPred) tp++;
    if (!posGT && posPred) fp++;
    if (posGT && !posPred) fn++;
    if (!posGT && !posPred) tn++;

    if (r.ground_truth === 'valid' && r.predicted === 'invalid') skepticFI++;

    totalConf += r.confidence;
    totalCost += r.cost_usd;
    totalLatency += r.latency_ms;

    const t = `tier_${r.tier_reached}`;
    tierCounts[t] = (tierCounts[t] ?? 0) + 1;

    // Error pattern
    if (!r.correct) {
      const pattern = `${r.claim_type}:${r.ground_truth}→${r.predicted}`;
      errorCounts[pattern] = (errorCounts[pattern] ?? 0) + 1;
    }

    // By type
    const typeKey = r.claim_type;
    if (!byType[typeKey]) byType[typeKey] = { tp: 0, fp: 0, tn: 0, fn: 0, n: 0 };
    byType[typeKey]!.n++;
    if (posGT && posPred) byType[typeKey]!.tp++;
    if (!posGT && posPred) byType[typeKey]!.fp++;
    if (posGT && !posPred) byType[typeKey]!.fn++;
    if (!posGT && !posPred) byType[typeKey]!.tn++;

    // By derivation
    const derivKey = r.derivation;
    if (!byDeriv[derivKey]) byDeriv[derivKey] = { tp: 0, fp: 0, tn: 0, fn: 0, n: 0 };
    byDeriv[derivKey]!.n++;
    if (posGT && posPred) byDeriv[derivKey]!.tp++;
    if (!posGT && posPred) byDeriv[derivKey]!.fp++;
    if (posGT && !posPred) byDeriv[derivKey]!.fn++;
    if (!posGT && !posPred) byDeriv[derivKey]!.tn++;

    // Calibration bins
    for (const bin of bins) {
      if (r.confidence >= bin.lo && r.confidence < bin.hi) {
        bin.n++;
        if (r.correct) bin.correct++;
        bin.confSum += r.confidence;
        break;
      }
    }
  }

  const correct = tp + tn;
  const accuracy = round(correct / n);
  const precision = tp + fp === 0 ? 0 : round(tp / (tp + fp));
  const recall = tp + fn === 0 ? 0 : round(tp / (tp + fn));
  const f1 = precision + recall === 0 ? 0 : round(2 * precision * recall / (precision + recall));
  const f2 = precision + recall === 0 ? 0 : round(5 * precision * recall / (4 * precision + recall));
  const fpr = tp + fn === 0 ? 0 : round(fp / (tp + fn)); // FP among all positives (valid GT)
  const fnr = tn + fp === 0 ? 0 : round(fn / (tn + fp)); // FN among all negatives (invalid GT)

  // Calibration error
  const calibBins: CalibrationBin[] = bins
    .filter(b => b.n > 0)
    .map(b => ({
      bin_label: `${b.lo.toFixed(1)}–${b.hi.toFixed(2).replace('.00', '')}`,
      confidence_low: b.lo,
      confidence_high: b.hi,
      n_claims: b.n,
      accuracy: round(b.correct / b.n),
      avg_confidence: round(b.confSum / b.n),
    }));

  const calErr = calibBins.length === 0 ? 0 : round(
    calibBins.reduce((sum, b) => sum + b.n_claims * Math.abs(b.avg_confidence - b.accuracy), 0) / n
  );

  function makeTypeMetrics(d: { tp: number; fp: number; tn: number; fn: number; n: number }): TypeMetrics {
    const acc = round((d.tp + d.tn) / d.n);
    const p = d.tp + d.fp === 0 ? 0 : round(d.tp / (d.tp + d.fp));
    const r = d.tp + d.fn === 0 ? 0 : round(d.tp / (d.tp + d.fn));
    const f = p + r === 0 ? 0 : round(2 * p * r / (p + r));
    const fpr_ = d.tp + d.fn === 0 ? 0 : round(d.fp / (d.tp + d.fn));
    const fnr_ = d.tn + d.fp === 0 ? 0 : round(d.fn / (d.tn + d.fp));
    return { total: d.n, correct: d.tp + d.tn, accuracy: acc, false_positive_rate: fpr_, false_negative_rate: fnr_, f1: f };
  }

  return {
    accuracy,
    precision,
    recall,
    f1,
    f2,
    false_positive_rate: fpr,
    false_negative_rate: fnr,
    skeptic_false_invalid_rate: round(skepticFI / n),
    avg_confidence: round(totalConf / n),
    calibration_error: calErr,
    tier_distribution: tierCounts,
    total_cost_usd: round6(totalCost),
    avg_cost_per_claim_usd: round6(totalCost / n),
    avg_latency_ms: round(totalLatency / n),
    by_claim_type: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, makeTypeMetrics(v)])),
    by_derivation: Object.fromEntries(Object.entries(byDeriv).map(([k, v]) => [k, makeTypeMetrics(v)])),
    confidence_bins: calibBins,
    error_pattern_counts: errorCounts,
  };
}

function emptyMetrics(): AggregatedMetrics {
  return {
    accuracy: 0, precision: 0, recall: 0, f1: 0, f2: 0,
    false_positive_rate: 0, false_negative_rate: 0,
    skeptic_false_invalid_rate: 0, avg_confidence: 0,
    calibration_error: 0, tier_distribution: {}, total_cost_usd: 0,
    avg_cost_per_claim_usd: 0, avg_latency_ms: 0,
    by_claim_type: {}, by_derivation: {},
    confidence_bins: [], error_pattern_counts: {},
  };
}

function round(n: number): number { return Math.round(n * 1000) / 1000; }
function round6(n: number): number { return Math.round(n * 1_000_000) / 1_000_000; }

// ─── Single-set runner ─────────────────────────────────────────────────────

async function runEvalSet(
  setKey: string,
  entries: EvalEntry[],
  system: SystemName,
  concurrency: number,
): Promise<EvalSetResult> {
  const info = EVAL_SETS[setKey]!;
  const label = `[${system.toUpperCase()}] ${info.label}`;
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  ${label}  (${entries.length} claims, concurrency=${concurrency})`);
  console.log(`${'─'.repeat(70)}`);

  const perClaim: ClaimResult[] = [];

  const tasks = entries.map((entry, i) => async () => {
    process.stdout.write(`  [${i + 1}/${entries.length}] ${entry.claim_id} (${entry.claim_type})... `);
    const t0 = Date.now();

    try {
      let verdict: Verdict;
      let confidence: number;
      let tierReached: number;
      let inputTokens: number;
      let outputTokens: number;

      let costUsd: number;

      if (system === 'herald') {
        const result = await withRetry(() => evaluateClaim(entry));
        verdict = result.verdict === 'uncertain' ? 'invalid' : result.verdict;
        confidence = result.confidence;
        tierReached = result.tier_reached;
        const est = estimateHeraldCost(result, entry);
        inputTokens = est.input;
        outputTokens = est.output;
        // HERALD T2 calls use gpt-4o-mini; T3 calls use claude-haiku-4-5
        const t3Calls = result.tier_details.tier_3 !== null ? 4 : 0;
        const t2Calls = result.tier_details.tier_2 !== null ? 1 : 0;
        const systemPromptTokens = 600;
        const userMsgTokens = Math.ceil(
          (entry.claim_text.length + entry.sources.reduce((a, s) => a + s.relevant_chunk.length, 0) + entry.reasoning.length) / 4
        );
        const outPerCall = 300;
        const t2In = t2Calls * (systemPromptTokens + userMsgTokens);
        const t2Out = t2Calls * outPerCall;
        const t3In = t3Calls * (systemPromptTokens + userMsgTokens);
        const t3Out = t3Calls * outPerCall;
        costUsd = t2In * MINI_INPUT_COST_PER_TOKEN + t2Out * MINI_OUTPUT_COST_PER_TOKEN
                + t3In * HAIKU_INPUT_COST_PER_TOKEN + t3Out * HAIKU_OUTPUT_COST_PER_TOKEN;
      } else if (system === 'llm_only') {
        const result = await withRetry(() => llmOnlyEvaluate(entry));
        verdict = result.verdict;
        confidence = result.confidence;
        tierReached = 2;
        inputTokens = result.input_tokens;
        outputTokens = result.output_tokens;
        costUsd = inputTokens * MINI_INPUT_COST_PER_TOKEN + outputTokens * MINI_OUTPUT_COST_PER_TOKEN;
      } else {
        const result = await withRetry(() => llmOnlyStrongEvaluate(entry));
        verdict = result.verdict;
        confidence = result.confidence;
        tierReached = 2;
        inputTokens = result.input_tokens;
        outputTokens = result.output_tokens;
        costUsd = inputTokens * HAIKU_INPUT_COST_PER_TOKEN + outputTokens * HAIKU_OUTPUT_COST_PER_TOKEN;
      }

      const latencyMs = Date.now() - t0;
      const correct = verdict === entry.ground_truth_verdict;

      process.stdout.write(`${correct ? '✓' : '✗'} ${verdict} (gt=${entry.ground_truth_verdict}) T${tierReached} ${latencyMs}ms\n`);

      perClaim.push({
        claim_id: entry.claim_id,
        claim_type: entry.claim_type,
        derivation: entry.derivation,
        ground_truth: entry.ground_truth_verdict,
        predicted: verdict,
        correct,
        confidence,
        tier_reached: tierReached,
        latency_ms: latencyMs,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: costUsd,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n  [ERROR] ${entry.claim_id}: ${msg}`);
      const latencyMs = Date.now() - t0;
      perClaim.push({
        claim_id: entry.claim_id,
        claim_type: entry.claim_type,
        derivation: entry.derivation,
        ground_truth: entry.ground_truth_verdict,
        predicted: 'uncertain' as Verdict,
        correct: false,
        confidence: 0,
        tier_reached: 2,
        latency_ms: latencyMs,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        error: msg,
      });
    }
  });

  await runWithConcurrency(tasks, concurrency);

  const metrics = computeMetrics(perClaim);
  console.log(`\n  → Accuracy: ${(metrics.accuracy * 100).toFixed(1)}%  F1: ${(metrics.f1 * 100).toFixed(1)}%  F2: ${(metrics.f2 * 100).toFixed(1)}%  AvgCost: $${metrics.avg_cost_per_claim_usd.toFixed(4)}/claim`);

  return {
    eval_set_key: setKey,
    label: info.label,
    notes: info.notes,
    n_claims: entries.length,
    run_timestamp: new Date().toISOString(),
    system,
    per_claim: perClaim,
    metrics,
  };
}

// ─── Variance runner ───────────────────────────────────────────────────────

async function runVarianceTest(
  setKey: string,
  entries: EvalEntry[],
  system: SystemName,
  reps: number,
  concurrency: number,
): Promise<VarianceResult> {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  VARIANCE TEST [${system.toUpperCase()}] ${EVAL_SETS[setKey]!.label} ×${reps} reps`);
  console.log(`${'─'.repeat(70)}`);

  const perRepVerdicts: Verdict[][] = [];
  const perRepAccuracies: number[] = [];

  for (let rep = 0; rep < reps; rep++) {
    console.log(`\n  Rep ${rep + 1}/${reps}:`);
    const result = await runEvalSet(setKey, entries, system, concurrency);
    perRepVerdicts.push(result.per_claim.map(c => c.predicted));
    perRepAccuracies.push(result.metrics.accuracy);
  }

  // Flip rate: fraction of claims that differ verdict across any two consecutive reps
  let totalFlips = 0;
  const n = entries.length;
  for (let i = 0; i < reps - 1; i++) {
    for (let j = 0; j < n; j++) {
      if (perRepVerdicts[i]![j] !== perRepVerdicts[i + 1]![j]) totalFlips++;
    }
  }
  const flipRate = reps < 2 ? 0 : round(totalFlips / ((reps - 1) * n));

  const mean = round(perRepAccuracies.reduce((a, b) => a + b, 0) / reps);
  const variance = perRepAccuracies.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / reps;
  const std = round(Math.sqrt(variance));

  console.log(`\n  Variance result: accuracy=[${perRepAccuracies.map(a => `${(a * 100).toFixed(1)}%`).join(', ')}] mean=${(mean * 100).toFixed(1)}% std=±${(std * 100).toFixed(1)}% flip_rate=${(flipRate * 100).toFixed(1)}%`);

  return { eval_set_key: setKey, system, n_reps: reps, per_rep_accuracy: perRepAccuracies, mean_accuracy: mean, std_accuracy: std, flip_rate: flipRate };
}

// ─── Summary printer ───────────────────────────────────────────────────────

function printFinalSummary(report: ComprehensiveReport): void {
  console.log('\n' + '='.repeat(70));
  console.log('  COMPREHENSIVE EVALUATION SUMMARY');
  console.log('='.repeat(70));

  console.log('\n📊 ACCURACY BY SYSTEM AND EVAL SET\n');
  console.log('  Set                  HERALD    mini-only  haiku-only  Δ(H-mini)');
  console.log('  ' + '─'.repeat(72));
  for (const comp of report.baseline_comparisons) {
    const info = EVAL_SETS[comp.eval_set_key]!;
    const delta = comp.delta_pp >= 0 ? `+${comp.delta_pp.toFixed(1)}` : comp.delta_pp.toFixed(1);
    const heraldPct = comp.herald_accuracy > 0 ? `${(comp.herald_accuracy * 100).toFixed(1)}%` : 'N/A';
    const miniPct = comp.llm_only_accuracy > 0 ? `${(comp.llm_only_accuracy * 100).toFixed(1)}%` : 'N/A';
    const haikuPct = comp.llm_only_strong_accuracy > 0 ? `${(comp.llm_only_strong_accuracy * 100).toFixed(1)}%` : 'N/A';
    console.log(`  ${info.label.substring(0, 22).padEnd(22)} ${heraldPct.padEnd(9)} ${miniPct.padEnd(11)} ${haikuPct.padEnd(11)} ${delta.padStart(6)}pp`);
  }

  console.log('\n📉 FALSE NEGATIVE RATES (invalid claims that slipped through)\n');
  console.log('  Set                  HERALD    mini-only  haiku-only');
  console.log('  ' + '─'.repeat(60));
  for (const comp of report.baseline_comparisons) {
    const info = EVAL_SETS[comp.eval_set_key]!;
    const hFNR = comp.herald_false_negative_rate > 0 ? `${(comp.herald_false_negative_rate * 100).toFixed(1)}%` : 'N/A';
    const mFNR = comp.llm_only_false_negative_rate > 0 ? `${(comp.llm_only_false_negative_rate * 100).toFixed(1)}%` : 'N/A';
    const sFNR = comp.llm_only_strong_false_negative_rate > 0 ? `${(comp.llm_only_strong_false_negative_rate * 100).toFixed(1)}%` : 'N/A';
    console.log(`  ${info.label.substring(0, 22).padEnd(22)} ${hFNR.padEnd(11)} ${mFNR.padEnd(11)} ${sFNR}`);
  }

  console.log('\n💰 COST ANALYSIS\n');
  console.log('  Set                  HERALD      mini        haiku');
  console.log('  ' + '─'.repeat(60));
  for (const comp of report.baseline_comparisons) {
    const info = EVAL_SETS[comp.eval_set_key]!;
    const hCost = `$${comp.herald_avg_cost_usd.toFixed(4)}`;
    const mCost = `$${comp.llm_only_avg_cost_usd.toFixed(4)}`;
    const sCost = `$${comp.llm_only_strong_avg_cost_usd.toFixed(4)}`;
    console.log(`  ${info.label.substring(0, 22).padEnd(22)} ${hCost.padEnd(11)} ${mCost.padEnd(11)} ${sCost}`);
  }

  const { cross_set_summary: css } = report;
  if (css.honest_holdout_accuracy !== null && css.contaminated_accuracy !== null) {
    console.log('\n⚠️  DATA CONTAMINATION ANALYSIS\n');
    console.log(`  eval-set-2 (tuned on it):  ${(css.contaminated_accuracy * 100).toFixed(1)}%`);
    console.log(`  eval-set-3 (honest holdout): ${(css.honest_holdout_accuracy * 100).toFixed(1)}%`);
    const gap = (css.accuracy_gap_pp ?? 0);
    console.log(`  Inflation from tuning: ${gap > 0 ? '+' : ''}${gap.toFixed(1)}pp  ${gap > 3 ? '⚠️  MEANINGFUL OVERFIT' : '✓ Within noise'}`);
  }

  if (report.variance_results.length > 0) {
    console.log('\n🎲 VARIANCE / STOCHASTICITY\n');
    for (const v of report.variance_results) {
      const perRepStr = v.per_rep_accuracy.map(a => `${(a * 100).toFixed(1)}%`).join(', ');
      console.log(`  ${v.system.toUpperCase()} on ${v.eval_set_key}: [${perRepStr}]  std=±${(v.std_accuracy * 100).toFixed(1)}pp  flip_rate=${(v.flip_rate * 100).toFixed(1)}%`);
    }
  }

  console.log('\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { concurrency, varianceReps, skipHerald, skipBaseline, skipStrongBaseline, evalSetsToRun, outputPath } = parseArgs();

  console.log('='.repeat(70));
  console.log('  HERALD COMPREHENSIVE EVALUATION SUITE');
  console.log('='.repeat(70));
  console.log(`  Eval sets:          ${evalSetsToRun.join(', ')}`);
  console.log(`  Run HERALD:         ${!skipHerald}`);
  console.log(`  Run LLM-only-mini:  ${!skipBaseline}`);
  console.log(`  Run LLM-only-haiku: ${!skipStrongBaseline}`);
  console.log(`  Variance reps:      ${varianceReps}`);
  console.log(`  Concurrency:        ${concurrency}`);
  console.log(`  Output:             ${outputPath}`);

  // Check NLI backend
  const nliAvailable = await checkNLIBackend();
  console.log(`\n  NLI backend:    ${nliAvailable ? '✓ online (Tier 1 will run)' : '✗ offline (will fall back to Tier 2)'}`);
  if (!nliAvailable) {
    console.log('  → To enable Tier 1: cd backend && uv run uvicorn policy_memo_agent.api.app:create_app --factory --port 8000');
  }

  const allResults: EvalSetResult[] = [];
  const varianceResults: VarianceResult[] = [];

  // Run all eval sets
  for (const setKey of evalSetsToRun) {
    const info = EVAL_SETS[setKey];
    if (!info) { console.warn(`  [WARN] Unknown eval set key '${setKey}' — skipping`); continue; }
    const entries = loadEvalSet(info.path);

    if (!skipHerald) {
      const heraldResult = await runEvalSet(setKey, entries, 'herald', concurrency);
      allResults.push(heraldResult);
    }

    if (!skipBaseline) {
      const baselineResult = await runEvalSet(setKey, entries, 'llm_only', concurrency);
      allResults.push(baselineResult);
    }

    if (!skipStrongBaseline) {
      const strongResult = await runEvalSet(setKey, entries, 'llm_only_strong', concurrency);
      allResults.push(strongResult);
    }
  }

  // Variance test on eval-set-3 (cleanest holdout) if requested
  if (varianceReps >= 2) {
    const varSetKey = evalSetsToRun.includes('3') ? '3' : evalSetsToRun[0];
    if (varSetKey) {
      const varEntries = loadEvalSet(EVAL_SETS[varSetKey]!.path);
      if (!skipHerald) {
        const vr = await runVarianceTest(varSetKey, varEntries, 'herald', varianceReps, concurrency);
        varianceResults.push(vr);
      }
      if (!skipBaseline) {
        const vr = await runVarianceTest(varSetKey, varEntries, 'llm_only', varianceReps, concurrency);
        varianceResults.push(vr);
      }
      if (!skipStrongBaseline) {
        const vr = await runVarianceTest(varSetKey, varEntries, 'llm_only_strong', varianceReps, concurrency);
        varianceResults.push(vr);
      }
    }
  }

  // Build baseline comparisons
  const baselineComparisons: BaselineComparison[] = [];
  for (const setKey of evalSetsToRun) {
    const heraldRes = allResults.find(r => r.eval_set_key === setKey && r.system === 'herald');
    const llmRes = allResults.find(r => r.eval_set_key === setKey && r.system === 'llm_only');
    const strongRes = allResults.find(r => r.eval_set_key === setKey && r.system === 'llm_only_strong');

    if (heraldRes ?? llmRes ?? strongRes) {
      const heraldAcc = heraldRes?.metrics.accuracy ?? 0;
      const llmAcc = llmRes?.metrics.accuracy ?? 0;
      const strongAcc = strongRes?.metrics.accuracy ?? 0;
      baselineComparisons.push({
        eval_set_key: setKey,
        herald_accuracy: heraldAcc,
        llm_only_accuracy: llmAcc,
        llm_only_strong_accuracy: strongAcc,
        delta_pp: round((heraldAcc - llmAcc) * 100),
        herald_f2: heraldRes?.metrics.f2 ?? 0,
        llm_only_f2: llmRes?.metrics.f2 ?? 0,
        llm_only_strong_f2: strongRes?.metrics.f2 ?? 0,
        herald_false_negative_rate: heraldRes?.metrics.false_negative_rate ?? 0,
        llm_only_false_negative_rate: llmRes?.metrics.false_negative_rate ?? 0,
        llm_only_strong_false_negative_rate: strongRes?.metrics.false_negative_rate ?? 0,
        herald_avg_cost_usd: heraldRes?.metrics.avg_cost_per_claim_usd ?? 0,
        llm_only_avg_cost_usd: llmRes?.metrics.avg_cost_per_claim_usd ?? 0,
        llm_only_strong_avg_cost_usd: strongRes?.metrics.avg_cost_per_claim_usd ?? 0,
        herald_tier_distribution: heraldRes?.metrics.tier_distribution ?? {},
      });
    }
  }

  // Cross-set summary
  const heraldAccs: Record<string, number> = {};
  const llmAccs: Record<string, number> = {};
  const strongAccs: Record<string, number> = {};
  for (const r of allResults) {
    if (r.system === 'herald') heraldAccs[r.eval_set_key] = r.metrics.accuracy;
    if (r.system === 'llm_only') llmAccs[r.eval_set_key] = r.metrics.accuracy;
    if (r.system === 'llm_only_strong') strongAccs[r.eval_set_key] = r.metrics.accuracy;
  }

  const contaminatedHerald = heraldAccs['2'] ?? null;
  const holdoutHerald = heraldAccs['3'] ?? null;
  const gapPP = contaminatedHerald !== null && holdoutHerald !== null
    ? round((contaminatedHerald - holdoutHerald) * 100)
    : null;

  const crossSetSummary: CrossSetSummary = {
    herald_accuracies: heraldAccs,
    llm_only_accuracies: llmAccs,
    llm_only_strong_accuracies: strongAccs,
    honest_holdout_accuracy: holdoutHerald,
    contaminated_accuracy: contaminatedHerald,
    accuracy_gap_pp: gapPP,
  };

  const report: ComprehensiveReport = {
    run_timestamp: new Date().toISOString(),
    config: { concurrency, variance_reps: varianceReps, eval_sets_run: evalSetsToRun },
    nli_backend_available: nliAvailable,
    eval_results: allResults,
    baseline_comparisons: baselineComparisons,
    variance_results: varianceResults,
    cross_set_summary: crossSetSummary,
  };

  // Write output
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), JSON.stringify(report, null, 2));

  printFinalSummary(report);
  console.log(`Full results → ${outputPath}`);
}

main().catch(err => {
  console.error('[FATAL]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
