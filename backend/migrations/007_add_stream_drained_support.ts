/**
 * migrations/007_add_stream_drained_support.ts
 *
 * Extends vesting_streams table to support StreamDrained event handling.
 * Adds fields to track when a stream was drained and by whom (permissionless).
 *
 * Issue #1010: Implement StreamDrained event handler for permissionless cleanup
 */

import { MigrationBuilder, ColumnDefinitions } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Add columns to vesting_streams for drain tracking
  pgm.addColumns("vesting_streams", {
    drained_by: {
      type: "varchar(56)",
      notNull: false,
      comment: "Stellar address that called drain_expired_stream (permissionless)",
    },
    drained_at: {
      type: "timestamptz",
      notNull: false,
      comment: "Timestamp when stream was drained",
    },
    drain_amount: {
      type: "numeric",
      notNull: false,
      comment: "Amount drained in this transaction",
    },
    drain_tx_hash: {
      type: "varchar(64)",
      notNull: false,
      unique: true,
      comment: "Stellar transaction hash for drain event (prevents duplicates)",
    },
  });

  // Update status enum values to include 'drained'
  pgm.alterColumn("vesting_streams", "status", {
    type: "varchar(20)",
    comment: "active | pre_cliff | expired | cancelled | drained",
  });

  // Create index for efficient drained stream lookups
  pgm.createIndex("vesting_streams", "drained_by", {
    name: "idx_vesting_streams_drained_by",
  });

  pgm.createIndex("vesting_streams", ["status", "drained_at"], {
    name: "idx_vesting_streams_status_drained_at",
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex("vesting_streams", ["status", "drained_at"], {
    name: "idx_vesting_streams_status_drained_at",
  });
  pgm.dropIndex("vesting_streams", "drained_by", {
    name: "idx_vesting_streams_drained_by",
  });

  pgm.dropColumns("vesting_streams", [
    "drained_by",
    "drained_at",
    "drain_amount",
    "drain_tx_hash",
  ]);

  pgm.alterColumn("vesting_streams", "status", {
    type: "varchar(20)",
    comment: "active | completed | cancelled",
  });
}
