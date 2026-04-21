"""
HERALD Tier 2: LLM-as-Judge using Claude Sonnet.

Evaluates claims that NLI could not resolve (or that skip Tier 1 by design)
across four dimensions: accuracy, relevance, completeness, and claim-type-specific
validity (causal mechanism, comparison fairness, projection conditionality, or
normative consensus).

Decision thresholds (CLAUDE.md):
- confidence > 0.85 → exit with verdict
- confidence ≤ 0.85 → UNCERTAIN, escalate to Tier 3
"""

from __future__ import annotations

import json
import logging
import os

import anthropic
from anthropic.types import TextBlock

from policy_memo_agent.herald.prompts.judge_system import get_judge_system_prompt
from policy_memo_agent.models.claims import NotesLogEntry
from policy_memo_agent.models.herald import TierOutput, TierTwoOutput, Verdict

logger = logging.getLogger(__name__)

_DEFAULT_MODEL = "claude-sonnet-4-6"
_HIGH_CONFIDENCE_THRESHOLD = 0.85


def _get_response_text(response: anthropic.types.Message) -> str:
    """Extract text from the first TextBlock in an Anthropic API response."""
    for block in response.content:
        if isinstance(block, TextBlock):
            return block.text
    raise ValueError(
        f"No TextBlock found in response (got {[type(b).__name__ for b in response.content]})"
    )


def _extract_json(text: str) -> dict[str, object]:
    """Strip markdown fences and parse JSON from model output."""
    stripped = text.strip()
    if "```" in stripped:
        parts = stripped.split("```")
        code = parts[1]
        if code.startswith("json"):
            code = code[4:]
        stripped = code.strip()
    result: dict[str, object] = json.loads(stripped)
    return result


def _format_sources(claim: NotesLogEntry) -> str:
    parts: list[str] = []
    for src in claim.sources:
        parts.append(
            f"[{src.source_id}] {src.source_title}\n"
            f"URL: {src.source_url}\n"
            f"Excerpt: {src.relevant_chunk}"
        )
    return "\n\n".join(parts)


async def run_tier2(
    claim: NotesLogEntry,
    prior_tier_results: list[TierOutput],
    *,
    policy_topic: str = "public policy",
    memo_summary: str | None = None,
    client: anthropic.AsyncAnthropic | None = None,
) -> TierOutput:
    """
    Run Tier 2 LLM-as-Judge evaluation.

    Parameters
    ----------
    claim:
        Notes log entry to evaluate.
    prior_tier_results:
        Outputs from Tier 1 (for context injection).
    policy_topic:
        The policy domain of the memo. Passed to the judge system prompt to
        calibrate domain expertise (e.g. 'maternal health policy in sub-Saharan Africa').
    memo_summary:
        Optional executive summary of the full memo. When provided, injected into
        the user content so the judge can assess claim relevance in context and
        catch supporting information present elsewhere in the document.
    client:
        AsyncAnthropic client. If None, one is constructed from ANTHROPIC_API_KEY.
        Inject a mock in unit tests.

    Returns
    -------
    TierOutput (tier=2). If verdict is UNCERTAIN (confidence ≤ 0.85), the router
    escalates to Tier 3.
    """
    if client is None:
        client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    sources_text = _format_sources(claim)
    prior_text = ""
    if prior_tier_results:
        prior_text = "\n\nPrior tier results (for context):\n" + json.dumps(
            [t.model_dump() for t in prior_tier_results],
            indent=2,
            default=str,
        )

    memo_context = ""
    if memo_summary:
        memo_context = f"MEMO CONTEXT:\n{memo_summary}\n\n"

    user_content = (
        f"{memo_context}"
        f"CLAIM: {claim.claim_text}\n"
        f"Claim type: {claim.claim_type}\n"
        f"Derivation: {claim.derivation}\n\n"
        f"SUPPORTING SOURCES:\n{sources_text}\n\n"
        f"Agent reasoning: {claim.reasoning}"
        f"{prior_text}"
    )

    response = await client.messages.create(
        model=_DEFAULT_MODEL,
        max_tokens=1024,
        system=get_judge_system_prompt(policy_topic),
        messages=[{"role": "user", "content": user_content}],
    )

    text = _get_response_text(response)
    data = _extract_json(text)

    confidence = float(str(data["confidence"]))
    # Escalate to Tier 3 if confidence is not high enough
    raw_verdict = Verdict(str(data["verdict"]))
    verdict = raw_verdict if confidence > _HIGH_CONFIDENCE_THRESHOLD else Verdict.UNCERTAIN

    raw_revision = data.get("suggested_revision")
    suggested_revision = str(raw_revision) if raw_revision is not None else None

    output = TierTwoOutput(
        verdict=verdict,
        confidence=confidence,
        accuracy_assessment=str(data.get("accuracy_assessment", "")),
        relevance_assessment=str(data.get("relevance_assessment", "")),
        completeness_assessment=str(data.get("completeness_assessment", "")),
        specialized_assessment=str(data.get("specialized_assessment", "")),
        reasoning=str(data.get("reasoning", "")),
        suggested_revision=suggested_revision,
    )

    logger.info(
        "Tier 2 complete claim_id=%s verdict=%s confidence=%.2f",
        claim.claim_id,
        verdict,
        confidence,
    )
    return TierOutput(tier=2, output=output)
