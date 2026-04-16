"""Repository for claim and HERALD evaluation persistence."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from policy_memo_agent.db.models import ClaimORM, HeraldEvaluationORM, ToolCallLogORM


class ClaimRepository:
    """All DB operations for the claims and herald_evaluations tables."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------------
    # Claims — create
    # ------------------------------------------------------------------

    async def create_claim(
        self,
        *,
        memo_id: uuid.UUID,
        claim_id: str,
        claim_text: str,
        claim_type: str,
        derivation: str,
        sources_json: list[Any],
        reasoning: str,
    ) -> ClaimORM:
        claim = ClaimORM(
            memo_id=memo_id,
            claim_id=claim_id,
            claim_text=claim_text,
            claim_type=claim_type,
            derivation=derivation,
            sources_json=sources_json,
            reasoning=reasoning,
            revision_count=0,
            status="draft",
        )
        self._session.add(claim)
        await self._session.flush()
        return claim

    async def bulk_create_claims(
        self, memo_id: uuid.UUID, entries: list[dict[str, Any]]
    ) -> list[ClaimORM]:
        """Insert multiple claims at once from a list of NotesLogEntry dicts."""
        claims = [
            ClaimORM(
                memo_id=memo_id,
                claim_id=e["claim_id"],
                claim_text=e["claim_text"],
                claim_type=e["claim_type"],
                derivation=e["derivation"],
                sources_json=e.get("sources", []),
                reasoning=e.get("reasoning", ""),
                revision_count=0,
                status="draft",
            )
            for e in entries
        ]
        for c in claims:
            self._session.add(c)
        await self._session.flush()
        return claims

    # ------------------------------------------------------------------
    # Claims — read
    # ------------------------------------------------------------------

    async def get_claims_for_memo(self, memo_id: uuid.UUID) -> list[ClaimORM]:
        result = await self._session.execute(
            select(ClaimORM).where(ClaimORM.memo_id == memo_id).order_by(ClaimORM.claim_id)
        )
        return list(result.scalars().all())

    async def get_claim_by_claim_id(self, memo_id: uuid.UUID, claim_id: str) -> ClaimORM | None:
        """Look up a claim by its agent-assigned ID (e.g. 'C-003'), scoped to a memo."""
        result = await self._session.execute(
            select(ClaimORM)
            .where(ClaimORM.memo_id == memo_id, ClaimORM.claim_id == claim_id)
            .options(selectinload(ClaimORM.evaluations))
        )
        return result.scalar_one_or_none()

    async def get_claim_by_pk(self, claim_pk: uuid.UUID) -> ClaimORM | None:
        result = await self._session.execute(
            select(ClaimORM)
            .where(ClaimORM.id == claim_pk)
            .options(selectinload(ClaimORM.evaluations))
        )
        return result.scalar_one_or_none()

    # ------------------------------------------------------------------
    # Claims — update
    # ------------------------------------------------------------------

    async def update_herald_result(
        self,
        claim: ClaimORM,
        *,
        herald_result_json: dict[str, Any],
        verdict: str,
    ) -> ClaimORM:
        """Store the latest HERALD result on the claim row and update status."""
        claim.herald_result_json = herald_result_json
        claim.status = "validated" if verdict == "valid" else "flagged"
        self._session.add(claim)
        await self._session.flush()
        return claim

    async def increment_revision_count(self, claim: ClaimORM) -> ClaimORM:
        claim.revision_count += 1
        self._session.add(claim)
        await self._session.flush()
        return claim

    async def update_claim_text(
        self, claim: ClaimORM, *, claim_text: str, reasoning: str
    ) -> ClaimORM:
        claim.claim_text = claim_text
        claim.reasoning = reasoning
        self._session.add(claim)
        await self._session.flush()
        return claim

    # ------------------------------------------------------------------
    # HERALD evaluations
    # ------------------------------------------------------------------

    async def save_herald_evaluation(
        self,
        *,
        claim_pk: uuid.UUID,
        tier_reached: int,
        verdict: str,
        confidence: float,
        feedback: str,
        suggested_revision: str | None,
        tier_details_json: dict[str, Any],
    ) -> HeraldEvaluationORM:
        evaluation = HeraldEvaluationORM(
            claim_id=claim_pk,
            tier_reached=tier_reached,
            verdict=verdict,
            confidence=confidence,
            feedback=feedback,
            suggested_revision=suggested_revision,
            tier_details_json=tier_details_json,
        )
        self._session.add(evaluation)
        await self._session.flush()
        return evaluation

    async def get_evaluations_for_claim(self, claim_pk: uuid.UUID) -> list[HeraldEvaluationORM]:
        result = await self._session.execute(
            select(HeraldEvaluationORM)
            .where(HeraldEvaluationORM.claim_id == claim_pk)
            .order_by(HeraldEvaluationORM.evaluated_at.desc())
        )
        return list(result.scalars().all())

    # ------------------------------------------------------------------
    # Tool call logs
    # ------------------------------------------------------------------

    async def log_tool_call(
        self,
        *,
        memo_id: uuid.UUID,
        tool_name: str,
        query: str,
        response_summary: str = "",
        latency_ms: int | None = None,
        success: bool = True,
    ) -> ToolCallLogORM:
        log = ToolCallLogORM(
            memo_id=memo_id,
            tool_name=tool_name,
            query=query,
            response_summary=response_summary,
            latency_ms=latency_ms,
            success=success,
        )
        self._session.add(log)
        await self._session.flush()
        return log
