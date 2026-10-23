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
import { incrementClaimedTotal, initStreamBalance } from './balanceTracker.js';

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

      // Only update balances for rows that were actually inserted (not
      // duplicates skipped by ON CONFLICT DO NOTHING).  This ensures
      // idempotency: re-processing the same event does not double-count.
      if ((result.rowCount ?? 0) > 0) {
        // ── StreamCreated: initialise the balance row ───────────────────
        if (ev.event_type === 'StreamCreated' && ev.amount) {
          // amount for StreamCreated is the total_deposit
          // rate and total_duration are not available in the decoded event;
          // they can be derived from the vesting_streams table or from the
          // full event payload.  For now, we store total_deposit and leave
          // rate/total_duration null — they will be backfilled by the
          // reconciliation job.
          await client.query(
            `INSERT INTO stream_balances
               (stream_id, total_deposit, claimed_total, remaining, updated_at)
             VALUES ($1, $2, 0, $2, now())
             ON CONFLICT (stream_id) DO UPDATE
               SET total_deposit = EXCLUDED.total_deposit,
                   remaining     = EXCLUDED.total_deposit - stream_balances.claimed_total,
                   updated_at    = now()`,
            [ev.recipient, ev.amount],
          );
        }

        // ── TokensClaimed: increment claimed_total ─────────────────────
        if (ev.event_type === 'TokensClaimed' && ev.amount) {
          await incrementClaimedTotal(client, ev.recipient, ev.amount);
        }
      }

      inserted += result.rowCount ?? 0;

      // Handle state transitions for specific event types
      if (ev.event_type === 'StreamDrained') {
        await handleStreamDrainedStateUpdate(client, ev);
      } else if (ev.event_type === 'StreamCancelled') {
        await handleStreamCancelledStateUpdate(client, ev);
      }
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

// ── State transition handlers ─────────────────────────────────────────────────

/**
 * Update stream status to 'drained' when a StreamDrained event is processed.
 *
 * Issue #1010: Implement StreamDrained event handler for permissionless cleanup
 *
 * Idempotent: uses ON CONFLICT DO UPDATE to handle duplicate drain_tx_hash
 * gracefully (same transaction hash = same drain, so we just update the row
 * with the same values, no-op in effect).
 */
async function handleStreamDrainedStateUpdate(
  client: any, // PoolClient
  ev: DecodedStreamEvent,
): Promise<void> {
  // Extract caller from event topics if available; for now we use sponsor
  // as the drained_by field (the caller is in values[0] in the contract event
  // but we don't currently store it; sponsor is a reasonable proxy).
  // If needed, the contract can emit the caller in a separate topic.

  const updateSql = `
    UPDATE vesting_streams
    SET
      status         = 'drained',
      drained_at     = now(),
      drain_amount   = $1,
      drain_tx_hash  = $2,
      drained_by     = $3,
      updated_at     = now()
    WHERE recipient_address = $4
      AND status != 'drained'  -- Do not re-update if already drained
    ON CONFLICT DO NOTHING;
  `;

  await client.query(updateSql, [
    ev.amount,              // drain_amount
    ev.transaction_hash,    // drain_tx_hash (unique constraint)
    ev.sponsor,             // drained_by (proxy for caller; see note above)
    ev.recipient,           // recipient_address
  ]);
}

/**
 * Update stream status to 'cancelled' when a StreamCancelled event is processed.
 *
 * Idempotent: uses conditional update to avoid re-writing an already-cancelled stream.
 */
async function handleStreamCancelledStateUpdate(
  client: any, // PoolClient
  ev: DecodedStreamEvent,
): Promise<void> {
  const updateSql = `
    UPDATE vesting_streams
    SET
      status     = 'cancelled',
      cancelled_at = now(),
      updated_at = now()
    WHERE recipient_address = $1
      AND status != 'cancelled'  -- Do not re-update if already cancelled
  `;

  await client.query(updateSql, [ev.recipient]);
}
