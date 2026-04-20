"""Application settings — loaded once at import time from the nearest .env file."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def _find_env_file() -> Path | None:
    """Walk up from this file until we find a .env, or return None."""
    current = Path(__file__).resolve().parent
    for _ in range(6):  # max 6 levels up
        candidate = current / ".env"
        if candidate.is_file():
            return candidate
        current = current.parent
    return None


_env_file = _find_env_file()

# Also populate os.environ so legacy os.getenv() calls work everywhere.
if _env_file is not None:
    try:
        from dotenv import load_dotenv

        load_dotenv(_env_file, override=False)
    except ImportError:
        pass  # python-dotenv not installed; pydantic-settings still reads the file


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_env_file,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # API keys
    groq_api_key: str = ""
    gemini_api_key: str = ""
    braintrust_api_key: str = ""
    braintrust_project_name: str = "policy-memo-agent"

    # Infrastructure (optional)
    database_url: str = ""
    redis_url: str = ""

    # NLI model
    hf_model_path: str = "MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli"
    nli_onnx_model_path: str = ""

    # Agent tuning
    max_tool_calls: int = 25
    max_research_tokens: int = 50000
    max_revision_attempts: int = 2

    log_level: str = "info"
    backend_port: int = 8000
    frontend_port: int = 3000


settings = Settings()
