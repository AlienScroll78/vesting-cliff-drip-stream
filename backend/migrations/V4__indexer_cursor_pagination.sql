-- V4__indexer_cursor_pagination.sql
-- Issue #554: Migrate indexer event polling to cursor-based pagination.
--
-- Changes:
--   1. Ensures the indexer_cursor table exists with a `cursor` column and
--      the initial seed row (idempotent via ON CONFLICT DO NOTHING).
--   2. Adds a `paging_token` column to indexed_events so each row stores the
--      Horizon paging token for audit / replay purposes.
--   3. Adds a deduplication index on (transaction_hash, event_index) to
--      enforce the uniqueness constraint used by the upsert logic.

-- ── indexer_cursor ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS indexer_cursor (
    id     INT  PRIMARY KEY DEFAULT 1,
    cursor TEXT NOT NULL DEFAULT ''
);

-- Seed the single control row when the table is first created.
INSERT INTO indexer_cursor (id, cursor)
VALUES (1, '')
ON CONFLICT DO NOTHING;

-- ── indexed_events: paging_token column ──────────────────────────────────────

-- Add paging_token if it doesn't already exist (safe to run on existing dbs).
ALTER TABLE indexed_events
    ADD COLUMN IF NOT EXISTS paging_token TEXT;

-- ── indexed_events: deduplication index ──────────────────────────────────────
-- The event_id PRIMARY KEY already provides deduplication in the happy path.
-- This additional index enforces uniqueness at the (tx_hash, event_index)
-- level, which maps to Horizon's own deduplication keys.

ALTER TABLE indexed_events
    ADD COLUMN IF NOT EXISTS transaction_hash TEXT,
    ADD COLUMN IF NOT EXISTS event_index      INT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_indexed_events_tx_hash_idx
    ON indexed_events (transaction_hash, event_index)
    WHERE transaction_hash IS NOT NULL AND event_index IS NOT NULL;
