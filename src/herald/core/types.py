"""Core data types for the HERALD pipeline."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class Verdict(Enum):
    VALID = "valid"
    INVALID = "invalid"
    UNCERTAIN = "uncertain"


class CheckpointType(Enum):
    RETRIEVAL = "retrieval"
    CLAIM_EXTRACTION = "claim_extraction"
    SYNTHESIS = "synthesis"
    NUMERICAL = "numerical"
    CAUSAL = "causal"
    EPISTEMIC = "epistemic"


@dataclass
class TierResult:
    """Result from any single tier."""
    tier: int
    verdict: Verdict
    confidence: float
    reasoning: str = ""
    raw_scores: dict = field(default_factory=dict)


@dataclass
class CounterfactualResult:
    """Result from Tier 2.5 counterfactual probe."""
    disconfirming_condition: str   # What the model says would change its verdict
    evidence_found: bool           # Whether that condition actually exists in the source
    evidence_quote: str            # The relevant quote, or empty string if not found
    verdict_overridden: bool       # True if a confident Tier 2 verdict was flipped to UNCERTAIN
    reasoning: str                 # Probe's explanation


@dataclass
class DebateResult:
    """Result from Tier 3 multi-agent debate."""
    advocate_argument: str
    critic_argument: str
    judge_verdict: Verdict
    judge_confidence: float
    judge_reasoning: str


@dataclass
class CheckpointOutput:
    """A single checkpoint output to be validated."""
    checkpoint_type: CheckpointType
    output_text: str
    source_context: str
    query: str = ""
    metadata: dict = field(default_factory=dict)


@dataclass
class EscalationPacket:
    """Full packet tracking a case through all tiers."""
    checkpoint: CheckpointOutput
    tier1_result: Optional[TierResult] = None
    tier2_result: Optional[TierResult] = None
    tier2_5_result: Optional[CounterfactualResult] = None
    tier3_result: Optional[DebateResult] = None
    resolved_at_tier: Optional[int] = None
    final_verdict: Optional[Verdict] = None
