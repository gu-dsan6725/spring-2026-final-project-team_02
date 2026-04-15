"""
HERALD Tier 1: NLI evaluation.

Wraps the NLIService singleton to evaluate a claim against its source excerpts
and produce a structured TierOutput. This is the cheap, local filter that runs
before any Anthropic API calls.

Decision thresholds (from CLAUDE.md routing table):
- statistical / comparative: 0.9 entailment confidence required for VALID exit
- causal: 0.85 (lower bar — NLI catches misquotes but misses correlation-as-causation)
- contradiction score ≥ 0.8 across any source → INVALID exit
"""

from __future__ import annotations

import logging

from policy_memo_agent.models.claims import NotesLogEntry
from policy_memo_agent.models.herald import TierOneOutput, TierOutput, Verdict
from policy_memo_agent.services.nli_service import NLIService, get_nli_service

logger = logging.getLogger(__name__)

_CONTRADICTION_EXIT_THRESHOLD = 0.8


def run_tier1(
    claim: NotesLogEntry,
    *,
    nli_service: NLIService | None = None,
    threshold: float | None = 0.9,
) -> TierOutput:
    """
    Run Tier 1 NLI evaluation synchronously.

    Evaluates the claim text against each source excerpt via the NLI model.
    Takes the best entailment and highest contradiction scores across all sources.

    Parameters
    ----------
    claim:
        The notes log entry to evaluate.
    nli_service:
        NLI service to use. Defaults to the module-level singleton.
        Inject a mock in tests.
    threshold:
        Minimum entailment confidence for a VALID exit. From the routing table.
        None defaults to 0.9.

    Returns
    -------
    TierOutput (tier=1). If verdict is UNCERTAIN, the router escalates to Tier 2.
    If the model is not loaded, the tier is skipped (skipped=True).
    """
    service = nli_service if nli_service is not None else get_nli_service()
    effective_threshold = threshold if threshold is not None else 0.9

    if not service.is_loaded():
        logger.warning("NLI model not loaded — skipping Tier 1 for claim %s", claim.claim_id)
        return TierOutput(tier=1, skipped=True, skip_reason="NLI model not loaded")

    pairs = [(src.relevant_chunk, claim.claim_text) for src in claim.sources]

    try:
        results = service.predict_batch(pairs)
    except Exception:
        logger.exception("NLI inference failed for claim %s — skipping Tier 1", claim.claim_id)
        return TierOutput(tier=1, skipped=True, skip_reason="NLI inference error")

    best_entailment = max((r.scores.get("entailment", 0.0) for r in results), default=0.0)
    max_contradiction = max((r.scores.get("contradiction", 0.0) for r in results), default=0.0)
    best_neutral = max((r.scores.get("neutral", 0.0) for r in results), default=0.0)

    if max_contradiction >= _CONTRADICTION_EXIT_THRESHOLD:
        verdict = Verdict.INVALID
        confidence = max_contradiction
        reasoning = (
            f"Strong contradiction detected across source excerpts "
            f"(contradiction_score={max_contradiction:.3f})"
        )
    elif best_entailment >= effective_threshold:
        verdict = Verdict.VALID
        confidence = best_entailment
        reasoning = (
            f"Entailment confirmed across source excerpts "
            f"(score={best_entailment:.3f} ≥ threshold={effective_threshold})"
        )
    else:
        verdict = Verdict.UNCERTAIN
        confidence = best_entailment
        reasoning = (
            f"Entailment below threshold — escalating to Tier 2 "
            f"(score={best_entailment:.3f}, threshold={effective_threshold})"
        )

    output = TierOneOutput(
        entailment_score=best_entailment,
        neutral_score=best_neutral,
        contradiction_score=max_contradiction,
        verdict=verdict,
        confidence=confidence,
        reasoning=reasoning,
    )
    logger.info(
        "Tier 1 complete claim_id=%s verdict=%s confidence=%.2f",
        claim.claim_id,
        verdict,
        confidence,
    )
    return TierOutput(tier=1, output=output)
