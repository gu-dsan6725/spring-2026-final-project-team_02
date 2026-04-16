-- Policy Memo Agent — PostgreSQL Schema
-- Version: 1.0  (matches CLAUDE.md architecture)
--
-- Table layout:
--   memos               — one row per memo, carries the full markdown and notes log
--   memo_versions       — append-only log of every revision; diff stored as JSON
--   claims              — one row per claim extracted from a memo
--   herald_evaluations  — one row per HERALD run against a claim (can be re-run)
--   tool_call_logs      — audit log of every MCP / external tool invocation

-- ---------------------------------------------------------------------------
-- Extension: pgcrypto for gen_random_uuid()
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- memos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memos (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          TEXT        NOT NULL,
    topic            TEXT        NOT NULL,
    background       TEXT        NOT NULL DEFAULT '',
    sources_input    JSONB       NOT NULL DEFAULT '[]',   -- list of URLs / file paths supplied by user
    template         TEXT,
    memo_markdown    TEXT        NOT NULL DEFAULT '',
    notes_log_json   JSONB       NOT NULL DEFAULT '[]',   -- list<NotesLogEntry> as JSON
    version          INTEGER     NOT NULL DEFAULT 1,      -- current version number
    status           TEXT        NOT NULL DEFAULT 'draft'
                                 CHECK (status IN ('draft', 'generating', 'ready', 'archived')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memos_user_id     ON memos (user_id);
CREATE INDEX IF NOT EXISTS idx_memos_created_at  ON memos (created_at DESC);

-- Keep updated_at current automatically
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_memos_updated_at ON memos;
CREATE TRIGGER trg_memos_updated_at
    BEFORE UPDATE ON memos
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- memo_versions
-- Append-only; one row per revision.  Diff records which claim_ids changed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memo_versions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    memo_id         UUID        NOT NULL REFERENCES memos (id) ON DELETE CASCADE,
    version_number  INTEGER     NOT NULL,
    memo_markdown   TEXT        NOT NULL,
    notes_log_json  JSONB       NOT NULL DEFAULT '[]',
    changed_claim_ids JSONB     NOT NULL DEFAULT '[]',  -- list of claim_id strings that changed
    change_reason   TEXT,                               -- e.g. "HERALD revision: C-003, C-005"
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (memo_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_memo_versions_memo_id ON memo_versions (memo_id, version_number DESC);

-- ---------------------------------------------------------------------------
-- claims
-- One row per atomic claim extracted from a memo.
-- claim_id is the agent-assigned identifier (C-001, C-002, …), scoped to memo.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claims (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    memo_id             UUID        NOT NULL REFERENCES memos (id) ON DELETE CASCADE,
    claim_id            TEXT        NOT NULL,   -- C-001, C-002, …
    claim_text          TEXT        NOT NULL,
    claim_type          TEXT        NOT NULL
                                    CHECK (claim_type IN (
                                        'statistical', 'causal', 'comparative',
                                        'predictive', 'normative', 'synthesis'
                                    )),
    derivation          TEXT        NOT NULL
                                    CHECK (derivation IN (
                                        'direct_extraction', 'paraphrase',
                                        'cross_source', 'agent_inference'
                                    )),
    sources_json        JSONB       NOT NULL DEFAULT '[]',  -- list<Source>
    reasoning           TEXT        NOT NULL DEFAULT '',
    herald_result_json  JSONB,      -- latest HeraldResult, null until evaluated
    revision_count      INTEGER     NOT NULL DEFAULT 0,
    status              TEXT        NOT NULL DEFAULT 'draft'
                                    CHECK (status IN ('draft', 'validated', 'flagged')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (memo_id, claim_id)
);

CREATE INDEX IF NOT EXISTS idx_claims_memo_id    ON claims (memo_id);
CREATE INDEX IF NOT EXISTS idx_claims_claim_type ON claims (claim_type);
CREATE INDEX IF NOT EXISTS idx_claims_status     ON claims (status);

DROP TRIGGER IF EXISTS trg_claims_updated_at ON claims;
CREATE TRIGGER trg_claims_updated_at
    BEFORE UPDATE ON claims
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- herald_evaluations
-- One row per HERALD run.  A claim may be evaluated multiple times (revisions).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS herald_evaluations (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id            UUID        NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
    tier_reached        INTEGER     NOT NULL CHECK (tier_reached BETWEEN 1 AND 4),
    verdict             TEXT        NOT NULL
                                    CHECK (verdict IN (
                                        'valid', 'invalid', 'uncertain',
                                        'plausible_but_unsupported'
                                    )),
    confidence          REAL        NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
    feedback            TEXT        NOT NULL,
    suggested_revision  TEXT,
    tier_details_json   JSONB       NOT NULL DEFAULT '{}',  -- HeraldResult.tier_details
    evaluated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_herald_claim_id     ON herald_evaluations (claim_id);
CREATE INDEX IF NOT EXISTS idx_herald_evaluated_at ON herald_evaluations (evaluated_at DESC);

-- ---------------------------------------------------------------------------
-- tool_call_logs
-- Audit log of every external tool / MCP invocation made during generation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_call_logs (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    memo_id          UUID        NOT NULL REFERENCES memos (id) ON DELETE CASCADE,
    tool_name        TEXT        NOT NULL,
    query            TEXT        NOT NULL,
    response_summary TEXT        NOT NULL DEFAULT '',
    latency_ms       INTEGER,
    success          BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_call_logs_memo_id    ON tool_call_logs (memo_id);
CREATE INDEX IF NOT EXISTS idx_tool_call_logs_tool_name  ON tool_call_logs (tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_call_logs_created_at ON tool_call_logs (created_at DESC);
