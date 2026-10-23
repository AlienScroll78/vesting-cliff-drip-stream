/**
 * tests/migrations/003_add_cancelled_at_to_streams.test.ts
 *
 * Tests for migration 003: add cancelled_at, refunded_amount, and
 * cancellation_tx_hash columns to vesting_streams.
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
  appliedMigrations,
} from "./helpers";

let pool: Pool;
let client: PoolClient;

// A helper stream row to use across tests
const SEED_STREAM = {
  recipient_address: "GCANCEL_TEST",
  sponsor_address: "GSPONSOR_CANCEL",
  token_address: "GTOKEN_CANCEL",
  rate_per_ledger: 10,
  start_ledger: 100,
  cliff_ledger: 150,
  end_ledger: 300,
  last_claimed_ledger: 100,
};

beforeAll(async () => {
  pool = createTestPool();
  client = await pool.connect();
  // Ensure all migrations are applied
  migrateUp();
});

afterAll(async () => {
  client.release();
  await pool.end();
});

// ── Apply ─────────────────────────────────────────────────────────────────────

describe("Migration 003 – apply: cancelled_at columns on vesting_streams", () => {
  it("adds cancelled_at column", async () => {
    const cols = await columns(client, "vesting_streams");
    const names = cols.map((c) => c.column_name);
    expect(names).toContain("cancelled_at");
  });

  it("adds refunded_amount column", async () => {
    const cols = await columns(client, "vesting_streams");
    const names = cols.map((c) => c.column_name);
    expect(names).toContain("refunded_amount");
  });

  it("adds cancellation_tx_hash column", async () => {
    const cols = await columns(client, "vesting_streams");
    const names = cols.map((c) => c.column_name);
    expect(names).toContain("cancellation_tx_hash");
  });

  it("cancelled_at is nullable (not required for active streams)", async () => {
    const cols = await columns(client, "vesting_streams");
    const col = cols.find((c) => c.column_name === "cancelled_at");
    expect(col?.is_nullable).toBe("YES");
  });

  it("refunded_amount is nullable", async () => {
    const cols = await columns(client, "vesting_streams");
    const col = cols.find((c) => c.column_name === "refunded_amount");
    expect(col?.is_nullable).toBe("YES");
  });

  it("cancellation_tx_hash is unique when provided", async () => {
    // Insert two streams
    await client.query(`
      INSERT INTO vesting_streams
        (recipient_address, sponsor_address, token_address, rate_per_ledger,
         start_ledger, cliff_ledger, end_ledger, last_claimed_ledger)
      VALUES
        ('GCANCEL_UNIQUE1', 'GSPONSOR', 'GTOKEN', 10, 100, 150, 300, 100)
    `);
    await client.query(`
      INSERT INTO vesting_streams
        (recipient_address, sponsor_address, token_address, rate_per_ledger,
         start_ledger, cliff_ledger, end_ledger, last_claimed_ledger)
      VALUES
        ('GCANCEL_UNIQUE2', 'GSPONSOR', 'GTOKEN', 10, 100, 150, 300, 100)
    `);

    // Set the same cancellation tx hash on both – second should fail
    await client.query(`
      UPDATE vesting_streams SET cancellation_tx_hash = 'CANCEL_TX_001'
      WHERE recipient_address = 'GCANCEL_UNIQUE1'
    `);

    await expect(
      client.query(`
        UPDATE vesting_streams SET cancellation_tx_hash = 'CANCEL_TX_001'
        WHERE recipient_address = 'GCANCEL_UNIQUE2'
      `)
    ).rejects.toThrow(/unique/i);

    await client.query(`
      DELETE FROM vesting_streams
      WHERE recipient_address IN ('GCANCEL_UNIQUE1', 'GCANCEL_UNIQUE2')
    `);
  });

  it("migration 003 is recorded in pgmigrations", async () => {
    const migrations = await appliedMigrations(client);
    expect(migrations.some((m) => m.includes("003"))).toBe(true);
  });
});

// ── Seed data integrity ───────────────────────────────────────────────────────

describe("Migration 003 – seed data integrity", () => {
  it("existing rows have null for the new columns after migration 003", async () => {
    // Insert a stream without the new fields
    await client.query(`
      INSERT INTO vesting_streams
        (recipient_address, sponsor_address, token_address, rate_per_ledger,
         start_ledger, cliff_ledger, end_ledger, last_claimed_ledger)
      VALUES
        ('GSEED_CANCEL', 'GSPONSOR', 'GTOKEN', 10, 100, 150, 300, 100)
    `);

    const res = await client.query(`
      SELECT cancelled_at, refunded_amount, cancellation_tx_hash
      FROM vesting_streams WHERE recipient_address = 'GSEED_CANCEL'
    `);

    expect(res.rows[0].cancelled_at).toBeNull();
    expect(res.rows[0].refunded_amount).toBeNull();
    expect(res.rows[0].cancellation_tx_hash).toBeNull();

    await client.query(
      `DELETE FROM vesting_streams WHERE recipient_address = 'GSEED_CANCEL'`
    );
  });

  it("can update a stream to cancelled status with all cancellation fields", async () => {
    await client.query(`
      INSERT INTO vesting_streams
        (recipient_address, sponsor_address, token_address, rate_per_ledger,
         start_ledger, cliff_ledger, end_ledger, last_claimed_ledger)
      VALUES
        ('GSEED_CANCELLED', 'GSPONSOR', 'GTOKEN', 10, 100, 150, 300, 100)
    `);

    const now = new Date().toISOString();
    await client.query(`
      UPDATE vesting_streams
      SET status = 'cancelled',
          cancelled_at = $1,
          refunded_amount = 2000,
          cancellation_tx_hash = 'CANCEL_FULL_TX'
      WHERE recipient_address = 'GSEED_CANCELLED'
    `, [now]);

    const res = await client.query(`
      SELECT status, refunded_amount, cancellation_tx_hash
      FROM vesting_streams WHERE recipient_address = 'GSEED_CANCELLED'
    `);

    expect(res.rows[0].status).toBe("cancelled");
    expect(parseInt(res.rows[0].refunded_amount)).toBe(2000);
    expect(res.rows[0].cancellation_tx_hash).toBe("CANCEL_FULL_TX");

    await client.query(
      `DELETE FROM vesting_streams WHERE recipient_address = 'GSEED_CANCELLED'`
    );
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe("Migration 003 – idempotency", () => {
  it("running migrate up again is a no-op", () => {
    expect(() => migrateUp()).not.toThrow();
  });
});

// ── Rollback ──────────────────────────────────────────────────────────────────

describe("Migration 003 – rollback", () => {
  it("rolling back 003 removes the new columns", async () => {
    migrateDown(1); // rolls back 003 only

    const cols = await columns(client, "vesting_streams");
    const names = cols.map((c) => c.column_name);

    expect(names).not.toContain("cancelled_at");
    expect(names).not.toContain("refunded_amount");
    expect(names).not.toContain("cancellation_tx_hash");

    // Restore
    migrateUp();
  });

  it("other columns remain after rolling back 003", async () => {
    const cols = await columns(client, "vesting_streams");
    const names = cols.map((c) => c.column_name);

    expect(names).toContain("recipient_address");
    expect(names).toContain("rate_per_ledger");
    expect(names).toContain("status");
  });
});
