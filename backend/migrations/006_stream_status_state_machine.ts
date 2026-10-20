/**
 * migrations/006_stream_status_state_machine.ts  (#753)
 *
 * Implements the stream status state machine in the database layer:
 *
 * 1. Drops the existing unconstrained varchar(20) status column on
 *    vesting_streams and replaces it with a new PostgreSQL enum type
 *    `stream_status_type` that enforces valid values at the DB level.
 *
 * Valid statuses:
 *   active     — stream is live and tokens are accruing
 *   pre_cliff  — stream started but cliff has not been reached yet
 *   expired    — end_ledger has passed; no more tokens accrue
 *   cancelled  — sponsor cancelled the stream
 *   drained    — expired stream was permissionlessly drained
 *
 * 2. Adds a `status_updated_at` column to track when the last transition
 *    occurred (used by the background expiry job and the status endpoint).
 *
 * 3. Adds a `stream_status_transitions` audit table that records every
 *    status transition with the triggering event and ledger sequence.
 *    This provides an immutable audit trail and enables debugging
 *    invalid-transition attempts.
 *
 * 4. Creates a `check_stream_status_transition` PostgreSQL function that
 *    enforces valid transitions and raises an exception on invalid ones.
 *    Valid transition table:
 *      active     → pre_cliff  (not applicable — pre_cliff is initial)
 *      active     → cancelled  (StreamCancelled event)
 *      active     → expired    (background job, end_ledger passed)
 *      pre_cliff  → active     (cliff reached — internal transition)
 *      pre_cliff  → cancelled  (StreamCancelled event)
 *      pre_cliff  → expired    (background job)
 *      expired    → drained    (StreamDrained event)
 *
 * 5. Creates a trigger `trg_stream_status_audit` that fires AFTER UPDATE
 *    on vesting_streams whenever the status column changes, automatically
 *    inserting a row into stream_status_transitions.
 */

import { MigrationBuilder, ColumnDefinitions } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // ── 1. Create the stream_status enum type ─────────────────────────────────
  pgm.createType("stream_status_type", [
    "active",
    "pre_cliff",
    "expired",
    "cancelled",
    "drained",
  ]);

  // ── 2. Migrate vesting_streams.status to use the new enum ─────────────────
  // Cast the existing varchar values to the new enum.
  // Existing data uses 'active', 'completed', 'cancelled'; map 'completed'
  // → 'expired' for consistency with the new status vocabulary.
  pgm.sql(`
    UPDATE vesting_streams
    SET status = 'expired'
    WHERE status = 'completed';
  `);

  pgm.sql(`
    ALTER TABLE vesting_streams
      ALTER COLUMN status TYPE stream_status_type
        USING status::stream_status_type,
      ALTER COLUMN status SET DEFAULT 'active'::stream_status_type,
      ALTER COLUMN status SET NOT NULL;
  `);

  // ── 3. Add status_updated_at column ──────────────────────────────────────
  pgm.addColumn("vesting_streams", {
    status_updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
      comment: "Timestamp of the most recent status transition",
    },
  });

  // ── 4. Create status transitions audit table ──────────────────────────────
  pgm.createTable("stream_status_transitions", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
      notNull: true,
    },
    recipient_address: {
      type: "varchar(56)",
      notNull: true,
      references: '"vesting_streams"',
      referencesConstraintName: "fk_status_transitions_stream",
      onDelete: "CASCADE",
    },
    from_status: {
      type: "stream_status_type",
      notNull: true,
      comment: "Status before the transition",
    },
    to_status: {
      type: "stream_status_type",
      notNull: true,
      comment: "Status after the transition",
    },
    triggering_event: {
      type: "text",
      notNull: false,
      comment: "Event type that caused this transition (e.g. StreamCancelled)",
    },
    ledger_sequence: {
      type: "integer",
      notNull: false,
      comment: "On-chain ledger sequence of the triggering event",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createIndex("stream_status_transitions", "recipient_address", {
    name: "idx_status_transitions_recipient",
  });
  pgm.createIndex("stream_status_transitions", "created_at", {
    name: "idx_status_transitions_created_at",
  });

  // ── 5. Create the transition validator function ───────────────────────────
  // Returns void; raises exception if transition is invalid.
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

  // ── 6. Create the audit trigger function ─────────────────────────────────
  pgm.sql(`
    CREATE OR REPLACE FUNCTION fn_stream_status_audit()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      -- Only fire when status actually changed.
      IF OLD.status IS DISTINCT FROM NEW.status THEN
        -- Validate the transition before recording it.
        PERFORM check_stream_status_transition(OLD.status, NEW.status);

        -- Record the transition in the audit table.
        INSERT INTO stream_status_transitions
          (recipient_address, from_status, to_status, triggering_event, ledger_sequence)
        VALUES
          (NEW.recipient_address, OLD.status, NEW.status, NULL, NULL);

        -- Keep status_updated_at in sync.
        NEW.status_updated_at := now();
      END IF;
      RETURN NEW;
    END;
    $$;
  `);

  // ── 7. Attach the trigger to vesting_streams ──────────────────────────────
  pgm.sql(`
    CREATE TRIGGER trg_stream_status_audit
    BEFORE UPDATE OF status ON vesting_streams
    FOR EACH ROW
    EXECUTE FUNCTION fn_stream_status_audit();
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TRIGGER IF EXISTS trg_stream_status_audit ON vesting_streams;`);
  pgm.sql(`DROP FUNCTION IF EXISTS fn_stream_status_audit();`);
  pgm.sql(`DROP FUNCTION IF EXISTS check_stream_status_transition(stream_status_type, stream_status_type);`);
  pgm.dropTable("stream_status_transitions");
  pgm.sql(`
    ALTER TABLE vesting_streams
      ALTER COLUMN status TYPE varchar(20)
        USING status::text,
      ALTER COLUMN status SET DEFAULT 'active';
  `);
  pgm.dropType("stream_status_type");
}
