/**
 * HERALD claim router.
 *
 * Determines the starting HERALD tier for a claim based on its claim_type,
 * then runs the evaluation pipeline with proper tier escalation.
 *
 * Routing table (mirrors CLAUDE.md and CLAIM_TYPE_CONFIG):
 *
 *   statistical  → Tier 1, NLI threshold 0.90
 *   comparative  → Tier 1, NLI threshold 0.90
 *   causal       → Tier 1, NLI threshold 0.85 (lower bar)
 *   predictive   → skip to Tier 2  (NLI cannot evaluate projections)
 *   normative    → skip to Tier 2  (NLI cannot evaluate prescriptions)
 *   synthesis    → skip to Tier 2  (no single source entails synthesis)
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
  const config = CLAIM_TYPE_CONFIG[claim.claim_type];
  if (config.skipNLI) {
    return {
      startTier: 2,
      skipNLI: true,
      nliThreshold: null,
      rationale: `Claim type '${claim.claim_type}' skips NLI — starting at Tier 2.`,
    };
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
export async function evaluateClaim(claim: NotesLogEntry): Promise<HeraldResult> {
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
  tier2Output = await evaluateWithLLMJudge(claim, tier1Output !== null ? tier1Output : undefined);
  tierDetails.tier_2 = tier2Output;

  if (tier2Output.verdict !== 'uncertain') {
    // Confident verdict from Tier 2 — exit
    return _buildResult(claim, tier2Output.verdict, tier2Output, tierDetails);
  }

  // -- Tier 3 — Multi-Agent Debate --
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
