"""Redis-backed session state for in-progress memo generation.

Purpose
-------
When the user's browser disconnects mid-generation, the agent state is preserved
in Redis so they can resume.  Three categories of state are managed:

1. **Agent state** — research plan, tool calls made so far, collected claim drafts.
   Key: ``agent:{memo_id}``  TTL: 24 hours

2. **HERALD progress** — which claim_ids have been evaluated, which are pending.
   Key: ``herald:{memo_id}``  TTL: 24 hours

3. **Generation stream** — SSE/WebSocket progress messages for the frontend.
   Key: ``stream:{memo_id}``  TTL: 2 hours (stream is ephemeral)

All values are JSON-encoded.  The service degrades gracefully: if Redis is
unavailable, methods log a warning and return None/empty rather than raising.
The generation pipeline must still function without Redis — it just loses
resume-ability.
"""

from __future__ import annotations

import json
import logging
from typing import Any, cast

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

_AGENT_TTL = 60 * 60 * 24  # 24 hours
_HERALD_TTL = 60 * 60 * 24
_STREAM_TTL = 60 * 60 * 2  # 2 hours

_redis: aioredis.Redis | None = None


def init_redis(redis_url: str) -> None:
    """Create the async Redis client.  Call once at startup."""
    global _redis
    _redis = aioredis.from_url(redis_url, decode_responses=True)
    logger.info("Redis client initialised")


async def close_redis() -> None:
    """Close the Redis connection pool.  Call at shutdown."""
    global _redis
    if _redis is not None:
        await _redis.aclose()
        logger.info("Redis client closed")
        _redis = None


def get_redis() -> aioredis.Redis | None:
    return _redis


# ---------------------------------------------------------------------------
# Agent state
# ---------------------------------------------------------------------------


async def save_agent_state(memo_id: str, state: dict[str, Any]) -> None:
    """Persist the current agent state for a memo generation run."""
    if _redis is None:
        logger.warning("Redis not available — agent state for %s will not be persisted", memo_id)
        return
    try:
        await _redis.setex(f"agent:{memo_id}", _AGENT_TTL, json.dumps(state))
    except Exception:
        logger.exception("Failed to save agent state for memo %s", memo_id)


async def load_agent_state(memo_id: str) -> dict[str, Any] | None:
    """Load the persisted agent state, or None if absent / Redis unavailable."""
    if _redis is None:
        return None
    try:
        raw = await _redis.get(f"agent:{memo_id}")
        if raw is None:
            return None
        return json.loads(raw)  # type: ignore[no-any-return]
    except Exception:
        logger.exception("Failed to load agent state for memo %s", memo_id)
        return None


async def delete_agent_state(memo_id: str) -> None:
    """Remove agent state after generation completes or is abandoned."""
    if _redis is None:
        return
    try:
        await _redis.delete(f"agent:{memo_id}")
    except Exception:
        logger.exception("Failed to delete agent state for memo %s", memo_id)


# ---------------------------------------------------------------------------
# HERALD evaluation progress
# ---------------------------------------------------------------------------


async def save_herald_progress(memo_id: str, progress: dict[str, Any]) -> None:
    """
    Persist HERALD evaluation progress.

    ``progress`` schema::

        {
            "evaluated": ["C-001", "C-003"],  # claim_ids completed
            "pending": ["C-002", "C-004"],  # claim_ids queued but not yet run
            "results": {"C-001": {...}},  # HeraldResult dicts, keyed by claim_id
        }
    """
    if _redis is None:
        logger.warning("Redis not available — HERALD progress for %s not persisted", memo_id)
        return
    try:
        await _redis.setex(f"herald:{memo_id}", _HERALD_TTL, json.dumps(progress))
    except Exception:
        logger.exception("Failed to save HERALD progress for memo %s", memo_id)


async def load_herald_progress(memo_id: str) -> dict[str, Any] | None:
    if _redis is None:
        return None
    try:
        raw = await _redis.get(f"herald:{memo_id}")
        if raw is None:
            return None
        return json.loads(raw)  # type: ignore[no-any-return]
    except Exception:
        logger.exception("Failed to load HERALD progress for memo %s", memo_id)
        return None


async def delete_herald_progress(memo_id: str) -> None:
    if _redis is None:
        return
    try:
        await _redis.delete(f"herald:{memo_id}")
    except Exception:
        logger.exception("Failed to delete HERALD progress for memo %s", memo_id)


# ---------------------------------------------------------------------------
# Generation stream messages (lightweight event bus)
# ---------------------------------------------------------------------------


async def push_stream_event(memo_id: str, event: dict[str, Any]) -> None:
    """Append a progress event to the stream list for the memo."""
    if _redis is None:
        return
    try:
        key = f"stream:{memo_id}"
        await cast("Any", _redis.rpush(key, json.dumps(event)))
        await _redis.expire(key, _STREAM_TTL)
    except Exception:
        logger.exception("Failed to push stream event for memo %s", memo_id)


async def pop_stream_events(memo_id: str, count: int = 50) -> list[dict[str, Any]]:
    """Pop up to ``count`` events from the stream list (FIFO)."""
    if _redis is None:
        return []
    try:
        key = f"stream:{memo_id}"
        # LPOP with count requires Redis >= 6.2
        raws = await cast("Any", _redis.lpop(key, count))
        if not raws:
            return []
        return [json.loads(r) for r in raws]
    except Exception:
        logger.exception("Failed to pop stream events for memo %s", memo_id)
        return []
