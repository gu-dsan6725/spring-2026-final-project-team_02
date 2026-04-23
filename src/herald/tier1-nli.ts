/**
 * HERALD Tier 1 — NLI client.
 *
 * Calls the local Python NLI service (DeBERTa-v3-large-mnli running via
 * Hugging Face Transformers or ONNX Runtime).  This is intentionally NOT
 * an Anthropic API call — it is the cheap, local filter that prevents
 * unnecessary LLM calls in Tiers 2–3.
 *
 * Routing guard: this module must NEVER be called for predictive, normative,
 * or synthesis claims (skipNLI === true).  The router enforces this, but we
 * also throw here to catch bugs early.
 */

import {
  CLAIM_TYPE_CONFIG,
  ClaimType,
  DerivationMethod,
  type NotesLogEntry,
} from '../types/claims';
import type { TierOutput } from '../types/herald';

// ---------------------------------------------------------------------------
// Backend URL configuration
// ---------------------------------------------------------------------------

const API_BASE =
  (typeof process !== 'undefined' && process.env['NEXT_PUBLIC_API_URL'] !== undefined
    ? process.env['NEXT_PUBLIC_API_URL']
    : null) ?? 'http://localhost:8000';

// ---------------------------------------------------------------------------
// Types mirroring the Python NLI response schema
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Aggregation logic
// ---------------------------------------------------------------------------

interface AggregatedResult {
  bestEntailment: number;
  bestContradiction: number;
  bestNeutral: number;
  supportingSources: number;
  contradictingSources: number;
  neutralSources: number;
}

const CONTRADICTION_THRESHOLD = 0.85;
// DeBERTa frequently mistakes near-paraphrases for contradictions because they use
// different surface wording while preserving the same proposition. Paraphrase claims
// need a higher bar before NLI can exit as "invalid" — the contradiction must be
// near-certain, not just likely.
const CONTRADICTION_THRESHOLD_PARAPHRASE = 0.95;
const DEFAULT_ENTAILMENT_MARGIN = 0.08;
const CAUSAL_PARAPHRASE_ENTAILMENT_MARGIN = 0.2;

// Sliding-window parameters
const MAX_WINDOW_SENTENCES = 3;
// DeBERTa-v3 has a 512-token budget shared between premise and hypothesis.
// Cap premise chars to avoid hard truncation inside the model (~375 words).
const MAX_PREMISE_CHARS = 1500;
const HEDGED_CAUSAL_SOURCE_PATTERN =
  /\b(associated with|association|correlated with|correlation|linked to|coincided with|may|might|could|suggests?|contributed to)\b/i;
const STRONG_CAUSAL_CLAIM_PATTERN =
  /\b(caused?|causing|drives?|driving|led to|results? in|intensif(?:y|ies|ied)|triggered?)\b/i;

function normalizeClaimForNLI(claimText: string): string {
  return claimText
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\b(approximately|roughly|about|around|nearly)\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

function requiredEntailmentMargin(claim: NotesLogEntry): number {
  if (claim.claim_type === ClaimType.Causal && claim.derivation === DerivationMethod.Paraphrase) {
    return CAUSAL_PARAPHRASE_ENTAILMENT_MARGIN;
  }
  return DEFAULT_ENTAILMENT_MARGIN;
}

function hasCausalHedgingMismatch(claim: NotesLogEntry): boolean {
  if (claim.claim_type !== ClaimType.Causal || claim.derivation !== DerivationMethod.Paraphrase) {
    return false;
  }

  const sourceText = claim.sources.map((src) => src.relevant_chunk).join('\n');
  return (
    HEDGED_CAUSAL_SOURCE_PATTERN.test(sourceText) &&
    STRONG_CAUSAL_CLAIM_PATTERN.test(claim.claim_text)
  );
}

// ---------------------------------------------------------------------------
// Sliding-window helpers
// ---------------------------------------------------------------------------

function splitIntoSentences(text: string): string[] {
  // Split only when sentence-terminal punctuation is followed by whitespace
  // then an uppercase letter or opening quote.  This avoids false splits on
  // decimal numbers (5.2%), abbreviations (e.g., U.S.), and mid-sentence
  // ellipses.
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z"'])/);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Build a deduplicated set of premise strings for one source chunk.
 *
 * Generates overlapping windows of 1–MAX_WINDOW_SENTENCES sentences so that
 * the strongest entailing sub-passage is always included, even when surrounding
 * context dilutes the signal on the full chunk.  The full chunk is always
 * included as one window.
 */
function buildChunkWindows(chunk: string): string[] {
  const sentences = splitIntoSentences(chunk);
  const seen = new Set<string>();
  const windows: string[] = [];

  const add = (w: string): void => {
    const trimmed = w.trim().slice(0, MAX_PREMISE_CHARS);
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed);
      windows.push(trimmed);
    }
  };

  // Always include the full chunk first
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

/**
 * Collapse per-window NLI results back to one synthetic item per source.
 *
 * Takes the best signal across all windows:
 *   - entailment  → max (any window entailing the claim counts)
 *   - contradiction → max (any window contradicting the claim counts)
 *   - neutral     → max
 *
 * The label reflects whichever score dominates.
 */
function collapseWindowsToSource(
  results: NLIResponseItem[],
  windowCountsPerSource: number[],
): NLIResponseItem[] {
  const collapsed: NLIResponseItem[] = [];
  let idx = 0;

  for (const count of windowCountsPerSource) {
    const slice = results.slice(idx, idx + count);
    idx += count;

    // Track max contradiction independently — a contradiction anywhere is a signal.
    // For entailment and neutral, link them to the SAME window: use the neutral score
    // from whichever window had the highest entailment, so the signal margin is
    // computed within a single window's probability distribution rather than mixing
    // the best entailment from one window with the worst neutral from another.
    let bestEntailmentWindow = slice[0]!;
    let maxContradiction = 0;

    for (const item of slice) {
      if (item.scores.entailment > bestEntailmentWindow.scores.entailment) {
        bestEntailmentWindow = item;
      }
      if (item.scores.contradiction > maxContradiction) {
        maxContradiction = item.scores.contradiction;
      }
    }

    const maxEntailment = bestEntailmentWindow.scores.entailment;
    const linkedNeutral = bestEntailmentWindow.scores.neutral;

    const label =
      maxEntailment >= maxContradiction && maxEntailment >= linkedNeutral
        ? 'entailment'
        : maxContradiction >= linkedNeutral
          ? 'contradiction'
          : 'neutral';

    collapsed.push({
      label,
      scores: { entailment: maxEntailment, contradiction: maxContradiction, neutral: linkedNeutral },
    });
  }

  return collapsed;
}

function aggregateResults(
  originalItems: NLIResponseItem[],
  canonicalItems: NLIResponseItem[],
): AggregatedResult {
  const sourceCount = originalItems.length;
  let bestEntailment = 0;
  let bestContradiction = 0;
  let bestNeutral = 0;
  let supportingSources = 0;
  let contradictingSources = 0;
  let neutralSources = 0;

  for (let i = 0; i < sourceCount; i++) {
    const original = originalItems[i];
    const canonical = canonicalItems[i] ?? original;
    const entailment = Math.max(original.scores.entailment, canonical.scores.entailment);
    const contradiction = original.scores.contradiction;
    const neutral = Math.max(original.scores.neutral, canonical.scores.neutral);

    bestEntailment = Math.max(bestEntailment, entailment);
    bestContradiction = Math.max(bestContradiction, contradiction);
    bestNeutral = Math.max(bestNeutral, neutral);

    if (contradiction >= entailment && contradiction >= neutral) {
      contradictingSources++;
    } else if (entailment >= contradiction && entailment >= neutral) {
      supportingSources++;
    } else {
      neutralSources++;
    }
  }

  return {
    bestEntailment,
    bestContradiction,
    bestNeutral,
    supportingSources,
    contradictingSources,
    neutralSources,
  };
}

// ---------------------------------------------------------------------------
// HTTP call
// ---------------------------------------------------------------------------

async function callNLIBatch(
  pairs: Array<{ premise: string; hypothesis: string }>,
): Promise<NLIBatchResponse> {
  const url = `${API_BASE}/api/herald/nli/batch`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairs }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`NLI service error ${String(response.status)}: ${body}`);
  }

  return response.json() as Promise<NLIBatchResponse>;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Evaluate a claim at HERALD Tier 1 using the local NLI model.
 *
 * @throws {Error} if the claim type has skipNLI === true
 *   (router should prevent this, but we guard defensively)
 */
export async function evaluateWithNLI(claim: NotesLogEntry): Promise<TierOutput> {
  const config = CLAIM_TYPE_CONFIG[claim.claim_type];

  // Guard: Tier 1 is invalid for predictive / normative / synthesis claims
  if (config.skipNLI) {
    throw new Error(
      `evaluateWithNLI() called for claim type '${claim.claim_type}' which has skipNLI=true. ` +
        `The router must direct this claim type to Tier 2.`,
    );
  }

  const threshold = config.nliEscalationThreshold ?? 0.9;
  const entailmentMargin = requiredEntailmentMargin(claim);

  // Build windowed pairs: each source chunk is expanded into overlapping
  // sentence windows so the NLI model sees every sub-passage, not just the
  // full chunk (which can dilute the signal when surrounding context is weak).
  const chunkWindowsPerSource = claim.sources.map((src) => buildChunkWindows(src.relevant_chunk));
  const windowCountsPerSource = chunkWindowsPerSource.map((w) => w.length);

  const canonicalHypothesis =
    claim.derivation === DerivationMethod.Paraphrase
      ? normalizeClaimForNLI(claim.claim_text)
      : claim.claim_text;
  const useCanonicalHypothesis =
    claim.derivation === DerivationMethod.Paraphrase && canonicalHypothesis !== claim.claim_text;

  const originalFlatPairs = chunkWindowsPerSource.flatMap((windows) =>
    windows.map((premise) => ({ premise, hypothesis: claim.claim_text })),
  );
  const canonicalFlatPairs = useCanonicalHypothesis
    ? chunkWindowsPerSource.flatMap((windows) =>
        windows.map((premise) => ({ premise, hypothesis: canonicalHypothesis })),
      )
    : originalFlatPairs;

  const [batchResponse, canonicalBatchResponse] = await Promise.all([
    callNLIBatch(originalFlatPairs),
    useCanonicalHypothesis
      ? callNLIBatch(canonicalFlatPairs)
      : Promise.resolve<NLIBatchResponse>({ results: [] }),
  ]);

  // Collapse window results back to one best item per source before aggregating
  const perSourceOriginal = collapseWindowsToSource(batchResponse.results, windowCountsPerSource);
  const perSourceCanonical =
    canonicalBatchResponse.results.length > 0
      ? collapseWindowsToSource(canonicalBatchResponse.results, windowCountsPerSource)
      : perSourceOriginal;

  const agg = aggregateResults(perSourceOriginal, perSourceCanonical);
  const bestSignalMargin = agg.bestEntailment - Math.max(agg.bestContradiction, agg.bestNeutral);
  const hedgingMismatch = hasCausalHedgingMismatch(claim);

  // Paraphrase claims use a higher contradiction threshold: DeBERTa frequently mistakes
  // near-paraphrases for contradictions because they use different surface wording while
  // preserving the same proposition. Only exit as invalid if the contradiction is near-certain.
  const effectiveContradictionThreshold =
    claim.derivation === DerivationMethod.Paraphrase
      ? CONTRADICTION_THRESHOLD_PARAPHRASE
      : CONTRADICTION_THRESHOLD;

  // ---------------------------------------------------------------------------
  // Decision logic
  // ---------------------------------------------------------------------------

  if (
    agg.bestEntailment >= threshold &&
    agg.bestContradiction < effectiveContradictionThreshold &&
    bestSignalMargin >= entailmentMargin &&
    !hedgingMismatch
  ) {
    return {
      tier_id: 1,
      verdict: 'valid',
      confidence: agg.bestEntailment,
      reasoning:
        `Strong support found in ${String(agg.supportingSources)} of ${String(claim.sources.length)} ` +
        `source chunk(s); best entailment ${(agg.bestEntailment * 100).toFixed(1)}% ` +
        `with signal margin ${(bestSignalMargin * 100).toFixed(1)} points and no strong contradiction ` +
        `(max contradiction ${(agg.bestContradiction * 100).toFixed(1)}%, ` +
        `threshold ${(effectiveContradictionThreshold * 100).toFixed(0)}%).`,
    };
  }

  if (agg.bestContradiction >= effectiveContradictionThreshold) {
    return {
      tier_id: 1,
      verdict: 'invalid',
      confidence: agg.bestContradiction,
      reasoning:
        `NLI detected a contradiction between the claim and ` +
        `${String(agg.contradictingSources)} of ${String(claim.sources.length)} source chunk(s). ` +
        `Best contradiction confidence: ${(agg.bestContradiction * 100).toFixed(1)}%.`,
      suggested_revision:
        'Verify the claim against the cited source. The claim may misrepresent the direction ' +
        'or magnitude of the finding. Consider quoting directly or paraphrasing more carefully.',
    };
  }

  // Neutral, mixed signals, or confidence below threshold → escalate
  const escalationReason = hedgingMismatch
    ? 'Causal hedging mismatch detected between source language and claim phrasing.'
    : bestSignalMargin < entailmentMargin
      ? `Signal margin ${(bestSignalMargin * 100).toFixed(1)} points is below the ${(entailmentMargin * 100).toFixed(0)}-point requirement.`
      : 'Entailment remains below the acceptance threshold.';
  return {
    tier_id: 1,
    verdict: 'uncertain',
    confidence: agg.bestEntailment,
    reasoning:
      `${escalationReason} ` +
      `NLI result inconclusive across ${String(claim.sources.length)} source(s): ` +
      `${String(agg.supportingSources)} support-leading, ${String(agg.neutralSources)} neutral-leading, ` +
      `${String(agg.contradictingSources)} contradiction-leading. Best entailment ` +
      `${(agg.bestEntailment * 100).toFixed(1)}%, best contradiction ` +
      `${(agg.bestContradiction * 100).toFixed(1)}%, best neutral ${(agg.bestNeutral * 100).toFixed(1)}%, ` +
      `threshold ${(threshold * 100).toFixed(0)}%. ` +
      `Escalating to Tier 2.`,
  };
}
