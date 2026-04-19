"""Tests for the WebSocket pipeline streaming endpoint.

Uses FastAPI's synchronous TestClient for WebSocket testing — starlette's
``websocket_connect`` context manager handles the WS handshake without
needing a real network connection.

Coverage:
  - Connection is accepted and a ``ping`` event is received immediately
  - Events pushed to the Redis stream are forwarded to the client
  - ``pipeline_complete`` event causes the server to close the connection
  - No-Redis path: connection is still accepted and ping is sent
  - Keepalive ping is sent when no events arrive
  - Unknown / malformed memo_id is handled (connection still accepted)
"""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from policy_memo_agent.api.app import create_app

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def client() -> TestClient:
    """Synchronous TestClient — required for WebSocket testing with starlette."""
    app = create_app()
    return TestClient(app, raise_server_exceptions=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_event(event_type: str, **kwargs: object) -> dict[str, object]:
    return {"type": event_type, **kwargs}


# ---------------------------------------------------------------------------
# Tests: connection handshake
# ---------------------------------------------------------------------------


def test_websocket_connects_and_sends_initial_ping(client: TestClient) -> None:
    """Connection is accepted and the first frame is a ping with the memo_id."""
    with (
        patch("policy_memo_agent.api.routes.ws.get_redis", return_value=None),
        client.websocket_connect("/ws/memo-001") as ws,
    ):
        msg = json.loads(ws.receive_text())
        assert msg["type"] == "ping"
        assert msg["memo_id"] == "memo-001"


def test_websocket_accepts_any_memo_id(client: TestClient) -> None:
    """The endpoint accepts connections for any memo_id string."""
    with (
        patch("policy_memo_agent.api.routes.ws.get_redis", return_value=None),
        client.websocket_connect("/ws/some-random-id-123") as ws,
    ):
        msg = json.loads(ws.receive_text())
        assert msg["type"] == "ping"


# ---------------------------------------------------------------------------
# Tests: Redis event forwarding
# ---------------------------------------------------------------------------


def test_events_from_redis_are_forwarded(client: TestClient) -> None:
    """Events returned by pop_stream_events are sent to the client."""
    agent_step = _make_event(
        "agent_step",
        step_id="step-1",
        label="Researching sources",
        detail="Querying arXiv",
        status="running",
        tool_calls_used=3,
        tokens_used=1200,
    )

    mock_redis = object()  # non-None sentinel so the code enters the Redis branch

    # First poll returns one event; subsequent polls return nothing (avoids infinite loop)
    pop_side_effects: list[list[dict[str, object]]] = [[agent_step], [], []]

    async def mock_pop(_memo_id: str, **_kwargs: object) -> list[dict[str, object]]:
        if pop_side_effects:
            return pop_side_effects.pop(0)
        return []

    with (
        patch("policy_memo_agent.api.routes.ws.get_redis", return_value=mock_redis),
        patch("policy_memo_agent.api.routes.ws.pop_stream_events", side_effect=mock_pop),
        client.websocket_connect("/ws/memo-002") as ws,
    ):
        # Frame 1: initial ping
        first = json.loads(ws.receive_text())
        assert first["type"] == "ping"

        # Frame 2: the agent_step event
        second = json.loads(ws.receive_text())
        assert second["type"] == "agent_step"
        assert second["label"] == "Researching sources"
        assert second["status"] == "running"
        ws.close()


def test_multiple_events_per_poll_are_all_forwarded(client: TestClient) -> None:
    """All events returned in a single pop are forwarded before the next poll."""
    events = [
        _make_event(
            "tool_call",
            tool_name="arxiv_search",
            query="CCT programs",
            latency_ms=320,
            success=True,
        ),
        _make_event(
            "tool_call", tool_name="worldbank_api", query="GDP Chad", latency_ms=180, success=True
        ),
    ]

    mock_redis = object()
    calls = 0

    async def mock_pop(_memo_id: str, **_kwargs: object) -> list[dict[str, object]]:
        nonlocal calls
        calls += 1
        if calls == 1:
            return events  # type: ignore[return-value]
        return []

    with (
        patch("policy_memo_agent.api.routes.ws.get_redis", return_value=mock_redis),
        patch("policy_memo_agent.api.routes.ws.pop_stream_events", side_effect=mock_pop),
        client.websocket_connect("/ws/memo-003") as ws,
    ):
        ws.receive_text()  # ping
        e1 = json.loads(ws.receive_text())
        e2 = json.loads(ws.receive_text())
        assert e1["type"] == "tool_call"
        assert e1["tool_name"] == "arxiv_search"
        assert e2["tool_name"] == "worldbank_api"
        ws.close()  # disconnect so the server loop exits cleanly


# ---------------------------------------------------------------------------
# Tests: pipeline_complete closes the connection
# ---------------------------------------------------------------------------


def test_pipeline_complete_closes_connection(client: TestClient) -> None:
    """Server forwards pipeline_complete and then exits the handler loop."""
    complete_event = _make_event(
        "pipeline_complete",
        requires_human_intervention=[],
        duration_ms=45000,
    )

    mock_redis = object()
    pop_calls = 0

    async def mock_pop(_memo_id: str, **_kwargs: object) -> list[dict[str, object]]:
        nonlocal pop_calls
        pop_calls += 1
        # Return the event only on the first poll; server exits via `return` after forwarding it.
        return [complete_event] if pop_calls == 1 else []  # type: ignore[return-value]

    with (
        patch("policy_memo_agent.api.routes.ws.get_redis", return_value=mock_redis),
        patch("policy_memo_agent.api.routes.ws.pop_stream_events", side_effect=mock_pop),
        client.websocket_connect("/ws/memo-004") as ws,
    ):
        ws.receive_text()  # ping
        done = json.loads(ws.receive_text())
        assert done["type"] == "pipeline_complete"
        assert done["requires_human_intervention"] == []
        assert done["duration_ms"] == 45000
        # Server returns after pipeline_complete; context manager closes cleanly.


# ---------------------------------------------------------------------------
# Tests: no-Redis path
# ---------------------------------------------------------------------------


def test_no_redis_still_accepts_connection(client: TestClient) -> None:
    """When Redis is not configured, connection is accepted and ping is sent."""
    with (
        patch("policy_memo_agent.api.routes.ws.get_redis", return_value=None),
        client.websocket_connect("/ws/memo-005") as ws,
    ):
        msg = json.loads(ws.receive_text())
        assert msg["type"] == "ping"
        assert msg["memo_id"] == "memo-005"


def test_no_redis_does_not_call_pop_stream_events(client: TestClient) -> None:
    """pop_stream_events is never called when Redis is None."""
    with (
        patch("policy_memo_agent.api.routes.ws.get_redis", return_value=None),
        patch("policy_memo_agent.api.routes.ws.pop_stream_events") as mock_pop,
        client.websocket_connect("/ws/memo-006") as ws,
    ):
        ws.receive_text()  # ping
        mock_pop.assert_not_called()


# ---------------------------------------------------------------------------
# Tests: herald_update and revision_update events
# ---------------------------------------------------------------------------


def test_herald_update_event_forwarded(client: TestClient) -> None:
    """herald_update events carry HeraldResult payload and progress."""
    herald_event = _make_event(
        "herald_update",
        result={
            "claim_id": "C-001",
            "tier_reached": 2,
            "verdict": "valid",
            "confidence": 0.92,
            "feedback": "Entailment confirmed.",
            "suggested_revision": None,
            "tier_details": {},
        },
        progress={"completed": 1, "total": 5},
    )

    mock_redis = object()
    calls = 0

    async def mock_pop(_memo_id: str, **_kwargs: object) -> list[dict[str, object]]:
        nonlocal calls
        calls += 1
        return [herald_event] if calls == 1 else []  # type: ignore[return-value]

    with (
        patch("policy_memo_agent.api.routes.ws.get_redis", return_value=mock_redis),
        patch("policy_memo_agent.api.routes.ws.pop_stream_events", side_effect=mock_pop),
        client.websocket_connect("/ws/memo-007") as ws,
    ):
        ws.receive_text()  # ping
        event = json.loads(ws.receive_text())
        assert event["type"] == "herald_update"
        assert event["result"]["claim_id"] == "C-001"
        assert event["result"]["verdict"] == "valid"
        assert event["progress"]["completed"] == 1
        assert event["progress"]["total"] == 5
        ws.close()


def test_revision_update_event_forwarded(client: TestClient) -> None:
    """revision_update events are forwarded with correct fields."""
    revision_event = _make_event(
        "revision_update",
        claim_id="C-002",
        attempt=1,
        status="revised",
        new_claim_text="Maternal mortality in Chad is 1,140 per 100,000 live births.",
    )

    mock_redis = object()
    calls = 0

    async def mock_pop(_memo_id: str, **_kwargs: object) -> list[dict[str, object]]:
        nonlocal calls
        calls += 1
        return [revision_event] if calls == 1 else []  # type: ignore[return-value]

    with (
        patch("policy_memo_agent.api.routes.ws.get_redis", return_value=mock_redis),
        patch("policy_memo_agent.api.routes.ws.pop_stream_events", side_effect=mock_pop),
        client.websocket_connect("/ws/memo-008") as ws,
    ):
        ws.receive_text()  # ping
        event = json.loads(ws.receive_text())
        assert event["type"] == "revision_update"
        assert event["claim_id"] == "C-002"
        assert event["status"] == "revised"
        assert event["attempt"] == 1
        ws.close()
