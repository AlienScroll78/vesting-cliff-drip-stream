/**
 * migrations/006_create_stream_events_and_cursors.ts
 *
 * Creates the `stream_events` table for persisting decoded Horizon contract
 * events and the `indexer_cursors` table for tracking poll position so the
 * indexer can resume after a restart without re-processing historical events.
 *
 * Schema follows the spec requirements:
 *   - stream_events: typed event rows with participant addresses, amounts,
 *     ledger position, and transaction hash (unique, used for deduplication)
 *   - indexer_cursors: single-row cursor store keyed by id=1
 *
 * Idempotent: uses IF NOT EXISTS / IF EXISTS guards throughout.
 */

import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // ── stream_events ──────────────────────────────────────────────────────────
  // Stores one row per decoded on-chain contract event.  The transaction_hash
  // uniqueness constraint prevents duplicate ingestion when the indexer
  // re-processes the same Horizon page after a restart.
  pgm.createTable(
    'stream_events',
    {
      id: {
        type: 'bigserial',
        primaryKey: true,
        notNull: true,
      },

      // Event classification
      event_type: {
        type: 'text',
        notNull: true,
        comment: 'StreamCreated | TokensClaimed | StreamCancelled | StreamClawedBack | StreamDrained',
      },

      // Participant addresses (Stellar G… / C… strkeys stored as text)
      recipient: { type: 'text', notNull: true },
      sponsor:   { type: 'text', notNull: true },
      token:     { type: 'text', notNull: true },

      // Numeric payload — NUMERIC preserves i128 precision from Soroban
      amount: {
        type: 'numeric',
        notNull: false,
        comment: 'Token amount for claim/cancel/clawback/drain events; null for StreamCreated',
      },

      // Chain position
      ledger_sequence: {
        type: 'integer',
        notNull: true,
        comment: 'Stellar ledger sequence number when this event was emitted',
      },
      transaction_hash: {
        type: 'text',
        notNull: true,
        comment: 'SHA-256 transaction hash; unique constraint prevents duplicate ingestion',
      },

      // Timestamps
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
    },
    { ifNotExists: true },
  );

  // Unique constraint on transaction_hash — primary deduplication guard
  pgm.createIndex('stream_events', 'transaction_hash', {
    name: 'uq_stream_events_tx_hash',
    unique: true,
    ifNotExists: true,
  });

  // Covering index for recipient-based queries (most common API access pattern)
  pgm.createIndex('stream_events', 'recipient', {
    name: 'idx_stream_events_recipient',
    ifNotExists: true,
  });

  // Index for event-type filtering
  pgm.createIndex('stream_events', 'event_type', {
    name: 'idx_stream_events_event_type',
    ifNotExists: true,
  });

  // Index for cursor-based pagination and backfill queries
  pgm.createIndex('stream_events', 'ledger_sequence', {
    name: 'idx_stream_events_ledger',
    ifNotExists: true,
  });

  // ── indexer_cursors ────────────────────────────────────────────────────────
  // Single-row table (id=1) that stores the last Horizon paging_token
  // successfully processed.  On restart the indexer reads this value and
  // resumes from that position rather than replaying from genesis.
  pgm.createTable(
    'indexer_cursors',
    {
      id: {
        type: 'integer',
        primaryKey: true,
        default: 1,
        notNull: true,
      },
      cursor: {
        type: 'text',
        notNull: true,
        default: "''",
        comment: 'Horizon paging_token of the last successfully processed event page',
      },
      updated_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
    },
    { ifNotExists: true },
  );

  // Seed the single control row so the indexer can always do UPDATE … WHERE id=1
  pgm.sql(`
    INSERT INTO indexer_cursors (id, cursor, updated_at)
    VALUES (1, '', now())
    ON CONFLICT (id) DO NOTHING;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('indexer_cursors', { ifExists: true });
  pgm.dropTable('stream_events',   { ifExists: true });
}
