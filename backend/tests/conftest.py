"""
Shared pytest fixtures for the policy-memo-agent test suite.

Fixture highlights:
- async_client: HTTPX async test client against the FastAPI app
- mock_anthropic: patched Anthropic client so tests don't hit the real API
- sample_notes_log: one NotesLogEntry per claim type (mirrors CLAUDE.md mock data)
- db_session: SQLite in-memory session for unit tests
- skip_if_no_api_key: marks tests as integration if ANTHROPIC_API_KEY is absent
"""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator, Generator
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from policy_memo_agent.models.claims import (
    ClaimType,
    DerivationMethod,
    NotesLogEntry,
    Source,
)

# ---------------------------------------------------------------------------
# API key guard — mark tests as integration when no real key is present
# ---------------------------------------------------------------------------


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """Auto-skip integration tests when ANTHROPIC_API_KEY is not set."""
    if os.getenv("ANTHROPIC_API_KEY"):
        return
    skip_mark = pytest.mark.skip(reason="ANTHROPIC_API_KEY not set — skipping integration test")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip_mark)


# ---------------------------------------------------------------------------
# FastAPI async test client
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture()
async def async_client() -> AsyncGenerator[AsyncClient, None]:
    """Async HTTPX client pointed at the FastAPI app."""
    from policy_memo_agent.api.app import create_app

    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),  # type: ignore[arg-type]
        base_url="http://test",
    ) as client:
        yield client


# ---------------------------------------------------------------------------
# Mock Anthropic client
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_anthropic() -> Generator[MagicMock, None, None]:
    """Patched Anthropic client — prevents real API calls in unit tests."""
    mock = MagicMock()
    mock.messages = MagicMock()
    mock.messages.create = AsyncMock(
        return_value=MagicMock(
            content=[
                MagicMock(text='{"verdict": "valid", "confidence": 0.95, "reasoning": "mock"}')
            ],
            usage=MagicMock(input_tokens=100, output_tokens=50),
        )
    )
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("anthropic.Anthropic", lambda **_: mock)
        mp.setattr("anthropic.AsyncAnthropic", lambda **_: mock)
        yield mock


# ---------------------------------------------------------------------------
# Sample NotesLogEntry fixtures — one per claim type
# ---------------------------------------------------------------------------


@pytest.fixture()
def statistical_entry() -> NotesLogEntry:
    return NotesLogEntry(
        claim_id="C-001",
        claim_text="Maternal mortality in Chad stands at 1,140 per 100,000 live births.",
        claim_type=ClaimType.STATISTICAL,
        derivation=DerivationMethod.DIRECT_EXTRACTION,
        sources=[
            Source(
                source_id="S-001",
                source_title="WHO Global Health Observatory 2023",
                source_url="https://www.who.int/data/gho",
                relevant_chunk=(
                    "Maternal mortality ratio (per 100,000 live births): Chad — 1,140 (2020 estimate)."
                ),
            )
        ],
        reasoning="Direct extraction of the numeric value and units from the WHO GHO dataset.",
    )


@pytest.fixture()
def causal_entry() -> NotesLogEntry:
    return NotesLogEntry(
        claim_id="C-002",
        claim_text=(
            "Removal of fuel subsidies contributed to a 15% increase in rural transportation costs."
        ),
        claim_type=ClaimType.CAUSAL,
        derivation=DerivationMethod.PARAPHRASE,
        sources=[
            Source(
                source_id="S-002",
                source_title="World Bank Policy Note — Chad Energy Subsidies (2022)",
                source_url="https://www.worldbank.org/chad-energy-subsidies",
                relevant_chunk=(
                    "Following the 2021 subsidy removal, rural transport operators reported a "
                    "15.2% average increase in fuel-related operating costs, leading to "
                    "corresponding fare increases."
                ),
            )
        ],
        reasoning=(
            "Paraphrase of World Bank finding; causal mechanism (subsidy removal → cost increase) "
            "is explicitly stated in the source."
        ),
    )


@pytest.fixture()
def comparative_entry() -> NotesLogEntry:
    return NotesLogEntry(
        claim_id="C-003",
        claim_text=(
            "Cash transfer programs have shown stronger effects on school enrollment "
            "than fee waiver programs."
        ),
        claim_type=ClaimType.COMPARATIVE,
        derivation=DerivationMethod.CROSS_SOURCE,
        sources=[
            Source(
                source_id="S-003",
                source_title="Baird et al. (2019) — Conditional Cash Transfers and Education Outcomes",
                source_url="https://arxiv.org/abs/example",
                relevant_chunk=(
                    "Our meta-analysis of 12 RCTs across Kenya, Tanzania, and Uganda finds that "
                    "conditional cash transfer programs increased enrollment by 8.2 percentage "
                    "points on average."
                ),
            ),
            Source(
                source_id="S-004",
                source_title="UNESCO Global Education Monitoring Report 2023",
                source_url="https://www.unesco.org/gem-report/en",
                relevant_chunk=(
                    "Fee waiver programs showed more modest enrollment gains of 3-5 percentage "
                    "points in comparable East African settings."
                ),
            ),
        ],
        reasoning=(
            "Cross-source comparison synthesizing effect sizes from meta-analysis against "
            "UNESCO monitoring data."
        ),
    )


@pytest.fixture()
def predictive_entry() -> NotesLogEntry:
    return NotesLogEntry(
        claim_id="C-004",
        claim_text=(
            "Urban water demand in the Sahel is projected to exceed supply capacity by 2032."
        ),
        claim_type=ClaimType.PREDICTIVE,
        derivation=DerivationMethod.DIRECT_EXTRACTION,
        sources=[
            Source(
                source_id="S-005",
                source_title="IPCC AR6 Regional Factsheet — West Africa",
                source_url="https://www.ipcc.ch/report/ar6",
                relevant_chunk=(
                    "Under SSP2-4.5, urban water demand in West African Sahel cities is projected "
                    "to exceed current supply infrastructure capacity by 2030-2035."
                ),
            )
        ],
        reasoning=(
            "Direct extraction of the IPCC projection; conditionality (SSP2-4.5 scenario) "
            "is preserved in the source."
        ),
    )


@pytest.fixture()
def normative_entry() -> NotesLogEntry:
    return NotesLogEntry(
        claim_id="C-005",
        claim_text=(
            "Multi-stakeholder governance frameworks are considered best practice for "
            "transboundary water management."
        ),
        claim_type=ClaimType.NORMATIVE,
        derivation=DerivationMethod.PARAPHRASE,
        sources=[
            Source(
                source_id="S-006",
                source_title="UN-Water Transboundary Waters Report 2023",
                source_url="https://www.unwater.org/publications",
                relevant_chunk=(
                    "Multi-stakeholder governance — encompassing state actors, civil society, and "
                    "local communities — is recommended as best practice by UN-Water for "
                    "sustainable transboundary basin management."
                ),
            )
        ],
        reasoning="Paraphrase of UN-Water normative guidance; attributed to a single authoritative source.",
    )


@pytest.fixture()
def synthesis_entry() -> NotesLogEntry:
    return NotesLogEntry(
        claim_id="C-006",
        claim_text=(
            "Declining enrollment and rising child labor suggest that education subsidy programs "
            "have not reached their most vulnerable target populations."
        ),
        claim_type=ClaimType.SYNTHESIS,
        derivation=DerivationMethod.AGENT_INFERENCE,
        sources=[
            Source(
                source_id="S-007",
                source_title="UNICEF Chad Country Report 2023",
                source_url="https://www.unicef.org/chad",
                relevant_chunk=(
                    "Primary school enrollment in Chad declined 4.1% year-over-year in 2022, "
                    "despite ongoing subsidy programs."
                ),
            ),
            Source(
                source_id="S-008",
                source_title="ILO Child Labour Global Estimates 2022",
                source_url="https://www.ilo.org/child-labour",
                relevant_chunk=(
                    "Child labour incidence in Chad increased from 28% to 31% between 2020 and 2022."
                ),
            ),
        ],
        reasoning=(
            "Agent inference combining declining enrollment trend (UNICEF) with rising child labour "
            "(ILO) to suggest subsidy program reach failure. Neither source makes this conclusion "
            "directly — flagged as high-risk synthesis."
        ),
    )


@pytest.fixture()
def sample_notes_log(
    statistical_entry: NotesLogEntry,
    causal_entry: NotesLogEntry,
    comparative_entry: NotesLogEntry,
    predictive_entry: NotesLogEntry,
    normative_entry: NotesLogEntry,
    synthesis_entry: NotesLogEntry,
) -> list[NotesLogEntry]:
    """All six mock claims — one per claim type."""
    return [
        statistical_entry,
        causal_entry,
        comparative_entry,
        predictive_entry,
        normative_entry,
        synthesis_entry,
    ]


# ---------------------------------------------------------------------------
# SQLite in-memory database session
# ---------------------------------------------------------------------------


@pytest.fixture()
def db_session() -> Generator[MagicMock, None, None]:
    """
    SQLite in-memory async session for unit tests.
    Returns a MagicMock until the SQLAlchemy ORM layer is wired up in checkpoint-0.x.
    Replace with a real aiosqlite session once db/database.py is implemented.
    """
    session = MagicMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.close = AsyncMock()
    session.execute = AsyncMock()
    session.add = MagicMock()
    session.delete = MagicMock()
    yield session
