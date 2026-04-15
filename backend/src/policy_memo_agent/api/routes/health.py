"""Health check endpoints."""

from __future__ import annotations

import sys

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/health", tags=["health"])


@router.get("", status_code=status.HTTP_200_OK)
async def health_check() -> JSONResponse:
    """Returns service status, Python version, and key dependency versions."""
    import fastapi
    import pydantic

    return JSONResponse(
        content={
            "status": "ok",
            "python": sys.version,
            "dependencies": {
                "fastapi": fastapi.__version__,
                "pydantic": pydantic.__version__,
            },
        }
    )


@router.get("/nli", status_code=status.HTTP_200_OK)
async def nli_health() -> JSONResponse:
    """Checks whether the NLI model is loaded and ready."""
    from policy_memo_agent.services.nli_service import get_nli_service

    service = get_nli_service()
    if service.is_loaded():
        return JSONResponse(content={"status": "ok", "message": "NLI model is loaded and ready."})
    return JSONResponse(
        content={
            "status": "not_loaded",
            "message": (
                "NLI model is not loaded. "
                "Install transformers + torch (uv sync --extra nli) or set NLI_ONNX_MODEL_PATH."
            ),
        },
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    )


@router.get("/db", status_code=status.HTTP_200_OK)
async def db_health() -> JSONResponse:
    """Checks database connectivity."""
    # Database connection is wired up in checkpoint-0.x (db/database.py).
    # Until then, report as not configured.
    return JSONResponse(
        content={
            "status": "not_configured",
            "message": "Database will be configured in checkpoint-0.x",
        },
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    )
