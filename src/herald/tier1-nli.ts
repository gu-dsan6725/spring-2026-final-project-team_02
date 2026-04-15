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

import { CLAIM_TYPE_CONFIG, type NotesLogEntry } from '../types/claims';
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

type AggregatedLabel = 'entailment' | 'neutral' | 'contradiction';

interface AggregatedResult {
  label: AggregatedLabel;
  /** Confidence of the winning label, averaged across sources. */
  confidence: number;
  /** Raw scores per source, for reasoning. */
  perSourceScores: NLIScores[];
}

/**
 * Aggregate NLI results across multiple sources for a single claim.
 *
 * Rules (in priority order):
 * 1. Any source returns contradiction → aggregate = contradiction
 *    (confidence = max contradiction score across all sources)
 * 2. All sources return entailment → aggregate = entailment
 *    (confidence = min entailment score — weakest link)
 * 3. Mixed → aggregate = neutral
 *    (confidence = average neutral score)
 */
function aggregateResults(items: NLIResponseItem[]): AggregatedResult {
  const perSourceScores = items.map((i) => i.scores);

  const contradictionScores = items
    .filter((i) => i.label === 'contradiction')
    .map((i) => i.scores.contradiction);

  if (contradictionScores.length > 0) {
    const maxContradiction = Math.max(...contradictionScores);
    return { label: 'contradiction', confidence: maxContradiction, perSourceScores };
  }

  const allEntail = items.every((i) => i.label === 'entailment');
  if (allEntail) {
    // Use the minimum entailment score (weakest-link aggregation)
    const minEntailment = Math.min(...items.map((i) => i.scores.entailment));
    return { label: 'entailment', confidence: minEntailment, perSourceScores };
  }

  // Mixed signals → neutral
  const avgNeutral =
    perSourceScores.reduce((sum, s) => sum + s.neutral, 0) / perSourceScores.length;
  return { label: 'neutral', confidence: avgNeutral, perSourceScores };
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

  // Build premise–hypothesis pairs: one per source chunk
  const pairs = claim.sources.map((src) => ({
    premise: src.relevant_chunk,
    hypothesis: claim.claim_text,
  }));

  const batchResponse = await callNLIBatch(pairs);
  const agg = aggregateResults(batchResponse.results);

  // ---------------------------------------------------------------------------
  // Decision logic
  // ---------------------------------------------------------------------------

  if (agg.label === 'entailment' && agg.confidence >= threshold) {
    return {
      tier_id: 1,
      verdict: 'valid',
      confidence: agg.confidence,
      reasoning:
        `All ${String(pairs.length)} source(s) entail the claim with confidence ` +
        `${(agg.confidence * 100).toFixed(1)}% (threshold: ${(threshold * 100).toFixed(0)}%).`,
    };
  }

  if (agg.label === 'contradiction' && agg.confidence > 0.7) {
    const contradictingCount = batchResponse.results.filter(
      (r) => r.label === 'contradiction',
    ).length;
    return {
      tier_id: 1,
      verdict: 'invalid',
      confidence: agg.confidence,
      reasoning:
        `NLI detected a contradiction between the claim and ` +
        `${String(contradictingCount)} of ${String(pairs.length)} source chunk(s). ` +
        `Contradiction confidence: ${(agg.confidence * 100).toFixed(1)}%.`,
      suggested_revision:
        'Verify the claim against the cited source. The claim may misrepresent the direction ' +
        'or magnitude of the finding. Consider quoting directly or paraphrasing more carefully.',
    };
  }

  // Neutral, mixed signals, or confidence below threshold → escalate
  const entailCount = batchResponse.results.filter((r) => r.label === 'entailment').length;
  const neutralCount = batchResponse.results.filter((r) => r.label === 'neutral').length;
  const contraCount = batchResponse.results.filter((r) => r.label === 'contradiction').length;

  return {
    tier_id: 1,
    verdict: 'uncertain',
    confidence: agg.confidence,
    reasoning:
      `NLI result inconclusive across ${String(pairs.length)} source(s): ` +
      `${String(entailCount)} entailment, ${String(neutralCount)} neutral, ${String(contraCount)} contradiction. ` +
      `Aggregate label '${agg.label}' with confidence ${(agg.confidence * 100).toFixed(1)}% ` +
      `(threshold: ${(threshold * 100).toFixed(0)}%). Escalating to Tier 2.`,
  };
}
