/**
 * migrations/007_create_stream_balances.ts  (#996)
 *
 * Creates the `stream_balances` table that maintains a running
 * `claimed_total` per stream, allowing the API to serve remaining-balance
 * queries without hitting the Soroban RPC node on every request.
 *
 * Columns:
 *   stream_id      — recipient address (natural key; each recipient has one
 *                    active stream at a time in the current contract design)
 *   total_deposit  — rate × total_duration, populated from StreamCreated
 *   claimed_total  — running sum of TokensClaimed amounts
 *   remaining      — total_deposit − claimed_total (recomputed on each update)
 *   rate           — tokens per ledger (stored for recomputation)
 *   total_duration — total stream length in ledgers (stored for recomputation)
 *   updated_at     — timestamp of last balance update
 *
 * The remaining field is stored to allow O(1) reads, but both raw fields
 * (rate, total_duration) are also persisted so the balance can be recomputed
 * from first principles during reconciliation.
 *
 * Idempotent: uses IF NOT EXISTS guards throughout.
 */

import { MigrationBuilder, ColumnDefinitions } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable(
    "stream_balances",
    {
      id: {
        type: "bigserial",
        primaryKey: true,
        notNull: true,
      },

      // Recipient address — natural key for the stream.
      // In the current contract each recipient has one active schedule;
      // stream_id in the event context maps to recipient_address.
      stream_id: {
        type: "varchar(56)",
        notNull: true,
        comment: "Recipient address identifying this stream",
      },

      // Total deposit: rate × total_duration (i128 as NUMERIC for precision)
      total_deposit: {
        type: "numeric",
        notNull: false,
        default: "0",
        comment: "Total tokens deposited: rate × total_duration",
      },

      // Running sum of all TokensClaimed event amounts
      claimed_total: {
        type: "numeric",
        notNull: true,
        default: "0",
        comment: "Running total of tokens claimed by the recipient",
      },

      // Remaining balance: total_deposit − claimed_total
      remaining: {
        type: "numeric",
        notNull: true,
        default: "0",
        comment: "Remaining unclaimed balance: total_deposit − claimed_total",
      },

      // Raw fields for recomputation during reconciliation
      rate: {
        type: "numeric",
        notNull: false,
        comment: "Tokens released per ledger (raw i128 value)",
      },

      total_duration: {
        type: "integer",
        notNull: false,
        comment: "Total stream length in ledgers",
      },

      // Timestamp of last balance update (for reconciliation diagnostics)
      updated_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },

      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
    },
    { ifNotExists: true },
  );

  // Unique constraint on stream_id — one balance row per stream
  pgm.createIndex("stream_balances", "stream_id", {
    name: "uq_stream_balances_stream_id",
    unique: true,
    ifNotExists: true,
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("stream_balances", { ifExists: true });
}
