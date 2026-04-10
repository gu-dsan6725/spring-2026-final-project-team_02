import pytest
from herald.tier1.classifier import NLIClassifier
from herald.core.types import CheckpointOutput, CheckpointType

def test_nli_classifier_basic():
    classifier = NLIClassifier()
    cp = CheckpointOutput(checkpoint_type=CheckpointType.CLAIM_EXTRACTION, output_text="Test claim", source_context="Source text")
    # This is a smoke test; just check that it runs and returns a TierResult
    result = classifier.classify(cp)
    assert hasattr(result, 'verdict')
