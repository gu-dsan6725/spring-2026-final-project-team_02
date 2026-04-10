"""Configuration loader."""

import copy
import os
import yaml
from pathlib import Path
from dotenv import load_dotenv


def _apply_overrides(
    config: dict,
    provider: str | None = None,
    tier2_model: str | None = None,
    tier3_model: str | None = None,
) -> dict:
    """Apply CLI-style overrides on top of the YAML config."""
    merged = copy.deepcopy(config)

    if provider:
        merged["provider"] = provider.lower()
    if tier2_model:
        merged.setdefault("tier2", {})
        merged["tier2"]["model"] = tier2_model
    if tier3_model:
        merged.setdefault("tier3", {})
        merged["tier3"]["model"] = tier3_model

    return merged


def load_config(
    config_path: str = "configs/default.yaml",
    provider: str | None = None,
    tier2_model: str | None = None,
    tier3_model: str | None = None,
) -> dict:
    """Load YAML config, merge env vars, and apply optional CLI overrides."""
    load_dotenv()  # loads .env file

    path = Path(config_path)
    if not path.exists():
        raise FileNotFoundError(f"Config not found: {config_path}")

    with open(path) as f:
        config = yaml.safe_load(f)

    config = _apply_overrides(
        config,
        provider=provider,
        tier2_model=tier2_model,
        tier3_model=tier3_model,
    )

    # Inject API keys from environment
    provider = config.get("provider", "groq").lower()
    config["groq_api_key"] = os.environ.get("GROQ_API_KEY", "")
    config["gemini_api_key"] = os.environ.get("GEMINI_API_KEY", "")
    config["openai_api_key"] = os.environ.get("OPENAI_API_KEY", "")

    if provider == "gemini":
        if not config["gemini_api_key"]:
            raise ValueError(
                "GEMINI_API_KEY not set. Add it to your .env file.\n"
                "Get a free key at https://aistudio.google.com/apikey"
            )
    elif provider == "groq":
        if not config["groq_api_key"]:
            raise ValueError(
                "GROQ_API_KEY not set. Copy .env.example to .env and add your key.\n"
                "Get a free key at https://console.groq.com"
            )
    elif provider == "openai":
        if not config["openai_api_key"]:
            raise ValueError("OPENAI_API_KEY not set. Add it to your .env file.")
    else:
        raise ValueError(f"Unknown provider: {provider!r}. Use 'groq', 'gemini', or 'openai'.")

    return config
