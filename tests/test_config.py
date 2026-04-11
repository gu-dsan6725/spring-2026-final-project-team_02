import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../src")))

from herald.core.config import load_config
from herald.core.llm import get_llm_client


def test_load_config():
    config = load_config("configs/default.yaml")
    assert "tier1" in config


def test_load_config_overrides():
    config = load_config(
        "configs/default.yaml",
        provider="groq",
        tier2_model="llama-3.3-70b-versatile",
        tier3_model="llama-3.3-70b-versatile",
    )
    assert config["provider"] == "groq"
    assert config["tier2"]["model"] == "llama-3.3-70b-versatile"
    assert config["tier3"]["model"] == "llama-3.3-70b-versatile"


def test_load_config_openai_override():
    os.environ["OPENAI_API_KEY"] = "test-openai-key"
    config = load_config(
        "configs/default.yaml",
        provider="openai",
        tier2_model="gpt-4o-mini",
        tier3_model="gpt-4o-mini",
    )
    assert config["provider"] == "openai"
    assert config["openai_api_key"] == "test-openai-key"
    assert config["tier2"]["model"] == "gpt-4o-mini"
    assert config["tier3"]["model"] == "gpt-4o-mini"


def test_get_llm_client_openai():
    os.environ["OPENAI_API_KEY"] = "test-openai-key"
    config = load_config(
        "configs/default.yaml",
        provider="openai",
        tier2_model="gpt-4o-mini",
    )
    client = get_llm_client(config)
    assert client.provider == "openai"
    assert client.model == "gpt-4o-mini"
