/**
 * migrations/008_terminal_event_handlers.ts  (#997)
 *
 * Adds support for StreamCancelled and StreamClawedBack terminal events:
 *
 * 1. Adds 'clawedback' to the stream_status_type enum.
 * 2. Adds terminal event detail columns to vesting_streams for recording
 *    the final split of funds and event metadata.
 * 3. Updates the check_stream_status_transition function to allow
 *    active → clawedback and pre_cliff → clawedback transitions.
 *
 * StreamCancelled records: sponsor_refund, recipient_payout,
 *   cancelled_at_ledger, tx_hash
 * StreamClawedBack records: sponsor, amount, reason, clawed_at_ledger,
 *   tx_hash
 *
 * Status transitions enforced: only 'active' (or 'pre_cliff') streams can
 * be cancelled or clawed back. Terminal states (cancelled, clawedback,
 * drained) cannot transition further.
 */

import { MigrationBuilder, ColumnDefinitions } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // ── 1. Add 'clawedback' to the stream_status_type enum ────────────────────
  pgm.sql(`ALTER TYPE stream_status_type ADD VALUE IF NOT EXISTS 'clawedback';`);

  // ── 2. Add terminal event detail columns to vesting_streams ───────────────
  // StreamCancelled details (extends columns from migration 003)
  pgm.addColumn("vesting_streams", {
    cancelled_at_ledger: {
      type: "integer",
      notNull: false,
      comment: "Ledger sequence at which the stream was cancelled",
    },
    cancellation_recipient_payout: {
      type: "numeric",
      notNull: false,
      comment: "Tokens transferred to recipient before cancellation (post-cliff)",
    },
  });

  // StreamClawedBack details
  pgm.addColumn("vesting_streams", {
    clawed_at_ledger: {
      type: "integer",
      notNull: false,
      comment: "Ledger sequence at which the clawback was executed",
    },
    clawback_sponsor: {
      type: "varchar(56)",
      notNull: false,
      comment: "Address of the sponsor who initiated the clawback",
    },
    clawback_amount: {
      type: "numeric",
      notNull: false,
      comment: "Total amount of tokens clawed back",
    },
    clawback_reason: {
      type: "text",
      notNull: false,
      comment: "Compliance reason string for the clawback (max 256 chars on-chain)",
    },
    clawback_tx_hash: {
      type: "varchar(64)",
      notNull: false,
      comment: "Transaction hash of the clawback transaction",
    },
  });

  // ── 3. Update the transition validator function ──────────────────────────
  // Allow active → clawedback and pre_cliff → clawedback transitions.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION check_stream_status_transition(
      p_from  stream_status_type,
      p_to    stream_status_type
    ) RETURNS void
    LANGUAGE plpgsql
    AS $$
    BEGIN
      -- Identity transitions (no-op) are always valid.
      IF p_from = p_to THEN
        RETURN;
      END IF;

      -- Enforce allowed transitions.
      IF NOT (
        (p_from = 'active'    AND p_to IN ('cancelled', 'expired', 'clawedback'))    OR
        (p_from = 'pre_cliff' AND p_to IN ('active', 'cancelled', 'expired', 'clawedback')) OR
        (p_from = 'expired'   AND p_to = 'drained')
      ) THEN
        RAISE EXCEPTION
          'Invalid stream status transition: % → %. '
          'Allowed: active→cancelled|expired|clawedback, pre_cliff→active|cancelled|expired|clawedback, expired→drained',
          p_from, p_to
          USING ERRCODE = 'check_violation';
      END IF;
    END;
    $$;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Remove clawback columns
  pgm.dropColumn("vesting_streams", "clawback_tx_hash");
  pgm.dropColumn("vesting_streams", "clawback_reason");
  pgm.dropColumn("vesting_streams", "clawback_amount");
  pgm.dropColumn("vesting_streams", "clawback_sponsor");
  pgm.dropColumn("vesting_streams", "clawed_at_ledger");

  // Remove cancellation detail columns
  pgm.dropColumn("vesting_streams", "cancellation_recipient_payout");
  pgm.dropColumn("vesting_streams", "cancelled_at_ledger");

  // Restore the original transition function (without clawedback)
  pgm.sql(`
    CREATE OR REPLACE FUNCTION check_stream_status_transition(
      p_from  stream_status_type,
      p_to    stream_status_type
    ) RETURNS void
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF p_from = p_to THEN
        RETURN;
      END IF;

      IF NOT (
        (p_from = 'active'    AND p_to IN ('cancelled', 'expired'))    OR
        (p_from = 'pre_cliff' AND p_to IN ('active', 'cancelled', 'expired')) OR
        (p_from = 'expired'   AND p_to = 'drained')
      ) THEN
        RAISE EXCEPTION
          'Invalid stream status transition: % → %. '
          'Allowed: active→cancelled|expired, pre_cliff→active|cancelled|expired, expired→drained',
          p_from, p_to
          USING ERRCODE = 'check_violation';
      END IF;
    END;
    $$;
  `);

  // Note: Cannot remove 'clawedback' from the enum type in PostgreSQL
  // without recreating the type. This is a known limitation.
}
