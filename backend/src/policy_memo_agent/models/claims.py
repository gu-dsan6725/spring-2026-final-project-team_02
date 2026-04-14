"""Pydantic models for claims, notes log, and HERALD routing configuration."""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class ClaimType(StrEnum):
    """The 6 atomic claim types defined in CLAUDE.md."""

    STATISTICAL = "statistical"
    CAUSAL = "causal"
    COMPARATIVE = "comparative"
    PREDICTIVE = "predictive"
    NORMATIVE = "normative"
    SYNTHESIS = "synthesis"


class DerivationMethod(StrEnum):
    """How the agent produced the claim — correlates with risk level."""

    DIRECT_EXTRACTION = "direct_extraction"
    PARAPHRASE = "paraphrase"
    CROSS_SOURCE = "cross_source"
    AGENT_INFERENCE = "agent_inference"


class Source(BaseModel):
    """A single source that supports a claim."""

    source_id: str = Field(..., description="Unique source identifier, e.g. S-001")
    source_title: str = Field(..., description="Human-readable title of the source")
    source_url: str = Field(..., description="URL or file path of the source")
    relevant_chunk: str = Field(..., description="The exact excerpt that supports the claim")


class NotesLogEntry(BaseModel):
    """Provenance record for a single claim. Built during research, before memo is written."""

    claim_id: str = Field(..., description="Unique claim identifier, e.g. C-001")
    claim_text: str = Field(..., description="The full text of the claim as it appears in the memo")
    claim_type: ClaimType
    derivation: DerivationMethod
    sources: list[Source] = Field(..., min_length=1)
    reasoning: str = Field(
        ..., description="Explanation of how sources were combined to produce this claim"
    )


class ClaimTypeConfig(BaseModel):
    """HERALD routing configuration for a claim type."""

    claim_type: ClaimType
    start_tier: int = Field(..., ge=1, le=4, description="Which HERALD tier to start evaluation at")
    skip_nli: bool = Field(..., description="Whether to skip Tier 1 NLI evaluation")
    nli_threshold: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Minimum NLI confidence for VALID exit. None if skip_nli is True.",
    )
    rationale: str = Field(..., description="Why this routing is appropriate for this claim type")


# HERALD routing table — single source of truth for all routing logic.
# Mirrors the table in CLAUDE.md exactly.
HERALD_ROUTING_TABLE: dict[ClaimType, ClaimTypeConfig] = {
    ClaimType.STATISTICAL: ClaimTypeConfig(
        claim_type=ClaimType.STATISTICAL,
        start_tier=1,
        skip_nli=False,
        nli_threshold=0.9,
        rationale="NLI handles entailment well for numeric claims",
    ),
    ClaimType.COMPARATIVE: ClaimTypeConfig(
        claim_type=ClaimType.COMPARATIVE,
        start_tier=1,
        skip_nli=False,
        nli_threshold=0.9,
        rationale="NLI handles entailment well for comparative claims",
    ),
    ClaimType.CAUSAL: ClaimTypeConfig(
        claim_type=ClaimType.CAUSAL,
        start_tier=1,
        skip_nli=False,
        nli_threshold=0.85,
        rationale="Lower threshold: NLI catches misquotes but misses correlation-as-causation",
    ),
    ClaimType.PREDICTIVE: ClaimTypeConfig(
        claim_type=ClaimType.PREDICTIVE,
        start_tier=2,
        skip_nli=True,
        nli_threshold=None,
        rationale="NLI cannot evaluate predictions; skip to LLM judge",
    ),
    ClaimType.NORMATIVE: ClaimTypeConfig(
        claim_type=ClaimType.NORMATIVE,
        start_tier=2,
        skip_nli=True,
        nli_threshold=None,
        rationale="NLI cannot evaluate prescriptions; skip to LLM judge",
    ),
    ClaimType.SYNTHESIS: ClaimTypeConfig(
        claim_type=ClaimType.SYNTHESIS,
        start_tier=2,
        skip_nli=True,
        nli_threshold=None,
        rationale="No single source entails a synthesis claim; skip to LLM judge",
    ),
}


def get_routing_config(claim_type: ClaimType) -> ClaimTypeConfig:
    """Return the HERALD routing configuration for a given claim type."""
    return HERALD_ROUTING_TABLE[claim_type]


# Re-export for convenience
__all__: list[Any] = [
    "HERALD_ROUTING_TABLE",
    "ClaimType",
    "ClaimTypeConfig",
    "DerivationMethod",
    "NotesLogEntry",
    "Source",
    "get_routing_config",
]
