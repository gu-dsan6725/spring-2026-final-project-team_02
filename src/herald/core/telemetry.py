"""HERALD observability — OpenTelemetry tracing + Braintrust experiment logging.

Two independent concerns live here:

OpenTelemetry (OTel)
--------------------
Wraps each tier call in a span so you can see per-tier latency, token usage,
escalation rates, and verdict distributions in any OTel-compatible backend
(Jaeger, Honeycomb, Datadog, Langfuse, etc.).

Configure via environment variables (standard OTel conventions):
  OTEL_EXPORTER_OTLP_ENDPOINT  — e.g. http://localhost:4318 for a local collector
  OTEL_SERVICE_NAME            — defaults to "herald"

If OTEL_EXPORTER_OTLP_ENDPOINT is not set, spans are emitted to stdout at DEBUG
level only (no-op in production unless you enable debug logging).

Braintrust
----------
Logs each eval case as a scored experiment row so threshold sweeps, prompt
changes, and model swaps are tracked as named experiments with comparison tables.

Configure via environment variable:
  BRAINTRUST_API_KEY  — get one at braintrust.dev

Usage in evaluate.py:
  from herald.core.telemetry import BraintrustLogger
  bt = BraintrustLogger(experiment_name="run_07_govreport_v2")
  bt.log_case(input=..., output=..., expected=..., scores=...)
  bt.flush()

Usage in escalation.py (OTel):
  from herald.core.telemetry import get_tracer
  tracer = get_tracer()
  with tracer.start_as_current_span("herald.tier1") as span:
      span.set_attribute("herald.checkpoint_type", cp_type)
      ...
"""

from __future__ import annotations

import logging
import os
import time
from contextlib import contextmanager
from typing import Any

logger = logging.getLogger("herald.telemetry")


# ── OpenTelemetry ─────────────────────────────────────────────────────────────


def configure_otel(service_name: str = "herald") -> None:
    """Configure the global OTel TracerProvider.

    Safe to call multiple times — subsequent calls are no-ops if already
    configured. If OTEL_EXPORTER_OTLP_ENDPOINT is not set, a no-op provider
    is used so the rest of the code can use get_tracer() unconditionally.
    """
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

        # Don't re-configure if a real provider is already set
        existing = trace.get_tracer_provider()
        if not isinstance(existing, trace.ProxyTracerProvider):
            return

        resource = Resource.create({"service.name": service_name})
        provider = TracerProvider(resource=resource)

        endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
        if endpoint:
            try:
                from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
                    OTLPSpanExporter,
                )

                provider.add_span_processor(
                    BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces"))
                )
                logger.info(f"[Telemetry] OTel exporter → {endpoint}")
            except ImportError:
                logger.warning(
                    "[Telemetry] opentelemetry-exporter-otlp-proto-http not installed; "
                    "falling back to console exporter. Run: uv add opentelemetry-exporter-otlp-proto-http"
                )
                provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
        else:
            logger.debug(
                "[Telemetry] OTEL_EXPORTER_OTLP_ENDPOINT not set — spans logged to DEBUG only"
            )

        trace.set_tracer_provider(provider)

    except ImportError:
        logger.debug(
            "[Telemetry] opentelemetry-sdk not installed — tracing disabled. "
            "Run: uv add opentelemetry-sdk"
        )


def get_tracer(name: str = "herald"):
    """Return an OTel tracer, or a no-op shim if OTel is not installed."""
    try:
        from opentelemetry import trace

        return trace.get_tracer(name)
    except ImportError:
        return _NoOpTracer()


class _NoOpSpan:
    """Minimal span shim used when OTel is not installed."""

    def set_attribute(self, key: str, value: Any) -> None:  # noqa: ANN401
        pass

    def record_exception(self, exc: Exception) -> None:
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass


class _NoOpTracer:
    """No-op tracer shim used when opentelemetry-sdk is not installed."""

    @contextmanager
    def start_as_current_span(self, name: str, **_kwargs):
        yield _NoOpSpan()


# ── Braintrust ────────────────────────────────────────────────────────────────


class BraintrustLogger:
    """Log eval cases to a Braintrust experiment.

    Each case becomes one row in the experiment with:
      input    — dict with checkpoint_type, output_text, source_context
      output   — final_verdict from HERALD
      expected — ground truth label
      scores   — {"accuracy": 0|1, "tier_resolved": 1|2|3|4}
      metadata — tier confidences, escalation path

    Falls back to a no-op (just prints) if braintrust is not installed or
    BRAINTRUST_API_KEY is not set.
    """

    def __init__(self, experiment_name: str, project: str | None = None):
        self._rows: list[dict] = []
        self._experiment_name = experiment_name
        self._bt = None

        api_key = os.environ.get("BRAINTRUST_API_KEY")
        if not api_key:
            logger.info(
                "[Telemetry] BRAINTRUST_API_KEY not set — Braintrust logging disabled. "
                "Results will be printed to stdout only."
            )
            return

        # Project: explicit arg > BRAINTRUST_PROJECT env var > fallback "herald"
        resolved_project = project or os.environ.get("BRAINTRUST_PROJECT", "herald")

        try:
            import braintrust

            self._bt = braintrust.init(
                project=resolved_project,
                experiment=experiment_name,
                api_key=api_key,
            )
            logger.info(
                f"[Telemetry] Braintrust experiment '{experiment_name}' "
                f"opened in project '{resolved_project}'"
            )
        except ImportError:
            logger.warning(
                "[Telemetry] braintrust package not installed — logging disabled. "
                "Run: uv add braintrust"
            )

    def log_case(
        self,
        *,
        input: dict,
        output: str,
        expected: str,
        metadata: dict | None = None,
    ) -> None:
        """Log one eval case. Call flush() at the end of the eval run."""
        scores = {
            "accuracy": 1 if output == expected else 0,
        }
        if metadata and "resolved_at_tier" in metadata:
            scores["tier_resolved"] = metadata["resolved_at_tier"]

        row = {
            "input": input,
            "output": output,
            "expected": expected,
            "scores": scores,
            "metadata": metadata or {},
        }
        self._rows.append(row)

        if self._bt is not None:
            try:
                self._bt.log(**row)
            except Exception as e:
                logger.warning(f"[Telemetry] Braintrust log failed: {e}")

    def flush(self) -> None:
        """Flush all buffered rows to Braintrust and print summary."""
        if self._bt is not None:
            try:
                self._bt.flush()
                logger.info(f"[Telemetry] Flushed {len(self._rows)} rows to Braintrust")
            except Exception as e:
                logger.warning(f"[Telemetry] Braintrust flush failed: {e}")

        # Always print a local summary
        n = len(self._rows)
        if n:
            correct = sum(1 for r in self._rows if r["scores"]["accuracy"] == 1)
            print(f"[Braintrust] {self._experiment_name}: {correct}/{n} ({correct / n:.1%}) logged")

    @property
    def rows(self) -> list[dict]:
        return list(self._rows)


# ── Convenience: timed span context manager ───────────────────────────────────


@contextmanager
def timed_span(tracer, span_name: str, attributes: dict | None = None):
    """Context manager that wraps a block in an OTel span and logs duration.

    Usage:
        with timed_span(tracer, "herald.tier2", {"checkpoint_type": "numerical"}):
            result = judge.judge(checkpoint, t1_result)
    """
    start = time.perf_counter()
    with tracer.start_as_current_span(span_name) as span:
        if attributes:
            for k, v in attributes.items():
                span.set_attribute(k, v)
        try:
            yield span
        except Exception as exc:
            span.record_exception(exc)
            raise
        finally:
            elapsed_ms = (time.perf_counter() - start) * 1000
            span.set_attribute("herald.duration_ms", round(elapsed_ms, 1))
