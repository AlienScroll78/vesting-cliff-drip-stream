-- V1__create_schedules.sql
-- Stores on-chain vesting schedule data indexed from the contract.

CREATE TABLE schedules (
    id                BIGSERIAL PRIMARY KEY,
    recipient         TEXT        NOT NULL UNIQUE,
    sponsor           TEXT        NOT NULL,
    token             TEXT        NOT NULL,
    rate_per_ledger   NUMERIC     NOT NULL,
    start_ledger      BIGINT      NOT NULL,
    cliff_ledger      BIGINT      NOT NULL,
    end_ledger        BIGINT      NOT NULL,
    total_deposit     NUMERIC     NOT NULL,
    status            TEXT        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'completed', 'cancelled')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_schedules_sponsor  ON schedules (sponsor);
CREATE INDEX idx_schedules_token    ON schedules (token);
CREATE INDEX idx_schedules_status   ON schedules (status);
