"""LLM provider abstraction for HERALD.

Supports Groq, Google Gemini, and OpenAI behind a unified interface.
Switch providers via config: provider: "groq" | "gemini" | "openai"

Usage:
    client = get_llm_client(config)
    response = client.complete(prompt, json_mode=True, system=JUDGE_SYSTEM)
"""

import os
import re
from dataclasses import dataclass


@dataclass
class LLMResponse:
    content: str
    model: str
    provider: str
    input_tokens: int = 0
    output_tokens: int = 0


class GroqClient:
    """Thin wrapper around Groq chat completions."""

    def __init__(self, api_key: str, model: str):
        from groq import Groq

        self.client = Groq(api_key=api_key)
        self.model = model
        self.provider = "groq"

    def complete(
        self,
        prompt: str,
        system: str = "",
        json_mode: bool = False,
        temperature: float = 0.1,
    ) -> LLMResponse:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        kwargs = {}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
            **kwargs,
        )
        usage = response.usage
        return LLMResponse(
            content=response.choices[0].message.content,
            model=self.model,
            provider="groq",
            input_tokens=usage.prompt_tokens if usage else 0,
            output_tokens=usage.completion_tokens if usage else 0,
        )


class GeminiClient:
    """Thin wrapper around Google Gemini via google-genai SDK.

    Uses the OpenAI-compatible endpoint pattern via google.genai.
    JSON mode is enforced via response_mime_type when json_mode=True.
    """

    # Models known not to support system_instruction or json_mode
    _NO_SYSTEM_MODELS = {
        "gemma-3-1b-it",
        "gemma-3-4b-it",
        "gemma-3-12b-it",
        "gemma-3-27b-it",
        "gemma-3n-e4b-it",
        "gemma-3n-e2b-it",
        "gemma-4-26b-a4b-it",
        "gemma-4-31b-it",
    }

    def __init__(self, api_key: str, model: str):
        from google import genai
        from google.genai import types as genai_types

        self.client = genai.Client(api_key=api_key)
        self.model = model
        self.provider = "gemini"
        self._types = genai_types
        # Check if this model supports system_instruction and json_mode
        base = model.split("/")[-1].split("-preview")[0].split("-00")[0]
        self._supports_system = base not in self._NO_SYSTEM_MODELS
        self._supports_json_mode = self._supports_system  # same set for now

    @staticmethod
    def _extract_json_from_text(text: str) -> str:
        """Extract JSON from markdown code fences if present."""
        # Strip ```json ... ``` or ``` ... ``` fences
        match = re.search(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", text, re.DOTALL)
        if match:
            return match.group(1)
        # Try to find bare JSON object/array
        match = re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)
        if match:
            return match.group(1)
        return text

    def complete(
        self,
        prompt: str,
        system: str = "",
        json_mode: bool = False,
        temperature: float = 0.1,
    ) -> LLMResponse:
        config_kwargs = {"temperature": temperature}

        # Use native features only if the model supports them
        if system and self._supports_system:
            config_kwargs["system_instruction"] = system
        if json_mode and self._supports_json_mode:
            config_kwargs["response_mime_type"] = "application/json"

        # For models without system support, merge system into prompt
        effective_prompt = (
            f"{system}\n\n{prompt}" if (system and not self._supports_system) else prompt
        )

        config = self._types.GenerateContentConfig(**config_kwargs)
        response = self.client.models.generate_content(
            model=self.model,
            contents=effective_prompt,
            config=config,
        )
        content = self._extract_json_from_text(response.text) if json_mode else response.text
        usage = getattr(response, "usage_metadata", None)
        return LLMResponse(
            content=content,
            model=self.model,
            provider="gemini",
            input_tokens=getattr(usage, "prompt_token_count", 0) or 0,
            output_tokens=getattr(usage, "candidates_token_count", 0) or 0,
        )


class OpenAIClient:
    """Thin wrapper around OpenAI chat completions."""

    def __init__(self, api_key: str, model: str):
        from openai import OpenAI

        self.client = OpenAI(api_key=api_key)
        self.model = model
        self.provider = "openai"

    def complete(
        self,
        prompt: str,
        system: str = "",
        json_mode: bool = False,
        temperature: float = 0.1,
    ) -> LLMResponse:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        kwargs = {}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
            **kwargs,
        )
        usage = response.usage
        return LLMResponse(
            content=response.choices[0].message.content,
            model=self.model,
            provider="openai",
            input_tokens=usage.prompt_tokens if usage else 0,
            output_tokens=usage.completion_tokens if usage else 0,
        )


def get_llm_client(config: dict, tier: int = 2):
    """Build the right LLM client from config.

    Args:
        config: The full HERALD config dict.
        tier:   Which tier's model config to use (2 or 3). Defaults to 2.
                Tier 2 and Tier 3 can now use different models — set
                ``tier2.model`` and ``tier3.model`` independently in
                configs/default.yaml. If ``tier3.model`` is not set,
                falls back to ``tier2.model``.
    """
    provider = config.get("provider", "groq").lower()

    # Resolve model: tier-specific first, then fall back to tier2 default
    tier_key = f"tier{tier}"
    fallback_model_defaults = {
        "gemini": "gemini-2.0-flash",
        "groq": "llama-3.3-70b-versatile",
        "openai": "gpt-4o-mini",
    }
    tier2_model = config.get("tier2", {}).get("model", fallback_model_defaults.get(provider, ""))
    model = config.get(tier_key, {}).get("model") or tier2_model

    if provider == "gemini":
        api_key = config.get("gemini_api_key") or os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            raise ValueError(
                "GEMINI_API_KEY not set. Add it to your .env file.\n"
                "Get a free key at https://aistudio.google.com/apikey"
            )
        return GeminiClient(api_key=api_key, model=model)

    elif provider == "groq":
        api_key = config.get("groq_api_key", "")
        if not api_key:
            raise ValueError("GROQ_API_KEY not set. Add it to your .env file.")
        return GroqClient(api_key=api_key, model=model)

    elif provider == "openai":
        api_key = config.get("openai_api_key") or os.environ.get("OPENAI_API_KEY", "")
        if not api_key:
            raise ValueError("OPENAI_API_KEY not set. Add it to your .env file.")
        return OpenAIClient(api_key=api_key, model=model)

    else:
        raise ValueError(f"Unknown provider: {provider!r}. Use 'groq', 'gemini', or 'openai'.")
