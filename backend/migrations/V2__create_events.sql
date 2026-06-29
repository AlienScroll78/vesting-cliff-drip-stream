-- V2__create_events.sql
-- Stores raw and decoded on-chain events.

CREATE TABLE events (
    id              BIGSERIAL PRIMARY KEY,
    ledger          BIGINT      NOT NULL,
    tx_hash         TEXT        NOT NULL,
    event_type      TEXT        NOT NULL
                    CHECK (event_type IN ('stream_created', 'tokens_claimed', 'stream_cancelled', 'stream_completed')),
    recipient       TEXT        NOT NULL,
    sponsor         TEXT,
    token           TEXT,
    amount          NUMERIC,
    raw_xdr         TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_recipient  ON events (recipient);
CREATE INDEX idx_events_ledger     ON events (ledger);
CREATE INDEX idx_events_event_type ON events (event_type);
CREATE INDEX idx_events_tx_hash    ON events (tx_hash);
