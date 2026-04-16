"""Memo CRUD and lifecycle endpoints."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from policy_memo_agent.api.deps import ClaimRepo, MemoRepo
from policy_memo_agent.db.models import ClaimORM, MemoORM, MemoVersionORM

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/memos", tags=["memos"])


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class CreateMemoRequest(BaseModel):
    topic: str = Field(..., min_length=1)
    background: str = Field(default="")
    known_sources: list[str] = Field(default_factory=list)
    template: str | None = None
    user_id: str = Field(default="anonymous")


class MemoSummary(BaseModel):
    id: str
    user_id: str
    topic: str
    status: str
    version: int
    created_at: str
    updated_at: str


class MemoDetail(MemoSummary):
    background: str
    sources_input: list[str]
    template: str | None
    memo_markdown: str
    notes_log: list[dict[str, Any]]


class ClaimSummary(BaseModel):
    id: str
    claim_id: str
    claim_text: str
    claim_type: str
    derivation: str
    status: str
    revision_count: int
    herald_result: dict[str, Any] | None


class VersionSummary(BaseModel):
    id: str
    version_number: int
    changed_claim_ids: list[str]
    change_reason: str | None
    created_at: str


class VersionDetail(VersionSummary):
    memo_markdown: str
    notes_log: list[dict[str, Any]]


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------


def _memo_summary(m: MemoORM) -> MemoSummary:
    return MemoSummary(
        id=str(m.id),
        user_id=m.user_id,
        topic=m.topic,
        status=m.status,
        version=m.version,
        created_at=m.created_at.isoformat(),
        updated_at=m.updated_at.isoformat(),
    )


def _memo_detail(m: MemoORM) -> MemoDetail:
    return MemoDetail(
        id=str(m.id),
        user_id=m.user_id,
        topic=m.topic,
        status=m.status,
        version=m.version,
        created_at=m.created_at.isoformat(),
        updated_at=m.updated_at.isoformat(),
        background=m.background,
        sources_input=m.sources_input if isinstance(m.sources_input, list) else [],
        template=m.template,
        memo_markdown=m.memo_markdown,
        notes_log=m.notes_log_json if isinstance(m.notes_log_json, list) else [],
    )


def _claim_summary(c: ClaimORM) -> ClaimSummary:
    return ClaimSummary(
        id=str(c.id),
        claim_id=c.claim_id,
        claim_text=c.claim_text,
        claim_type=c.claim_type,
        derivation=c.derivation,
        status=c.status,
        revision_count=c.revision_count,
        herald_result=c.herald_result_json if isinstance(c.herald_result_json, dict) else None,
    )


def _version_summary(v: MemoVersionORM) -> VersionSummary:
    return VersionSummary(
        id=str(v.id),
        version_number=v.version_number,
        changed_claim_ids=v.changed_claim_ids if isinstance(v.changed_claim_ids, list) else [],
        change_reason=v.change_reason,
        created_at=v.created_at.isoformat(),
    )


def _version_detail(v: MemoVersionORM) -> VersionDetail:
    return VersionDetail(
        id=str(v.id),
        version_number=v.version_number,
        changed_claim_ids=v.changed_claim_ids if isinstance(v.changed_claim_ids, list) else [],
        change_reason=v.change_reason,
        created_at=v.created_at.isoformat(),
        memo_markdown=v.memo_markdown,
        notes_log=v.notes_log_json if isinstance(v.notes_log_json, list) else [],
    )


def _parse_memo_id(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Invalid memo id: {raw!r}",
        ) from None


# ---------------------------------------------------------------------------
# POST /api/memos — create a new memo (triggers agent generation)
# ---------------------------------------------------------------------------


@router.post("", response_model=MemoSummary, status_code=status.HTTP_201_CREATED)
async def create_memo(body: CreateMemoRequest, repo: MemoRepo) -> MemoSummary:
    """
    Create a new memo record and kick off agent research + generation.

    The memo is created in ``generating`` status immediately so the client can
    poll ``GET /api/memos/{id}`` for progress.  The actual agent invocation
    will be wired up in checkpoint-2.x (research-agent integration).
    """
    memo = await repo.create(
        user_id=body.user_id,
        topic=body.topic,
        background=body.background,
        sources_input=body.known_sources,
        template=body.template,
    )
    logger.info("Created memo %s for user %s: %r", memo.id, body.user_id, body.topic)
    # TODO checkpoint-2.x: enqueue background agent task here
    return _memo_summary(memo)


# ---------------------------------------------------------------------------
# GET /api/memos — list memos for a user
# ---------------------------------------------------------------------------


@router.get("", response_model=list[MemoSummary])
async def list_memos(
    repo: MemoRepo,
    user_id: str = Query(default="anonymous"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[MemoSummary]:
    memos = await repo.list_for_user(user_id, limit=limit, offset=offset)
    return [_memo_summary(m) for m in memos]


# ---------------------------------------------------------------------------
# GET /api/memos/{memo_id} — get memo with notes log
# ---------------------------------------------------------------------------


@router.get("/{memo_id}", response_model=MemoDetail)
async def get_memo(memo_id: str, repo: MemoRepo) -> MemoDetail:
    mid = _parse_memo_id(memo_id)
    memo = await repo.get_by_id(mid)
    if memo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memo not found")
    return _memo_detail(memo)


# ---------------------------------------------------------------------------
# GET /api/memos/{memo_id}/claims — list all claims
# ---------------------------------------------------------------------------


@router.get("/{memo_id}/claims", response_model=list[ClaimSummary])
async def get_claims(
    memo_id: str, memo_repo: MemoRepo, claim_repo: ClaimRepo
) -> list[ClaimSummary]:
    mid = _parse_memo_id(memo_id)
    memo = await memo_repo.get_by_id(mid)
    if memo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memo not found")
    claims = await claim_repo.get_claims_for_memo(mid)
    return [_claim_summary(c) for c in claims]


# ---------------------------------------------------------------------------
# GET /api/memos/{memo_id}/versions — version history
# ---------------------------------------------------------------------------


@router.get("/{memo_id}/versions", response_model=list[VersionSummary])
async def get_versions(memo_id: str, repo: MemoRepo) -> list[VersionSummary]:
    mid = _parse_memo_id(memo_id)
    memo = await repo.get_by_id(mid)
    if memo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memo not found")
    versions = await repo.list_versions(mid)
    return [_version_summary(v) for v in versions]


# ---------------------------------------------------------------------------
# GET /api/memos/{memo_id}/versions/{version_number} — single version detail
# ---------------------------------------------------------------------------


@router.get("/{memo_id}/versions/{version_number}", response_model=VersionDetail)
async def get_version(memo_id: str, version_number: int, repo: MemoRepo) -> VersionDetail:
    mid = _parse_memo_id(memo_id)
    version = await repo.get_version(mid, version_number)
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")
    return _version_detail(version)


# ---------------------------------------------------------------------------
# POST /api/memos/{memo_id}/revise — trigger revision of invalid claims
# ---------------------------------------------------------------------------


class ReviseRequest(BaseModel):
    claim_ids: list[str] = Field(
        ..., min_length=1, description="Agent claim IDs to revise (C-001 etc)"
    )


class ReviseResponse(BaseModel):
    memo_id: str
    revised_claim_ids: list[str]
    skipped_claim_ids: list[str]
    new_version: int


@router.post("/{memo_id}/revise", response_model=ReviseResponse)
async def revise_memo(
    memo_id: str,
    body: ReviseRequest,
    memo_repo: MemoRepo,
    claim_repo: ClaimRepo,
) -> ReviseResponse:
    """
    Trigger revision of the specified claims and snapshot a new memo version.

    For each claim that has been HERALD-evaluated as invalid/uncertain and whose
    revision_count < MAX_REVISION_ATTEMPTS (2), the route:
      1. Increments revision_count.
      2. Creates a new memo version snapshot.

    Actual re-generation of claim text is wired up in checkpoint-2.x (feedback loop).
    Claims that have already hit the revision limit are returned in skipped_claim_ids.
    """
    mid = _parse_memo_id(memo_id)
    memo = await memo_repo.get_by_id(mid)
    if memo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memo not found")

    max_revision_attempts = 2
    revised: list[str] = []
    skipped: list[str] = []

    for cid in body.claim_ids:
        claim = await claim_repo.get_claim_by_claim_id(mid, cid)
        if claim is None:
            skipped.append(cid)
            continue
        if claim.revision_count >= max_revision_attempts:
            logger.warning(
                "Claim %s on memo %s has reached max revision attempts (%d) — flagging",
                cid,
                memo_id,
                max_revision_attempts,
            )
            claim.status = "flagged"
            skipped.append(cid)
            continue
        await claim_repo.increment_revision_count(claim)
        revised.append(cid)

    if revised:
        version = await memo_repo.create_version(
            memo,
            changed_claim_ids=revised,
            change_reason=f"HERALD revision attempt for: {', '.join(revised)}",
        )
        new_version = version.version_number
    else:
        new_version = memo.version

    return ReviseResponse(
        memo_id=memo_id,
        revised_claim_ids=revised,
        skipped_claim_ids=skipped,
        new_version=new_version,
    )
