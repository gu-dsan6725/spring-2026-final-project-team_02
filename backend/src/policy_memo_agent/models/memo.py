"""Pydantic models for policy memo input and output."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from policy_memo_agent.models.claims import NotesLogEntry


class MemoInput(BaseModel):
    """User-provided input for generating a policy memo."""

    topic: str = Field(..., description="The policy topic to research and write about")
    background: str = Field(
        default="",
        description="Optional background framing or context provided by the user",
    )
    known_sources: list[str] = Field(
        default_factory=list,
        description="URLs or file paths to sources the user wants the agent to use",
    )
    template: str | None = Field(
        default=None,
        description="Optional memo template or structural guidance",
    )
    max_tool_calls: int = Field(
        default=25,
        ge=1,
        le=100,
        description="Maximum number of tool calls the agent may make during research",
    )
    max_research_tokens: int = Field(
        default=50000,
        ge=1000,
        description="Maximum tokens to spend on research phase",
    )


class MemoSection(BaseModel):
    """A single section of the policy memo."""

    title: str
    content: str
    claim_ids: list[str] = Field(
        default_factory=list,
        description="IDs of claims (C-xxx) that appear in this section",
    )


class MemoOutput(BaseModel):
    """The complete output from the research and generation agent."""

    memo_id: str = Field(..., description="Unique memo identifier")
    title: str
    sections: list[MemoSection]
    notes_log: list[NotesLogEntry] = Field(
        ...,
        description="Full provenance record — one entry per claim in the memo",
    )
    total_tool_calls: int = Field(..., ge=0)
    total_research_tokens: int = Field(..., ge=0)
    model_used: str


__all__: list[Any] = [
    "MemoInput",
    "MemoOutput",
    "MemoSection",
]
