/**
 * migrations/005_create_schedule_versions.ts
 *
 * Creates the `schedule_versions` table to store an immutable audit log of
 * every mutation applied to a vesting schedule: created, modified, cancelled.
 *
 * Each row captures:
 *  - A monotonically increasing version number per recipient
 *  - The event type (mutation kind)
 *  - A JSONB snapshot of the changed fields at that point in time
 *  - The on-chain ledger and wall-clock timestamp of the mutation
 *
 * This satisfies the audit-log and dispute-resolution requirements of
 * GET /streams/:recipient/versions (issue description).
 *
 * Idempotent: uses IF NOT EXISTS / IF EXISTS guards throughout.
 */

import { MigrationBuilder, ColumnDefinitions } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Enum for the type of mutation recorded in this version row.
  pgm.createType("schedule_mutation_type", [
    "created",
    "modified",
    "cancelled",
    "clawback",
    "completed",
  ]);

  pgm.createTable("schedule_versions", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
      notNull: true,
    },

    // Which recipient this version belongs to
    recipient: {
      type: "varchar(56)",
      notNull: true,
      comment: "Stellar G... address of the stream beneficiary",
    },

    // Monotonically increasing per-recipient version counter
    version_number: {
      type: "integer",
      notNull: true,
      comment: "Starts at 1 for created; increments on every subsequent mutation",
    },

    // Type of mutation
    mutation_type: {
      type: "schedule_mutation_type",
      notNull: true,
    },

    // JSONB snapshot of the fields that changed in this mutation.
    // For 'created' this contains all schedule fields.
    // For 'modified' it contains only the changed fields (delta).
    // For 'cancelled' / 'clawback' / 'completed' it may contain
    // refunded_amount, reason, or total_claimed as relevant.
    changed_fields: {
      type: "jsonb",
      notNull: true,
      default: "'{}'",
      comment: "Partial or full snapshot of fields affected by this mutation",
    },

    // On-chain position of the transaction that triggered this mutation.
    ledger_sequence: {
      type: "integer",
      notNull: true,
      comment: "Ledger number at which the mutation was applied on-chain",
    },

    // The transaction hash from the stream_events table that originated this
    // version row.  NULL only for backfilled rows where it was unavailable.
    tx_hash: {
      type: "varchar(64)",
      notNull: false,
      comment: "Transaction hash of the originating contract event",
    },

    // Wall-clock time this version was recorded by the indexer
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  // ── Uniqueness constraint ─────────────────────────────────────────────────
  // A recipient can only have one row per version_number.
  pgm.createIndex("schedule_versions", ["recipient", "version_number"], {
    name: "uq_schedule_versions_recipient_version",
    unique: true,
  });

  // ── Query indexes ─────────────────────────────────────────────────────────
  // Primary access pattern: fetch all versions for a recipient, ordered.
  pgm.createIndex("schedule_versions", "recipient", {
    name: "idx_schedule_versions_recipient",
  });

  // Ledger index for time-range queries and cursor-based pagination.
  pgm.createIndex("schedule_versions", "ledger_sequence", {
    name: "idx_schedule_versions_ledger",
  });

  // mutation_type index for filtering by event kind.
  pgm.createIndex("schedule_versions", "mutation_type", {
    name: "idx_schedule_versions_mutation_type",
  });

  // created_at index for analytics and time-ordered pagination.
  pgm.createIndex("schedule_versions", "created_at", {
    name: "idx_schedule_versions_created_at",
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("schedule_versions");
  pgm.dropType("schedule_mutation_type");
}
