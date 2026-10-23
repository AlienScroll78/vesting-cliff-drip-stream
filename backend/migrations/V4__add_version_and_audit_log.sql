-- V4__add_version_and_audit_log.sql
-- Adds optimistic-lock version column to schedules and creates audit_log table.

-- Optimistic-lock version: incremented on every status-change UPDATE.
ALTER TABLE schedules
    ADD COLUMN version INT NOT NULL DEFAULT 1;

-- Audit log: append-only record of all schedule state transitions.
CREATE TABLE audit_log (
    id          BIGSERIAL    PRIMARY KEY,
    recipient   TEXT         NOT NULL,
    action      TEXT         NOT NULL
                             CHECK (action IN ('created', 'claimed', 'cancelled', 'completed')),
    old_status  TEXT,
    new_status  TEXT         NOT NULL,
    ledger      BIGINT,
    tx_hash     TEXT,
    actor       TEXT,
    metadata    JSONB,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_recipient ON audit_log (recipient);
CREATE INDEX idx_audit_log_action    ON audit_log (action);
CREATE INDEX idx_audit_log_created   ON audit_log (created_at);
