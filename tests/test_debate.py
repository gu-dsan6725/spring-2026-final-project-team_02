import pytest
from unittest.mock import MagicMock
from herald.tier3.debate import MultiAgentDebate
from herald.core.types import CheckpointOutput, CheckpointType, TierResult, Verdict

def test_debate_mock():
    debate = MultiAgentDebate(api_key="fake-key")
    debate.client = MagicMock()
    debate._call = MagicMock(return_value="{\"verdict\": \"valid\", \"confidence\": 0.9, \"reasoning\": \"ok\"}")
    cp = CheckpointOutput(checkpoint_type=CheckpointType.CLAIM_EXTRACTION, output_text="Test claim", source_context="Source text")
    t1 = TierResult(tier=1, verdict=Verdict.UNCERTAIN, confidence=0.5)
    t2 = TierResult(tier=2, verdict=Verdict.UNCERTAIN, confidence=0.5)
    result = debate.debate(cp, t1, t2)
    assert hasattr(result, 'judge_verdict')
