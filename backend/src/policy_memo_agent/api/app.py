"""FastAPI application factory."""

from __future__ import annotations

import logging
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
    - Startup: initialize DB connection pool and NLI model
    - Shutdown: release resources

    DB and NLI model initialization will be wired up in later checkpoints.
    """
    logger.info("Starting policy-memo-agent backend...")
    # TODO checkpoint-0.x: initialize DB connection pool
    # TODO checkpoint-1.x: load NLI model
    yield
    logger.info("Shutting down policy-memo-agent backend...")
    # TODO checkpoint-0.x: close DB connection pool


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
