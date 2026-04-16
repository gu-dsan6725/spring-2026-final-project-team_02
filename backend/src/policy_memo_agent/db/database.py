"""SQLAlchemy async engine and session factory.

Usage
-----
During startup (lifespan), call ``init_db()``.
In FastAPI route handlers, use the ``get_db_session`` dependency (via deps.py).
In repositories, receive the session as a parameter — never import it globally.

The module is designed for two modes:
- Production: asyncpg + PostgreSQL (DATABASE_URL starts with "postgresql")
- Testing:    aiosqlite + SQLite in-memory (DATABASE_URL starts with "sqlite")
  SQLite requires the aiosqlite driver: ``uv add aiosqlite --optional dev``
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# Module-level engine and session factory — set once by init_db().
_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def _build_url(database_url: str) -> str:
    """Convert a plain postgres:// URL to the asyncpg driver URL."""
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if database_url.startswith("postgres://"):
        return database_url.replace("postgres://", "postgresql+asyncpg://", 1)
    if database_url.startswith("sqlite://"):
        # SQLite in-memory for tests: use aiosqlite
        return database_url.replace("sqlite://", "sqlite+aiosqlite://", 1)
    return database_url


def init_db(database_url: str, *, echo: bool = False) -> None:
    """Create the async engine and session factory.

    Call once at application startup.  Idempotent — calling again with the same
    URL is a no-op; calling with a different URL reinitialises (useful in tests).
    """
    global _engine, _session_factory

    url = _build_url(database_url)
    logger.info("Initialising database engine: %s", url.split("@")[-1])  # hide credentials

    connect_args: dict[str, object] = {}
    if "sqlite" in url:
        # aiosqlite needs check_same_thread=False
        connect_args["check_same_thread"] = False

    _engine = create_async_engine(
        url,
        echo=echo,
        pool_pre_ping=True,
        connect_args=connect_args,
    )
    _session_factory = async_sessionmaker(
        _engine,
        expire_on_commit=False,
        class_=AsyncSession,
    )
    logger.info("Database engine ready")


async def close_db() -> None:
    """Dispose the connection pool.  Call at application shutdown."""
    global _engine
    if _engine is not None:
        await _engine.dispose()
        logger.info("Database engine disposed")
        _engine = None


def get_engine() -> AsyncEngine:
    if _engine is None:
        raise RuntimeError("Database not initialised — call init_db() first.")
    return _engine


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields a scoped async session.

    The session is committed on clean exit and rolled back on exception.
    """
    if _session_factory is None:
        raise RuntimeError("Database not initialised — call init_db() first.")
    async with _session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
