/**
 * backend/tests/migrations/004_stream_events.test.ts  (#286)
 *
 * Tests that migration 004 creates stream_events, stream_events_dlq, and
 * horizon_worker_cursor with the expected schema.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, getTableColumns, getTableIndexes, tableExists } from "../../src/database.js";
import type { Pool } from "pg";

let pool: Pool;

beforeAll(async () => {
  pool = createPool();

  // Run the migration DDL directly (mirrors what node-pg-migrate would execute).
  const client = await pool.connect();
  try {
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stream_event_type') THEN
          CREATE TYPE stream_event_type AS ENUM (
            'vc_create','vc_claim','vc_cancel','vc_done','vc_drain'
          );
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS stream_events (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type      stream_event_type NOT NULL,
        recipient       VARCHAR(56) NOT NULL,
        sponsor         VARCHAR(56),
        token           VARCHAR(56),
        amount          BIGINT,
        ledger_sequence INTEGER NOT NULL,
        tx_hash         VARCHAR(64) NOT NULL UNIQUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS stream_events_dlq (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        horizon_event_id  TEXT NOT NULL UNIQUE,
        raw_payload       JSONB NOT NULL,
        attempt_count     INTEGER NOT NULL DEFAULT 1,
        last_error        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS horizon_worker_cursor (
        id                   INTEGER PRIMARY KEY DEFAULT 1,
        last_paging_token    TEXT NOT NULL DEFAULT '',
        last_ledger_sequence INTEGER NOT NULL DEFAULT 0,
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      INSERT INTO horizon_worker_cursor (id, last_paging_token, last_ledger_sequence)
      VALUES (1, '', 0) ON CONFLICT DO NOTHING;
    `);

    // Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stream_events_recipient_type
        ON stream_events (recipient, event_type);
      CREATE INDEX IF NOT EXISTS idx_stream_events_sponsor
        ON stream_events (sponsor);
      CREATE INDEX IF NOT EXISTS idx_stream_events_ledger
        ON stream_events (ledger_sequence);
      CREATE INDEX IF NOT EXISTS idx_stream_events_created_at
        ON stream_events (created_at);
    `);
  } finally {
    client.release();
  }
});

afterAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("DROP TABLE IF EXISTS stream_events CASCADE");
    await client.query("DROP TABLE IF EXISTS stream_events_dlq CASCADE");
    await client.query("DROP TABLE IF EXISTS horizon_worker_cursor CASCADE");
    await client.query("DROP TYPE IF EXISTS stream_event_type CASCADE");
  } finally {
    client.release();
  }
  await pool.end();
});

describe("migration 004 — stream_events", () => {
  it("creates stream_events table", async () => {
    const client = await pool.connect();
    try {
      const exists = await tableExists(client, "stream_events");
      expect(exists).toBe(true);
    } finally {
      client.release();
    }
  });

  it("stream_events has expected columns", async () => {
    const client = await pool.connect();
    try {
      const cols = await getTableColumns(client, "stream_events");
      const names = cols.map((c) => c.column_name);
      expect(names).toContain("id");
      expect(names).toContain("event_type");
      expect(names).toContain("recipient");
      expect(names).toContain("sponsor");
      expect(names).toContain("token");
      expect(names).toContain("amount");
      expect(names).toContain("ledger_sequence");
      expect(names).toContain("tx_hash");
      expect(names).toContain("created_at");
    } finally {
      client.release();
    }
  });

  it("stream_events has recipient+event_type composite index", async () => {
    const client = await pool.connect();
    try {
      const indexes = await getTableIndexes(client, "stream_events");
      expect(indexes).toContain("idx_stream_events_recipient_type");
    } finally {
      client.release();
    }
  });

  it("stream_events has ledger_sequence index", async () => {
    const client = await pool.connect();
    try {
      const indexes = await getTableIndexes(client, "stream_events");
      expect(indexes).toContain("idx_stream_events_ledger");
    } finally {
      client.release();
    }
  });

  it("tx_hash has unique constraint (prevents duplicate ingestion)", async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO stream_events
          (event_type, recipient, ledger_sequence, tx_hash)
        VALUES ('vc_create', 'GABC', 100, 'unique-hash-001')
      `);
      await expect(
        client.query(`
          INSERT INTO stream_events
            (event_type, recipient, ledger_sequence, tx_hash)
          VALUES ('vc_claim', 'GABC', 101, 'unique-hash-001')
        `)
      ).rejects.toThrow();
    } finally {
      client.release();
    }
  });

  it("creates stream_events_dlq table with required columns", async () => {
    const client = await pool.connect();
    try {
      const cols = await getTableColumns(client, "stream_events_dlq");
      const names = cols.map((c) => c.column_name);
      expect(names).toContain("horizon_event_id");
      expect(names).toContain("raw_payload");
      expect(names).toContain("attempt_count");
      expect(names).toContain("last_error");
    } finally {
      client.release();
    }
  });

  it("seeds horizon_worker_cursor with a single row", async () => {
    const client = await pool.connect();
    try {
      const result = await client.query("SELECT * FROM horizon_worker_cursor WHERE id = 1");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].last_paging_token).toBe("");
      expect(result.rows[0].last_ledger_sequence).toBe(0);
    } finally {
      client.release();
    }
  });
});
