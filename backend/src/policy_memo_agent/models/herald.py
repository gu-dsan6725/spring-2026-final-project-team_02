"""Pydantic models for HERALD evaluation pipeline outputs."""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class Verdict(StrEnum):
    """Possible verdicts from HERALD evaluation."""

    VALID = "valid"
    INVALID = "invalid"
    UNCERTAIN = "uncertain"
    PLAUSIBLE_BUT_UNSUPPORTED = "plausible_but_unsupported"


class TierOneOutput(BaseModel):
    """Output from Tier 1 NLI evaluation."""

    entailment_score: float = Field(..., ge=0.0, le=1.0)
    neutral_score: float = Field(..., ge=0.0, le=1.0)
    contradiction_score: float = Field(..., ge=0.0, le=1.0)
    verdict: Verdict
    confidence: float = Field(..., ge=0.0, le=1.0)
    reasoning: str


class TierTwoOutput(BaseModel):
    """Output from Tier 2 LLM-as-Judge evaluation."""

    verdict: Verdict
    confidence: float = Field(..., ge=0.0, le=1.0)
    accuracy_assessment: str
    relevance_assessment: str
    completeness_assessment: str
    specialized_assessment: str = Field(
        ...,
        description=(
            "Causal validity, comparison fairness, projection basis, or consensus check "
            "depending on claim type"
        ),
    )
    reasoning: str
    suggested_revision: str | None = None


class DebatePersona(StrEnum):
    """The three debate personas in Tier 3."""

    DOMAIN_EXPERT = "domain_expert"
    METHODOLOGIST = "methodologist"
    SKEPTIC = "skeptic"


class PersonaOutput(BaseModel):
    """Output from a single Tier 3 debate persona."""

    persona: DebatePersona
    verdict: Verdict
    reasoning: str


class DebateOutput(BaseModel):
    """Full output from Tier 3 Multi-Agent Debate."""

    domain_expert: PersonaOutput
    methodologist: PersonaOutput
    skeptic: PersonaOutput
    judge_synthesis: str
    final_verdict: Verdict
    confidence: float = Field(..., ge=0.0, le=1.0)
    suggested_revision: str | None = None


class TierOutput(BaseModel):
    """Container for a single tier's output — nullable for tiers that were not reached."""

    tier: int = Field(..., ge=1, le=4)
    output: TierOneOutput | TierTwoOutput | DebateOutput | None = None
    skipped: bool = False
    skip_reason: str | None = None


class HeraldResult(BaseModel):
    """
    The complete HERALD evaluation result for a single claim.
    This is the output schema used for agent revision feedback.
    """

    claim_id: str
    tier_reached: int = Field(..., ge=1, le=4)
    verdict: Verdict
    confidence: float = Field(..., ge=0.0, le=1.0)
    feedback: str = Field(..., description="Human-readable explanation of the verdict")
    suggested_revision: str | None = Field(
        default=None,
        description="Concrete revision suggestion when verdict is invalid or uncertain",
    )
    tier_details: dict[str, TierOutput | None] = Field(
        default_factory=dict,
        description="Keyed by 'tier_1', 'tier_2', 'tier_3', 'tier_4'",
    )


__all__: list[Any] = [
    "DebateOutput",
    "DebatePersona",
    "HeraldResult",
    "PersonaOutput",
    "TierOneOutput",
    "TierOutput",
    "TierTwoOutput",
    "Verdict",
]
