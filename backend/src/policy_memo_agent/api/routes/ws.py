"""WebSocket endpoint for real-time pipeline event streaming.

The frontend ``useWebSocket`` hook connects to::

    ws://localhost:8000/ws/{memo_id}

Event flow
----------
When the pipeline is running it pushes JSON events into a Redis list via
``session_service.push_stream_event``.  This endpoint polls that list and
forwards each event to the connected client as a JSON text frame.

When Redis is not configured the endpoint still accepts the connection and
sends a single ``connected`` ping so the frontend hook reaches
``status: 'connected'``.  Events emitted without Redis simply won't be
streamed (the frontend falls back to polling the REST endpoints).

Supported event ``type`` values (mirrors ``useWebSocket.ts``):
  - ``agent_step``
  - ``tool_call``
  - ``memo_ready``
  - ``herald_update``
  - ``revision_update``
  - ``pipeline_complete``
  - ``error``
  - ``ping``  (keepalive, not forwarded to the event buffer in the hook)
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from policy_memo_agent.services.session_service import get_redis, pop_stream_events

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])

# How often to poll the Redis stream list for new events (seconds).
_POLL_INTERVAL = 0.25

# How often to send a keepalive ping when there are no events (seconds).
_PING_INTERVAL = 15.0


@router.websocket("/ws/{memo_id}")
async def pipeline_stream(websocket: WebSocket, memo_id: str) -> None:
    """Stream pipeline progress events for a memo generation run.

    The client connects once per pipeline run.  The server:
    1. Accepts the connection.
    2. Sends a ``connected`` ping so the hook transitions to ``status: 'connected'``.
    3. Polls the Redis stream list every 250 ms and forwards any queued events.
    4. Sends a ``ping`` keepalive every 15 s so the browser doesn't time out.
    5. Exits cleanly when the client disconnects or a ``pipeline_complete``
       event is forwarded.
    """
    await websocket.accept()
    logger.info("WebSocket connection opened for memo_id=%s", memo_id)

    # Send an immediate ping so the frontend hook registers as connected.
    await websocket.send_text(json.dumps({"type": "ping", "memo_id": memo_id}))

    redis = get_redis()
    if redis is None:
        logger.warning(
            "Redis not configured — WebSocket for memo %s will not stream events. "
            "Set REDIS_URL in .env to enable streaming.",
            memo_id,
        )

    time_since_ping = 0.0

    try:
        while True:
            # --- drain the Redis stream queue ---
            if redis is not None:
                events = await pop_stream_events(memo_id, count=50)
                for event in events:
                    await websocket.send_text(json.dumps(event))
                    if event.get("type") == "pipeline_complete":
                        logger.info(
                            "pipeline_complete received for memo %s — closing WebSocket", memo_id
                        )
                        return

            # --- keepalive ping ---
            time_since_ping += _POLL_INTERVAL
            if time_since_ping >= _PING_INTERVAL:
                await websocket.send_text(json.dumps({"type": "ping"}))
                time_since_ping = 0.0

            await asyncio.sleep(_POLL_INTERVAL)

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected for memo_id=%s", memo_id)
    except Exception:
        logger.exception("WebSocket error for memo_id=%s", memo_id)
        with contextlib.suppress(Exception):
            await websocket.send_text(
                json.dumps({"type": "error", "message": "Internal server error in stream."})
            )
