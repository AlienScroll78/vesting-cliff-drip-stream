-- Migration V6: Create admin audit log table
-- Closes #742 — JWT-based auth with audit trail for admin actions

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id            BIGSERIAL PRIMARY KEY,
    timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    action        TEXT        NOT NULL,
    subject       TEXT        NOT NULL,  -- JWT sub (Stellar address of the actor)
    params        JSONB       NOT NULL DEFAULT '{}',
    request_id    TEXT
);

-- Index for querying by actor
CREATE INDEX IF NOT EXISTS idx_audit_log_subject    ON admin_audit_log (subject);
-- Index for time-range queries
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp  ON admin_audit_log (timestamp DESC);
-- Index for action-type queries
CREATE INDEX IF NOT EXISTS idx_audit_log_action     ON admin_audit_log (action);
