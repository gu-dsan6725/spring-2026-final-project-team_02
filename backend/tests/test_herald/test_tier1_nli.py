"""
HERALD Tier 1 NLI tests.

Test groups
-----------
Unit tests (fast, no model required)
  - NLIService raises before load()
  - _parse_hf_output normalises labels correctly
  - HTTP endpoint returns 503 when model is not loaded
  - HTTP endpoint returns correct structure when model is mocked

Slow / integration tests (@pytest.mark.tier1 @pytest.mark.slow)
  - Real model loads successfully
  - Entailment: "The unemployment rate is 5.2%" + "Unemployment is at 5.2%"
  - Contradiction: "GDP grew by 3%" + "GDP shrank by 3%"
  - Neutral: "The program was implemented in 2020" + "The program was successful"
  - Batch endpoint returns consistent results with single-pair endpoint
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from policy_memo_agent.services.nli_service import NLIResult, NLIService, _parse_hf_output

# ---------------------------------------------------------------------------
# Unit tests — no model needed
# ---------------------------------------------------------------------------


class TestNLIServiceBeforeLoad:
    def test_is_loaded_false_before_load(self) -> None:
        service = NLIService()
        assert service.is_loaded() is False

    def test_predict_raises_before_load(self) -> None:
        service = NLIService()
        with pytest.raises(RuntimeError, match="called before load"):
            service.predict("some premise", "some hypothesis")

    def test_predict_batch_raises_before_load(self) -> None:
        service = NLIService()
        with pytest.raises(RuntimeError, match="called before load"):
            service.predict_batch([("p", "h")])


class TestParseHFOutput:
    """Unit tests for the static label-normalisation helper."""

    def test_uppercase_labels(self) -> None:
        raw = [
            {"label": "ENTAILMENT", "score": 0.9},
            {"label": "NEUTRAL", "score": 0.06},
            {"label": "CONTRADICTION", "score": 0.04},
        ]
        result = _parse_hf_output(raw)
        assert result.label == "entailment"
        assert abs(result.scores["entailment"] - 0.9) < 1e-6

    def test_lowercase_labels(self) -> None:
        raw = [
            {"label": "contradiction", "score": 0.8},
            {"label": "neutral", "score": 0.1},
            {"label": "entailment", "score": 0.1},
        ]
        result = _parse_hf_output(raw)
        assert result.label == "contradiction"

    def test_numeric_labels(self) -> None:
        # LABEL_0=contradiction, LABEL_1=neutral, LABEL_2=entailment
        raw = [
            {"label": "LABEL_2", "score": 0.95},
            {"label": "LABEL_1", "score": 0.03},
            {"label": "LABEL_0", "score": 0.02},
        ]
        result = _parse_hf_output(raw)
        assert result.label == "entailment"
        assert result.scores["entailment"] == pytest.approx(0.95)

    def test_single_dict_input(self) -> None:
        """pipeline with top_k=1 returns a single dict, not a list."""
        raw = {"label": "NEUTRAL", "score": 0.7}
        result = _parse_hf_output(raw)
        assert result.label == "neutral"

    def test_all_three_keys_always_present(self) -> None:
        raw = [{"label": "ENTAILMENT", "score": 1.0}]
        result = _parse_hf_output(raw)
        assert "entailment" in result.scores
        assert "neutral" in result.scores
        assert "contradiction" in result.scores


class TestNLIServiceWithMockedPipeline:
    """Fast tests that verify NLIService logic without actually loading the model."""

    def _make_loaded_service(self, mock_output: list[list[dict[str, object]]]) -> NLIService:
        """Return an NLIService whose _pipeline is mocked to return mock_output."""
        service = NLIService()
        # Simulate load() without hitting disk
        mock_pipeline = MagicMock(side_effect=mock_output)
        service._pipeline = mock_pipeline
        service._loaded = True
        service._use_onnx = False
        return service

    def test_predict_entailment(self) -> None:
        mock_out = [
            [
                {"label": "ENTAILMENT", "score": 0.95},
                {"label": "NEUTRAL", "score": 0.03},
                {"label": "CONTRADICTION", "score": 0.02},
            ]
        ]
        service = self._make_loaded_service(mock_out)
        result = service.predict("The rate is 5%.", "The rate is 5%.")
        assert result.label == "entailment"
        assert result.scores["entailment"] == pytest.approx(0.95)

    def test_predict_contradiction(self) -> None:
        mock_out = [
            [
                {"label": "CONTRADICTION", "score": 0.91},
                {"label": "NEUTRAL", "score": 0.05},
                {"label": "ENTAILMENT", "score": 0.04},
            ]
        ]
        service = self._make_loaded_service(mock_out)
        result = service.predict("GDP grew by 3%.", "GDP shrank by 3%.")
        assert result.label == "contradiction"

    def test_predict_batch_returns_list(self) -> None:
        mock_out = [
            [
                [
                    {"label": "ENTAILMENT", "score": 0.9},
                    {"label": "NEUTRAL", "score": 0.06},
                    {"label": "CONTRADICTION", "score": 0.04},
                ],
                [
                    {"label": "NEUTRAL", "score": 0.7},
                    {"label": "ENTAILMENT", "score": 0.2},
                    {"label": "CONTRADICTION", "score": 0.1},
                ],
            ]
        ]
        service = self._make_loaded_service(mock_out)
        results = service.predict_batch([("p1", "h1"), ("p2", "h2")])
        assert len(results) == 2
        assert results[0].label == "entailment"
        assert results[1].label == "neutral"


# ---------------------------------------------------------------------------
# API endpoint tests — mock the NLI service
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture()
async def client_with_mock_nli() -> AsyncClient:
    """FastAPI test client with NLI service replaced by a mock via dependency_overrides."""
    from policy_memo_agent.api.app import create_app
    from policy_memo_agent.services.nli_service import get_nli_service

    mock_service = MagicMock(spec=NLIService)
    mock_service.is_loaded.return_value = True
    mock_service.predict.return_value = NLIResult(
        label="entailment",
        scores={"entailment": 0.92, "neutral": 0.05, "contradiction": 0.03},
    )
    mock_service.predict_batch.return_value = [
        NLIResult(
            label="entailment",
            scores={"entailment": 0.92, "neutral": 0.05, "contradiction": 0.03},
        )
    ]

    app = create_app()
    # FastAPI dependency override — bypasses the real singleton entirely
    app.dependency_overrides[get_nli_service] = lambda: mock_service

    async with AsyncClient(
        transport=ASGITransport(app=app),  # type: ignore[arg-type]
        base_url="http://test",
    ) as client:
        yield client

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_nli_single_endpoint_ok(client_with_mock_nli: AsyncClient) -> None:
    response = await client_with_mock_nli.post(
        "/api/herald/nli",
        json={"premise": "The rate is 5%.", "hypothesis": "Unemployment is 5%."},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["label"] == "entailment"
    assert "scores" in data
    assert set(data["scores"].keys()) == {"entailment", "neutral", "contradiction"}


@pytest.mark.asyncio
async def test_nli_batch_endpoint_ok(client_with_mock_nli: AsyncClient) -> None:
    response = await client_with_mock_nli.post(
        "/api/herald/nli/batch",
        json={"pairs": [{"premise": "The rate is 5%.", "hypothesis": "Unemployment is 5%."}]},
    )
    assert response.status_code == 200
    data = response.json()
    assert "results" in data
    assert len(data["results"]) == 1


@pytest.mark.asyncio
async def test_nli_batch_empty_pairs(client_with_mock_nli: AsyncClient) -> None:
    response = await client_with_mock_nli.post(
        "/api/herald/nli/batch",
        json={"pairs": []},
    )
    assert response.status_code == 200
    assert response.json()["results"] == []


@pytest.mark.asyncio
async def test_nli_endpoint_503_when_not_loaded() -> None:
    """NLI service returns 503 when model has not been loaded."""
    from policy_memo_agent.api.app import create_app
    from policy_memo_agent.services.nli_service import get_nli_service

    mock_service = MagicMock(spec=NLIService)
    mock_service.is_loaded.return_value = False

    app = create_app()
    app.dependency_overrides[get_nli_service] = lambda: mock_service

    async with AsyncClient(
        transport=ASGITransport(app=app),  # type: ignore[arg-type]
        base_url="http://test",
    ) as client:
        response = await client.post(
            "/api/herald/nli",
            json={"premise": "p", "hypothesis": "h"},
        )

    app.dependency_overrides.clear()
    assert response.status_code == 503


# ---------------------------------------------------------------------------
# Slow / real-model tests
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def loaded_nli_service() -> NLIService:
    """Load the real DeBERTa model once per module (expensive — ~30-60s)."""
    service = NLIService()
    service.load()
    return service


@pytest.mark.integration
@pytest.mark.tier1
@pytest.mark.slow
def test_model_loads_successfully(loaded_nli_service: NLIService) -> None:
    assert loaded_nli_service.is_loaded() is True


@pytest.mark.integration
@pytest.mark.tier1
@pytest.mark.slow
def test_entailment_detection(loaded_nli_service: NLIService) -> None:
    result = loaded_nli_service.predict(
        premise="The unemployment rate is 5.2%.",
        hypothesis="Unemployment is at 5.2%.",
    )
    assert result.label == "entailment", (
        f"Expected entailment, got {result.label}. Scores: {result.scores}"
    )
    assert result.scores["entailment"] > 0.5


@pytest.mark.integration
@pytest.mark.tier1
@pytest.mark.slow
def test_contradiction_detection(loaded_nli_service: NLIService) -> None:
    result = loaded_nli_service.predict(
        premise="GDP grew by 3%.",
        hypothesis="GDP shrank by 3%.",
    )
    assert result.label == "contradiction", (
        f"Expected contradiction, got {result.label}. Scores: {result.scores}"
    )
    assert result.scores["contradiction"] > 0.5


@pytest.mark.integration
@pytest.mark.tier1
@pytest.mark.slow
def test_neutral_detection(loaded_nli_service: NLIService) -> None:
    result = loaded_nli_service.predict(
        premise="The program was implemented in 2020.",
        hypothesis="The program was successful.",
    )
    assert result.label == "neutral", (
        f"Expected neutral, got {result.label}. Scores: {result.scores}"
    )
    assert result.scores["neutral"] > 0.3


@pytest.mark.integration
@pytest.mark.tier1
@pytest.mark.slow
def test_batch_consistent_with_single(loaded_nli_service: NLIService) -> None:
    """Batch inference must return the same labels as individual calls."""
    pairs = [
        ("The unemployment rate is 5.2%.", "Unemployment is at 5.2%."),
        ("GDP grew by 3%.", "GDP shrank by 3%."),
    ]
    batch_results = loaded_nli_service.predict_batch(pairs)
    single_results = [loaded_nli_service.predict(p, h) for p, h in pairs]

    for i, (batch, single) in enumerate(zip(batch_results, single_results, strict=True)):
        assert batch.label == single.label, (
            f"Mismatch at pair {i}: batch={batch.label} single={single.label}"
        )
