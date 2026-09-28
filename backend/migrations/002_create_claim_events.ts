/**
 * migrations/002_create_claim_events.ts
 *
 * Creates the `claim_events` table to record every TokensClaimed event
 * emitted by the contract, enabling historical claim queries and analytics.
 */

import { MigrationBuilder, ColumnDefinitions } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("claim_events", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
      notNull: true,
    },
    // Foreign key to the stream
    stream_id: {
      type: "uuid",
      notNull: true,
      references: '"vesting_streams"',
      onDelete: "CASCADE",
    },
    recipient_address: { type: "varchar(56)", notNull: true },

    // Claim details
    amount: { type: "bigint", notNull: true },
    ledger_claimed_through: { type: "integer", notNull: true },
    transaction_hash: { type: "varchar(64)", notNull: true, unique: true },

    claimed_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createIndex("claim_events", "stream_id");
  pgm.createIndex("claim_events", "recipient_address");
  pgm.createIndex("claim_events", "claimed_at");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("claim_events");
}
