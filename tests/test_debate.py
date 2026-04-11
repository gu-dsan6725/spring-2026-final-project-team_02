from unittest.mock import MagicMock, patch

from herald.core.types import CheckpointOutput, CheckpointType, TierResult, Verdict
from herald.tier3.debate import MultiAgentDebate

MOCK_CONFIG = {"provider": "groq", "tier3": {"model": "fake-model"}}


def test_debate_mock():
    with patch("herald.tier3.debate.get_llm_client", return_value=MagicMock()):
        debate = MultiAgentDebate(MOCK_CONFIG)

    mock_response = MagicMock()
    mock_response.content = "some argument"
    judge_response = MagicMock()
    judge_response.content = (
        '{"verdict": "valid", "confidence": 0.9, "reasoning": "ok",'
        ' "advocate_strengths": "a", "critic_strengths": "b"}'
    )
    debate.client = MagicMock()
    debate.client.complete.side_effect = [mock_response, mock_response, judge_response]
    cp = CheckpointOutput(
        checkpoint_type=CheckpointType.CLAIM_EXTRACTION,
        output_text="Test claim",
        source_context="Source text",
    )
    t1 = TierResult(tier=1, verdict=Verdict.UNCERTAIN, confidence=0.5)
    t2 = TierResult(tier=2, verdict=Verdict.UNCERTAIN, confidence=0.5)
    result = debate.debate(cp, t1, t2)
    assert hasattr(result, "judge_verdict")
