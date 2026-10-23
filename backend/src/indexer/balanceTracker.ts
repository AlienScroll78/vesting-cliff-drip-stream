/**
 * backend/src/indexer/balanceTracker.ts  (#996)
 *
 * Stream balance tracking for the event indexer.
 *
 * When a TokensClaimed event is inserted, this module atomically updates
 * the `stream_balances` table to maintain a running `claimed_total` per
 * stream.  The remaining balance is computed as:
 *   remaining = total_deposit − claimed_total
 *
 * Both raw fields (rate, total_duration) are stored on the balance row so
 * the balance can be recomputed from first principles during reconciliation.
 *
 * The balance update runs inside the same database transaction as the
 * event insert so that the balance and event log are always consistent.
 */

import type { Pool, PoolClient } from "pg";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StreamBalance {
  stream_id: string;
  total_deposit: string;
  claimed_total: string;
  remaining: string;
  rate: string | null;
  total_duration: number | null;
  updated_at: string;
}

export interface BalanceUpdateResult {
  stream_id: string;
  claimed_total: string;
  remaining: string;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialise (or update) a stream balance row from a StreamCreated event.
 *
 * This must be called when the indexer processes a StreamCreated event to
 * populate the total_deposit, rate, and total_duration fields.
 *
 * If the row already exists (re-processed event), it is updated idempotently.
 *
 * @param client  A connected PoolClient (must be inside a transaction).
 * @param streamId  Recipient address identifying the stream.
 * @param totalDeposit  Total deposit amount (decimal string).
 * @param rate  Tokens per ledger (decimal string).
 * @param totalDuration  Total stream length in ledgers.
 */
export async function initStreamBalance(
  client: PoolClient,
  streamId: string,
  totalDeposit: string,
  rate: string,
  totalDuration: number,
): Promise<void> {
  await client.query(
    `INSERT INTO stream_balances (stream_id, total_deposit, claimed_total, remaining, rate, total_duration, updated_at)
     VALUES ($1, $2, 0, $2, $3, $4, now())
     ON CONFLICT (stream_id) DO UPDATE
       SET total_deposit = EXCLUDED.total_deposit,
           rate           = EXCLUDED.rate,
           total_duration = EXCLUDED.total_duration,
           remaining      = EXCLUDED.total_deposit - stream_balances.claimed_total,
           updated_at     = now()`,
    [streamId, totalDeposit, rate, totalDuration],
  );
}

/**
 * Atomically increment the claimed_total for a stream and recompute remaining.
 *
 * This must be called inside the same transaction as the event insert to
 * guarantee atomicity (single transaction: event + balance update).
 *
 * If no balance row exists yet (e.g. StreamCreated not yet processed), a
 * row is created with claimed_total = amount and total_deposit = 0; it will
 * be corrected when the StreamCreated event is processed.
 *
 * @param client  A connected PoolClient (must be inside a transaction).
 * @param streamId  Recipient address identifying the stream.
 * @param amount  Claim amount as a decimal string (i128 safe).
 * @returns The updated claimed_total and remaining values.
 */
export async function incrementClaimedTotal(
  client: PoolClient,
  streamId: string,
  amount: string,
): Promise<BalanceUpdateResult> {
  // Upsert: if the row exists, increment claimed_total; otherwise create one.
  const result = await client.query<{ claimed_total: string; remaining: string }>(
    `INSERT INTO stream_balances (stream_id, total_deposit, claimed_total, remaining, updated_at)
     VALUES ($1, 0, $2, -$2, now())
     ON CONFLICT (stream_id) DO UPDATE
       SET claimed_total = stream_balances.claimed_total + $2,
           remaining     = stream_balances.total_deposit - (stream_balances.claimed_total + $2),
           updated_at    = now()
     RETURNING claimed_total::text, remaining::text`,
    [streamId, amount],
  );

  return {
    stream_id: streamId,
    claimed_total: result.rows[0].claimed_total,
    remaining: result.rows[0].remaining,
  };
}

/**
 * Read the current balance for a stream.
 *
 * @param pool  PostgreSQL connection pool.
 * @param streamId  Recipient address identifying the stream.
 * @returns The balance row, or null if no balance exists.
 */
export async function getStreamBalance(
  pool: Pool,
  streamId: string,
): Promise<StreamBalance | null> {
  const result = await pool.query(
    `SELECT stream_id,
            total_deposit::text,
            claimed_total::text,
            remaining::text,
            rate::text,
            total_duration,
            updated_at::text
     FROM stream_balances
     WHERE stream_id = $1`,
    [streamId],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    stream_id: row.stream_id,
    total_deposit: row.total_deposit,
    claimed_total: row.claimed_total,
    remaining: row.remaining,
    rate: row.rate,
    total_duration: row.total_duration,
    updated_at: row.updated_at,
  };
}

/**
 * Recompute the balance from scratch using all stream_events rows.
 *
 * This is used by the daily reconciliation job to verify that the DB balance
 * matches the on-chain claimable_amount view.  It sums all vc_claim events
 * for the given recipient and updates the balance row.
 *
 * @param pool  PostgreSQL connection pool.
 * @param streamId  Recipient address identifying the stream.
 * @returns The recomputed balance, or null if no events exist.
 */
export async function recomputeBalance(
  pool: Pool,
  streamId: string,
): Promise<BalanceUpdateResult | null> {
  // Sum all claim event amounts for this recipient
  const sumResult = await pool.query<{ total_claimed: string | null }>(
    `SELECT COALESCE(SUM(amount::numeric), 0)::text AS total_claimed
     FROM stream_events
     WHERE recipient = $1 AND event_type = 'TokensClaimed'`,
    [streamId],
  );

  const claimedTotal = sumResult.rows[0]?.total_claimed ?? "0";

  // Fetch the total_deposit from the balance row (set by StreamCreated)
  const balanceResult = await pool.query<{ total_deposit: string }>(
    `SELECT total_deposit::text FROM stream_balances WHERE stream_id = $1`,
    [streamId],
  );

  if (balanceResult.rows.length === 0) {
    // No balance row — create one from the recomputed claim total
    await pool.query(
      `INSERT INTO stream_balances (stream_id, total_deposit, claimed_total, remaining, updated_at)
       VALUES ($1, 0, $2, -$2, now())
       ON CONFLICT (stream_id) DO UPDATE
         SET claimed_total = $2,
             remaining     = stream_balances.total_deposit - $2,
             updated_at    = now()`,
      [streamId, claimedTotal],
    );
  } else {
    const totalDeposit = balanceResult.rows[0].total_deposit;
    const remaining = (BigInt(totalDeposit) - BigInt(claimedTotal)).toString();

    await pool.query(
      `UPDATE stream_balances
       SET claimed_total = $2,
           remaining     = $3,
           updated_at    = now()
       WHERE stream_id = $1`,
      [streamId, claimedTotal, remaining],
    );
  }

  // Read back the result
  const finalResult = await pool.query<{ claimed_total: string; remaining: string }>(
    `SELECT claimed_total::text, remaining::text
     FROM stream_balances
     WHERE stream_id = $1`,
    [streamId],
  );

  if (finalResult.rows.length === 0) return null;

  return {
    stream_id: streamId,
    claimed_total: finalResult.rows[0].claimed_total,
    remaining: finalResult.rows[0].remaining,
  };
}
