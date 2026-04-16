"""
Tests for memo CRUD, version creation, and HERALD result storage.

Test DB strategy
----------------
We use an async SQLite in-memory database (via aiosqlite) so these tests
run without a real Postgres instance.  The FastAPI ``db_session`` dependency
is overridden to point at the test session; the rest of the app stack runs
normally.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from policy_memo_agent.db.models import Base
from policy_memo_agent.db.repositories.claim_repo import ClaimRepository
from policy_memo_agent.db.repositories.memo_repo import MemoRepository

# ---------------------------------------------------------------------------
# In-memory SQLite engine shared across all tests in this module
# ---------------------------------------------------------------------------

_TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture(scope="module")
async def test_engine() -> AsyncGenerator[object, None]:
    engine = create_async_engine(_TEST_DB_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture()
async def db_session(test_engine: object) -> AsyncGenerator[AsyncSession, None]:  # type: ignore[misc]
    from sqlalchemy.ext.asyncio import AsyncEngine

    assert isinstance(test_engine, AsyncEngine)
    factory = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# ---------------------------------------------------------------------------
# FastAPI test client with overridden DB dependency
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture()
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    from policy_memo_agent.api.app import create_app
    from policy_memo_agent.api.deps import db_session as app_db_session

    app = create_app()

    async def _override() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[app_db_session] = _override

    async with AsyncClient(
        transport=ASGITransport(app=app),  # type: ignore[arg-type]
        base_url="http://test",
    ) as c:
        yield c


# ---------------------------------------------------------------------------
# Repository fixtures (share the same session as the client)
# ---------------------------------------------------------------------------


@pytest.fixture()
def memo_repo(db_session: AsyncSession) -> MemoRepository:
    return MemoRepository(db_session)


@pytest.fixture()
def claim_repo(db_session: AsyncSession) -> ClaimRepository:
    return ClaimRepository(db_session)


# ===========================================================================
# Tests: POST /api/memos — create memo
# ===========================================================================


@pytest.mark.asyncio
async def test_create_memo_returns_201(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/memos",
        json={
            "topic": "Water scarcity in the Sahel",
            "background": "Focus on rural communities",
            "user_id": "user-abc",
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["topic"] == "Water scarcity in the Sahel"
    assert data["user_id"] == "user-abc"
    assert data["status"] == "generating"
    assert data["version"] == 1
    assert uuid.UUID(data["id"])  # valid UUID


@pytest.mark.asyncio
async def test_create_memo_stores_sources(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/memos",
        json={
            "topic": "Education subsidies",
            "known_sources": ["https://arxiv.org/abs/1234", "https://worldbank.org/report"],
            "user_id": "user-xyz",
        },
    )
    assert resp.status_code == 201
    # Retrieve and verify sources are persisted
    memo_id = resp.json()["id"]
    get_resp = await client.get(f"/api/memos/{memo_id}")
    assert get_resp.status_code == 200
    assert "https://arxiv.org/abs/1234" in get_resp.json()["sources_input"]


# ===========================================================================
# Tests: GET /api/memos/{id} — retrieval
# ===========================================================================


@pytest.mark.asyncio
async def test_get_memo_returns_full_detail(client: AsyncClient) -> None:
    create_resp = await client.post(
        "/api/memos",
        json={"topic": "Climate adaptation", "background": "IPCC AR6", "user_id": "u1"},
    )
    memo_id = create_resp.json()["id"]

    resp = await client.get(f"/api/memos/{memo_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == memo_id
    assert data["background"] == "IPCC AR6"
    assert isinstance(data["notes_log"], list)
    assert isinstance(data["sources_input"], list)


@pytest.mark.asyncio
async def test_get_memo_not_found(client: AsyncClient) -> None:
    fake_id = str(uuid.uuid4())
    resp = await client.get(f"/api/memos/{fake_id}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_memo_invalid_uuid(client: AsyncClient) -> None:
    resp = await client.get("/api/memos/not-a-uuid")
    assert resp.status_code == 422


# ===========================================================================
# Tests: GET /api/memos — listing
# ===========================================================================


@pytest.mark.asyncio
async def test_list_memos_filters_by_user(client: AsyncClient) -> None:
    # Create memos for two different users
    await client.post("/api/memos", json={"topic": "Memo A", "user_id": "alice"})
    await client.post("/api/memos", json={"topic": "Memo B", "user_id": "alice"})
    await client.post("/api/memos", json={"topic": "Memo C", "user_id": "bob"})

    resp = await client.get("/api/memos?user_id=alice")
    assert resp.status_code == 200
    topics = [m["topic"] for m in resp.json()]
    assert "Memo A" in topics
    assert "Memo B" in topics
    assert "Memo C" not in topics


# ===========================================================================
# Tests: GET /api/memos/{id}/claims — claim listing
# ===========================================================================


@pytest.mark.asyncio
async def test_get_claims_empty_before_generation(client: AsyncClient) -> None:
    resp = await client.post("/api/memos", json={"topic": "Fiscal policy", "user_id": "u2"})
    memo_id = resp.json()["id"]

    claims_resp = await client.get(f"/api/memos/{memo_id}/claims")
    assert claims_resp.status_code == 200
    assert claims_resp.json() == []


@pytest.mark.asyncio
async def test_get_claims_returns_persisted_claims(
    client: AsyncClient,
    memo_repo: MemoRepository,
    claim_repo: ClaimRepository,
    db_session: AsyncSession,
) -> None:
    memo = await memo_repo.create(user_id="u3", topic="Health policy")
    await claim_repo.create_claim(
        memo_id=memo.id,
        claim_id="C-001",
        claim_text="Maternal mortality in Chad is 1,140 per 100,000.",
        claim_type="statistical",
        derivation="direct_extraction",
        sources_json=[
            {
                "source_id": "S-001",
                "source_title": "WHO",
                "source_url": "https://who.int",
                "relevant_chunk": "…",
            }
        ],
        reasoning="Direct extraction.",
    )
    await db_session.commit()

    resp = await client.get(f"/api/memos/{memo.id}/claims")
    assert resp.status_code == 200
    claims = resp.json()
    assert len(claims) == 1
    assert claims[0]["claim_id"] == "C-001"
    assert claims[0]["claim_type"] == "statistical"
    assert claims[0]["status"] == "draft"
    assert claims[0]["revision_count"] == 0


# ===========================================================================
# Tests: Version creation on claim revision
# ===========================================================================


@pytest.mark.asyncio
async def test_revise_creates_new_version(
    client: AsyncClient,
    memo_repo: MemoRepository,
    claim_repo: ClaimRepository,
    db_session: AsyncSession,
) -> None:
    memo = await memo_repo.create(user_id="u4", topic="Energy subsidies")
    await memo_repo.update_content(
        memo,
        memo_markdown="# Energy Subsidies\n\nContent here.",
        notes_log_json=[],
        status="ready",
    )
    await claim_repo.create_claim(
        memo_id=memo.id,
        claim_id="C-001",
        claim_text="Subsidies increased transport costs by 15%.",
        claim_type="causal",
        derivation="paraphrase",
        sources_json=[],
        reasoning="Paraphrase of World Bank note.",
    )
    await db_session.commit()

    resp = await client.post(
        f"/api/memos/{memo.id}/revise",
        json={"claim_ids": ["C-001"]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "C-001" in data["revised_claim_ids"]
    assert data["new_version"] == 2

    # Verify version was created in DB
    versions = await memo_repo.list_versions(memo.id)
    assert len(versions) == 1
    assert versions[0].version_number == 2
    assert "C-001" in versions[0].changed_claim_ids


@pytest.mark.asyncio
async def test_revise_skips_claims_at_max_attempts(
    client: AsyncClient,
    memo_repo: MemoRepository,
    claim_repo: ClaimRepository,
    db_session: AsyncSession,
) -> None:
    memo = await memo_repo.create(user_id="u5", topic="Water policy")
    claim = await claim_repo.create_claim(
        memo_id=memo.id,
        claim_id="C-001",
        claim_text="Water demand will exceed supply by 2032.",
        claim_type="predictive",
        derivation="direct_extraction",
        sources_json=[],
        reasoning="IPCC projection.",
    )
    # Simulate already at max (2 attempts)
    claim.revision_count = 2
    db_session.add(claim)
    await db_session.commit()

    resp = await client.post(
        f"/api/memos/{memo.id}/revise",
        json={"claim_ids": ["C-001"]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "C-001" in data["skipped_claim_ids"]
    assert data["revised_claim_ids"] == []


@pytest.mark.asyncio
async def test_revise_nonexistent_claim_is_skipped(
    client: AsyncClient,
    memo_repo: MemoRepository,
    db_session: AsyncSession,
) -> None:
    memo = await memo_repo.create(user_id="u6", topic="Trade policy")
    await db_session.commit()

    resp = await client.post(
        f"/api/memos/{memo.id}/revise",
        json={"claim_ids": ["C-999"]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "C-999" in data["skipped_claim_ids"]
    assert data["new_version"] == memo.version  # no new version created


# ===========================================================================
# Tests: GET /api/memos/{id}/versions
# ===========================================================================


@pytest.mark.asyncio
async def test_version_history_grows_with_each_revision(
    client: AsyncClient,
    memo_repo: MemoRepository,
    claim_repo: ClaimRepository,
    db_session: AsyncSession,
) -> None:
    memo = await memo_repo.create(user_id="u7", topic="Governance")
    await memo_repo.update_content(memo, memo_markdown="v1", notes_log_json=[], status="ready")
    await claim_repo.create_claim(
        memo_id=memo.id,
        claim_id="C-001",
        claim_text="Claim one.",
        claim_type="normative",
        derivation="paraphrase",
        sources_json=[],
        reasoning="",
    )
    await claim_repo.create_claim(
        memo_id=memo.id,
        claim_id="C-002",
        claim_text="Claim two.",
        claim_type="synthesis",
        derivation="agent_inference",
        sources_json=[],
        reasoning="",
    )
    await db_session.commit()

    # First revision
    r1 = await client.post(f"/api/memos/{memo.id}/revise", json={"claim_ids": ["C-001"]})
    assert r1.status_code == 200
    assert r1.json()["new_version"] == 2

    # Second revision
    r2 = await client.post(f"/api/memos/{memo.id}/revise", json={"claim_ids": ["C-002"]})
    assert r2.status_code == 200
    assert r2.json()["new_version"] == 3

    # Version list
    versions_resp = await client.get(f"/api/memos/{memo.id}/versions")
    assert versions_resp.status_code == 200
    versions = versions_resp.json()
    assert len(versions) == 2
    version_numbers = {v["version_number"] for v in versions}
    assert version_numbers == {2, 3}


# ===========================================================================
# Tests: HERALD result storage
# ===========================================================================


@pytest.mark.asyncio
async def test_herald_result_stored_on_claim(
    client: AsyncClient,
    memo_repo: MemoRepository,
    claim_repo: ClaimRepository,
    db_session: AsyncSession,
) -> None:
    """Verify that saving a HeraldEvaluation row and updating claim status works."""
    memo = await memo_repo.create(user_id="u8", topic="Education")
    claim = await claim_repo.create_claim(
        memo_id=memo.id,
        claim_id="C-001",
        claim_text="Cash transfers improve enrollment.",
        claim_type="comparative",
        derivation="cross_source",
        sources_json=[],
        reasoning="Meta-analysis comparison.",
    )
    await db_session.commit()

    herald_result = {
        "claim_id": "C-001",
        "tier_reached": 2,
        "verdict": "valid",
        "confidence": 0.92,
        "feedback": "Source entails the claim with high confidence.",
        "suggested_revision": None,
        "tier_details": {},
    }

    # Save evaluation via repository (simulating what the HERALD pipeline will do)
    await claim_repo.save_herald_evaluation(
        claim_pk=claim.id,
        tier_reached=2,
        verdict="valid",
        confidence=0.92,
        feedback="Source entails the claim with high confidence.",
        suggested_revision=None,
        tier_details_json={},
    )
    await claim_repo.update_herald_result(claim, herald_result_json=herald_result, verdict="valid")
    await db_session.commit()

    # Retrieve via API
    resp = await client.get(f"/api/herald/memos/{memo.id}/evaluate/C-001")
    assert resp.status_code == 200
    data = resp.json()
    assert data["verdict"] == "valid"
    assert data["confidence"] == pytest.approx(0.92, abs=0.01)
    assert data["tier_reached"] == 2
    assert data["claim_id"] == "C-001"


@pytest.mark.asyncio
async def test_herald_result_404_before_evaluation(
    client: AsyncClient,
    memo_repo: MemoRepository,
    claim_repo: ClaimRepository,
    db_session: AsyncSession,
) -> None:
    memo = await memo_repo.create(user_id="u9", topic="Tax policy")
    await claim_repo.create_claim(
        memo_id=memo.id,
        claim_id="C-001",
        claim_text="Tax cuts increase GDP.",
        claim_type="causal",
        derivation="paraphrase",
        sources_json=[],
        reasoning="",
    )
    await db_session.commit()

    resp = await client.get(f"/api/herald/memos/{memo.id}/evaluate/C-001")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_evaluate_claims_queues_known_claims(
    client: AsyncClient,
    memo_repo: MemoRepository,
    claim_repo: ClaimRepository,
    db_session: AsyncSession,
) -> None:
    memo = await memo_repo.create(user_id="u10", topic="Infrastructure")
    await claim_repo.create_claim(
        memo_id=memo.id,
        claim_id="C-001",
        claim_text="Roads reduce poverty.",
        claim_type="causal",
        derivation="direct_extraction",
        sources_json=[],
        reasoning="",
    )
    await db_session.commit()

    resp = await client.post(
        f"/api/herald/memos/{memo.id}/evaluate",
        json={"claim_ids": ["C-001"]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "C-001" in data["queued_claim_ids"]


@pytest.mark.asyncio
async def test_evaluate_claims_rejects_unknown_claims(
    client: AsyncClient,
    memo_repo: MemoRepository,
    db_session: AsyncSession,
) -> None:
    memo = await memo_repo.create(user_id="u11", topic="Agriculture")
    await db_session.commit()

    resp = await client.post(
        f"/api/herald/memos/{memo.id}/evaluate",
        json={"claim_ids": ["C-999"]},
    )
    assert resp.status_code == 404
