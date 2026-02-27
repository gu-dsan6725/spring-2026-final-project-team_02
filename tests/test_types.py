from herald.core.types import CheckpointOutput, CheckpointType, TierResult, Verdict

def test_types_instantiation():
    cp = CheckpointOutput(checkpoint_type=CheckpointType.CLAIM_EXTRACTION, output_text="foo", source_context="bar")
    t1 = TierResult(tier=1, verdict=Verdict.UNCERTAIN, confidence=0.5)
    assert cp.checkpoint_type == CheckpointType.CLAIM_EXTRACTION
    assert t1.verdict == Verdict.UNCERTAIN
