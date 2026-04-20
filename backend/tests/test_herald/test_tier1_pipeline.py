from __future__ import annotations

from unittest.mock import MagicMock

from policy_memo_agent.herald.tier1_nli import run_tier1
from policy_memo_agent.models.claims import ClaimType, DerivationMethod, NotesLogEntry, Source
from policy_memo_agent.services.nli_service import NLIResult


def _claim(*, derivation: DerivationMethod = DerivationMethod.DIRECT_EXTRACTION) -> NotesLogEntry:
    return NotesLogEntry(
        claim_id="GT-001",
        claim_text="Around rainfall variability intensified drought cycles.",
        claim_type=ClaimType.CAUSAL,
        derivation=derivation,
        reasoning="Test claim.",
        sources=[
            Source(
                source_id="S-001",
                source_title="Source A",
                source_url="https://example.com/a",
                relevant_chunk="Chunk A",
            ),
            Source(
                source_id="S-002",
                source_title="Source B",
                source_url="https://example.com/b",
                relevant_chunk="Chunk B",
            ),
        ],
    )


def test_run_tier1_accepts_single_strong_supporting_chunk() -> None:
    service = MagicMock()
    service.is_loaded.return_value = True
    service.predict_batch.return_value = [
        NLIResult(
            label="entailment",
            scores={"entailment": 0.91, "neutral": 0.06, "contradiction": 0.03},
        ),
        NLIResult(
            label="neutral",
            scores={"entailment": 0.22, "neutral": 0.71, "contradiction": 0.07},
        ),
    ]

    result = run_tier1(_claim(), nli_service=service, threshold=0.85)

    assert result.output is not None
    assert result.output.verdict.value == "valid"
    assert result.output.confidence == 0.91


def test_run_tier1_uses_canonicalized_paraphrase_variant() -> None:
    service = MagicMock()
    service.is_loaded.return_value = True
    service.predict_batch.side_effect = [
        [
            NLIResult(
                label="neutral",
                scores={"entailment": 0.44, "neutral": 0.5, "contradiction": 0.06},
            ),
            NLIResult(
                label="neutral",
                scores={"entailment": 0.27, "neutral": 0.63, "contradiction": 0.1},
            ),
        ],
        [
            NLIResult(
                label="entailment",
                scores={"entailment": 0.9, "neutral": 0.07, "contradiction": 0.03},
            ),
            NLIResult(
                label="neutral",
                scores={"entailment": 0.29, "neutral": 0.62, "contradiction": 0.09},
            ),
        ],
    ]

    result = run_tier1(
        _claim(derivation=DerivationMethod.PARAPHRASE), nli_service=service, threshold=0.85
    )

    assert result.output is not None
    assert result.output.verdict.value == "valid"
    assert result.output.confidence == 0.9
    assert service.predict_batch.call_count == 2


def test_run_tier1_invalidates_on_strong_contradiction() -> None:
    service = MagicMock()
    service.is_loaded.return_value = True
    service.predict_batch.return_value = [
        NLIResult(
            label="contradiction",
            scores={"entailment": 0.08, "neutral": 0.1, "contradiction": 0.82},
        ),
        NLIResult(
            label="entailment",
            scores={"entailment": 0.9, "neutral": 0.06, "contradiction": 0.04},
        ),
    ]

    result = run_tier1(_claim(), nli_service=service, threshold=0.85)

    assert result.output is not None
    assert result.output.verdict.value == "invalid"
    assert result.output.confidence == 0.82


def test_run_tier1_escalates_when_signal_margin_is_too_small() -> None:
    service = MagicMock()
    service.is_loaded.return_value = True
    service.predict_batch.return_value = [
        NLIResult(
            label="entailment",
            scores={"entailment": 0.93, "neutral": 0.84, "contradiction": 0.03},
        ),
        NLIResult(
            label="neutral",
            scores={"entailment": 0.18, "neutral": 0.72, "contradiction": 0.1},
        ),
    ]

    result = run_tier1(
        _claim(derivation=DerivationMethod.DIRECT_EXTRACTION), nli_service=service, threshold=0.9
    )

    assert result.output is not None
    assert result.output.verdict.value == "uncertain"
    assert "Signal margin" in result.output.reasoning


def test_run_tier1_escalates_on_causal_hedging_mismatch() -> None:
    service = MagicMock()
    service.is_loaded.return_value = True
    service.predict_batch.return_value = [
        NLIResult(
            label="entailment",
            scores={"entailment": 0.96, "neutral": 0.03, "contradiction": 0.01},
        ),
        NLIResult(
            label="neutral",
            scores={"entailment": 0.22, "neutral": 0.72, "contradiction": 0.06},
        ),
    ]

    claim = _claim(derivation=DerivationMethod.PARAPHRASE).model_copy(
        update={
            "claim_text": "Rainfall variability intensified drought cycles across the region.",
            "sources": [
                Source(
                    source_id="S-001",
                    source_title="Source A",
                    source_url="https://example.com/a",
                    relevant_chunk=(
                        "Rainfall variability coincided with more frequent failed rainy seasons "
                        "across the region."
                    ),
                ),
                Source(
                    source_id="S-002",
                    source_title="Source B",
                    source_url="https://example.com/b",
                    relevant_chunk="Additional background context.",
                ),
            ],
        }
    )

    result = run_tier1(claim, nli_service=service, threshold=0.85)

    assert result.output is not None
    assert result.output.verdict.value == "uncertain"
    assert "hedging mismatch" in result.output.reasoning.lower()
