"""HERALD evaluation endpoints."""

from __future__ import annotations

import logging
import time
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from policy_memo_agent.api.deps import ClaimRepo, MemoRepo
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


def _parse_memo_id(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Invalid memo id: {raw!r}",
        ) from None


# ---------------------------------------------------------------------------
# Request / response schemas — NLI (unchanged)
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
# Request / response schemas — memo-scoped HERALD evaluation
# ---------------------------------------------------------------------------


class EvaluateRequest(BaseModel):
    claim_ids: list[str] = Field(
        ...,
        min_length=1,
        description="Agent claim IDs to evaluate (C-001, C-002 …)",
    )


class EvaluationJobResponse(BaseModel):
    memo_id: str
    queued_claim_ids: list[str]
    message: str


class HeraldResultResponse(BaseModel):
    claim_id: str
    claim_text: str
    claim_type: str
    tier_reached: int
    verdict: str
    confidence: float
    feedback: str
    suggested_revision: str | None
    tier_details: dict[str, Any]
    evaluated_at: str | None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _to_nli_response(result: NLIResult) -> NLIResponse:
    return NLIResponse(
        label=result.label,
        scores=NLIScores(
            entailment=result.scores.get("entailment", 0.0),
            neutral=result.scores.get("neutral", 0.0),
            contradiction=result.scores.get("contradiction", 0.0),
        ),
    )


# ---------------------------------------------------------------------------
# Endpoints — low-level NLI inference (unchanged from prior checkpoint)
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
    return _to_nli_response(result)


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
    return NLIBatchResponse(results=[_to_nli_response(r) for r in results])


# ---------------------------------------------------------------------------
# Endpoints — memo-scoped HERALD evaluation pipeline
# ---------------------------------------------------------------------------


@router.post("/memos/{memo_id}/evaluate", response_model=EvaluationJobResponse)
async def evaluate_claims(
    memo_id: str,
    body: EvaluateRequest,
    memo_repo: MemoRepo,
    claim_repo: ClaimRepo,
) -> EvaluationJobResponse:
    """
    Trigger HERALD evaluation for a set of claims within a memo.

    Validates that the memo and each requested claim exist.  Actual
    tier-by-tier evaluation is enqueued as a background task (wired up in
    checkpoint-3.x — HERALD integration).  Returns immediately with the list of
    queued claim IDs so the frontend can poll ``GET .../evaluate/{claimId}``.
    """
    mid = _parse_memo_id(memo_id)
    memo = await memo_repo.get_by_id(mid)
    if memo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memo not found")

    queued: list[str] = []
    missing: list[str] = []
    for cid in body.claim_ids:
        claim = await claim_repo.get_claim_by_claim_id(mid, cid)
        if claim is None:
            missing.append(cid)
        else:
            queued.append(cid)

    if missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Claims not found in this memo: {missing}",
        )

    # TODO checkpoint-3.x: dispatch HERALD pipeline tasks to background queue
    logger.info("HERALD evaluation queued for memo %s: %s", memo_id, queued)

    return EvaluationJobResponse(
        memo_id=memo_id,
        queued_claim_ids=queued,
        message=(
            f"HERALD evaluation queued for {len(queued)} claim(s). "
            "Poll GET /api/herald/memos/{memo_id}/evaluate/{claimId} for results."
        ),
    )


@router.get("/memos/{memo_id}/evaluate/{claim_id}", response_model=HeraldResultResponse)
async def get_herald_result(
    memo_id: str,
    claim_id: str,
    memo_repo: MemoRepo,
    claim_repo: ClaimRepo,
) -> HeraldResultResponse:
    """
    Get the latest HERALD evaluation result for a specific claim.

    Returns 404 if the claim has not been evaluated yet (check ``status`` on
    ``GET /api/memos/{id}/claims`` to know when evaluation has completed).
    """
    mid = _parse_memo_id(memo_id)
    memo = await memo_repo.get_by_id(mid)
    if memo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memo not found")

    claim = await claim_repo.get_claim_by_claim_id(mid, claim_id)
    if claim is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")

    # Fetch most recent evaluation row for rich tier_details
    evaluations = await claim_repo.get_evaluations_for_claim(claim.id)
    latest_eval = evaluations[0] if evaluations else None

    if latest_eval is None and claim.herald_result_json is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This claim has not been evaluated yet.",
        )

    if latest_eval is not None:
        return HeraldResultResponse(
            claim_id=claim.claim_id,
            claim_text=claim.claim_text,
            claim_type=claim.claim_type,
            tier_reached=latest_eval.tier_reached,
            verdict=latest_eval.verdict,
            confidence=latest_eval.confidence,
            feedback=latest_eval.feedback,
            suggested_revision=latest_eval.suggested_revision,
            tier_details=latest_eval.tier_details_json
            if isinstance(latest_eval.tier_details_json, dict)
            else {},
            evaluated_at=latest_eval.evaluated_at.isoformat(),
        )

    # Fall back to the denormalised herald_result_json on the claim row
    hr: dict[str, Any] = claim.herald_result_json  # type: ignore[assignment]
    return HeraldResultResponse(
        claim_id=claim.claim_id,
        claim_text=claim.claim_text,
        claim_type=claim.claim_type,
        tier_reached=hr.get("tier_reached", 0),
        verdict=hr.get("verdict", "uncertain"),
        confidence=hr.get("confidence", 0.0),
        feedback=hr.get("feedback", ""),
        suggested_revision=hr.get("suggested_revision"),
        tier_details=hr.get("tier_details", {}),
        evaluated_at=None,
    )
