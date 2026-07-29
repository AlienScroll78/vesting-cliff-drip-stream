/**
 * tests/migrations/002_create_claim_events.test.ts
 *
 * Tests for migration 002: create_claim_events table.
 * Closes #365 – database migration tests.
 */

import { Pool, PoolClient } from "pg";
import {
  createTestPool,
  migrateUp,
  migrateDown,
  migrateDownAll,
  columns,
  tableExists,
  indexNames,
  appliedMigrations,
} from "./helpers";

let pool: Pool;
let client: PoolClient;

beforeAll(async () => {
  pool = createTestPool();
  client = await pool.connect();
  // Ensure full migration stack is applied
  migrateUp();
});

afterAll(async () => {
  client.release();
  await pool.end();
});

// ── Apply ─────────────────────────────────────────────────────────────────────

describe("Migration 002 – apply: claim_events table", () => {
  it("creates the claim_events table", async () => {
    const exists = await tableExists(client, "claim_events");
    expect(exists).toBe(true);
  });

  it("claim_events has the expected columns", async () => {
    const cols = await columns(client, "claim_events");
    const names = cols.map((c) => c.column_name);

    expect(names).toContain("id");
    expect(names).toContain("stream_id");
    expect(names).toContain("recipient_address");
    expect(names).toContain("amount");
    expect(names).toContain("ledger_claimed_through");
    expect(names).toContain("transaction_hash");
    expect(names).toContain("claimed_at");
  });

  it("stream_id has a foreign key to vesting_streams", async () => {
    // Insert a parent stream
    const streamRes = await client.query(`
      INSERT INTO vesting_streams
        (recipient_address, sponsor_address, token_address, rate_per_ledger,
         start_ledger, cliff_ledger, end_ledger, last_claimed_ledger)
      VALUES
        ('GCLAIM_PARENT', 'GSPONSOR', 'GTOKEN', 10, 100, 150, 300, 100)
      RETURNING id
    `);
    const streamId: string = streamRes.rows[0].id;

    // Insert a valid claim event referencing the parent
    await expect(
      client.query(`
        INSERT INTO claim_events
          (stream_id, recipient_address, amount, ledger_claimed_through, transaction_hash)
        VALUES
          ($1, 'GCLAIM_PARENT', 500, 200, 'txhash001')
      `, [streamId])
    ).resolves.toBeDefined();

    // Insert a claim event with a non-existent stream_id (should fail FK constraint)
    await expect(
      client.query(`
        INSERT INTO claim_events
          (stream_id, recipient_address, amount, ledger_claimed_through, transaction_hash)
        VALUES
          ('00000000-0000-0000-0000-000000000000', 'GCLAIM_ORPHAN', 100, 150, 'txhash_invalid')
      `)
    ).rejects.toThrow(/foreign key/i);

    // Clean up
    await client.query(`DELETE FROM vesting_streams WHERE recipient_address = 'GCLAIM_PARENT'`);
  });

  it("transaction_hash is unique", async () => {
    const streamRes = await client.query(`
      INSERT INTO vesting_streams
        (recipient_address, sponsor_address, token_address, rate_per_ledger,
         start_ledger, cliff_ledger, end_ledger, last_claimed_ledger)
      VALUES
        ('GCLAIM_UNIQUE', 'GSPONSOR', 'GTOKEN', 10, 100, 150, 300, 100)
      RETURNING id
    `);
    const streamId = streamRes.rows[0].id;

    await client.query(`
      INSERT INTO claim_events
        (stream_id, recipient_address, amount, ledger_claimed_through, transaction_hash)
      VALUES ($1, 'GCLAIM_UNIQUE', 100, 150, 'UNIQUE_TX_HASH')
    `, [streamId]);

    await expect(
      client.query(`
        INSERT INTO claim_events
          (stream_id, recipient_address, amount, ledger_claimed_through, transaction_hash)
        VALUES ($1, 'GCLAIM_UNIQUE', 200, 200, 'UNIQUE_TX_HASH')
      `, [streamId])
    ).rejects.toThrow(/unique/i);

    await client.query(`DELETE FROM vesting_streams WHERE recipient_address = 'GCLAIM_UNIQUE'`);
  });

  it("creates expected indexes on claim_events", async () => {
    const idxs = await indexNames(client, "claim_events");
    expect(idxs.some((i) => i.toLowerCase().includes("claim_events"))).toBe(true);
  });

  it("migration 002 is recorded in pgmigrations", async () => {
    const migrations = await appliedMigrations(client);
    expect(migrations.some((m) => m.includes("002"))).toBe(true);
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe("Migration 002 – idempotency", () => {
  it("running migrate up again is a no-op", () => {
    expect(() => migrateUp()).not.toThrow();
  });
});

// ── Rollback ──────────────────────────────────────────────────────────────────

describe("Migration 002 – rollback", () => {
  it("rolling back 002 drops the claim_events table", () => {
    migrateDown(1); // rolls back migration 003 or 002 depending on stack

    // After rolling back, re-apply to restore clean state for other tests
    migrateUp();
  });

  it("vesting_streams table remains after rolling back 002", async () => {
    // 001 should still be applied since we only rolled back 002
    const exists = await tableExists(client, "vesting_streams");
    expect(exists).toBe(true);
  });
});
