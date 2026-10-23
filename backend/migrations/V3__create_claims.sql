-- V3__create_claims.sql
-- Records every successful claim transaction.

CREATE TABLE claims (
    id            BIGSERIAL PRIMARY KEY,
    recipient     TEXT        NOT NULL,
    token         TEXT        NOT NULL,
    amount        NUMERIC     NOT NULL,
    ledger        BIGINT      NOT NULL,
    tx_hash       TEXT        NOT NULL UNIQUE,
    claimed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_claims_recipient ON claims (recipient);
CREATE INDEX idx_claims_token     ON claims (token);

-- Foreign key to schedules (optional, schedule may be cancelled/deleted)
ALTER TABLE claims
    ADD CONSTRAINT fk_claims_schedule
    FOREIGN KEY (recipient) REFERENCES schedules (recipient)
    ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;
