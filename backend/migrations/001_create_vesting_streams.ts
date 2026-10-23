/**
 * migrations/001_create_vesting_streams.ts
 *
 * Creates the core `vesting_streams` table that mirrors on-chain state for
 * the Vesting Cliff Drip Stream contract, allowing the backend indexer to
 * serve read queries without hitting an RPC node on every request.
 */

import { MigrationBuilder, ColumnDefinitions } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("vesting_streams", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
      notNull: true,
    },
    // On-chain identifiers
    recipient_address: { type: "varchar(56)", notNull: true, unique: true },
    sponsor_address: { type: "varchar(56)", notNull: true },
    token_address: { type: "varchar(56)", notNull: true },

    // Stream parameters (mirrors VestingSchedule in contract)
    rate_per_ledger: { type: "bigint", notNull: true },
    start_ledger: { type: "integer", notNull: true },
    cliff_ledger: { type: "integer", notNull: true },
    end_ledger: { type: "integer", notNull: true },
    last_claimed_ledger: { type: "integer", notNull: true },

    // Index metadata
    status: {
      type: "varchar(20)",
      notNull: true,
      default: "'active'",
      comment: "active | completed | cancelled",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createIndex("vesting_streams", "sponsor_address");
  pgm.createIndex("vesting_streams", "token_address");
  pgm.createIndex("vesting_streams", "status");
  pgm.createIndex("vesting_streams", ["recipient_address", "status"]);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("vesting_streams");
}
