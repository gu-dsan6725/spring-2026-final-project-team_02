"""
HERALD Tier 3 Multi-Agent Debate tests.

Test groups
-----------
TestDetermineVerdict
    Pure unit tests for the consensus decision function — no IO, no mocks.
    Covers all consensus cases defined in CLAUDE.md.

TestRunDebate
    Integration-style tests with a mocked Anthropic client.
    Verifies end-to-end debate flow, parallel persona execution, and revision handling.

TestRouterEscalation
    Verifies that the router only calls Tier 3 after Tier 2 returns UNCERTAIN,
    and that Tier 4 (human review) is flagged when Tier 3 cannot reach consensus.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from anthropic.types import TextBlock

from policy_memo_agent.herald.router import evaluate_claim
from policy_memo_agent.herald.tier3_debate import _determine_verdict, run_debate
from policy_memo_agent.models.claims import ClaimType, DerivationMethod, NotesLogEntry, Source
from policy_memo_agent.models.herald import (
    DebateOutput,
    DebatePersona,
    PersonaOutput,
    TierOutput,
    Verdict,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def synthesis_claim() -> NotesLogEntry:
    """Synthesis claim — skips Tier 1, starts at Tier 2 per routing table."""
    return NotesLogEntry(
        claim_id="C-006",
        claim_text=(
            "Declining enrollment and rising child labor suggest that education subsidy programs "
            "have not reached their most vulnerable target populations."
        ),
        claim_type=ClaimType.SYNTHESIS,
        derivation=DerivationMethod.AGENT_INFERENCE,
        sources=[
            Source(
                source_id="S-007",
                source_title="UNICEF Chad Country Report 2023",
                source_url="https://www.unicef.org/chad",
                relevant_chunk=(
                    "Primary school enrollment in Chad declined 4.1% year-over-year in 2022, "
                    "despite ongoing subsidy programs."
                ),
            ),
            Source(
                source_id="S-008",
                source_title="ILO Child Labour Global Estimates 2022",
                source_url="https://www.ilo.org/child-labour",
                relevant_chunk=(
                    "Child labour incidence in Chad increased from 28% to 31% between 2020 and 2022."
                ),
            ),
        ],
        reasoning=(
            "Agent inference combining declining enrollment (UNICEF) with rising child labour "
            "(ILO) to conclude subsidy programs failed to reach vulnerable populations."
        ),
    )


@pytest.fixture()
def statistical_claim() -> NotesLogEntry:
    """Statistical claim — starts at Tier 1 per routing table."""
    return NotesLogEntry(
        claim_id="C-001",
        claim_text="Maternal mortality in Chad stands at 1,140 per 100,000 live births.",
        claim_type=ClaimType.STATISTICAL,
        derivation=DerivationMethod.DIRECT_EXTRACTION,
        sources=[
            Source(
                source_id="S-001",
                source_title="WHO Global Health Observatory 2023",
                source_url="https://www.who.int/data/gho",
                relevant_chunk=(
                    "Maternal mortality ratio (per 100,000 live births): Chad — 1,140 (2020 estimate)."
                ),
            )
        ],
        reasoning="Direct extraction of the numeric value from the WHO GHO dataset.",
    )


# ---------------------------------------------------------------------------
# Mock construction helpers
# ---------------------------------------------------------------------------


def _persona_json(verdict: Verdict, reasoning: str = "Test reasoning.") -> str:
    return json.dumps({"verdict": verdict.value, "reasoning": reasoning})


def _judge_json(
    verdict: Verdict,
    confidence: float,
    synthesis: str = "Judge synthesis.",
    suggested_revision: str | None = None,
) -> str:
    return json.dumps(
        {
            "final_verdict": verdict.value,
            "confidence": confidence,
            "synthesis": synthesis,
            "suggested_revision": suggested_revision,
        }
    )


def _judge2_json(
    verdict: Verdict,
    confidence: float,
    suggested_revision: str | None = None,
) -> str:
    """Tier 2 judge response JSON."""
    return json.dumps(
        {
            "verdict": verdict.value,
            "confidence": confidence,
            "accuracy_assessment": "accurate",
            "relevance_assessment": "relevant",
            "completeness_assessment": "complete",
            "specialized_assessment": "appropriate",
            "reasoning": "Overall assessment.",
            "suggested_revision": suggested_revision,
        }
    )


def _mock_response(text: str) -> MagicMock:
    """
    Build a minimal Anthropic message response mock.

    Sets content_block.__class__ = TextBlock so that isinstance(block, TextBlock)
    returns True in _get_response_text(), matching real SDK behaviour.
    """
    content_block = MagicMock()
    content_block.text = text
    content_block.__class__ = TextBlock  # allows isinstance() checks to pass
    response = MagicMock()
    response.content = [content_block]
    return response


def _make_debate_client(
    persona_verdicts: list[Verdict],
    judge_verdict: Verdict,
    judge_confidence: float,
    suggested_revision: str | None = None,
) -> MagicMock:
    """
    Create a mock AsyncAnthropic client for debate-only tests.

    Responses are consumed in order: [persona1, persona2, persona3, judge].
    """
    responses = [_mock_response(_persona_json(v)) for v in persona_verdicts]
    responses.append(
        _mock_response(
            _judge_json(judge_verdict, judge_confidence, suggested_revision=suggested_revision)
        )
    )
    mock_client = MagicMock()
    mock_client.messages = MagicMock()
    mock_client.messages.create = AsyncMock(side_effect=responses)
    return mock_client


def _make_router_client(
    tier2_verdict: Verdict,
    tier2_confidence: float,
    debate_persona_verdicts: list[Verdict],
    debate_judge_verdict: Verdict,
    debate_judge_confidence: float,
) -> MagicMock:
    """
    Build a mock client for full-router tests that need Tier 2 then Tier 3.

    Response order: [tier2_judge, persona1, persona2, persona3, debate_judge]
    """
    responses = [_mock_response(_judge2_json(tier2_verdict, tier2_confidence))]
    responses += [_mock_response(_persona_json(v)) for v in debate_persona_verdicts]
    responses.append(_mock_response(_judge_json(debate_judge_verdict, debate_judge_confidence)))
    mock_client = MagicMock()
    mock_client.messages = MagicMock()
    mock_client.messages.create = AsyncMock(side_effect=responses)
    return mock_client


def _make_persona(
    verdict: Verdict,
    persona: DebatePersona = DebatePersona.DOMAIN_EXPERT,
) -> PersonaOutput:
    return PersonaOutput(persona=persona, verdict=verdict, reasoning="test reasoning")


# ---------------------------------------------------------------------------
# TestDetermineVerdict — pure unit tests (no IO)
# ---------------------------------------------------------------------------


class TestDetermineVerdict:
    """
    Exercises _determine_verdict() directly.
    All consensus scenarios from CLAUDE.md are covered here.
    """

    def test_unanimous_valid_returns_valid(self) -> None:
        personas = [
            _make_persona(Verdict.VALID, DebatePersona.DOMAIN_EXPERT),
            _make_persona(Verdict.VALID, DebatePersona.METHODOLOGIST),
            _make_persona(Verdict.VALID, DebatePersona.SKEPTIC),
        ]
        verdict, _ = _determine_verdict(personas, Verdict.VALID, 0.6)
        assert verdict == Verdict.VALID

    def test_unanimous_invalid_returns_invalid(self) -> None:
        personas = [
            _make_persona(Verdict.INVALID, DebatePersona.DOMAIN_EXPERT),
            _make_persona(Verdict.INVALID, DebatePersona.METHODOLOGIST),
            _make_persona(Verdict.INVALID, DebatePersona.SKEPTIC),
        ]
        verdict, _ = _determine_verdict(personas, Verdict.INVALID, 0.5)
        assert verdict == Verdict.INVALID

    def test_unanimous_boosts_confidence_to_at_least_0_9(self) -> None:
        """Low judge confidence should be raised to ≥ 0.9 on unanimous agreement."""
        personas = [
            _make_persona(Verdict.VALID, DebatePersona.DOMAIN_EXPERT),
            _make_persona(Verdict.VALID, DebatePersona.METHODOLOGIST),
            _make_persona(Verdict.VALID, DebatePersona.SKEPTIC),
        ]
        _, confidence = _determine_verdict(personas, Verdict.VALID, 0.55)
        assert confidence >= 0.9

    def test_unanimous_preserves_high_judge_confidence(self) -> None:
        """If judge confidence already > 0.9, it should be kept as-is (not clamped down)."""
        personas = [
            _make_persona(Verdict.VALID, DebatePersona.DOMAIN_EXPERT),
            _make_persona(Verdict.VALID, DebatePersona.METHODOLOGIST),
            _make_persona(Verdict.VALID, DebatePersona.SKEPTIC),
        ]
        _, confidence = _determine_verdict(personas, Verdict.VALID, 0.97)
        assert confidence == pytest.approx(0.97)

    def test_two_one_high_confidence_exits_with_majority_verdict(self) -> None:
        """2 VALID, 1 INVALID, judge confidence 0.82 > 0.75 → exit with VALID."""
        personas = [
            _make_persona(Verdict.VALID, DebatePersona.DOMAIN_EXPERT),
            _make_persona(Verdict.VALID, DebatePersona.METHODOLOGIST),
            _make_persona(Verdict.INVALID, DebatePersona.SKEPTIC),
        ]
        verdict, confidence = _determine_verdict(personas, Verdict.VALID, 0.82)
        assert verdict == Verdict.VALID
        assert confidence == pytest.approx(0.82)

    def test_two_one_high_confidence_invalid_majority(self) -> None:
        """2 INVALID, 1 VALID, judge confidence 0.9 → exit with INVALID."""
        personas = [
            _make_persona(Verdict.INVALID, DebatePersona.DOMAIN_EXPERT),
            _make_persona(Verdict.INVALID, DebatePersona.METHODOLOGIST),
            _make_persona(Verdict.VALID, DebatePersona.SKEPTIC),
        ]
        verdict, _ = _determine_verdict(personas, Verdict.INVALID, 0.9)
        assert verdict == Verdict.INVALID

    def test_two_one_at_threshold_escalates(self) -> None:
        """
        Confidence exactly at 0.75 is NOT strictly greater → escalate.
        Boundary condition from CLAUDE.md: requires confidence *> 0.75*.
        """
        personas = [
            _make_persona(Verdict.VALID, DebatePersona.DOMAIN_EXPERT),
            _make_persona(Verdict.VALID, DebatePersona.METHODOLOGIST),
            _make_persona(Verdict.INVALID, DebatePersona.SKEPTIC),
        ]
        verdict, _ = _determine_verdict(personas, Verdict.VALID, 0.75)
        assert verdict == Verdict.UNCERTAIN

    def test_two_one_low_confidence_escalates(self) -> None:
        """2-1 majority but judge_confidence 0.65 ≤ 0.75 → UNCERTAIN."""
        personas = [
            _make_persona(Verdict.VALID, DebatePersona.DOMAIN_EXPERT),
            _make_persona(Verdict.VALID, DebatePersona.METHODOLOGIST),
            _make_persona(Verdict.INVALID, DebatePersona.SKEPTIC),
        ]
        verdict, _ = _determine_verdict(personas, Verdict.VALID, 0.65)
        assert verdict == Verdict.UNCERTAIN

    def test_three_way_split_escalates(self) -> None:
        """One vote each for VALID, INVALID, UNCERTAIN → no majority → UNCERTAIN."""
        personas = [
            _make_persona(Verdict.VALID, DebatePersona.DOMAIN_EXPERT),
            _make_persona(Verdict.INVALID, DebatePersona.METHODOLOGIST),
            _make_persona(Verdict.UNCERTAIN, DebatePersona.SKEPTIC),
        ]
        verdict, _ = _determine_verdict(personas, Verdict.UNCERTAIN, 0.4)
        assert verdict == Verdict.UNCERTAIN

    def test_three_way_split_with_high_confidence_still_escalates(self) -> None:
        """Even with high judge confidence, a 3-way split (most_common_count=1) escalates."""
        personas = [
            _make_persona(Verdict.VALID, DebatePersona.DOMAIN_EXPERT),
            _make_persona(Verdict.INVALID, DebatePersona.METHODOLOGIST),
            _make_persona(Verdict.UNCERTAIN, DebatePersona.SKEPTIC),
        ]
        verdict, _ = _determine_verdict(personas, Verdict.VALID, 0.95)
        assert verdict == Verdict.UNCERTAIN


# ---------------------------------------------------------------------------
# TestRunDebate — integration tests with mocked Anthropic client
# ---------------------------------------------------------------------------


class TestRunDebate:
    """
    Tests run_debate() end-to-end with a mocked Anthropic client.

    The mock client returns canned JSON responses in call order:
    [domain_expert, methodologist, skeptic, judge_synthesis].
    """

    @pytest.mark.asyncio
    async def test_unanimous_valid_exits_without_escalation(
        self, synthesis_claim: NotesLogEntry
    ) -> None:
        """All 3 personas agree VALID → TierOutput with VALID, not UNCERTAIN."""
        client = _make_debate_client(
            persona_verdicts=[Verdict.VALID, Verdict.VALID, Verdict.VALID],
            judge_verdict=Verdict.VALID,
            judge_confidence=0.95,
        )
        result = await run_debate(synthesis_claim, [], client=client)

        assert result.tier == 3
        assert isinstance(result.output, DebateOutput)
        assert result.output.final_verdict == Verdict.VALID
        assert result.output.confidence >= 0.9  # boosted for unanimous
        # 3 personas + 1 judge = 4 total API calls
        assert client.messages.create.call_count == 4

    @pytest.mark.asyncio
    async def test_unanimous_invalid_exits_correctly(self, synthesis_claim: NotesLogEntry) -> None:
        """All 3 agree INVALID → final_verdict == INVALID."""
        client = _make_debate_client(
            persona_verdicts=[Verdict.INVALID, Verdict.INVALID, Verdict.INVALID],
            judge_verdict=Verdict.INVALID,
            judge_confidence=0.92,
        )
        result = await run_debate(synthesis_claim, [], client=client)

        assert isinstance(result.output, DebateOutput)
        assert result.output.final_verdict == Verdict.INVALID

    @pytest.mark.asyncio
    async def test_two_one_high_confidence_exits_with_majority(
        self, synthesis_claim: NotesLogEntry
    ) -> None:
        """2 VALID, 1 INVALID, judge confidence 0.82 > 0.75 → exits VALID."""
        client = _make_debate_client(
            persona_verdicts=[Verdict.VALID, Verdict.VALID, Verdict.INVALID],
            judge_verdict=Verdict.VALID,
            judge_confidence=0.82,
        )
        result = await run_debate(synthesis_claim, [], client=client)

        assert isinstance(result.output, DebateOutput)
        assert result.output.final_verdict == Verdict.VALID
        assert result.output.confidence == pytest.approx(0.82)

    @pytest.mark.asyncio
    async def test_two_one_low_confidence_escalates(self, synthesis_claim: NotesLogEntry) -> None:
        """2-1 split, judge confidence 0.65 ≤ 0.75 → UNCERTAIN (escalate to Tier 4)."""
        client = _make_debate_client(
            persona_verdicts=[Verdict.VALID, Verdict.VALID, Verdict.INVALID],
            judge_verdict=Verdict.VALID,
            judge_confidence=0.65,
        )
        result = await run_debate(synthesis_claim, [], client=client)

        assert isinstance(result.output, DebateOutput)
        assert result.output.final_verdict == Verdict.UNCERTAIN

    @pytest.mark.asyncio
    async def test_three_way_split_escalates(self, synthesis_claim: NotesLogEntry) -> None:
        """One vote each for VALID / INVALID / UNCERTAIN → UNCERTAIN."""
        client = _make_debate_client(
            persona_verdicts=[Verdict.VALID, Verdict.INVALID, Verdict.UNCERTAIN],
            judge_verdict=Verdict.UNCERTAIN,
            judge_confidence=0.45,
        )
        result = await run_debate(synthesis_claim, [], client=client)

        assert isinstance(result.output, DebateOutput)
        assert result.output.final_verdict == Verdict.UNCERTAIN

    @pytest.mark.asyncio
    async def test_low_judge_confidence_escalates_regardless_of_majority(
        self, synthesis_claim: NotesLogEntry
    ) -> None:
        """Very low judge confidence (0.3) with 2-1 split → UNCERTAIN."""
        client = _make_debate_client(
            persona_verdicts=[Verdict.INVALID, Verdict.INVALID, Verdict.VALID],
            judge_verdict=Verdict.INVALID,
            judge_confidence=0.3,
        )
        result = await run_debate(synthesis_claim, [], client=client)

        assert isinstance(result.output, DebateOutput)
        assert result.output.final_verdict == Verdict.UNCERTAIN

    @pytest.mark.asyncio
    async def test_all_three_personas_called_in_parallel(
        self, synthesis_claim: NotesLogEntry
    ) -> None:
        """
        asyncio.gather is used: all 3 persona coroutines are scheduled together.
        Verified by patching _evaluate_persona and checking call count and personas.
        """
        call_log: list[DebatePersona] = []

        async def tracking_evaluate(
            client: Any,
            system_prompt: Any,
            persona: DebatePersona,
            claim_context: Any,
        ) -> PersonaOutput:
            call_log.append(persona)
            return PersonaOutput(
                persona=persona,
                verdict=Verdict.VALID,
                reasoning="mocked",
            )

        async def stub_judge(
            client: Any,
            claim: Any,
            de: Any,
            m: Any,
            s: Any,
        ) -> tuple[Verdict, float, str, None]:
            return Verdict.VALID, 0.95, "unanimous", None

        with (
            patch(
                "policy_memo_agent.herald.tier3_debate._evaluate_persona",
                side_effect=tracking_evaluate,
            ),
            patch(
                "policy_memo_agent.herald.tier3_debate._run_judge",
                side_effect=stub_judge,
            ),
        ):
            result = await run_debate(synthesis_claim, [], client=MagicMock())

        # All 3 personas called exactly once
        assert len(call_log) == 3
        assert set(call_log) == {
            DebatePersona.DOMAIN_EXPERT,
            DebatePersona.METHODOLOGIST,
            DebatePersona.SKEPTIC,
        }
        assert isinstance(result.output, DebateOutput)

    @pytest.mark.asyncio
    async def test_suggested_revision_included_when_invalid(
        self, synthesis_claim: NotesLogEntry
    ) -> None:
        """Suggested revision is forwarded when verdict is INVALID."""
        revision_text = (
            "Consider qualifying: 'suggests a possible gap' rather than asserting failure."
        )
        client = _make_debate_client(
            persona_verdicts=[Verdict.INVALID, Verdict.INVALID, Verdict.INVALID],
            judge_verdict=Verdict.INVALID,
            judge_confidence=0.92,
            suggested_revision=revision_text,
        )
        result = await run_debate(synthesis_claim, [], client=client)

        assert isinstance(result.output, DebateOutput)
        assert result.output.final_verdict == Verdict.INVALID
        assert result.output.suggested_revision == revision_text

    @pytest.mark.asyncio
    async def test_suggested_revision_cleared_when_valid(
        self, synthesis_claim: NotesLogEntry
    ) -> None:
        """When verdict is VALID, suggested_revision is suppressed even if judge returned one."""
        client = _make_debate_client(
            persona_verdicts=[Verdict.VALID, Verdict.VALID, Verdict.VALID],
            judge_verdict=Verdict.VALID,
            judge_confidence=0.96,
            suggested_revision="An unnecessary revision.",
        )
        result = await run_debate(synthesis_claim, [], client=client)

        assert isinstance(result.output, DebateOutput)
        assert result.output.final_verdict == Verdict.VALID
        assert result.output.suggested_revision is None

    @pytest.mark.asyncio
    async def test_tier_number_is_always_3(self, synthesis_claim: NotesLogEntry) -> None:
        client = _make_debate_client(
            persona_verdicts=[Verdict.VALID, Verdict.VALID, Verdict.VALID],
            judge_verdict=Verdict.VALID,
            judge_confidence=0.9,
        )
        result = await run_debate(synthesis_claim, [], client=client)
        assert result.tier == 3

    @pytest.mark.asyncio
    async def test_output_contains_all_persona_fields(self, synthesis_claim: NotesLogEntry) -> None:
        """DebateOutput must have domain_expert, methodologist, skeptic, and judge_synthesis."""
        client = _make_debate_client(
            persona_verdicts=[Verdict.VALID, Verdict.VALID, Verdict.VALID],
            judge_verdict=Verdict.VALID,
            judge_confidence=0.9,
        )
        result = await run_debate(synthesis_claim, [], client=client)

        assert isinstance(result.output, DebateOutput)
        assert result.output.domain_expert.persona == DebatePersona.DOMAIN_EXPERT
        assert result.output.methodologist.persona == DebatePersona.METHODOLOGIST
        assert result.output.skeptic.persona == DebatePersona.SKEPTIC
        assert result.output.judge_synthesis == "Judge synthesis."

    @pytest.mark.asyncio
    async def test_prior_tier_results_appear_in_context(
        self, synthesis_claim: NotesLogEntry
    ) -> None:
        """Prior tier results must be injected into the claim context sent to each persona."""
        captured_contexts: list[str] = []

        async def capturing_evaluate(
            client: Any,
            system_prompt: Any,
            persona: DebatePersona,
            claim_context: str,
        ) -> PersonaOutput:
            captured_contexts.append(claim_context)
            return PersonaOutput(persona=persona, verdict=Verdict.VALID, reasoning="mocked")

        async def stub_judge(
            client: Any, claim: Any, de: Any, m: Any, s: Any
        ) -> tuple[Verdict, float, str, None]:
            return Verdict.VALID, 0.95, "synthesis", None

        prior = TierOutput(tier=2, skipped=True, skip_reason="test prior")

        with (
            patch(
                "policy_memo_agent.herald.tier3_debate._evaluate_persona",
                side_effect=capturing_evaluate,
            ),
            patch(
                "policy_memo_agent.herald.tier3_debate._run_judge",
                side_effect=stub_judge,
            ),
        ):
            await run_debate(synthesis_claim, [prior], client=MagicMock())

        assert len(captured_contexts) == 3
        for ctx in captured_contexts:
            assert "Previous tier evaluations" in ctx
            # The JSON serialises TierOutput.tier as the integer 2, not "tier_2"
            assert '"tier": 2' in ctx


# ---------------------------------------------------------------------------
# TestRouterEscalation — verifies tier chaining in router.py
# ---------------------------------------------------------------------------


class TestRouterEscalation:
    """
    Tests that the router chains tiers correctly:
    - Tier 2 UNCERTAIN → Tier 3 runs
    - Tier 3 UNCERTAIN → tier_reached=4
    - Tier 3 VALID → resolves at tier 3
    - Synthesis claims skip Tier 1
    """

    @pytest.mark.asyncio
    async def test_tier3_only_called_when_tier2_uncertain(
        self, synthesis_claim: NotesLogEntry
    ) -> None:
        """
        When Tier 2 returns UNCERTAIN (confidence ≤ 0.85), Tier 3 must run.
        Synthesis claims skip Tier 1 entirely.
        """
        client = _make_router_client(
            tier2_verdict=Verdict.UNCERTAIN,
            tier2_confidence=0.5,  # below threshold → UNCERTAIN
            debate_persona_verdicts=[Verdict.VALID, Verdict.VALID, Verdict.VALID],
            debate_judge_verdict=Verdict.VALID,
            debate_judge_confidence=0.95,
        )
        result = await evaluate_claim(synthesis_claim, anthropic_client=client)

        # Tier 1 skipped (synthesis claim), Tier 2 ran, Tier 3 resolved
        assert result.tier_details["tier_1"] is not None
        assert result.tier_details["tier_1"].skipped is True
        assert result.tier_details["tier_2"] is not None
        assert result.tier_details["tier_3"] is not None
        assert result.tier_reached == 3
        assert result.verdict == Verdict.VALID

    @pytest.mark.asyncio
    async def test_tier3_not_called_when_tier2_resolves(
        self, synthesis_claim: NotesLogEntry
    ) -> None:
        """When Tier 2 resolves with high confidence, Tier 3 must NOT run."""
        # Single response: Tier 2 resolves confidently
        t2_response = _mock_response(_judge2_json(Verdict.VALID, confidence=0.92))
        mock_client = MagicMock()
        mock_client.messages = MagicMock()
        mock_client.messages.create = AsyncMock(return_value=t2_response)

        result = await evaluate_claim(synthesis_claim, anthropic_client=mock_client)

        assert result.tier_reached == 2
        assert result.verdict == Verdict.VALID
        assert result.tier_details["tier_3"] is None
        # Only 1 API call (Tier 2), no Tier 3 calls
        assert mock_client.messages.create.call_count == 1

    @pytest.mark.asyncio
    async def test_escalates_to_tier4_when_tier3_uncertain(
        self, synthesis_claim: NotesLogEntry
    ) -> None:
        """When Tier 3 cannot reach consensus, tier_reached must be 4."""
        client = _make_router_client(
            tier2_verdict=Verdict.UNCERTAIN,
            tier2_confidence=0.4,
            debate_persona_verdicts=[Verdict.VALID, Verdict.INVALID, Verdict.UNCERTAIN],
            debate_judge_verdict=Verdict.UNCERTAIN,
            debate_judge_confidence=0.3,
        )
        result = await evaluate_claim(synthesis_claim, anthropic_client=client)

        assert result.tier_reached == 4
        assert result.verdict == Verdict.UNCERTAIN
        assert result.tier_details["tier_4"] is not None
        assert result.tier_details["tier_3"] is not None

    @pytest.mark.asyncio
    async def test_synthesis_claim_skips_tier1(self, synthesis_claim: NotesLogEntry) -> None:
        """Synthesis claims must have tier_1 skipped=True per routing table."""
        # Tier 2 resolves immediately so we don't need further responses
        t2_response = _mock_response(_judge2_json(Verdict.VALID, confidence=0.9))
        mock_client = MagicMock()
        mock_client.messages = MagicMock()
        mock_client.messages.create = AsyncMock(return_value=t2_response)

        result = await evaluate_claim(synthesis_claim, anthropic_client=mock_client)

        assert result.tier_details["tier_1"] is not None
        assert result.tier_details["tier_1"].skipped is True

    @pytest.mark.asyncio
    async def test_statistical_claim_runs_tier1(self, statistical_claim: NotesLogEntry) -> None:
        """Statistical claims start at Tier 1 — tier_1 should not be skipped."""
        from policy_memo_agent.services.nli_service import NLIResult

        # Mock NLI service to return high entailment → resolves at Tier 1
        mock_nli = MagicMock()
        mock_nli.is_loaded.return_value = True
        mock_nli.predict_batch.return_value = [
            NLIResult(
                label="entailment",
                scores={"entailment": 0.95, "neutral": 0.03, "contradiction": 0.02},
            )
        ]

        result = await evaluate_claim(statistical_claim, nli_service=mock_nli)

        assert result.tier_details["tier_1"] is not None
        assert result.tier_details["tier_1"].skipped is False
        assert result.tier_reached == 1
        assert result.verdict == Verdict.VALID

    @pytest.mark.asyncio
    async def test_herald_result_has_all_tier_detail_keys(
        self, synthesis_claim: NotesLogEntry
    ) -> None:
        """HeraldResult.tier_details always has all four tier keys."""
        t2_response = _mock_response(_judge2_json(Verdict.VALID, confidence=0.9))
        mock_client = MagicMock()
        mock_client.messages = MagicMock()
        mock_client.messages.create = AsyncMock(return_value=t2_response)

        result = await evaluate_claim(synthesis_claim, anthropic_client=mock_client)

        assert set(result.tier_details.keys()) == {"tier_1", "tier_2", "tier_3", "tier_4"}
