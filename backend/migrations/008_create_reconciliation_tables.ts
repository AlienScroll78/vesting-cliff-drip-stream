/**
 * migrations/008_create_reconciliation_tables.ts
 *
 * Creates tables for tracking stream reconciliation results and failures.
 * Used by the daily reconciliation job to detect indexer desync.
 *
 * Issue #1007: Build stream reconciliation job comparing DB vs on-chain state
 */

import { MigrationBuilder, ColumnDefinitions } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Create reconciliation_failures table to log mismatches
  pgm.createTable("reconciliation_failures", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
      notNull: true,
    },

    // Reference to the stream being checked
    recipient_address: {
      type: "varchar(56)",
      notNull: true,
      comment: "Stellar address of the recipient (stream identifier)",
    },

    // Mismatch details
    failure_type: {
      type: "varchar(50)",
      notNull: true,
      comment: "Type of mismatch: balance_mismatch | status_mismatch | missing_on_chain | missing_in_db",
    },

    // Expected vs actual values (stored as text for flexibility)
    db_value: {
      type: "text",
      notNull: false,
      comment: "Value from database (JSON serialized if complex)",
    },

    chain_value: {
      type: "text",
      notNull: false,
      comment: "Value from on-chain contract view function (JSON serialized if complex)",
    },

    // Context
    reconciliation_job_id: {
      type: "uuid",
      notNull: false,
      comment: "Reference to the reconciliation job that detected this failure",
    },

    error_message: {
      type: "text",
      notNull: false,
      comment: "Any error encountered while checking this stream",
    },

    // Status tracking
    acknowledged: {
      type: "boolean",
      notNull: true,
      default: false,
      comment: "Whether this mismatch has been reviewed/acknowledged",
    },

    acknowledged_at: {
      type: "timestamptz",
      notNull: false,
      comment: "When the mismatch was acknowledged",
    },

    acknowledged_by: {
      type: "varchar(255)",
      notNull: false,
      comment: "User/system that acknowledged the mismatch",
    },

    resolution_notes: {
      type: "text",
      notNull: false,
      comment: "Notes on how the mismatch was resolved",
    },

    // Timestamps
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

  // Create reconciliation_runs table to track job executions
  pgm.createTable("reconciliation_runs", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
      notNull: true,
    },

    // Execution context
    started_at: {
      type: "timestamptz",
      notNull: true,
    },

    completed_at: {
      type: "timestamptz",
      notNull: false,
      comment: "null if still running",
    },

    dry_run: {
      type: "boolean",
      notNull: true,
      default: false,
      comment: "Whether this was a dry-run (no writes)",
    },

    // Statistics
    streams_checked: {
      type: "integer",
      notNull: true,
      default: 0,
    },

    failures_detected: {
      type: "integer",
      notNull: true,
      default: 0,
    },

    errors_encountered: {
      type: "integer",
      notNull: true,
      default: 0,
      comment: "RPC failures or other transient errors",
    },

    // Results
    status: {
      type: "varchar(20)",
      notNull: true,
      default: "'running'",
      comment: "running | completed | failed",
    },

    error_message: {
      type: "text",
      notNull: false,
      comment: "If status=failed, the error that caused failure",
    },

    // Slack notification
    slack_alert_sent: {
      type: "boolean",
      notNull: true,
      default: false,
      comment: "Whether a Slack alert was sent for this run",
    },

    slack_alert_sent_at: {
      type: "timestamptz",
      notNull: false,
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  // Indexes for efficient querying
  pgm.createIndex("reconciliation_failures", "recipient_address", {
    name: "idx_reconciliation_failures_recipient",
  });

  pgm.createIndex("reconciliation_failures", "failure_type", {
    name: "idx_reconciliation_failures_type",
  });

  pgm.createIndex("reconciliation_failures", ["acknowledged", "created_at"], {
    name: "idx_reconciliation_failures_unacked",
  });

  pgm.createIndex("reconciliation_runs", ["started_at", "status"], {
    name: "idx_reconciliation_runs_time_status",
  });

  pgm.createIndex("reconciliation_runs", "dry_run", {
    name: "idx_reconciliation_runs_dry_run",
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex("reconciliation_runs", "dry_run", {
    name: "idx_reconciliation_runs_dry_run",
  });

  pgm.dropIndex("reconciliation_runs", ["started_at", "status"], {
    name: "idx_reconciliation_runs_time_status",
  });

  pgm.dropIndex("reconciliation_failures", ["acknowledged", "created_at"], {
    name: "idx_reconciliation_failures_unacked",
  });

  pgm.dropIndex("reconciliation_failures", "failure_type", {
    name: "idx_reconciliation_failures_type",
  });

  pgm.dropIndex("reconciliation_failures", "recipient_address", {
    name: "idx_reconciliation_failures_recipient",
  });

  pgm.dropTable("reconciliation_runs");
  pgm.dropTable("reconciliation_failures");
}
