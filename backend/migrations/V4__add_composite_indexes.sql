-- V4__add_composite_indexes.sql
-- Issue #741: Add composite indexes identified by pg_stat_statements audit.
--
-- Why these two indexes:
--   1. idx_streams_sponsor_status  — the analytics query on GET /analytics/sponsor/:address
--      filters WHERE s.sponsor = $1 AND s.status = 'active'.  Without a composite
--      index Postgres must full-scan schedules and re-filter on status.
--
--   2. idx_events_recipient_type   — several event-log queries filter by
--      recipient AND event_type together (e.g. "all tokens_claimed events for
--      this recipient").  The separate single-column indexes are less efficient
--      because the planner still must reconcile two bitmaps.
--
-- Both use IF NOT EXISTS so the migration is idempotent.

-- Composite index: sponsor + status (covers the primary analytics hot path)
CREATE INDEX IF NOT EXISTS idx_streams_sponsor_status
    ON schedules (sponsor, status);

-- Composite index: recipient + event_type (covers event-log query patterns)
-- The `events` table uses the column name `event_type`.
CREATE INDEX IF NOT EXISTS idx_events_recipient_type
    ON events (recipient, event_type);

-- Composite index on indexed_events (used by the event indexer + graphql queries)
CREATE INDEX IF NOT EXISTS idx_indexed_events_recipient_type
    ON indexed_events (recipient, event_type);
