/**
 * Migration 004 – create webhook_dead_letter_queue table  (Issue #552)
 *
 * Stores webhook deliveries that have permanently failed after all retry
 * attempts are exhausted.  Admin operators can inspect and replay items
 * via POST /admin/webhooks/dlq/replay.
 */

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("webhook_dead_letter_queue", (table) => {
    table.increments("id").primary();

    /** The destination URL that rejected (or failed to receive) the payload. */
    table.string("webhook_url", 2048).notNullable();

    /** The full JSON payload that was attempted. */
    table.jsonb("payload").notNullable();

    /** Human-readable error message from the last failed attempt. */
    table.text("last_error").notNullable();

    /** Number of delivery attempts made before giving up. */
    table
      .integer("retry_count")
      .notNullable()
      .defaultTo(0)
      .checkPositive();

    /** Timestamp when the item was moved to the DLQ. */
    table.timestamp("failed_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    /** Timestamp of the most recent manual replay attempt (null if never replayed). */
    table.timestamp("last_retry_at", { useTz: true }).nullable();
  });

  // Index for fast lookup by URL (useful when bulk-replaying a failing endpoint)
  await knex.schema.raw(
    `CREATE INDEX idx_wdlq_webhook_url ON webhook_dead_letter_queue (webhook_url)`
  );

  // Index for time-based queries (newest failures first)
  await knex.schema.raw(
    `CREATE INDEX idx_wdlq_failed_at ON webhook_dead_letter_queue (failed_at DESC)`
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("webhook_dead_letter_queue");
}
