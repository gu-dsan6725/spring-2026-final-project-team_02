"""
HERALD evaluation router.

Routes each claim to the appropriate starting tier based on claim type,
then escalates through tiers until a confident verdict is reached or
Tier 4 (human review) is flagged.

Routing table (from CLAUDE.md):
┌──────────────────┬────────────┬───────────────────────────────────────┐
│ Claim Type       │ Start Tier │ NLI Threshold                         │
├──────────────────┼────────────┼───────────────────────────────────────┤
│ Statistical      │ 1          │ 0.9                                   │
│ Comparative      │ 1          │ 0.9                                   │
│ Causal           │ 1          │ 0.85 (lower — misses correlation)     │
│ Predictive       │ 2 (skip)   │ N/A                                   │
│ Normative        │ 2 (skip)   │ N/A                                   │
│ Synthesis        │ 2 (skip)   │ N/A                                   │
└──────────────────┴────────────┴───────────────────────────────────────┘

Escalation conditions:
- Tier 1: verdict == UNCERTAIN or tier skipped → Tier 2
- Tier 2: verdict == UNCERTAIN → Tier 3
- Tier 3: verdict == UNCERTAIN → Tier 4 (human review)
"""

from __future__ import annotations

import logging

import anthropic

from policy_memo_agent.herald.tier1_nli import run_tier1
from policy_memo_agent.herald.tier2_judge import run_tier2
from policy_memo_agent.herald.tier3_debate import run_debate
from policy_memo_agent.models.claims import NotesLogEntry, get_routing_config
from policy_memo_agent.models.herald import (
    DebateOutput,
    HeraldResult,
    TierOneOutput,
    TierOutput,
    TierTwoOutput,
    Verdict,
)
from policy_memo_agent.services.nli_service import NLIService

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal helpers for extracting typed fields from polymorphic TierOutput
# ---------------------------------------------------------------------------


def _get_verdict(tier_output: TierOutput) -> Verdict | None:
    """Return the verdict from any tier output, or None if skipped/empty."""
    if tier_output.skipped or tier_output.output is None:
        return None
    output = tier_output.output
    if isinstance(output, DebateOutput):
        return output.final_verdict
    # TierOneOutput and TierTwoOutput both have .verdict
    return output.verdict


def _get_confidence(tier_output: TierOutput) -> float:
    """Return the confidence score from any tier output."""
    if tier_output.output is None:
        return 0.0
    return tier_output.output.confidence


def _get_suggested_revision(tier_output: TierOutput) -> str | None:
    """Return a suggested revision if the tier produced one."""
    if tier_output.output is None:
        return None
    output = tier_output.output
    if isinstance(output, (TierTwoOutput, DebateOutput)):
        return output.suggested_revision
    return None


def _build_feedback(tier_output: TierOutput, verdict: Verdict) -> str:
    """Generate human-readable feedback text from a tier output."""
    if tier_output.output is None:
        return "Evaluation could not be completed."
    output = tier_output.output
    if isinstance(output, TierOneOutput):
        return output.reasoning
    if isinstance(output, TierTwoOutput):
        return output.reasoning
    if isinstance(output, DebateOutput):
        return output.judge_synthesis
    return f"Verdict: {verdict}"


def _build_result(
    claim_id: str,
    tier_reached: int,
    deciding_output: TierOutput,
    tier_details: dict[str, TierOutput | None],
) -> HeraldResult:
    """Assemble the final HeraldResult from the tier that produced the verdict."""
    verdict = _get_verdict(deciding_output) or Verdict.UNCERTAIN
    return HeraldResult(
        claim_id=claim_id,
        tier_reached=tier_reached,
        verdict=verdict,
        confidence=_get_confidence(deciding_output),
        feedback=_build_feedback(deciding_output, verdict),
        suggested_revision=_get_suggested_revision(deciding_output),
        tier_details=tier_details,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def evaluate_claim(
    claim: NotesLogEntry,
    *,
    policy_topic: str = "public policy",
    nli_service: NLIService | None = None,
    anthropic_client: anthropic.AsyncAnthropic | None = None,
) -> HeraldResult:
    """
    Evaluate a single claim through the full HERALD pipeline.

    Routes the claim to the correct starting tier based on its type, then
    escalates through tiers until a confident verdict is reached or Tier 4
    (human review) is required.

    Parameters
    ----------
    claim:
        The notes log entry with full provenance (claim text, type,
        derivation, sources, and reasoning).
    policy_topic:
        The policy domain. Used to personalise the Tier 3 Domain Expert persona.
    nli_service:
        Optional NLI service override for testing; defaults to module singleton.
    anthropic_client:
        Optional Anthropic async client override for testing.

    Returns
    -------
    HeraldResult with the final verdict, feedback, and all tier_details populated.
    tier_reached=4 means the claim requires human review.
    """
    routing = get_routing_config(claim.claim_type)
    tier_details: dict[str, TierOutput | None] = {
        "tier_1": None,
        "tier_2": None,
        "tier_3": None,
        "tier_4": None,
    }
    accumulated: list[TierOutput] = []

    # ── Tier 1: NLI ──────────────────────────────────────────────────────────
    # Claims that bypass NLI (start_tier > 1 or skip_nli=True) still receive a
    # skipped TierOutput so the UI and HeraldResult always have all four tier keys.
    if routing.start_tier > 1 or routing.skip_nli:
        t1 = TierOutput(
            tier=1,
            skipped=True,
            skip_reason=routing.rationale,
        )
        tier_details["tier_1"] = t1
        accumulated.append(t1)
    else:
        t1 = run_tier1(
            claim,
            nli_service=nli_service,
            threshold=routing.nli_threshold,
        )
        tier_details["tier_1"] = t1
        accumulated.append(t1)

        verdict = _get_verdict(t1)
        if verdict is not None and verdict != Verdict.UNCERTAIN:
            logger.info("Claim %s resolved at Tier 1: %s", claim.claim_id, verdict)
            return _build_result(claim.claim_id, 1, t1, tier_details)

    # ── Tier 2: LLM Judge ────────────────────────────────────────────────────
    if routing.start_tier <= 2:
        t2 = await run_tier2(claim, accumulated, client=anthropic_client)
        tier_details["tier_2"] = t2
        accumulated.append(t2)

        verdict = _get_verdict(t2)
        if verdict is not None and verdict != Verdict.UNCERTAIN:
            logger.info("Claim %s resolved at Tier 2: %s", claim.claim_id, verdict)
            return _build_result(claim.claim_id, 2, t2, tier_details)

    # ── Tier 3: Multi-Agent Debate ───────────────────────────────────────────
    t3 = await run_debate(
        claim,
        accumulated,
        policy_topic=policy_topic,
        client=anthropic_client,
    )
    tier_details["tier_3"] = t3
    accumulated.append(t3)

    verdict = _get_verdict(t3)
    if verdict is not None and verdict != Verdict.UNCERTAIN:
        logger.info("Claim %s resolved at Tier 3: %s", claim.claim_id, verdict)
        return _build_result(claim.claim_id, 3, t3, tier_details)

    # ── Tier 4: Human Review ─────────────────────────────────────────────────
    logger.info(
        "Claim %s could not be resolved — escalating to Tier 4 (human review)",
        claim.claim_id,
    )
    t4 = TierOutput(tier=4, skipped=False)
    tier_details["tier_4"] = t4

    # Use the richest available evaluation (Tier 3) for feedback
    return HeraldResult(
        claim_id=claim.claim_id,
        tier_reached=4,
        verdict=Verdict.UNCERTAIN,
        confidence=_get_confidence(t3),
        feedback=(
            "Claim requires human review — no confident verdict after Tier 3. "
            f"Tier 3 synthesis: {_build_feedback(t3, Verdict.UNCERTAIN)}"
        ),
        suggested_revision=_get_suggested_revision(t3),
        tier_details=tier_details,
    )
