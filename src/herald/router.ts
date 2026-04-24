/**
 * HERALD claim router.
 *
 * Determines the starting HERALD tier for a claim based on its claim_type,
 * then runs the evaluation pipeline with proper tier escalation.
 *
 * Routing table (mirrors CLAUDE.md and CLAIM_TYPE_CONFIG):
 *
 *   statistical  → Tier 1, NLI threshold 0.99
 *   comparative  → Tier 1, NLI threshold 0.99
 *   causal       → Tier 1, NLI threshold 0.94 (lower bar)
 *   predictive   → skip to Tier 2  (NLI cannot evaluate projections)
 *   normative    → skip to Tier 2  (NLI cannot evaluate prescriptions)
 *   synthesis    → skip to Tier 2  (no single source entails synthesis)
 *
 * Tier 3 runs only when T2 is uncertain — the previous high-risk derivation override
 * (agent_inference / cross_source always → T3) was removed after data showed it
 * degraded accuracy by forcing correct T2 verdicts into an adversarial T3 stage.
 */

import { CLAIM_TYPE_CONFIG, type ClaimType, type NotesLogEntry } from '../types/claims';
import type { HeraldResult, TierOutput } from '../types/herald';
import { evaluateWithNLI } from './tier1-nli';
import { evaluateWithLLMJudge } from './tier2-llm-judge';
import { evaluateWithDebate } from './tier3-debate';
import { logWarn } from '../observability/braintrust';

// ---------------------------------------------------------------------------
// Tier routing
// ---------------------------------------------------------------------------

export interface RouteDecision {
  startTier: 1 | 2;
  skipNLI: boolean;
  nliThreshold: number | null;
  rationale: string;
}

/** Determine which tier a claim should start evaluation at. */
export function routeClaim(claim: NotesLogEntry): RouteDecision {
  // Cast through unknown so the null check is valid at runtime — LLMs can hallucinate
  // claim types not present in CLAIM_TYPE_CONFIG.
  const config = (
    CLAIM_TYPE_CONFIG as unknown as Record<
      string,
      (typeof CLAIM_TYPE_CONFIG)[keyof typeof CLAIM_TYPE_CONFIG] | undefined
    >
  )[claim.claim_type];
  if (config == null || config.skipNLI) {
    const rationale =
      config == null
        ? `Unknown claim type '${claim.claim_type}' — defaulting to Tier 2.`
        : `Claim type '${claim.claim_type}' skips NLI — starting at Tier 2.`;
    return { startTier: 2, skipNLI: true, nliThreshold: null, rationale };
  }
  return {
    startTier: 1,
    skipNLI: false,
    nliThreshold: config.nliEscalationThreshold,
    rationale:
      `Claim type '${claim.claim_type}' starts at Tier 1 ` +
      `(NLI threshold: ${String((config.nliEscalationThreshold ?? 0.9) * 100)}%).`,
  };
}

// ---------------------------------------------------------------------------
// Full pipeline
// ---------------------------------------------------------------------------

/**
 * Run the HERALD evaluation pipeline for a single claim.
 *
 * - If skipNLI is false: run Tier 1; escalate to Tier 2 only on 'uncertain'.
 * - If skipNLI is true: skip directly to Tier 2.
 *
 * Returns a full HeraldResult suitable for agent revision feedback.
 */
export async function evaluateClaim(
  claim: NotesLogEntry,
  policyTopic?: string,
  memoSummary?: string,
): Promise<HeraldResult> {
  const route = routeClaim(claim);
  const tierDetails: HeraldResult['tier_details'] = {
    tier_1: null,
    tier_2: null,
    tier_3: null,
    tier_4: null,
  };

  let tier1Output: TierOutput | null = null;
  let tier2Output: TierOutput | null = null;

  // -- Tier 1 --
  if (!route.skipNLI) {
    try {
      tier1Output = await evaluateWithNLI(claim);
      tierDetails.tier_1 = tier1Output;

      if (tier1Output.verdict === 'valid' || tier1Output.verdict === 'invalid') {
        // Early exit: confident verdict from Tier 1
        return _buildResult(claim, tier1Output.verdict, tier1Output, tierDetails);
      }
      // 'uncertain' → fall through to Tier 2
    } catch (err) {
      // NLI backend unavailable (e.g. Python service not running) — skip to Tier 2
      logWarn('herald.tier1.unavailable', {
        claim_id: claim.claim_id,
        reason: err instanceof Error ? err.message : String(err),
        note: 'Falling back to Tier 2 (LLM Judge).',
      });
      // tier1Output stays null; Tier 2 runs without NLI context
    }
  }

  // -- Tier 2 --
  tier2Output = await evaluateWithLLMJudge(
    claim,
    tier1Output !== null ? tier1Output : undefined,
    policyTopic,
    memoSummary,
  );
  tierDetails.tier_2 = tier2Output;

  if (tier2Output.verdict !== 'uncertain') {
    // Confident verdict from Tier 2 — exit regardless of derivation.
    // The previous "high-risk override" that forced agent_inference/cross_source
    // to T3 was removed: data showed T3 was overriding correct T2 verdicts more
    // often than it was catching genuine errors, degrading accuracy by 2-3pp.
    return _buildResult(claim, tier2Output.verdict, tier2Output, tierDetails);
  }

  // -- Tier 3 — Senior Reviewer --
  // Runs only when T2 is genuinely uncertain (confidence ≤ threshold).
  const tier3Output = await evaluateWithDebate(claim, tier2Output);
  tierDetails.tier_3 = tier3Output;

  return _buildResult(claim, tier3Output.verdict, tier3Output, tierDetails);
}

// ---------------------------------------------------------------------------
// Result builder
// ---------------------------------------------------------------------------

function _buildResult(
  claim: NotesLogEntry,
  verdict: HeraldResult['verdict'],
  decidingTier: TierOutput,
  tierDetails: HeraldResult['tier_details'],
): HeraldResult {
  const tierReached = decidingTier.tier_id;
  return {
    claim_id: claim.claim_id,
    tier_reached: tierReached,
    verdict,
    confidence: decidingTier.confidence,
    feedback: decidingTier.reasoning,
    suggested_revision: decidingTier.suggested_revision ?? null,
    tier_details: tierDetails,
  };
}

// ---------------------------------------------------------------------------
// Convenience: which claim types skip Tier 1?
// ---------------------------------------------------------------------------

export function claimTypesSkippingNLI(): ClaimType[] {
  return (
    Object.entries(CLAIM_TYPE_CONFIG) as Array<[ClaimType, (typeof CLAIM_TYPE_CONFIG)[ClaimType]]>
  )
    .filter(([, cfg]) => cfg.skipNLI)
    .map(([claimType]) => claimType);
}

export function claimTypesUsingNLI(): ClaimType[] {
  return (
    Object.entries(CLAIM_TYPE_CONFIG) as Array<[ClaimType, (typeof CLAIM_TYPE_CONFIG)[ClaimType]]>
  )
    .filter(([, cfg]) => !cfg.skipNLI)
    .map(([claimType]) => claimType);
}
