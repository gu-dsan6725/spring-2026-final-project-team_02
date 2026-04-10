import pytest
from herald.core.config import load_config

def test_load_config():
    config = load_config("configs/default.yaml")
    assert 'tier1' in config
