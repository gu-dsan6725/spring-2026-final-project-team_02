"""Memo CRUD endpoints — stub implementation, returns 501 until checkpoint-2.x."""

from __future__ import annotations

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/memos", tags=["memos"])

_NOT_IMPLEMENTED = JSONResponse(
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
    content={
        "error": "not_implemented",
        "message": "Memo endpoints will be implemented in checkpoint-2.x",
    },
)


@router.post("")
async def create_memo() -> JSONResponse:
    return _NOT_IMPLEMENTED


@router.get("/{memo_id}")
async def get_memo(_memo_id: str) -> JSONResponse:
    return _NOT_IMPLEMENTED


@router.get("")
async def list_memos() -> JSONResponse:
    return _NOT_IMPLEMENTED


@router.delete("/{memo_id}")
async def delete_memo(_memo_id: str) -> JSONResponse:
    return _NOT_IMPLEMENTED
