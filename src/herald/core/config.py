"""Configuration loader."""

import os
import yaml
from pathlib import Path
from dotenv import load_dotenv


def load_config(config_path: str = "configs/default.yaml") -> dict:
    """Load YAML config and merge with environment variables."""
    load_dotenv()  # loads .env file

    path = Path(config_path)
    if not path.exists():
        raise FileNotFoundError(f"Config not found: {config_path}")

    with open(path) as f:
        config = yaml.safe_load(f)

    # Inject API keys from environment
    config["groq_api_key"] = os.environ.get("GROQ_API_KEY", "")
    if not config["groq_api_key"]:
        raise ValueError(
            "GROQ_API_KEY not set. Copy .env.example to .env and add your key.\n"
            "Get a free key at https://console.groq.com"
        )

    # Optional — only required when running herald-agent
    config["anthropic_api_key"] = os.environ.get("ANTHROPIC_API_KEY", "")

    # Optional — only required when running herald-agent
    config["anthropic_api_key"] = os.environ.get("ANTHROPIC_API_KEY", "")

    return config
