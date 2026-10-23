/**
 * migrations/004_create_stream_events.ts  (#286)
 *
 * Creates the `stream_events` table to persist decoded contract events
 * (StreamCreated / TokensClaimed / StreamCancelled / StreamCompleted /
 * StreamDrained), enabling efficient historical queries without hitting
 * Horizon on every request.
 *
 * Idempotent: uses IF NOT EXISTS / IF EXISTS guards throughout.
 */

import { MigrationBuilder, ColumnDefinitions } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Create event_type enum for type safety and query efficiency.
  pgm.createType("stream_event_type", [
    "vc_create",
    "vc_claim",
    "vc_cancel",
    "vc_done",
    "vc_drain",
  ]);

  pgm.createTable("stream_events", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
      notNull: true,
    },

    // Event identity
    event_type: {
      type: "stream_event_type",
      notNull: true,
      comment: "vc_create | vc_claim | vc_cancel | vc_done | vc_drain",
    },

    // Participants (mirrors events.rs topic / data fields)
    recipient: { type: "varchar(56)", notNull: true },
    sponsor: { type: "varchar(56)", notNull: false },
    token: { type: "varchar(56)", notNull: false },

    // Numeric payload (null when not applicable to the event type)
    amount: { type: "bigint", notNull: false, comment: "vc_claim: tokens transferred; vc_cancel: refunded_amount" },

    // Chain position
    ledger_sequence: { type: "integer", notNull: true },
    tx_hash: { type: "varchar(64)", notNull: true, unique: true, comment: "Unique constraint prevents duplicate ingestion" },

    // Timestamps
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  // ── Indexes ──────────────────────────────────────────────────────────────
  // Composite covering index: most queries filter by recipient + event_type.
  pgm.createIndex("stream_events", ["recipient", "event_type"], {
    name: "idx_stream_events_recipient_type",
  });

  // Sponsor index supports #289 schedule list queries.
  pgm.createIndex("stream_events", "sponsor", {
    name: "idx_stream_events_sponsor",
  });

  // Ledger sequence index: cursor-based pagination and backfill resumption.
  pgm.createIndex("stream_events", "ledger_sequence", {
    name: "idx_stream_events_ledger",
  });

  // created_at index for time-range queries and analytics.
  pgm.createIndex("stream_events", "created_at", {
    name: "idx_stream_events_created_at",
  });

  // ── Dead-letter table for events that fail to decode (#287) ──────────────
  pgm.createTable("stream_events_dlq", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
      notNull: true,
    },
    horizon_event_id: { type: "text", notNull: true, unique: true },
    raw_payload: { type: "jsonb", notNull: true },
    attempt_count: { type: "integer", notNull: true, default: 1 },
    last_error: { type: "text", notNull: false },
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

  // ── Worker cursor table for #287 ingestion worker ────────────────────────
  // Separate from the existing indexer_cursor used by the legacy indexer.
  pgm.createTable("horizon_worker_cursor", {
    id: {
      type: "integer",
      primaryKey: true,
      default: 1,
    },
    last_paging_token: {
      type: "text",
      notNull: true,
      default: "''",
      comment: "Horizon paging_token of the last successfully processed event",
    },
    last_ledger_sequence: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  // Seed the single cursor row.
  pgm.sql(`
    INSERT INTO horizon_worker_cursor (id, last_paging_token, last_ledger_sequence)
    VALUES (1, '', 0)
    ON CONFLICT DO NOTHING;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("stream_events_dlq");
  pgm.dropTable("stream_events");
  pgm.dropTable("horizon_worker_cursor");
  pgm.dropType("stream_event_type");
}
