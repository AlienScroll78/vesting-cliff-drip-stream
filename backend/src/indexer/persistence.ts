/**
 * backend/src/indexer/persistence.ts
 *
 * PostgreSQL persistence layer for the stream event indexer.
 *
 * Responsibilities:
 *   - Read / write the indexer cursor from `indexer_cursors`
 *   - Batch-upsert decoded events into `stream_events` with idempotency
 *     guarantee (ON CONFLICT (transaction_hash) DO NOTHING)
 *   - For terminal events (StreamCancelled, StreamClawedBack), atomically
 *     update the stream status and record terminal event details in the
 *     same transaction
 *
 * All writes run inside a single transaction so a partial batch never
 * leaves the database in an inconsistent state.
 */

import { Pool } from 'pg';
import type { DecodedStreamEvent } from './types.js';
import { handleTerminalEvent } from './terminalEventHandlers.js';

// ── Cursor management ─────────────────────────────────────────────────────────

/**
 * Read the current Horizon paging_token cursor from `indexer_cursors`.
 * Returns an empty string when no cursor has been saved yet (fresh start).
 */
export async function readCursor(pool: Pool): Promise<string> {
  const result = await pool.query<{ cursor: string }>(
    'SELECT cursor FROM indexer_cursors WHERE id = 1',
  );
  return result.rows[0]?.cursor ?? '';
}

/**
 * Persist the latest processed Horizon paging_token to `indexer_cursors`.
 */
export async function writeCursor(pool: Pool, cursor: string): Promise<void> {
  await pool.query(
    `UPDATE indexer_cursors
        SET cursor     = $1,
            updated_at = now()
      WHERE id = 1`,
    [cursor],
  );
}

// ── Event upsert ──────────────────────────────────────────────────────────────

const INSERT_SQL = `
  INSERT INTO stream_events
    (event_type, recipient, sponsor, token, amount,
     ledger_sequence, transaction_hash)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (transaction_hash) DO NOTHING
`;

/**
 * Batch-upsert decoded events into `stream_events`.
 *
 * Runs all inserts inside a single transaction.  The unique constraint on
 * `transaction_hash` means duplicate events (re-processed after a restart)
 * are silently skipped via `DO NOTHING`.
 *
 * For terminal events (StreamCancelled, StreamClawedBack), the stream status
 * is updated and terminal event details are recorded atomically in the same
 * transaction — but only for rows that were actually inserted (not duplicates).
 * This ensures idempotency: re-processing the same event does not re-apply
 * the status transition.
 *
 * @returns The number of rows actually inserted (rows skipped by DO NOTHING
 *          are NOT counted).
 */
export async function upsertStreamEvents(
  pool: Pool,
  events: DecodedStreamEvent[],
): Promise<number> {
  if (events.length === 0) return 0;

  const client = await pool.connect();
  let inserted = 0;

  try {
    await client.query('BEGIN');

    for (const ev of events) {
      const result = await client.query(INSERT_SQL, [
        ev.event_type,
        ev.recipient,
        ev.sponsor,
        ev.token,
        ev.amount,           // string or null → PostgreSQL NUMERIC
        ev.ledger_sequence,
        ev.transaction_hash,
      ]);

      // Only apply terminal event handlers for rows that were actually
      // inserted (not duplicates skipped by ON CONFLICT DO NOTHING).
      if ((result.rowCount ?? 0) > 0) {
        // ── Terminal events: update stream status & record details ──────
        if (ev.event_type === 'StreamCancelled' || ev.event_type === 'StreamClawedBack') {
          await handleTerminalEvent(client, ev);
        }
      }

      inserted += result.rowCount ?? 0;
    }

    await client.query('COMMIT');
    return inserted;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
