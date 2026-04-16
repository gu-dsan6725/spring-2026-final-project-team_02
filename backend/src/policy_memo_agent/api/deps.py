"""Dependency injection providers for the FastAPI application."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from policy_memo_agent.db.database import get_db_session
from policy_memo_agent.db.repositories.claim_repo import ClaimRepository
from policy_memo_agent.db.repositories.memo_repo import MemoRepository

# ---------------------------------------------------------------------------
# Database session
# ---------------------------------------------------------------------------


async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Yield a scoped async DB session (commits on clean exit, rolls back on error)."""
    async for session in get_db_session():
        yield session


DBSession = Annotated[AsyncSession, Depends(db_session)]


# ---------------------------------------------------------------------------
# Repositories — thin wrappers so routes receive typed repo objects
# ---------------------------------------------------------------------------


def memo_repo(session: DBSession) -> MemoRepository:
    return MemoRepository(session)


def claim_repo(session: DBSession) -> ClaimRepository:
    return ClaimRepository(session)


MemoRepo = Annotated[MemoRepository, Depends(memo_repo)]
ClaimRepo = Annotated[ClaimRepository, Depends(claim_repo)]
