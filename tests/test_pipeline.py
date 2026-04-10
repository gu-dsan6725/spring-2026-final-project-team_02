import pytest
from herald.pipeline.escalation import HeraldPipeline
from herald.tier1.classifier import NLIClassifier
from herald.tier2.judge import LLMJudge
from herald.tier3.debate import MultiAgentDebate
from herald.core.types import CheckpointOutput, CheckpointType, TierResult, Verdict

def test_pipeline_init():
    pipeline = HeraldPipeline(
        tier1=NLIClassifier(),
        tier2=LLMJudge(api_key="fake-key"),
        tier3=MultiAgentDebate(api_key="fake-key"),
    )
    assert hasattr(pipeline, 'validate')
