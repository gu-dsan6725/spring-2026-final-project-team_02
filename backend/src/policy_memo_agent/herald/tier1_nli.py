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
import re

from policy_memo_agent.models.claims import DerivationMethod, NotesLogEntry
from policy_memo_agent.models.herald import TierOneOutput, TierOutput, Verdict
from policy_memo_agent.services.nli_service import NLIService, get_nli_service

logger = logging.getLogger(__name__)

_CONTRADICTION_EXIT_THRESHOLD = 0.7
_DEFAULT_ENTAILMENT_MARGIN = 0.12
_CAUSAL_PARAPHRASE_ENTAILMENT_MARGIN = 0.2
_HEDGED_CAUSAL_SOURCE_PATTERN = re.compile(
    r"\b(associated with|association|correlated with|correlation|linked to|coincided with|may|might|could|suggests?|contributed to)\b",
    re.I,
)
_STRONG_CAUSAL_CLAIM_PATTERN = re.compile(
    r"\b(caused?|causing|drives?|driving|led to|results? in|intensif(?:y|ies|ied)|triggered?)\b",
    re.I,
)


def _normalize_claim_for_nli(claim_text: str) -> str:
    """Apply conservative surface normalization for paraphrase-friendly NLI."""
    text = claim_text.replace("\u201c", '"').replace("\u201d", '"').replace("\u2019", "'")
    text = re.sub(r"\b(approximately|roughly|about|around|nearly)\b", "", text, flags=re.I)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+([,.;:])", r"\1", text)
    return text.strip()


def _required_entailment_margin(claim: NotesLogEntry) -> float:
    if claim.claim_type == "causal" and claim.derivation == DerivationMethod.PARAPHRASE:
        return _CAUSAL_PARAPHRASE_ENTAILMENT_MARGIN
    return _DEFAULT_ENTAILMENT_MARGIN


def _has_causal_hedging_mismatch(claim: NotesLogEntry) -> bool:
    if claim.claim_type != "causal" or claim.derivation != DerivationMethod.PARAPHRASE:
        return False
    source_text = "\n".join(src.relevant_chunk for src in claim.sources)
    return bool(
        _HEDGED_CAUSAL_SOURCE_PATTERN.search(source_text)
        and _STRONG_CAUSAL_CLAIM_PATTERN.search(claim.claim_text)
    )


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
    entailment_margin = _required_entailment_margin(claim)

    if not service.is_loaded():
        logger.warning("NLI model not loaded — skipping Tier 1 for claim %s", claim.claim_id)
        return TierOutput(tier=1, skipped=True, skip_reason="NLI model not loaded")

    original_pairs = [(src.relevant_chunk, claim.claim_text) for src in claim.sources]
    canonical_claim_text = (
        _normalize_claim_for_nli(claim.claim_text)
        if claim.derivation == DerivationMethod.PARAPHRASE
        else claim.claim_text
    )
    use_canonical_claim = canonical_claim_text != claim.claim_text
    canonical_pairs = (
        [(src.relevant_chunk, canonical_claim_text) for src in claim.sources]
        if use_canonical_claim
        else original_pairs
    )

    try:
        original_results = service.predict_batch(original_pairs)
        canonical_results = (
            service.predict_batch(canonical_pairs) if use_canonical_claim else original_results
        )
    except Exception:
        logger.exception("NLI inference failed for claim %s — skipping Tier 1", claim.claim_id)
        return TierOutput(tier=1, skipped=True, skip_reason="NLI inference error")

    best_entailment = 0.0
    max_contradiction = 0.0
    best_neutral = 0.0
    support_leading = 0
    contradiction_leading = 0
    neutral_leading = 0

    for original, canonical in zip(original_results, canonical_results, strict=True):
        entailment = max(
            original.scores.get("entailment", 0.0),
            canonical.scores.get("entailment", 0.0),
        )
        contradiction = original.scores.get("contradiction", 0.0)
        neutral = max(
            original.scores.get("neutral", 0.0),
            canonical.scores.get("neutral", 0.0),
        )
        best_entailment = max(best_entailment, entailment)
        max_contradiction = max(max_contradiction, contradiction)
        best_neutral = max(best_neutral, neutral)

        if contradiction >= entailment and contradiction >= neutral:
            contradiction_leading += 1
        elif entailment >= contradiction and entailment >= neutral:
            support_leading += 1
        else:
            neutral_leading += 1

    best_signal_margin = best_entailment - max(max_contradiction, best_neutral)
    hedging_mismatch = _has_causal_hedging_mismatch(claim)

    if max_contradiction >= _CONTRADICTION_EXIT_THRESHOLD:
        verdict = Verdict.INVALID
        confidence = max_contradiction
        reasoning = (
            f"Strong contradiction detected across {contradiction_leading} source excerpt(s) "
            f"(contradiction_score={max_contradiction:.3f})"
        )
    elif (
        best_entailment >= effective_threshold
        and best_signal_margin >= entailment_margin
        and not hedging_mismatch
    ):
        verdict = Verdict.VALID
        confidence = best_entailment
        reasoning = (
            f"Strong support found in {support_leading} source excerpt(s) "
            f"(best_entailment={best_entailment:.3f} ≥ threshold={effective_threshold}, "
            f"signal_margin={best_signal_margin:.3f})"
        )
    else:
        verdict = Verdict.UNCERTAIN
        confidence = best_entailment
        escalation_reason = (
            "Causal hedging mismatch detected between source language and claim phrasing"
            if hedging_mismatch
            else f"Signal margin {best_signal_margin:.3f} is below the required {entailment_margin:.3f}"
            if best_signal_margin < entailment_margin
            else "Entailment below threshold"
        )
        reasoning = (
            f"{escalation_reason} — escalating to Tier 2 "
            f"(best_entailment={best_entailment:.3f}, max_contradiction={max_contradiction:.3f}, "
            f"best_neutral={best_neutral:.3f}, support={support_leading}, neutral={neutral_leading}, contradiction={contradiction_leading}, "
            f"threshold={effective_threshold})"
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
