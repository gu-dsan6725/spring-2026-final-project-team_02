"""HERALD evaluation endpoints — stub implementation, returns 501 until checkpoint-3.x."""

from __future__ import annotations

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/herald", tags=["herald"])

_NOT_IMPLEMENTED = JSONResponse(
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
    content={
        "error": "not_implemented",
        "message": "HERALD endpoints will be implemented in checkpoint-3.x",
    },
)


@router.post("/evaluate")
async def evaluate_claims() -> JSONResponse:
    return _NOT_IMPLEMENTED


@router.get("/results/{memo_id}")
async def get_results(_memo_id: str) -> JSONResponse:
    return _NOT_IMPLEMENTED
