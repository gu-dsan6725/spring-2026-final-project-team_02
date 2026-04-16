"""FastAPI application factory."""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from policy_memo_agent.api.middleware.error_handler import ErrorHandlerMiddleware
from policy_memo_agent.api.routes import health, herald, memos

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Application lifespan handler.
    - Startup: initialise DB connection pool, Redis client, and NLI model
    - Shutdown: release all resources
    """
    logger.info("Starting policy-memo-agent backend...")

    # ------------------------------------------------------------------
    # Database
    # ------------------------------------------------------------------
    database_url = os.getenv("DATABASE_URL", "")
    if database_url:
        from policy_memo_agent.db.database import init_db

        try:
            init_db(database_url)
            logger.info("Database initialised")
        except Exception:
            logger.exception(
                "Database initialisation failed — memo persistence will be unavailable."
            )
    else:
        logger.warning(
            "DATABASE_URL is not set — running without database persistence. "
            "Set DATABASE_URL in .env to enable memo storage."
        )

    # ------------------------------------------------------------------
    # Redis
    # ------------------------------------------------------------------
    redis_url = os.getenv("REDIS_URL", "")
    if redis_url:
        from policy_memo_agent.services.session_service import init_redis

        try:
            init_redis(redis_url)
            logger.info("Redis client initialised")
        except Exception:
            logger.exception("Redis initialisation failed — session resume will be unavailable.")
    else:
        logger.warning(
            "REDIS_URL is not set — running without Redis. "
            "Agent state will not be persisted across disconnects."
        )

    # ------------------------------------------------------------------
    # NLI model (Tier 1 HERALD)
    # ------------------------------------------------------------------
    from policy_memo_agent.services.nli_service import get_nli_service

    nli_service = get_nli_service()
    try:
        nli_service.load()
        logger.info("NLI model ready")
    except Exception:
        logger.exception(
            "NLI model failed to load — Tier 1 evaluation will be unavailable. "
            "Install transformers + torch (uv sync --extra nli) or set NLI_ONNX_MODEL_PATH."
        )

    yield

    # ------------------------------------------------------------------
    # Shutdown
    # ------------------------------------------------------------------
    logger.info("Shutting down policy-memo-agent backend...")

    if database_url:
        from policy_memo_agent.db.database import close_db

        await close_db()

    if redis_url:
        from policy_memo_agent.services.session_service import close_redis

        await close_redis()


def create_app() -> FastAPI:
    """Application factory — creates and configures the FastAPI instance."""
    app = FastAPI(
        title="Policy Memo Agent API",
        description="AI-powered policy memo writing with HERALD claim evaluation",
        version="0.1.0",
        lifespan=lifespan,
    )

    # CORS — allow the Next.js dev server
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Global error handler
    app.add_middleware(ErrorHandlerMiddleware)

    # Routes
    app.include_router(health.router)
    app.include_router(memos.router)
    app.include_router(herald.router)

    return app
