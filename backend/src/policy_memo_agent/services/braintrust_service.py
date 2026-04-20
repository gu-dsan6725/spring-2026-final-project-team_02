"""
Braintrust observability service for the Python backend.

Wraps the Braintrust Python SDK with a graceful no-op fallback so the app
runs correctly when BRAINTRUST_API_KEY is not set (e.g. in CI, local dev).

Usage
-----
from policy_memo_agent.services.braintrust_service import get_braintrust

bt = get_braintrust()
bt.log_nli_inference(...)
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

from policy_memo_agent.settings import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Payload dataclasses
# ---------------------------------------------------------------------------


@dataclass
class NLIInferenceLog:
    """One NLI premise-hypothesis pair inference record."""

    claim_id: str
    claim_text: str
    premise_chunk: str
    label: str  # "entailment" | "neutral" | "contradiction"
    entailment_score: float
    neutral_score: float
    contradiction_score: float
    latency_ms: float
    use_onnx: bool = False


@dataclass
class NLIBatchLog:
    """Summary of a batch NLI inference call."""

    claim_ids: list[str]
    labels: list[str]
    latency_ms: float
    pair_count: int
    use_onnx: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ModelLoadLog:
    """NLI model load event."""

    use_onnx: bool
    model_name: str
    latency_ms: float
    success: bool
    error: str | None = None


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class BraintrustService:
    """
    Thin wrapper around the Braintrust Python SDK.

    When BRAINTRUST_API_KEY is not set all methods are no-ops (they still
    write structured JSON to the Python logger at DEBUG level so local
    development is traceable without credentials).
    """

    def __init__(self) -> None:
        self._logger: Any = None  # braintrust.Logger | None
        self._enabled = False
        self._init()

    def _init(self) -> None:
        api_key = settings.braintrust_api_key
        project = settings.braintrust_project_name

        if not api_key:
            logger.warning("BRAINTRUST_API_KEY not set — Braintrust logging disabled (stderr only)")
            return

        try:
            import braintrust

            self._logger = braintrust.init_logger(
                api_key=api_key,
                project=project,
                async_flush=True,
            )
            self._enabled = True
            logger.info("Braintrust logger initialised (project: %s)", project)
        except ImportError:
            logger.warning("braintrust package not installed — pip install braintrust to enable")
        except Exception as exc:
            logger.warning("Braintrust init failed (non-fatal): %s", exc)

    # ------------------------------------------------------------------
    # Public logging methods
    # ------------------------------------------------------------------

    def log_nli_inference(self, entry: NLIInferenceLog) -> None:
        """Log a single NLI inference call."""
        payload = {
            "input": {
                "claim_id": entry.claim_id,
                "claim_text": entry.claim_text[:300],
                "premise_preview": entry.premise_chunk[:200],
                "use_onnx": entry.use_onnx,
            },
            "output": {
                "label": entry.label,
                "entailment_score": entry.entailment_score,
                "neutral_score": entry.neutral_score,
                "contradiction_score": entry.contradiction_score,
            },
            "metadata": {
                "latency_ms": entry.latency_ms,
                "tier": "tier1_nli",
            },
        }
        logger.debug("nli_inference %s", payload)
        self._log(payload)

    def log_nli_batch(self, entry: NLIBatchLog) -> None:
        """Log a batch NLI inference call."""
        payload = {
            "input": {
                "claim_ids": entry.claim_ids,
                "pair_count": entry.pair_count,
                "use_onnx": entry.use_onnx,
            },
            "output": {
                "labels": entry.labels,
            },
            "metadata": {
                "latency_ms": entry.latency_ms,
                "tier": "tier1_nli_batch",
                **entry.metadata,
            },
        }
        logger.debug("nli_batch %s", payload)
        self._log(payload)

    def log_model_load(self, entry: ModelLoadLog) -> None:
        """Log model loading event (startup telemetry)."""
        payload = {
            "input": {
                "model_name": entry.model_name,
                "use_onnx": entry.use_onnx,
            },
            "output": {
                "success": entry.success,
                "error": entry.error,
            },
            "metadata": {
                "latency_ms": entry.latency_ms,
                "event": "model_load",
            },
        }
        logger.debug("model_load %s", payload)
        self._log(payload)

    def log_herald_request(
        self,
        endpoint: str,
        claim_id: str,
        latency_ms: float,
        status_code: int,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Log a HERALD API request (latency + status)."""
        payload = {
            "input": {"endpoint": endpoint, "claim_id": claim_id},
            "output": {"status_code": status_code},
            "metadata": {
                "latency_ms": latency_ms,
                "event": "herald_request",
                **(metadata or {}),
            },
        }
        logger.debug("herald_request %s", payload)
        self._log(payload)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _log(self, payload: dict[str, Any]) -> None:
        if not self._enabled or self._logger is None:
            return
        try:
            self._logger.log(**payload)
        except Exception as exc:
            # Observability must never crash the app
            logger.debug("Braintrust log() failed (non-fatal): %s", exc)


# ---------------------------------------------------------------------------
# Timing helper
# ---------------------------------------------------------------------------


class Timer:
    """Context manager that measures elapsed wall-clock time in milliseconds."""

    def __init__(self) -> None:
        self.elapsed_ms: float = 0.0
        self._start: float = 0.0

    def __enter__(self) -> Timer:
        self._start = time.perf_counter()
        return self

    def __exit__(self, *_: object) -> None:
        self.elapsed_ms = (time.perf_counter() - self._start) * 1000.0


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_service_instance: BraintrustService | None = None


def get_braintrust() -> BraintrustService:
    """Return the module-level Braintrust service singleton."""
    global _service_instance
    if _service_instance is None:
        _service_instance = BraintrustService()
    return _service_instance
