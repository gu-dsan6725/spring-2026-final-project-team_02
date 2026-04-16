"""Repository for memo and memo-version persistence operations."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from policy_memo_agent.db.models import MemoORM, MemoVersionORM


class MemoRepository:
    """All DB operations for the memos and memo_versions tables."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------------
    # Create
    # ------------------------------------------------------------------

    async def create(
        self,
        *,
        user_id: str,
        topic: str,
        background: str = "",
        sources_input: list[str] | None = None,
        template: str | None = None,
    ) -> MemoORM:
        memo = MemoORM(
            user_id=user_id,
            topic=topic,
            background=background,
            sources_input=sources_input or [],
            template=template,
            memo_markdown="",
            notes_log_json=[],
            version=1,
            status="generating",
        )
        self._session.add(memo)
        await self._session.flush()  # get the id without committing
        return memo

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    async def get_by_id(self, memo_id: uuid.UUID) -> MemoORM | None:
        result = await self._session.execute(
            select(MemoORM).where(MemoORM.id == memo_id).options(selectinload(MemoORM.claims))
        )
        return result.scalar_one_or_none()

    async def list_for_user(
        self,
        user_id: str,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> list[MemoORM]:
        result = await self._session.execute(
            select(MemoORM)
            .where(MemoORM.user_id == user_id)
            .order_by(MemoORM.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().all())

    # ------------------------------------------------------------------
    # Update
    # ------------------------------------------------------------------

    async def update_content(
        self,
        memo: MemoORM,
        *,
        memo_markdown: str,
        notes_log_json: list[Any],
        status: str = "ready",
    ) -> MemoORM:
        memo.memo_markdown = memo_markdown
        memo.notes_log_json = notes_log_json
        memo.status = status
        self._session.add(memo)
        await self._session.flush()
        return memo

    async def set_status(self, memo: MemoORM, status: str) -> MemoORM:
        memo.status = status
        self._session.add(memo)
        await self._session.flush()
        return memo

    # ------------------------------------------------------------------
    # Versioning
    # ------------------------------------------------------------------

    async def create_version(
        self,
        memo: MemoORM,
        *,
        changed_claim_ids: list[str],
        change_reason: str | None = None,
    ) -> MemoVersionORM:
        """Snapshot the current memo content as a new version row.

        Also increments memo.version.
        """
        new_version_number = memo.version + 1
        version = MemoVersionORM(
            memo_id=memo.id,
            version_number=new_version_number,
            memo_markdown=memo.memo_markdown,
            notes_log_json=memo.notes_log_json,
            changed_claim_ids=changed_claim_ids,
            change_reason=change_reason,
        )
        memo.version = new_version_number
        self._session.add(version)
        self._session.add(memo)
        await self._session.flush()
        return version

    async def list_versions(self, memo_id: uuid.UUID) -> list[MemoVersionORM]:
        result = await self._session.execute(
            select(MemoVersionORM)
            .where(MemoVersionORM.memo_id == memo_id)
            .order_by(MemoVersionORM.version_number.desc())
        )
        return list(result.scalars().all())

    async def get_version(self, memo_id: uuid.UUID, version_number: int) -> MemoVersionORM | None:
        result = await self._session.execute(
            select(MemoVersionORM).where(
                MemoVersionORM.memo_id == memo_id,
                MemoVersionORM.version_number == version_number,
            )
        )
        return result.scalar_one_or_none()

    # ------------------------------------------------------------------
    # Delete
    # ------------------------------------------------------------------

    async def delete(self, memo: MemoORM) -> None:
        await self._session.delete(memo)
        await self._session.flush()
