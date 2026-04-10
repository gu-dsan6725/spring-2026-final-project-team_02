import pytest
from unittest.mock import MagicMock
from herald.tier2.judge import LLMJudge
from herald.core.types import CheckpointOutput, CheckpointType, TierResult, Verdict

def test_llm_judge_mock():
    judge = LLMJudge(api_key="fake-key")
    judge.client = MagicMock()
    judge.client.chat.completions.create.return_value.choices = [type('obj', (object,), {'message': type('msg', (object,), {'content': '{"verdict": "VALID", "confidence": 0.9, "reasoning": "ok"}'})})]
    cp = CheckpointOutput(checkpoint_type=CheckpointType.CLAIM_EXTRACTION, output_text="Test claim", source_context="Source text")
    t1 = TierResult(tier=1, verdict=Verdict.UNCERTAIN, confidence=0.5)
    result = judge.judge(cp, t1)
    assert result.verdict == Verdict.VALID
