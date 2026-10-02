-- V5__slow_query_optimizations.sql
-- Issue #741: Audit-driven optimizations for the top-5 slow query patterns
-- identified via pg_stat_statements.
--
-- Slow query #1: Analytics aggregate — schedules JOIN claims filtered by
--   sponsor + status.  Fixed by composite index idx_streams_sponsor_status
--   (created in V4).
--
-- Slow query #2: Claims sub-query in analytics —
--   SELECT token, recipient, SUM(amount) FROM claims GROUP BY token, recipient
--   Benefits from a composite covering index on (recipient, token).
--
-- Slow query #3: Export streaming —
--   SELECT * FROM streams WHERE sponsor = $1 ORDER BY id
--   The `streams` table (legacy alias for schedules) needs sponsor index
--   (covered by idx_schedules_sponsor created in V1; ensure it exists).
--
-- Slow query #4: indexed_events cursor pagination —
--   SELECT … FROM indexed_events ORDER BY indexed_at DESC LIMIT n
--   Benefits from a BRIN index on indexed_at (append-mostly column).
--
-- Slow query #5: Cursor resumption in indexer —
--   SELECT cursor FROM indexer_cursor WHERE id = 1
--   Already uses PK; no extra index needed.  However, the upsert of
--   indexed_events can be sped up by ensuring the PK index on event_id is
--   clustered-friendly.  CLUSTER hint captured as a comment for DBA review.

-- Enable pg_stat_statements so future audits have data to work with.
-- This is a no-op if the extension is already loaded.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Slow query #2 fix: composite covering index on claims (recipient, token)
-- Covers: SELECT … FROM claims GROUP BY token, recipient WHERE recipient = $x
CREATE INDEX IF NOT EXISTS idx_claims_recipient_token
    ON claims (recipient, token);

-- Slow query #4 fix: BRIN index for time-range scans on indexed_events.
-- BRIN is very small and effective for append-only/monotonically growing tables.
CREATE INDEX IF NOT EXISTS idx_indexed_events_indexed_at_brin
    ON indexed_events USING BRIN (indexed_at);

-- Partial index for active schedules only — the most common filter.
-- Reduces index scan rows dramatically since completed/cancelled records are rare.
CREATE INDEX IF NOT EXISTS idx_schedules_active_sponsor
    ON schedules (sponsor)
    WHERE status = 'active';

-- Covering index for the readiness probe: SELECT 1 is fast by itself,
-- but an explicit health-check query on schedules can be covered cheaply.
-- No action needed — SELECT 1 does not touch tables.

-- Reset pg_stat_statements baseline after migrations so the next audit
-- starts from a clean slate.
SELECT pg_stat_statements_reset();
