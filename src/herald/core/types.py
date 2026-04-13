"""Core data types for the HERALD pipeline."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Literal


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

    disconfirming_condition: str  # What the model says would change its verdict
    evidence_found: bool  # Whether that condition actually exists in the source
    evidence_quote: str  # The relevant quote, or empty string if not found
    verdict_overridden: bool  # True if a confident Tier 2 verdict was flipped to UNCERTAIN
    reasoning: str  # Probe's explanation
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass
class DebateResult:
    """Result from Tier 3 multi-agent debate."""

    advocate_argument: str
    critic_argument: str
    judge_verdict: Verdict
    judge_confidence: float
    judge_reasoning: str
    input_tokens: int = 0
    output_tokens: int = 0


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
    tier1_result: TierResult | None = None
    tier2_result: TierResult | None = None
    tier2_5_result: CounterfactualResult | None = None
    tier3_result: DebateResult | None = None
    resolved_at_tier: int | None = None
    final_verdict: Verdict | None = None
    llm_calls: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0


# ── Phase 0: Task Analysis types ────────────────────────────────────────────


@dataclass
class TaskPlan:
    """Output of Phase 0 task analysis."""

    expected_output_count: int | str  # exact number or "multiple", "single"
    output_unit: str  # e.g., "comment", "claim", "paragraph", "bullet point"
    primary_checkpoint_types: list[CheckpointType]
    requires_source_mapping: bool
    task_nature: Literal["empirical", "subjective", "mixed"]
    evaluation_mode: Literal["exhaustive", "sampled", "adaptive"]
    sample_size: int | None  # If sampled, how many to validate
    skip_nli_for: list[CheckpointType]  # Route straight to Tier 2 (NLI weak here)
    debate_recommended_for: list[CheckpointType]  # Benefit from multi-agent debate
    source_type: Literal["single_document", "multiple_documents", "conversation"]
    source_chunking: Literal["by_section", "by_page", "whole_document", "per_output"]


@dataclass
class GeneratedOutput:
    """A single output from the research agent, ready for validation."""

    id: str
    text: str
    output_type: str  # e.g., "comment", "claim", "paragraph"
    references_section: str | None  # Which part of source this references
    suggested_checkpoint_type: CheckpointType | None
    metadata: dict = field(default_factory=dict)


@dataclass
class BatchValidationResult:
    """Results from batch validation of multiple outputs."""

    task_plan: TaskPlan
    total_outputs: int
    tier1_valid: list[tuple["GeneratedOutput", TierResult]]
    tier1_invalid: list[tuple["GeneratedOutput", TierResult]]
    escalated: list[tuple["GeneratedOutput", EscalationPacket]]
    tier4_pending: list[tuple["GeneratedOutput", EscalationPacket]]
    summary: dict  # aggregate statistics
