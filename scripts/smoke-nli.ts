/**
 * smoke-nli.ts — NLI threshold tuning tool
 *
 * Runs Tier 1 (NLI) only on a sample of NLI-eligible claims, shows raw scores
 * for every source window, and reports which threshold settings produce which
 * outcomes.  Use this to calibrate before a full eval run.
 *
 * Requires: NLI backend running at localhost:8000
 *   cd backend && uv run uvicorn policy_memo_agent.api.app:create_app --factory --port 8000
 *
 * Usage:
 *   npx tsx scripts/smoke-nli.ts [options]
 *
 * Options:
 *   --eval-set <path>        JSON eval file to sample from (default: data/eval-set-3.json)
 *   --n <num>                Max NLI-eligible claims to test (default: 20)
 *   --entail-threshold <n>   Override nliEscalationThreshold for all types (e.g. 0.78)
 *   --contra-threshold <n>   Override CONTRADICTION_THRESHOLD (e.g. 0.85)
 *   --margin <n>             Override DEFAULT_ENTAILMENT_MARGIN (e.g. 0.08)
 *   --causal-margin <n>      Override CAUSAL_PARAPHRASE_ENTAILMENT_MARGIN (e.g. 0.2)
 *   --verbose                Show raw per-window scores for every source
 *   --sweep                  Sweep entailment threshold 0.70–0.90 in 0.02 steps, print accuracy table
 */

import fs from 'node:fs';
import path from 'node:path';

// ─── Types ─────────────────────────────────────────────────────────────────

interface Source {
  source_id: string;
  source_title: string;
  source_url: string;
  relevant_chunk: string;
}

interface EvalEntry {
  claim_id: string;
  claim_text: string;
  claim_type: string;
  derivation: string;
  sources: Source[];
  reasoning: string;
  ground_truth_verdict: 'valid' | 'invalid';
}

interface NLIScores {
  entailment: number;
  neutral: number;
  contradiction: number;
}

interface NLIResponseItem {
  label: string;
  scores: NLIScores;
}

interface NLIBatchResponse {
  results: NLIResponseItem[];
}

// ─── CLI args ───────────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2);
  let evalFile = 'data/eval-set-3.json';
  let n = 20;
  let entailThreshold: number | null = null;
  let contraThreshold = 0.85;
  let margin = 0.08;
  let causalMargin = 0.2;
  let verbose = false;
  let sweep = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--eval-set' && v) { evalFile = v; i++; }
    else if (a === '--n' && v) { n = parseInt(v, 10); i++; }
    else if (a === '--entail-threshold' && v) { entailThreshold = parseFloat(v); i++; }
    else if (a === '--contra-threshold' && v) { contraThreshold = parseFloat(v); i++; }
    else if (a === '--margin' && v) { margin = parseFloat(v); i++; }
    else if (a === '--causal-margin' && v) { causalMargin = parseFloat(v); i++; }
    else if (a === '--verbose') verbose = true;
    else if (a === '--sweep') sweep = true;
  }
  return { evalFile, n, entailThreshold, contraThreshold, margin, causalMargin, verbose, sweep };
}

// ─── NLI backend call ───────────────────────────────────────────────────────

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8000';

async function callNLIBatch(
  pairs: Array<{ premise: string; hypothesis: string }>,
): Promise<NLIBatchResponse> {
  const url = `${API_BASE}/api/herald/nli/batch`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairs }),
  });
  if (!res.ok) throw new Error(`NLI error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<NLIBatchResponse>;
}

// ─── Sliding window helpers (mirrors tier1-nli.ts) ──────────────────────────

const MAX_WINDOW_SENTENCES = 3;
const MAX_PREMISE_CHARS = 1500;

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z"'])/).map(s => s.trim()).filter(s => s.length > 0);
}

function buildChunkWindows(chunk: string): string[] {
  const sentences = splitSentences(chunk);
  const seen = new Set<string>();
  const windows: string[] = [];
  const add = (w: string) => {
    const t = w.trim().slice(0, MAX_PREMISE_CHARS);
    if (t.length > 0 && !seen.has(t)) { seen.add(t); windows.push(t); }
  };
  add(chunk);
  if (sentences.length > 1) {
    for (let size = 1; size <= Math.min(MAX_WINDOW_SENTENCES, sentences.length); size++) {
      for (let start = 0; start <= sentences.length - size; start++) {
        add(sentences.slice(start, start + size).join(' '));
      }
    }
  }
  return windows;
}

// ─── NLI thresholds per claim type ─────────────────────────────────────────

const DEFAULT_THRESHOLDS: Record<string, number> = {
  statistical: 0.82,
  causal: 0.78,
  comparative: 0.82,
};

// ─── Evaluate one claim with given thresholds ───────────────────────────────

interface RawSourceResult {
  source_id: string;
  windows: Array<{ premise_snippet: string; entailment: number; neutral: number; contradiction: number }>;
  best_entailment: number;
  best_contradiction: number;
  best_neutral: number;
  dominant_label: string;
}

interface NLIEvalResult {
  claim_id: string;
  claim_type: string;
  derivation: string;
  ground_truth: 'valid' | 'invalid';
  nli_verdict: 'valid' | 'invalid' | 'uncertain';
  correct: boolean;
  best_entailment: number;
  best_contradiction: number;
  best_neutral: number;
  signal_margin: number;
  hedging_mismatch: boolean;
  escalation_reason: string;
  raw_sources: RawSourceResult[];
}

const HEDGED_CAUSAL = /\b(associated with|association|correlated with|correlation|linked to|coincided with|may|might|could|suggests?|contributed to)\b/i;
const STRONG_CAUSAL = /\b(caused?|causing|drives?|driving|led to|results? in|intensif(?:y|ies|ied)|triggered?)\b/i;

async function evaluateWithNLIRaw(
  entry: EvalEntry,
  opts: { entailThreshold: number | null; contraThreshold: number; margin: number; causalMargin: number },
): Promise<NLIEvalResult> {
  const threshold = opts.entailThreshold ?? DEFAULT_THRESHOLDS[entry.claim_type] ?? 0.82;
  const entailmentMargin = (entry.claim_type === 'causal' && entry.derivation === 'paraphrase')
    ? opts.causalMargin : opts.margin;

  const NORMALIZE_APPROX = /\b(approximately|roughly|about|around|nearly)\b/gi;
  const canonicalHypothesis = entry.derivation === 'paraphrase'
    ? entry.claim_text.replace(/[""]/g, '"').replace(/[']/g, "'").replace(NORMALIZE_APPROX, '').replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim()
    : entry.claim_text;
  const useCanonical = entry.derivation === 'paraphrase' && canonicalHypothesis !== entry.claim_text;

  const chunkWindows = entry.sources.map(s => buildChunkWindows(s.relevant_chunk));
  const windowCounts = chunkWindows.map(w => w.length);

  const origPairs = chunkWindows.flatMap(ws => ws.map(p => ({ premise: p, hypothesis: entry.claim_text })));
  const canonPairs = useCanonical
    ? chunkWindows.flatMap(ws => ws.map(p => ({ premise: p, hypothesis: canonicalHypothesis })))
    : origPairs;

  const [origRes, canonRes] = await Promise.all([
    callNLIBatch(origPairs),
    useCanonical ? callNLIBatch(canonPairs) : Promise.resolve<NLIBatchResponse>({ results: [] }),
  ]);

  // Collapse per-source
  const rawSources: RawSourceResult[] = [];
  let idx = 0;
  const collapsedOrig: NLIResponseItem[] = [];
  const collapsedCanon: NLIResponseItem[] = [];

  for (let s = 0; s < entry.sources.length; s++) {
    const count = windowCounts[s]!;
    const sliceOrig = origRes.results.slice(idx, idx + count);
    const sliceCanon = canonRes.results.length > 0 ? canonRes.results.slice(idx, idx + count) : sliceOrig;
    idx += count;

    // Track max contradiction independently; link neutral to the best-entailment window
    // (mirrors the fix in tier1-nli.ts collapseWindowsToSource).
    let maxC = 0;
    let bestEntailmentWindowIdx = 0;
    const windows: RawSourceResult['windows'] = [];

    for (let w = 0; w < sliceOrig.length; w++) {
      const o = sliceOrig[w]!;
      const canonE = sliceCanon[w]?.scores.entailment ?? 0;
      const effectiveE = Math.max(o.scores.entailment, canonE);
      if (effectiveE > (Math.max(sliceOrig[bestEntailmentWindowIdx]!.scores.entailment, sliceCanon[bestEntailmentWindowIdx]?.scores.entailment ?? 0))) {
        bestEntailmentWindowIdx = w;
      }
      if (o.scores.contradiction > maxC) maxC = o.scores.contradiction;
      const src = chunkWindows[s]?.[w] ?? '';
      windows.push({
        premise_snippet: src.slice(0, 80) + (src.length > 80 ? '…' : ''),
        entailment: Math.round(o.scores.entailment * 1000) / 1000,
        neutral: Math.round(o.scores.neutral * 1000) / 1000,
        contradiction: Math.round(o.scores.contradiction * 1000) / 1000,
      });
    }

    const bestW = sliceOrig[bestEntailmentWindowIdx]!;
    const bestWCanon = sliceCanon[bestEntailmentWindowIdx];
    const maxE = Math.max(bestW.scores.entailment, bestWCanon?.scores.entailment ?? 0);
    const maxN = Math.min(bestW.scores.neutral, bestWCanon?.scores.neutral ?? bestW.scores.neutral);

    const label = maxE >= maxC && maxE >= maxN ? 'entailment' : maxC >= maxN ? 'contradiction' : 'neutral';
    collapsedOrig.push({ label, scores: { entailment: maxE, contradiction: maxC, neutral: maxN } });
    collapsedCanon.push({ label, scores: { entailment: maxE, contradiction: maxC, neutral: maxN } });

    rawSources.push({
      source_id: entry.sources[s]!.source_id,
      windows,
      best_entailment: Math.round(maxE * 1000) / 1000,
      best_contradiction: Math.round(maxC * 1000) / 1000,
      best_neutral: Math.round(maxN * 1000) / 1000,
      dominant_label: label,
    });
  }

  // Aggregate across sources
  let bestE = 0, bestC = 0, bestN = 0;
  for (const item of collapsedOrig) {
    if (item.scores.entailment > bestE) bestE = item.scores.entailment;
    if (item.scores.contradiction > bestC) bestC = item.scores.contradiction;
    if (item.scores.neutral > bestN) bestN = item.scores.neutral;
  }

  const signalMargin = bestE - Math.max(bestC, bestN);
  const hedgingMismatch = entry.claim_type === 'causal' && entry.derivation === 'paraphrase'
    && HEDGED_CAUSAL.test(entry.sources.map(s => s.relevant_chunk).join('\n'))
    && STRONG_CAUSAL.test(entry.claim_text);

  let nliVerdict: 'valid' | 'invalid' | 'uncertain';
  let escalationReason = '';

  if (bestE >= threshold && bestC < opts.contraThreshold && signalMargin >= entailmentMargin && !hedgingMismatch) {
    nliVerdict = 'valid';
  } else if (bestC >= opts.contraThreshold) {
    nliVerdict = 'invalid';
  } else {
    nliVerdict = 'uncertain';
    if (hedgingMismatch) escalationReason = 'causal-hedging-mismatch';
    else if (signalMargin < entailmentMargin) escalationReason = `margin ${(signalMargin * 100).toFixed(1)}% < ${(entailmentMargin * 100).toFixed(0)}% required`;
    else escalationReason = `entailment ${(bestE * 100).toFixed(1)}% < ${(threshold * 100).toFixed(0)}% threshold`;
  }

  return {
    claim_id: entry.claim_id,
    claim_type: entry.claim_type,
    derivation: entry.derivation,
    ground_truth: entry.ground_truth_verdict,
    nli_verdict: nliVerdict,
    correct: nliVerdict === 'uncertain' || nliVerdict === entry.ground_truth_verdict,
    best_entailment: Math.round(bestE * 1000) / 1000,
    best_contradiction: Math.round(bestC * 1000) / 1000,
    best_neutral: Math.round(bestN * 1000) / 1000,
    signal_margin: Math.round(signalMargin * 1000) / 1000,
    hedging_mismatch: hedgingMismatch,
    escalation_reason: escalationReason,
    raw_sources: rawSources,
  };
}

// ─── Sweep mode ─────────────────────────────────────────────────────────────

function applyDecision(
  r: NLIEvalResult,
  threshold: number,
  margin: number,
  causalMargin: number,
  contraThreshold: number,
): 'valid' | 'invalid' | 'uncertain' {
  const em = (r.claim_type === 'causal' && r.derivation === 'paraphrase') ? causalMargin : margin;
  if (r.best_entailment >= threshold && r.best_contradiction < contraThreshold && r.signal_margin >= em && !r.hedging_mismatch) {
    return 'valid';
  }
  if (r.best_contradiction >= contraThreshold) return 'invalid';
  return 'uncertain';
}

function tally(allResults: NLIEvalResult[], threshold: number, margin: number, causalMargin: number, contraThreshold: number) {
  let exits = 0, fpExits = 0, fnExits = 0, correctExits = 0, uncertain = 0;
  const fnClaims: string[] = [];
  for (const r of allResults) {
    const v = applyDecision(r, threshold, margin, causalMargin, contraThreshold);
    if (v !== 'uncertain') {
      exits++;
      if (v === r.ground_truth) correctExits++;
      if (r.ground_truth === 'valid' && v === 'invalid') fpExits++;
      if (r.ground_truth === 'invalid' && v === 'valid') { fnExits++; fnClaims.push(r.claim_id); }
    } else { uncertain++; }
  }
  return { exits, fpExits, fnExits, correctExits, uncertain, fnClaims, n: allResults.length };
}

async function runSweep(
  entries: EvalEntry[],
  opts: { contraThreshold: number; margin: number; causalMargin: number },
): Promise<void> {
  const thresholds = [0.70, 0.74, 0.78, 0.82, 0.86, 0.90, 0.92, 0.94, 0.96, 0.98, 0.99];
  const margins   = [0.00, 0.03, 0.06, 0.08, 0.10, 0.15];

  console.log('\n🔄 SWEEP MODE — fetching NLI scores once, applying thresholds locally...\n');
  const allResults = await Promise.all(
    entries.map(e => evaluateWithNLIRaw(e, { entailThreshold: 0.0, ...opts }))
  );

  // ── Part 1: threshold sweep at fixed margin ──────────────────────────────
  console.log(`PART 1: Threshold sweep  (margin=${opts.margin}, causal_margin=${opts.causalMargin}, contra=${opts.contraThreshold})\n`);
  console.log(`${'Threshold'.padEnd(10)} ${'Exits'.padEnd(12)} ${'FP'.padEnd(6)} ${'FN'.padEnd(6)} ${'Correct'.padEnd(10)} ${'Uncertain'.padEnd(10)} FN claims`);
  console.log('─'.repeat(80));

  for (const t of thresholds) {
    const s = tally(allResults, t, opts.margin, opts.causalMargin, opts.contraThreshold);
    const exitPct = `${((s.exits / s.n) * 100).toFixed(0)}% (${s.exits}/${s.n})`;
    const mark = s.fpExits > 0 ? ' ⚠️ FP' : s.fnExits > 0 ? ' ⚠️ FN' : ' ✓';
    const fnStr = s.fnClaims.length > 0 ? s.fnClaims.join(',') : '';
    console.log(`  t=${t.toFixed(2)}   ${exitPct.padEnd(12)} ${String(s.fpExits).padEnd(6)} ${String(s.fnExits).padEnd(6)} ${String(s.correctExits).padEnd(10)} ${String(s.uncertain).padEnd(10)} ${fnStr}${mark}`);
  }

  // ── Part 2: margin sweep at each threshold that had FNs ──────────────────
  console.log(`\nPART 2: Margin sweep  (contra=${opts.contraThreshold}) — can a tighter margin block FN exits?\n`);
  console.log(`${'Margin'.padEnd(8)} ${'t=0.90'.padEnd(20)} ${'t=0.95'.padEnd(20)} ${'t=0.98'.padEnd(20)}`);
  console.log('─'.repeat(72));

  for (const m of margins) {
    const cols = [0.90, 0.95, 0.98].map(t => {
      const s = tally(allResults, t, m, opts.causalMargin, opts.contraThreshold);
      const exitPct = `${((s.exits / s.n) * 100).toFixed(0)}%(${s.exits}) FP=${s.fpExits} FN=${s.fnExits}`;
      return exitPct;
    });
    console.log(`  m=${m.toFixed(2)}  ${cols[0]!.padEnd(20)} ${cols[1]!.padEnd(20)} ${cols[2]!}`);
  }

  console.log('\n  FP exit = valid claimed invalid  FN exit = invalid claimed valid  Uncertain = safe escalation to T2');
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { evalFile, n, entailThreshold, contraThreshold, margin, causalMargin, verbose, sweep } = parseArgs();

  // Check NLI backend
  try {
    const health = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(2000) });
    if (!health.ok) throw new Error('not ok');
    console.log(`✓ NLI backend online at ${API_BASE}\n`);
  } catch {
    console.error(`✗ NLI backend unreachable at ${API_BASE}`);
    console.error('  Start it: cd backend && uv run uvicorn policy_memo_agent.api.app:create_app --factory --port 8000');
    process.exit(1);
  }

  // Load eval set
  const abs = path.resolve(evalFile);
  if (!fs.existsSync(abs)) { console.error(`File not found: ${abs}`); process.exit(1); }
  const all = JSON.parse(fs.readFileSync(abs, 'utf-8')) as EvalEntry[];
  const nliEligible = all.filter(e => ['statistical', 'causal', 'comparative'].includes(e.claim_type));
  const entries = nliEligible.slice(0, n);

  console.log(`📋 ${evalFile}: ${all.length} claims → ${nliEligible.length} NLI-eligible → testing ${entries.length}`);
  const validCount = entries.filter(e => e.ground_truth_verdict === 'valid').length;
  console.log(`   ${validCount} valid, ${entries.length - validCount} invalid\n`);

  if (sweep) {
    await runSweep(entries, { contraThreshold, margin, causalMargin });
    return;
  }

  console.log('Current thresholds:');
  console.log(`  Entailment:        ${entailThreshold != null ? entailThreshold : 'per-type (stat=0.82, causal=0.78, comp=0.82)'}`);
  console.log(`  Contradiction:     ${contraThreshold}`);
  console.log(`  Signal margin:     ${margin}`);
  console.log(`  Causal/para margin:${causalMargin}`);
  console.log('');

  const opts = { entailThreshold, contraThreshold, margin, causalMargin };
  const results: NLIEvalResult[] = [];

  for (const entry of entries) {
    process.stdout.write(`  ${entry.claim_id} [${entry.claim_type}/${entry.derivation}] gt=${entry.ground_truth_verdict}... `);
    const r = await evaluateWithNLIRaw(entry, opts);
    results.push(r);

    const icon = r.nli_verdict === 'uncertain' ? '?' : r.correct ? '✓' : '✗';
    const clr = r.nli_verdict === 'uncertain' ? '' : r.correct ? '' : ' ← WRONG EXIT';
    process.stdout.write(
      `${icon} ${r.nli_verdict} (E=${(r.best_entailment * 100).toFixed(1)}% C=${(r.best_contradiction * 100).toFixed(1)}% margin=${(r.signal_margin * 100).toFixed(1)}pp)${clr}\n`
    );

    if (verbose) {
      for (const src of r.raw_sources) {
        console.log(`    Source ${src.source_id}: best_E=${(src.best_entailment * 100).toFixed(1)}% best_C=${(src.best_contradiction * 100).toFixed(1)}% [${src.dominant_label}]`);
        for (const w of src.windows) {
          console.log(`      "${w.premise_snippet}" → E=${(w.entailment * 100).toFixed(1)}% N=${(w.neutral * 100).toFixed(1)}% C=${(w.contradiction * 100).toFixed(1)}%`);
        }
      }
    }
  }

  // Summary
  const exits = results.filter(r => r.nli_verdict !== 'uncertain');
  const uncertain = results.filter(r => r.nli_verdict === 'uncertain');
  const wrongExits = exits.filter(r => !r.correct);
  const fpExits = exits.filter(r => r.ground_truth === 'valid' && r.nli_verdict === 'invalid');
  const fnExits = exits.filter(r => r.ground_truth === 'invalid' && r.nli_verdict === 'valid');
  const correctExits = exits.filter(r => r.correct);

  console.log('\n' + '═'.repeat(70));
  console.log('  NLI SMOKE TEST SUMMARY');
  console.log('═'.repeat(70));
  console.log(`  Claims tested:      ${results.length} (${validCount} valid GT, ${results.length - validCount} invalid GT)`);
  console.log(`  NLI exits:          ${exits.length}/${results.length} (${((exits.length / results.length) * 100).toFixed(0)}%)`);
  console.log(`    → Correct exits:  ${correctExits.length} (${exits.length > 0 ? ((correctExits.length / exits.length) * 100).toFixed(0) : 0}% exit accuracy)`);
  console.log(`    → FP exits:       ${fpExits.length}  (valid claimed invalid — bad)`);
  console.log(`    → FN exits:       ${fnExits.length}  (invalid claimed valid — bad)`);
  console.log(`  Escalated (T2):     ${uncertain.length}/${results.length} (${((uncertain.length / results.length) * 100).toFixed(0)}%)`);

  if (wrongExits.length > 0) {
    console.log('\n  ⚠️  WRONG EXITS (NLI made a definitive call that was incorrect):');
    for (const r of wrongExits) {
      console.log(`    ${r.claim_id} [${r.claim_type}/${r.derivation}] gt=${r.ground_truth} nli=${r.nli_verdict}`);
      console.log(`      E=${(r.best_entailment * 100).toFixed(1)}% C=${(r.best_contradiction * 100).toFixed(1)}% margin=${(r.signal_margin * 100).toFixed(1)}pp`);
    }
  }

  if (uncertain.length > 0) {
    console.log('\n  ⏭  ESCALATED TO T2 (uncertain — diagnose why):');
    for (const r of uncertain) {
      const gt_icon = r.ground_truth === 'valid' ? '  (valid GT — could have exited)' : '  (invalid GT — escalation is safer)';
      console.log(`    ${r.claim_id} [${r.claim_type}/${r.derivation}] → ${r.escalation_reason}${r.ground_truth === 'valid' ? gt_icon : ''}`);
    }
  }

  console.log('\n  Tuning suggestions:');
  if (fpExits.length > 0) {
    console.log('  • FP exits exist → lower --contra-threshold (currently ' + contraThreshold + ')');
  }
  if (fnExits.length > 0) {
    console.log('  • FN exits exist → raise entailment threshold or --margin');
  }
  const escapedValid = uncertain.filter(r => r.ground_truth === 'valid');
  if (escapedValid.length > exits.length * 0.5) {
    console.log('  • Many valid claims escalating → lower --entail-threshold or --margin to let more through');
  }
  if (wrongExits.length === 0 && fpExits.length === 0 && fnExits.length === 0) {
    console.log('  ✓ No wrong exits. If exit rate is too low, try: --sweep');
  }
  console.log('\n  Try --sweep to see exit rate vs accuracy across all thresholds.');
  console.log('  Try --verbose to see per-window NLI scores for each source.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
