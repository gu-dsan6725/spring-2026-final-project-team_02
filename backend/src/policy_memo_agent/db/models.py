"""SQLAlchemy ORM models.

These mirror the tables in src/db/schema.sql exactly.
All UUID primary keys use server-side gen_random_uuid() as default and
Python-side uuid.uuid4() as the Python default so tests don't need a DB.

Column naming: snake_case in Python, same in SQL.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import JSON


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


def _now() -> datetime:
    return datetime.utcnow()


# ---------------------------------------------------------------------------
# Base
# ---------------------------------------------------------------------------


class Base(DeclarativeBase):
    pass


# Use JSONB on Postgres, JSON on SQLite (for tests)
def _json_col() -> Any:
    """Return JSONB for Postgres; falls back to JSON for SQLite in tests."""
    return JSONB().with_variant(JSON(), "sqlite")


# ---------------------------------------------------------------------------
# Memo
# ---------------------------------------------------------------------------


class MemoORM(Base):
    __tablename__ = "memos"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    topic: Mapped[str] = mapped_column(Text, nullable=False)
    background: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    sources_input: Mapped[Any] = mapped_column(_json_col(), nullable=False, server_default="[]")
    template: Mapped[str | None] = mapped_column(Text, nullable=True)
    memo_markdown: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    notes_log_json: Mapped[Any] = mapped_column(_json_col(), nullable=False, server_default="[]")
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1", default=1)
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default="draft",
        default="draft",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), default=_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), default=_now
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('draft', 'generating', 'ready', 'archived')",
            name="ck_memos_status",
        ),
    )

    # Relationships
    versions: Mapped[list[MemoVersionORM]] = relationship(
        "MemoVersionORM", back_populates="memo", cascade="all, delete-orphan"
    )
    claims: Mapped[list[ClaimORM]] = relationship(
        "ClaimORM", back_populates="memo", cascade="all, delete-orphan"
    )
    tool_call_logs: Mapped[list[ToolCallLogORM]] = relationship(
        "ToolCallLogORM", back_populates="memo", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# MemoVersion
# ---------------------------------------------------------------------------


class MemoVersionORM(Base):
    __tablename__ = "memo_versions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    memo_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("memos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    memo_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    notes_log_json: Mapped[Any] = mapped_column(_json_col(), nullable=False, server_default="[]")
    changed_claim_ids: Mapped[Any] = mapped_column(_json_col(), nullable=False, server_default="[]")
    change_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), default=_now
    )

    __table_args__ = (UniqueConstraint("memo_id", "version_number", name="uq_memo_versions"),)

    memo: Mapped[MemoORM] = relationship("MemoORM", back_populates="versions")


# ---------------------------------------------------------------------------
# Claim
# ---------------------------------------------------------------------------


class ClaimORM(Base):
    __tablename__ = "claims"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    memo_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("memos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    claim_id: Mapped[str] = mapped_column(Text, nullable=False)  # C-001, etc.
    claim_text: Mapped[str] = mapped_column(Text, nullable=False)
    claim_type: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    derivation: Mapped[str] = mapped_column(Text, nullable=False)
    sources_json: Mapped[Any] = mapped_column(_json_col(), nullable=False, server_default="[]")
    reasoning: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    herald_result_json: Mapped[Any | None] = mapped_column(_json_col(), nullable=True)
    revision_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0", default=0
    )
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="draft", default="draft", index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), default=_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), default=_now
    )

    __table_args__ = (
        UniqueConstraint("memo_id", "claim_id", name="uq_claims_memo_claim"),
        CheckConstraint(
            "claim_type IN ('statistical','causal','comparative','predictive','normative','synthesis')",
            name="ck_claims_type",
        ),
        CheckConstraint(
            "derivation IN ('direct_extraction','paraphrase','cross_source','agent_inference')",
            name="ck_claims_derivation",
        ),
        CheckConstraint(
            "status IN ('draft','validated','flagged')",
            name="ck_claims_status",
        ),
    )

    memo: Mapped[MemoORM] = relationship("MemoORM", back_populates="claims")
    evaluations: Mapped[list[HeraldEvaluationORM]] = relationship(
        "HeraldEvaluationORM", back_populates="claim", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# HeraldEvaluation
# ---------------------------------------------------------------------------


class HeraldEvaluationORM(Base):
    __tablename__ = "herald_evaluations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    claim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("claims.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tier_reached: Mapped[int] = mapped_column(Integer, nullable=False)
    verdict: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    feedback: Mapped[str] = mapped_column(Text, nullable=False)
    suggested_revision: Mapped[str | None] = mapped_column(Text, nullable=True)
    tier_details_json: Mapped[Any] = mapped_column(_json_col(), nullable=False, server_default="{}")
    evaluated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), default=_now
    )

    __table_args__ = (
        CheckConstraint("tier_reached BETWEEN 1 AND 4", name="ck_herald_tier"),
        CheckConstraint(
            "verdict IN ('valid','invalid','uncertain','plausible_but_unsupported')",
            name="ck_herald_verdict",
        ),
        CheckConstraint("confidence BETWEEN 0.0 AND 1.0", name="ck_herald_confidence"),
    )

    claim: Mapped[ClaimORM] = relationship("ClaimORM", back_populates="evaluations")


# ---------------------------------------------------------------------------
# ToolCallLog
# ---------------------------------------------------------------------------


class ToolCallLogORM(Base):
    __tablename__ = "tool_call_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    memo_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("memos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tool_name: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    query: Mapped[str] = mapped_column(Text, nullable=False)
    response_summary: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    success: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true", default=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), default=_now
    )

    memo: Mapped[MemoORM] = relationship("MemoORM", back_populates="tool_call_logs")


__all__ = [
    "Base",
    "ClaimORM",
    "HeraldEvaluationORM",
    "MemoORM",
    "MemoVersionORM",
    "ToolCallLogORM",
]
