"""HERALD evaluation endpoints."""

from __future__ import annotations

import logging
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from policy_memo_agent.services.braintrust_service import get_braintrust
from policy_memo_agent.services.nli_service import NLIResult, NLIService, get_nli_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/herald", tags=["herald"])


# ---------------------------------------------------------------------------
# Dependency helpers
# ---------------------------------------------------------------------------


def _nli_service(service: Annotated[NLIService, Depends(get_nli_service)]) -> NLIService:
    """Raise 503 if the NLI model has not been loaded yet."""
    if not service.is_loaded():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="NLI model is not loaded. Check /health/nli for status.",
        )
    return service


LoadedNLI = Annotated[NLIService, Depends(_nli_service)]


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class NLIPair(BaseModel):
    premise: str
    hypothesis: str


class NLIScores(BaseModel):
    entailment: float
    neutral: float
    contradiction: float


class NLIResponse(BaseModel):
    label: str
    scores: NLIScores


class NLIBatchRequest(BaseModel):
    pairs: list[NLIPair]
    claim_ids: list[str] | None = None


class NLIBatchResponse(BaseModel):
    results: list[NLIResponse]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _to_response(result: NLIResult) -> NLIResponse:
    return NLIResponse(
        label=result.label,
        scores=NLIScores(
            entailment=result.scores.get("entailment", 0.0),
            neutral=result.scores.get("neutral", 0.0),
            contradiction=result.scores.get("contradiction", 0.0),
        ),
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/nli", response_model=NLIResponse)
async def nli_single(body: NLIPair, service: LoadedNLI) -> NLIResponse:
    """
    Run NLI inference on a single premise-hypothesis pair.

    - **premise**: source chunk that supposedly supports the claim
    - **hypothesis**: the claim text being evaluated
    """
    logger.debug("NLI single: premise_len=%d hyp_len=%d", len(body.premise), len(body.hypothesis))
    t0 = time.perf_counter()
    result = service.predict(body.premise, body.hypothesis)
    latency_ms = (time.perf_counter() - t0) * 1000.0

    get_braintrust().log_herald_request(
        endpoint="/api/herald/nli",
        claim_id="",
        latency_ms=latency_ms,
        status_code=200,
        metadata={"label": result.label},
    )
    return _to_response(result)


@router.post("/nli/batch", response_model=NLIBatchResponse)
async def nli_batch(body: NLIBatchRequest, service: LoadedNLI) -> NLIBatchResponse:
    """
    Run NLI inference on a batch of premise-hypothesis pairs.

    More efficient than calling /nli in a loop when a claim has multiple sources.
    """
    if not body.pairs:
        return NLIBatchResponse(results=[])

    logger.debug("NLI batch: %d pairs", len(body.pairs))
    t0 = time.perf_counter()
    pairs = [(p.premise, p.hypothesis) for p in body.pairs]
    results = service.predict_batch(pairs, claim_ids=body.claim_ids)
    latency_ms = (time.perf_counter() - t0) * 1000.0

    get_braintrust().log_herald_request(
        endpoint="/api/herald/nli/batch",
        claim_id="",
        latency_ms=latency_ms,
        status_code=200,
        metadata={"pair_count": len(pairs)},
    )
    return NLIBatchResponse(results=[_to_response(r) for r in results])


# ---------------------------------------------------------------------------
# Legacy stubs (retained for future checkpoints)
# ---------------------------------------------------------------------------

_NOT_IMPLEMENTED_MSG = {
    "error": "not_implemented",
    "message": "This HERALD endpoint will be implemented in a future checkpoint.",
}


@router.post("/evaluate")
async def evaluate_claims() -> dict[str, str]:
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=_NOT_IMPLEMENTED_MSG)


@router.get("/results/{memo_id}")
async def get_results(_memo_id: str) -> dict[str, str]:
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=_NOT_IMPLEMENTED_MSG)
