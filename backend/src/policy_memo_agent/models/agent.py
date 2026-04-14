"""Pydantic models for agent configuration, research plans, and tool call logging."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ResearchQuery(BaseModel):
    """A single planned research query."""

    tool: str = Field(..., description="The tool to use, e.g. 'arxiv_search', 'web_search'")
    query: str = Field(..., description="The search query or parameters")
    expected_claim_types: list[str] = Field(
        default_factory=list,
        description="Claim types this query is expected to support",
    )
    rationale: str = Field(..., description="Why this query is needed for the memo")


class ResearchPlan(BaseModel):
    """The agent's research plan, created before executing any queries."""

    memo_id: str
    topic: str
    queries: list[ResearchQuery]
    target_source_count: int = Field(..., ge=1)
    notes: str = Field(
        default="",
        description="Agent's notes on strategy and expected claim distribution",
    )


class ToolCallLog(BaseModel):
    """A single logged tool call for observability."""

    tool_call_id: str
    memo_id: str
    tool_name: str
    input_params: dict[str, Any]
    output_summary: str = Field(..., description="Brief summary of tool output")
    success: bool
    error_message: str | None = None
    retry_count: int = Field(default=0, ge=0)
    latency_ms: float = Field(..., ge=0.0)
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class AgentConfig(BaseModel):
    """Runtime configuration for the research agent."""

    model: str = Field(default="claude-sonnet-4-20250514")
    max_tool_calls: int = Field(default=25, ge=1, le=100)
    max_research_tokens: int = Field(default=50000, ge=1000)
    max_revision_attempts: int = Field(default=2, ge=0, le=5)
    tool_timeout_seconds: int = Field(default=30, ge=5, le=120)
    tool_retry_count: int = Field(default=3, ge=0, le=5)


__all__: list[Any] = [
    "AgentConfig",
    "ResearchPlan",
    "ResearchQuery",
    "ToolCallLog",
]
