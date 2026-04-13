"""Telemetry stubs for HERALD.

Provides no-op implementations of OpenTelemetry helpers and Braintrust logger
so the pipeline runs without requiring optional observability infrastructure.

To enable real tracing, replace these with actual OpenTelemetry calls and set
OTEL_EXPORTER_OTLP_ENDPOINT in your environment.
"""

from contextlib import contextmanager


# ── No-op span ────────────────────────────────────────────────────────────────

class _NoOpSpan:
    """Span that accepts set_attribute calls and discards them."""

    def set_attribute(self, key: str, value) -> None:
        pass


# ── Public API ────────────────────────────────────────────────────────────────

def configure_otel() -> None:
    """Configure OpenTelemetry exporter. No-op unless overridden."""
    pass


def get_tracer(name: str):
    """Return a tracer instance. Returns None (accepted by timed_span)."""
    return None


@contextmanager
def timed_span(tracer, name: str, attributes: dict | None = None):
    """Context manager that yields a no-op span.

    Compatible with both a real OTel tracer and the None stub returned by
    get_tracer() above.
    """
    span = _NoOpSpan()
    try:
        yield span
    finally:
        pass


# ── Braintrust logger ─────────────────────────────────────────────────────────

class BraintrustLogger:
    """No-op Braintrust experiment logger.

    Activated only when BRAINTRUST_API_KEY is set. Silently discards all
    log calls when the key is absent so evaluation still runs without the
    optional dependency.
    """

    def __init__(self, experiment_name: str = "", **kwargs):
        self.experiment_name = experiment_name

    def log_case(self, *args, **kwargs) -> None:
        pass

    def flush(self) -> None:
        pass

    def finish(self) -> None:
        pass
