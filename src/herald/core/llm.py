"""LLM provider abstraction for HERALD.

Supports Groq, Google Gemini, and OpenAI behind a unified interface.
Switch providers via config: provider: "groq" | "gemini" | "openai"

Usage:
    client = get_llm_client(config)
    response = client.complete(prompt, json_mode=True, system=JUDGE_SYSTEM)

Retry + failover
----------------
Each .complete() call is wrapped in exponential-backoff retry logic (max 3
attempts, base delay 1 s, max delay 30 s, ±25% jitter).  Retryable errors:
  - HTTP 429 (rate limit)
  - HTTP 500 / 503 (server error)
  - Timeout / connection errors

If all retries are exhausted and a ``fallback_model`` is configured for the
tier, the call is re-attempted once against that model (different provider
if the model string is prefixed ``groq/`` or ``gemini/``).

Retries and failovers are recorded as OTel span attributes so they show up
in any connected tracing backend.
"""

import logging
import os
import random
import re
import time
from dataclasses import dataclass

logger = logging.getLogger("herald.llm")


# ── Retry helpers ─────────────────────────────────────────────────────────────

_RETRYABLE_STATUS_CODES = {429, 500, 503}

# Maximum number of retry attempts (not counting the initial call)
_MAX_RETRIES = 3
_BASE_DELAY = 1.0  # seconds
_MAX_DELAY = 30.0  # seconds
_JITTER_FACTOR = 0.25  # ±25% random jitter


def _is_retryable(exc: Exception) -> bool:
    """Return True if *exc* is a transient error worth retrying."""
    msg = str(exc).lower()

    # Detect HTTP status codes embedded in common SDK exception messages
    for code in _RETRYABLE_STATUS_CODES:
        if str(code) in msg:
            return True

    # Timeout / connection keywords used by httpx, requests, grpc, etc.
    retryable_keywords = (
        "timeout",
        "timed out",
        "connection",
        "rate limit",
        "rate_limit",
        "ratelimit",
        "resource exhausted",
        "service unavailable",
        "internal server error",
        "overloaded",
    )
    return any(kw in msg for kw in retryable_keywords)


def _backoff_delay(attempt: int) -> float:
    """Compute exponential-backoff delay with jitter for *attempt* (0-indexed)."""
    base = min(_BASE_DELAY * (2**attempt), _MAX_DELAY)
    jitter = base * _JITTER_FACTOR * (2 * random.random() - 1)
    return max(0.0, base + jitter)


def _get_active_span():
    """Return the current OTel span, or None if OTel is not installed/active."""
    try:
        from opentelemetry import trace

        span = trace.get_current_span()
        # INVALID_SPAN is the sentinel returned when no span is active
        if span is trace.INVALID_SPAN:
            return None
        return span
    except Exception:
        return None


def _call_with_retry(fn, *args, **kwargs):
    """Call *fn(*args, **kwargs)* with exponential-backoff retry.

    Returns the result of the first successful call.
    Raises the last exception when all retries are exhausted.
    Retry events are automatically recorded on the current active OTel span.
    """
    last_exc: Exception | None = None
    for attempt in range(_MAX_RETRIES):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            if not _is_retryable(exc):
                raise
            last_exc = exc
            delay = _backoff_delay(attempt)
            logger.warning(
                "[LLM] Retryable error on attempt %d/%d: %s. Retrying in %.1fs.",
                attempt + 1,
                _MAX_RETRIES,
                exc,
                delay,
            )
            span = _get_active_span()
            if span is not None:
                try:
                    span.set_attribute("herald.llm.retry_count", attempt + 1)
                    span.set_attribute("herald.llm.last_retry_reason", str(exc)[:200])
                except Exception:
                    pass
            time.sleep(delay)
    raise last_exc  # type: ignore[misc]


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


# ── Resilient client wrapper ───────────────────────────────────────────────────


class ResilientClient:
    """Wraps any provider client with retry + optional fallback-model failover.

    ``complete()`` signature is identical to the underlying clients so all
    existing callers (judge.py, debate.py, counterfactual.py) work unchanged.

    Failover flow
    -------------
    1. Attempt ``primary.complete()`` up to ``_MAX_RETRIES`` times with
       exponential backoff.
    2. If all retries are exhausted *and* a ``fallback_client`` is provided,
       log the failover event, annotate the current OTel span, and attempt
       ``fallback_client.complete()`` once (no further retry on the fallback).
    3. If the fallback also raises, propagate that exception.
    """

    def __init__(self, primary, fallback=None):
        self._primary = primary
        self._fallback = fallback
        # Expose same interface attributes as underlying clients
        self.model = primary.model
        self.provider = primary.provider

    def complete(
        self,
        prompt: str,
        system: str = "",
        json_mode: bool = False,
        temperature: float = 0.1,
    ) -> LLMResponse:
        try:
            return _call_with_retry(
                self._primary.complete,
                prompt,
                system=system,
                json_mode=json_mode,
                temperature=temperature,
            )
        except Exception as primary_exc:
            if self._fallback is None:
                raise

            logger.warning(
                "[LLM] Primary model '%s' exhausted all retries (%s). Failing over to '%s'.",
                self._primary.model,
                primary_exc,
                self._fallback.model,
            )
            # Record the failover on whatever OTel span is currently active
            span = _get_active_span()
            if span is not None:
                try:
                    span.set_attribute("herald.llm.failover", True)
                    span.set_attribute("herald.llm.failover_model", self._fallback.model)
                    span.set_attribute("herald.llm.failover_reason", str(primary_exc)[:200])
                except Exception:
                    pass

            return self._fallback.complete(
                prompt,
                system=system,
                json_mode=json_mode,
                temperature=temperature,
            )


def _build_client_from_model_string(model_str: str, config: dict):
    """Build a provider client from a model string.

    Model strings can be plain (e.g. ``gemma-3-27b-it``) or prefixed with the
    provider (e.g. ``groq/llama-3.1-70b-versatile``, ``gemini/gemini-2.0-flash``).
    When prefixed, the prefix overrides ``config["provider"]``.
    """
    if "/" in model_str and model_str.split("/")[0] in ("groq", "gemini", "openai"):
        provider_override, model = model_str.split("/", 1)
    else:
        provider_override = None
        model = model_str

    provider = (provider_override or config.get("provider", "groq")).lower()

    if provider == "gemini":
        api_key = config.get("gemini_api_key") or os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            raise ValueError(
                "GEMINI_API_KEY not set. Add it to your .env file.\n"
                "Get a free key at https://aistudio.google.com/apikey"
            )
        return GeminiClient(api_key=api_key, model=model)

    elif provider == "groq":
        api_key = config.get("groq_api_key", "") or os.environ.get("GROQ_API_KEY", "")
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


def get_llm_client(config: dict, tier: int = 2) -> ResilientClient:
    """Build a resilient LLM client from config.

    Args:
        config: The full HERALD config dict.
        tier:   Which tier's model config to use (2 or 3). Defaults to 2.
                Tier 2 and Tier 3 can now use different models — set
                ``tier2.model`` and ``tier3.model`` independently in
                configs/default.yaml. If ``tier3.model`` is not set,
                falls back to ``tier2.model``.

    Returns a ``ResilientClient`` that wraps the primary provider client with:
      - Exponential-backoff retry (up to 3 attempts) on 429/500/503/timeout
      - Optional failover to ``fallback_model`` when all retries are exhausted
    """
    provider = config.get("provider", "groq").lower()

    # Resolve primary model: tier-specific first, then fall back to tier2 default
    tier_key = f"tier{tier}"
    _provider_defaults = {
        "gemini": "gemini-2.0-flash",
        "groq": "llama-3.3-70b-versatile",
        "openai": "gpt-4o-mini",
    }
    tier2_model = config.get("tier2", {}).get("model", _provider_defaults.get(provider, ""))
    model = config.get(tier_key, {}).get("model") or tier2_model

    primary = _build_client_from_model_string(model, config)

    # Build fallback client if a fallback_model is configured for this tier
    fallback_model_str = config.get(tier_key, {}).get("fallback_model")
    fallback = None
    if fallback_model_str:
        try:
            fallback = _build_client_from_model_string(fallback_model_str, config)
            logger.debug(
                "[LLM] Tier %d: primary=%s fallback=%s",
                tier,
                primary.model,
                fallback.model,
            )
        except Exception as exc:
            logger.warning(
                "[LLM] Tier %d: could not build fallback client for '%s': %s — failover disabled.",
                tier,
                fallback_model_str,
                exc,
            )

    return ResilientClient(primary=primary, fallback=fallback)
