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
    provider = config.get("provider", "groq").lower()
    config["groq_api_key"] = os.environ.get("GROQ_API_KEY", "")
    config["gemini_api_key"] = os.environ.get("GEMINI_API_KEY", "")

    if provider == "gemini":
        if not config["gemini_api_key"]:
            raise ValueError(
                "GEMINI_API_KEY not set. Add it to your .env file.\n"
                "Get a free key at https://aistudio.google.com/apikey"
            )
    else:
        if not config["groq_api_key"]:
            raise ValueError(
                "GROQ_API_KEY not set. Copy .env.example to .env and add your key.\n"
                "Get a free key at https://console.groq.com"
            )

    return config
