"""
run_experiment.py — HERALD vs. LLM-as-Judge experiment runner.

Evaluates three systems against the ground-truth eval set:
  System A: Full HERALD pipeline  (Tier 1 → 2 → 3 → 4)
  System B: LLM-as-Judge only     (Tier 2 direct, no NLI or debate)
  System C: HERALD without Tier 1 (Tier 2 → 3, NLI skipped for all types)

Usage (from repo root):
  cd backend
  uv run python ../experiment-scripts/run_experiment.py [OPTIONS]

Options:
  --eval-set PATH        Path to eval-set JSON  [default: ../data/eval-set.json]
  --output PATH          Output JSON file        [default: ../results/experiment-YYYY-MM-DD.json]
  --systems A B C        Which systems to run    [default: A B C]
  --claim-types TYPE...  Filter by claim type(s) [default: all]
  --concurrency N        Max concurrent claims   [default: 3]
  --dry-run              Mock verdicts, no API calls
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import random
import sys
import time
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Any, AsyncGenerator

import anthropic
from pydantic import BaseModel

# Resolve backend src so imports work when run from repo root or experiment-scripts/
_BACKEND_SRC = Path(__file__).parent.parent / "backend" / "src"
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from policy_memo_agent.herald.router import evaluate_claim
from policy_memo_agent.herald.tier2_judge import run_tier2
from policy_memo_agent.herald.tier3_debate import run_debate
from policy_memo_agent.models.claims import (
    ClaimType,
    NotesLogEntry,
    get_routing_config,
)
from policy_memo_agent.models.herald import TierOutput, Verdict
from policy_memo_agent.services.nli_service import NLIService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger("experiment")


# ---------------------------------------------------------------------------
# Eval-set schema (NotesLogEntry + ground truth fields)
# ---------------------------------------------------------------------------


class EvalEntry(NotesLogEntry):
    """A NotesLogEntry extended with ground-truth verdict for benchmarking."""

    ground_truth_verdict: str
    ground_truth_rationale: str


# ---------------------------------------------------------------------------
# Token-tracking Anthropic client wrapper
# ---------------------------------------------------------------------------


class _UsageAccumulator:
    """Thread-safe accumulator for Anthropic API usage across multiple calls."""

    def __init__(self) -> None:
        self.input_tokens: int = 0
        self.output_tokens: int = 0
        self.call_count: int = 0

    def record(self, usage: anthropic.types.Usage) -> None:
        self.input_tokens += usage.input_tokens
        self.output_tokens += usage.output_tokens
        self.call_count += 1

    def snapshot(self) -> dict[str, int]:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "api_calls": self.call_count,
        }


class TokenTrackingClient(anthropic.AsyncAnthropic):
    """
    Thin subclass that intercepts messages.create() and records token usage
    into a caller-supplied _UsageAccumulator. All other behaviour is identical
    to the base AsyncAnthropic client.
    """

    def __init__(self, accumulator: _UsageAccumulator, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._accumulator = accumulator

    # messages is a property on the base class; we override create at call time
    # by wrapping the entire messages namespace with a proxy.
    @property  # type: ignore[override]
    def messages(self) -> Any:  # noqa: ANN401
        parent_messages = super().messages
        acc = self._accumulator

        class _TrackedMessages:
            async def create(self, **kw: Any) -> Any:  # noqa: ANN401
                response = await parent_messages.create(**kw)
                if hasattr(response, "usage") and response.usage is not None:
                    acc.record(response.usage)
                return response

        return _TrackedMessages()


# ---------------------------------------------------------------------------
# Per-claim result record
# ---------------------------------------------------------------------------


class SystemResult(BaseModel):
    verdict: str
    tier_reached: int
    confidence: float
    input_tokens: int
    output_tokens: int
    api_calls: int
    latency_ms: int
    error: str | None = None


class ClaimResult(BaseModel):
    claim_id: str
    claim_type: str
    derivation: str
    ground_truth: str
    system_a: SystemResult | None = None
    system_b: SystemResult | None = None
    system_c: SystemResult | None = None


# ---------------------------------------------------------------------------
# Dry-run helpers
# ---------------------------------------------------------------------------

_DRY_RUN_VERDICTS = [Verdict.VALID, Verdict.INVALID]


def _dry_run_result(system: str, claim: EvalEntry) -> SystemResult:
    """Return a deterministic mock result keyed on claim_id hash."""
    rng = random.Random(f"{system}-{claim.claim_id}")
    verdict = rng.choice(_DRY_RUN_VERDICTS)
    tier = 1 if system == "A" else 2
    return SystemResult(
        verdict=verdict,
        tier_reached=tier,
        confidence=round(rng.uniform(0.7, 0.99), 2),
        input_tokens=rng.randint(300, 1200),
        output_tokens=rng.randint(80, 400),
        api_calls=tier,
        latency_ms=rng.randint(200, 3000),
    )


# ---------------------------------------------------------------------------
# System runners
# ---------------------------------------------------------------------------


async def _run_system_a(
    claim: EvalEntry,
    nli_service: NLIService | None,
    client: TokenTrackingClient,
    accumulator: _UsageAccumulator,
) -> SystemResult:
    """Full HERALD pipeline."""
    t0 = time.monotonic()
    try:
        result = await evaluate_claim(
            claim,
            policy_topic="public policy",
            nli_service=nli_service,
            anthropic_client=client,
        )
        latency = int((time.monotonic() - t0) * 1000)
        usage = accumulator.snapshot()
        return SystemResult(
            verdict=result.verdict,
            tier_reached=result.tier_reached,
            confidence=result.confidence,
            input_tokens=usage["input_tokens"],
            output_tokens=usage["output_tokens"],
            api_calls=usage["api_calls"],
            latency_ms=latency,
        )
    except Exception as exc:
        logger.warning("System A failed for %s: %s", claim.claim_id, exc)
        return SystemResult(
            verdict="error",
            tier_reached=0,
            confidence=0.0,
            input_tokens=accumulator.input_tokens,
            output_tokens=accumulator.output_tokens,
            api_calls=accumulator.call_count,
            latency_ms=int((time.monotonic() - t0) * 1000),
            error=str(exc),
        )


async def _run_system_b(
    claim: EvalEntry,
    client: TokenTrackingClient,
    accumulator: _UsageAccumulator,
) -> SystemResult:
    """LLM-as-Judge only (Tier 2 direct, verdict returned regardless of confidence)."""
    t0 = time.monotonic()
    try:
        tier_output: TierOutput = await run_tier2(claim, [], client=client)
        latency = int((time.monotonic() - t0) * 1000)
        usage = accumulator.snapshot()
        output = tier_output.output
        if output is None:
            raise ValueError("Tier 2 returned no output")
        # For System B we take the raw verdict (no escalation threshold applied)
        # The judge's stated confidence is the final word.
        return SystemResult(
            verdict=str(output.verdict),
            tier_reached=2,
            confidence=output.confidence,
            input_tokens=usage["input_tokens"],
            output_tokens=usage["output_tokens"],
            api_calls=usage["api_calls"],
            latency_ms=latency,
        )
    except Exception as exc:
        logger.warning("System B failed for %s: %s", claim.claim_id, exc)
        return SystemResult(
            verdict="error",
            tier_reached=0,
            confidence=0.0,
            input_tokens=accumulator.input_tokens,
            output_tokens=accumulator.output_tokens,
            api_calls=accumulator.call_count,
            latency_ms=int((time.monotonic() - t0) * 1000),
            error=str(exc),
        )


async def _run_system_c(
    claim: EvalEntry,
    client: TokenTrackingClient,
    accumulator: _UsageAccumulator,
) -> SystemResult:
    """
    HERALD without Tier 1: Tier 2 → Tier 3 for all claim types.
    Implements the same escalation logic as the router but forces NLI skip.
    """
    _T2_THRESHOLD = 0.85
    t0 = time.monotonic()
    try:
        # Tier 2
        t2_output = await run_tier2(claim, [], client=client)
        t2_inner = t2_output.output
        if t2_inner is None:
            raise ValueError("Tier 2 returned no output")

        if t2_inner.confidence > _T2_THRESHOLD and t2_inner.verdict != Verdict.UNCERTAIN:
            latency = int((time.monotonic() - t0) * 1000)
            usage = accumulator.snapshot()
            return SystemResult(
                verdict=str(t2_inner.verdict),
                tier_reached=2,
                confidence=t2_inner.confidence,
                input_tokens=usage["input_tokens"],
                output_tokens=usage["output_tokens"],
                api_calls=usage["api_calls"],
                latency_ms=latency,
            )

        # Escalate to Tier 3
        t3_output = await run_debate(
            claim,
            [t2_output],
            policy_topic="public policy",
            client=client,
        )
        t3_inner = t3_output.output
        if t3_inner is None:
            raise ValueError("Tier 3 returned no output")

        latency = int((time.monotonic() - t0) * 1000)
        usage = accumulator.snapshot()

        # DebateOutput uses .final_verdict, not .verdict
        from policy_memo_agent.models.herald import DebateOutput

        if isinstance(t3_inner, DebateOutput):
            final_verdict = str(t3_inner.final_verdict)
            final_confidence = t3_inner.confidence
        else:
            final_verdict = str(t3_inner.verdict)
            final_confidence = t3_inner.confidence

        return SystemResult(
            verdict=final_verdict,
            tier_reached=3,
            confidence=final_confidence,
            input_tokens=usage["input_tokens"],
            output_tokens=usage["output_tokens"],
            api_calls=usage["api_calls"],
            latency_ms=latency,
        )
    except Exception as exc:
        logger.warning("System C failed for %s: %s", claim.claim_id, exc)
        return SystemResult(
            verdict="error",
            tier_reached=0,
            confidence=0.0,
            input_tokens=accumulator.input_tokens,
            output_tokens=accumulator.output_tokens,
            api_calls=accumulator.call_count,
            latency_ms=int((time.monotonic() - t0) * 1000),
            error=str(exc),
        )


# ---------------------------------------------------------------------------
# Per-claim orchestrator
# ---------------------------------------------------------------------------


async def evaluate_one(
    claim: EvalEntry,
    systems: list[str],
    nli_service: NLIService | None,
    api_key: str,
    dry_run: bool,
) -> ClaimResult:
    record = ClaimResult(
        claim_id=claim.claim_id,
        claim_type=claim.claim_type,
        derivation=claim.derivation,
        ground_truth=claim.ground_truth_verdict,
    )

    if dry_run:
        if "A" in systems:
            record.system_a = _dry_run_result("A", claim)
        if "B" in systems:
            record.system_b = _dry_run_result("B", claim)
        if "C" in systems:
            record.system_c = _dry_run_result("C", claim)
        return record

    # Each system gets its own accumulator + client so tokens don't cross-contaminate
    if "A" in systems:
        acc_a = _UsageAccumulator()
        client_a = TokenTrackingClient(acc_a, api_key=api_key)
        record.system_a = await _run_system_a(claim, nli_service, client_a, acc_a)

    if "B" in systems:
        acc_b = _UsageAccumulator()
        client_b = TokenTrackingClient(acc_b, api_key=api_key)
        record.system_b = await _run_system_b(claim, client_b, acc_b)

    if "C" in systems:
        acc_c = _UsageAccumulator()
        client_c = TokenTrackingClient(acc_c, api_key=api_key)
        record.system_c = await _run_system_c(claim, client_c, acc_c)

    return record


# ---------------------------------------------------------------------------
# Main experiment loop
# ---------------------------------------------------------------------------


async def run_experiment(
    eval_set_path: Path,
    output_path: Path,
    systems: list[str],
    claim_type_filter: list[str] | None,
    concurrency: int,
    dry_run: bool,
) -> None:
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not dry_run and not api_key:
        logger.error("ANTHROPIC_API_KEY is not set. Use --dry-run to test without an API key.")
        sys.exit(1)

    # Load eval set
    raw_entries: list[dict[str, Any]] = json.loads(eval_set_path.read_text())
    entries = [EvalEntry.model_validate(e) for e in raw_entries]

    if claim_type_filter:
        entries = [e for e in entries if e.claim_type in claim_type_filter]
        logger.info("Filtered to %d claims of type(s): %s", len(entries), claim_type_filter)

    # Randomise order to mitigate any positional bias
    random.seed(42)
    random.shuffle(entries)
    logger.info("Running %d claims × systems %s (concurrency=%d)", len(entries), systems, concurrency)

    # Load NLI service once (only needed if System A is running)
    nli_service: NLIService | None = None
    if "A" in systems and not dry_run:
        nli_service = NLIService()
        await nli_service.load()
        logger.info("NLI service loaded")

    # Run with a semaphore to control concurrency
    semaphore = asyncio.Semaphore(concurrency)
    results: list[ClaimResult] = []
    completed = 0

    async def bounded(claim: EvalEntry) -> ClaimResult:
        async with semaphore:
            result = await evaluate_one(claim, systems, nli_service, api_key, dry_run)
            nonlocal completed
            completed += 1
            logger.info("[%d/%d] %s  A=%s B=%s C=%s",
                completed, len(entries), claim.claim_id,
                result.system_a.verdict if result.system_a else "-",
                result.system_b.verdict if result.system_b else "-",
                result.system_c.verdict if result.system_c else "-",
            )
            return result

    results = await asyncio.gather(*[bounded(e) for e in entries])

    # Write output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "meta": {
            "date": str(date.today()),
            "eval_set": str(eval_set_path),
            "systems": systems,
            "claim_type_filter": claim_type_filter,
            "concurrency": concurrency,
            "dry_run": dry_run,
            "total_claims": len(results),
        },
        "results": [r.model_dump() for r in results],
    }
    output_path.write_text(json.dumps(payload, indent=2))
    logger.info("Results written to %s", output_path)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--eval-set",
        type=Path,
        default=Path(__file__).parent.parent / "data" / "eval-set.json",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parent.parent / "results" / f"experiment-{date.today()}.json",
    )
    parser.add_argument("--systems", nargs="+", choices=["A", "B", "C"], default=["A", "B", "C"])
    parser.add_argument(
        "--claim-types",
        nargs="+",
        choices=[t.value for t in ClaimType],
        default=None,
        metavar="TYPE",
    )
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    asyncio.run(
        run_experiment(
            eval_set_path=args.eval_set,
            output_path=args.output,
            systems=args.systems,
            claim_type_filter=args.claim_types,
            concurrency=args.concurrency,
            dry_run=args.dry_run,
        )
    )
