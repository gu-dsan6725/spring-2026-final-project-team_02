"""
HERALD Tier 3: Multi-Agent Debate.

Runs three independent persona evaluations in parallel (Domain Expert, Methodologist,
Skeptic), then synthesizes their verdicts with a Judge agent.

Decision logic (CLAUDE.md):
- Unanimous (3/3 agree) → exit with that verdict, boost confidence to ≥ 0.9
- 2-1 majority + judge_confidence > 0.75 → exit with the majority verdict
- 3-way split OR judge_confidence ≤ 0.75 → UNCERTAIN, escalate to Tier 4
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from collections import Counter

import anthropic
from anthropic.types import TextBlock

from policy_memo_agent.herald.prompts.domain_expert import get_domain_expert_prompt
from policy_memo_agent.herald.prompts.judge_synthesis import get_judge_synthesis_prompt
from policy_memo_agent.herald.prompts.methodologist import get_methodologist_prompt
from policy_memo_agent.herald.prompts.skeptic import get_skeptic_prompt
from policy_memo_agent.models.claims import NotesLogEntry
from policy_memo_agent.models.herald import (
    DebateOutput,
    DebatePersona,
    PersonaOutput,
    TierOutput,
    Verdict,
)

logger = logging.getLogger(__name__)

_DEFAULT_MODEL = "claude-sonnet-4-6"

# Judge confidence must be *strictly greater than* this threshold for a 2-1 split to exit.
_JUDGE_CONFIDENCE_THRESHOLD = 0.75


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------


def _format_sources(claim: NotesLogEntry) -> str:
    parts: list[str] = []
    for source in claim.sources:
        parts.append(
            f"[{source.source_id}] {source.source_title}\n"
            f"URL: {source.source_url}\n"
            f"Excerpt: {source.relevant_chunk}"
        )
    return "\n\n".join(parts)


def _format_claim_context(
    claim: NotesLogEntry,
    prior_tier_results: list[TierOutput],
) -> str:
    """Build the user-turn message shared by all three debate personas."""
    sources_text = _format_sources(claim)
    prior_text = ""
    if prior_tier_results:
        prior_text = "\n\nPrevious tier evaluations (for context):\n" + json.dumps(
            [t.model_dump() for t in prior_tier_results],
            indent=2,
            default=str,
        )
    return (
        f"CLAIM: {claim.claim_text}\n\n"
        f"Claim type: {claim.claim_type}\n"
        f"Derivation method: {claim.derivation}\n\n"
        f"SUPPORTING SOURCES:\n{sources_text}\n\n"
        f"Agent reasoning: {claim.reasoning}"
        f"{prior_text}"
    )


# ---------------------------------------------------------------------------
# JSON parsing helper
# ---------------------------------------------------------------------------


def _get_response_text(response: anthropic.types.Message) -> str:
    """Extract text from the first TextBlock in an Anthropic API response."""
    for block in response.content:
        if isinstance(block, TextBlock):
            return block.text
    raise ValueError(
        f"No TextBlock found in response (got {[type(b).__name__ for b in response.content]})"
    )


def _extract_json(text: str) -> dict[str, object]:
    """
    Parse JSON from model output, stripping markdown code fences if present.

    Raises json.JSONDecodeError on malformed output.
    """
    stripped = text.strip()
    if "```" in stripped:
        # Take content between the first pair of fences
        parts = stripped.split("```")
        code = parts[1]
        if code.startswith("json"):
            code = code[4:]
        stripped = code.strip()
    result: dict[str, object] = json.loads(stripped)
    return result


# ---------------------------------------------------------------------------
# Persona evaluation
# ---------------------------------------------------------------------------


async def _evaluate_persona(
    client: anthropic.AsyncAnthropic,
    system_prompt: str,
    persona: DebatePersona,
    claim_context: str,
) -> PersonaOutput:
    """
    Call a single debate persona and parse its structured JSON response.

    The model is instructed to return:
      {"verdict": "...", "reasoning": "..."}
    """
    response = await client.messages.create(
        model=_DEFAULT_MODEL,
        max_tokens=1024,
        system=system_prompt,
        messages=[{"role": "user", "content": claim_context}],
    )
    text = _get_response_text(response)
    data = _extract_json(text)
    return PersonaOutput(
        persona=persona,
        verdict=Verdict(str(data["verdict"])),
        reasoning=str(data["reasoning"]),
    )


# ---------------------------------------------------------------------------
# Judge synthesis
# ---------------------------------------------------------------------------


async def _run_judge(
    client: anthropic.AsyncAnthropic,
    claim: NotesLogEntry,
    domain_expert: PersonaOutput,
    methodologist: PersonaOutput,
    skeptic: PersonaOutput,
) -> tuple[Verdict, float, str, str | None]:
    """
    Run the judge synthesis over the three persona outputs.

    Returns
    -------
    tuple of (final_verdict, confidence, synthesis_text, suggested_revision)
    """
    user_content = (
        f"CLAIM: {claim.claim_text}\n\n"
        f"DOMAIN EXPERT verdict={domain_expert.verdict}:\n{domain_expert.reasoning}\n\n"
        f"METHODOLOGIST verdict={methodologist.verdict}:\n{methodologist.reasoning}\n\n"
        f"SKEPTIC verdict={skeptic.verdict}:\n{skeptic.reasoning}"
    )
    response = await client.messages.create(
        model=_DEFAULT_MODEL,
        max_tokens=1024,
        system=get_judge_synthesis_prompt(),
        messages=[{"role": "user", "content": user_content}],
    )
    text = _get_response_text(response)
    data = _extract_json(text)

    verdict = Verdict(str(data["final_verdict"]))
    confidence = float(str(data["confidence"]))
    synthesis = str(data["synthesis"])
    raw_revision = data.get("suggested_revision")
    suggested_revision = str(raw_revision) if raw_revision is not None else None
    return verdict, confidence, synthesis, suggested_revision


# ---------------------------------------------------------------------------
# Consensus decision logic (pure function — testable without IO)
# ---------------------------------------------------------------------------


def _determine_verdict(
    personas: list[PersonaOutput],
    _judge_verdict: Verdict,
    judge_confidence: float,
) -> tuple[Verdict, float]:
    """
    Apply the CLAUDE.md consensus rules to produce a final verdict.

    Rules
    -----
    1. Unanimous (3/3) → use that verdict; boost confidence to max(judge_confidence, 0.9)
    2. 2-1 majority AND judge_confidence > 0.75 → use majority verdict
    3. 3-way split OR judge_confidence ≤ 0.75 → UNCERTAIN (escalate to Tier 4)

    Parameters
    ----------
    personas:
        Outputs from all three debate personas.
    judge_verdict:
        The judge's synthesized verdict (used as tiebreaker context).
    judge_confidence:
        The judge's stated confidence in its synthesis.

    Returns
    -------
    (final_verdict, final_confidence)
    """
    verdicts = [p.verdict for p in personas]
    counts: Counter[Verdict] = Counter(verdicts)
    most_common_verdict, most_common_count = counts.most_common(1)[0]

    if most_common_count == 3:
        # Unanimous — boost confidence for a strong signal
        return most_common_verdict, max(judge_confidence, 0.9)

    if most_common_count == 2 and judge_confidence > _JUDGE_CONFIDENCE_THRESHOLD:
        # Clear 2-1 majority with sufficient judge confidence
        return most_common_verdict, judge_confidence

    # 3-way split or insufficient judge confidence — escalate
    return Verdict.UNCERTAIN, judge_confidence


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def run_debate(
    claim: NotesLogEntry,
    prior_tier_results: list[TierOutput],
    *,
    policy_topic: str = "public policy",
    client: anthropic.AsyncAnthropic | None = None,
) -> TierOutput:
    """
    Run Tier 3 Multi-Agent Debate evaluation for a single claim.

    All three persona evaluations are launched concurrently via asyncio.gather,
    then a Judge agent synthesizes their outputs into a final verdict.

    Parameters
    ----------
    claim:
        The notes log entry with claim text, type, derivation, and sources.
    prior_tier_results:
        Outputs from Tiers 1 and/or 2 — injected into the context so personas
        can build on earlier evaluations.
    policy_topic:
        Policy domain string used to personalise the Domain Expert persona
        (e.g. 'education finance in sub-Saharan Africa').
    client:
        AsyncAnthropic client. If None, one is constructed from ANTHROPIC_API_KEY.
        Inject a mock here in unit tests.

    Returns
    -------
    TierOutput (tier=3) with a DebateOutput payload.
    If final_verdict is UNCERTAIN, the router must escalate to Tier 4.
    """
    if client is None:
        client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    claim_context = _format_claim_context(claim, prior_tier_results)

    # ── Run all 3 personas in parallel ───────────────────────────────────────
    domain_expert, methodologist, skeptic = await asyncio.gather(
        _evaluate_persona(
            client,
            get_domain_expert_prompt(policy_topic),
            DebatePersona.DOMAIN_EXPERT,
            claim_context,
        ),
        _evaluate_persona(
            client,
            get_methodologist_prompt(),
            DebatePersona.METHODOLOGIST,
            claim_context,
        ),
        _evaluate_persona(
            client,
            get_skeptic_prompt(),
            DebatePersona.SKEPTIC,
            claim_context,
        ),
    )

    logger.info(
        "Tier 3 personas complete claim_id=%s verdicts=%s/%s/%s",
        claim.claim_id,
        domain_expert.verdict,
        methodologist.verdict,
        skeptic.verdict,
    )

    # ── Judge synthesis ───────────────────────────────────────────────────────
    judge_verdict, judge_confidence, judge_synthesis, suggested_revision = await _run_judge(
        client, claim, domain_expert, methodologist, skeptic
    )

    # ── Apply consensus rules ─────────────────────────────────────────────────
    final_verdict, final_confidence = _determine_verdict(
        [domain_expert, methodologist, skeptic],
        judge_verdict,
        judge_confidence,
    )

    # Suppress suggested revision when the claim is valid — no change needed
    revision = suggested_revision if final_verdict != Verdict.VALID else None

    output = DebateOutput(
        domain_expert=domain_expert,
        methodologist=methodologist,
        skeptic=skeptic,
        judge_synthesis=judge_synthesis,
        final_verdict=final_verdict,
        confidence=final_confidence,
        suggested_revision=revision,
    )

    logger.info(
        "Tier 3 complete claim_id=%s verdict=%s confidence=%.2f",
        claim.claim_id,
        final_verdict,
        final_confidence,
    )

    return TierOutput(tier=3, output=output)
