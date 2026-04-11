from unittest.mock import patch

from herald.pipeline.escalation import HeraldPipeline
from herald.tier1.classifier import NLIClassifier
from herald.tier2.judge import LLMJudge
from herald.tier3.debate import MultiAgentDebate

MOCK_CONFIG = {"provider": "groq", "tier2": {"model": "fake"}, "tier3": {"model": "fake"}}


def test_pipeline_init():
    with (
        patch("herald.tier2.judge.get_llm_client"),
        patch("herald.tier3.debate.get_llm_client"),
    ):
        pipeline = HeraldPipeline(
            tier1=NLIClassifier(),
            tier2=LLMJudge(MOCK_CONFIG),
            tier3=MultiAgentDebate(MOCK_CONFIG),
        )
    assert hasattr(pipeline, "validate")
