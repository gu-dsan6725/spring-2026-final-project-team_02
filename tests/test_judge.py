from unittest.mock import MagicMock, patch

from herald.core.types import CheckpointOutput, CheckpointType, TierResult, Verdict
from herald.tier2.judge import LLMJudge

MOCK_CONFIG = {"provider": "groq", "tier2": {"model": "fake-model"}}


def test_llm_judge_mock():
    with patch("herald.tier2.judge.get_llm_client", return_value=MagicMock()):
        judge = LLMJudge(MOCK_CONFIG)

    mock_response = MagicMock()
    mock_response.content = (
        '{"verdict": "valid", "confidence": 0.99, "reasoning": "ok", "key_issues": []}'
    )
    mock_response.provider = "groq"
    judge.client = MagicMock()
    judge.client.complete.return_value = mock_response

    cp = CheckpointOutput(
        checkpoint_type=CheckpointType.CLAIM_EXTRACTION,
        output_text="Test claim",
        source_context="Source text",
    )
    t1 = TierResult(tier=1, verdict=Verdict.UNCERTAIN, confidence=0.5)
    result = judge.judge(cp, t1)
    assert result.verdict == Verdict.VALID
