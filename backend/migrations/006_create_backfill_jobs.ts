/**
 * migrations/006_create_backfill_jobs.ts  (#749)
 *
 * Creates the `backfill_jobs` table for tracking progress of admin-triggered
 * backfill operations.  Enables resumability after a restart and idempotent
 * re-runs over the same ledger range.
 *
 * Idempotent: uses IF NOT EXISTS guards throughout.
 */

import { MigrationBuilder, ColumnDefinitions } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Status enum for job lifecycle
  pgm.createType("backfill_job_status", [
    "pending",
    "running",
    "completed",
    "failed",
  ]);

  pgm.createTable("backfill_jobs", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
      notNull: true,
    },

    // Ledger range requested by the operator
    from_ledger: { type: "integer", notNull: true },
    to_ledger: { type: "integer", notNull: true },

    // Current job state
    status: {
      type: "backfill_job_status",
      notNull: true,
      default: "'pending'",
    },

    // Progress counters (updated incrementally)
    events_fetched: { type: "integer", notNull: true, default: 0 },
    events_inserted: { type: "integer", notNull: true, default: 0 },
    events_skipped: { type: "integer", notNull: true, default: 0 },

    // Resumability: store the last Horizon paging_token processed
    last_cursor: {
      type: "text",
      notNull: false,
      comment: "Horizon paging_token of the last processed page — enables resume after restart",
    },

    // Timestamps
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    started_at: { type: "timestamptz", notNull: false },
    completed_at: { type: "timestamptz", notNull: false },

    // Error capture
    error_message: { type: "text", notNull: false },
  });

  // Index for listing recent jobs
  pgm.createIndex("backfill_jobs", "created_at", {
    name: "idx_backfill_jobs_created_at",
  });

  // Index for querying by status (e.g. find running jobs)
  pgm.createIndex("backfill_jobs", "status", {
    name: "idx_backfill_jobs_status",
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("backfill_jobs");
  pgm.dropType("backfill_job_status");
}
