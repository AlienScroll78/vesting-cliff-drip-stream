/**
 * backend/src/jobs/balanceReconciliation.ts  (#996)
 *
 * Daily reconciliation job that verifies the DB balance (stream_balances
 * table) matches the on-chain claimable_amount view.
 *
 * The job:
 *   1. Fetches all stream_balances rows.
 *   2. For each stream, recomputes the claimed_total from stream_events
 *      and compares it to the stored value.
 *   3. If there is a discrepancy, logs a warning and corrects the balance.
 *
 * This is a safety net: under normal operation the atomic transaction in
 * upsertStreamEvents() keeps the balance in sync.  The reconciliation job
 * catches drift caused by:
 *   - Manual database edits
 *   - Out-of-order event processing
 *   - Bugs in the indexer
 *
 * The job can also be triggered manually via the admin API.
 */

import cron from "node-cron";
import { Pool } from "pg";
import { recomputeBalance } from "../indexer/balanceTracker.js";

// ── Logger ────────────────────────────────────────────────────────────────────

function log(
  level: "info" | "warn" | "error",
  msg: string,
  extra?: object,
): void {
  process.stderr.write(
    JSON.stringify({
      level,
      time: new Date().toISOString(),
      job: "balance_reconciliation",
      msg,
      ...extra,
    }) + "\n",
  );
}

// ── Reconciliation result ─────────────────────────────────────────────────────

export interface ReconciliationResult {
  checked: number;
  corrected: number;
  errors: number;
  durationMs: number;
}

// ── Core reconciliation logic ──────────────────────────────────────────────────

/**
 * Run the balance reconciliation for all streams in the database.
 *
 * @param db  PostgreSQL connection pool.
 * @returns Summary of checked/corrected/error counts.
 */
export async function runBalanceReconciliation(db: Pool): Promise<ReconciliationResult> {
  const start = Date.now();
  let checked = 0;
  let corrected = 0;
  let errors = 0;

  try {
    // Fetch all stream balance rows
    const balanceRows = await db.query<{ stream_id: string; claimed_total: string }>(
      `SELECT stream_id, claimed_total::text
       FROM stream_balances`,
    );

    for (const row of balanceRows.rows) {
      checked++;

      try {
        // Recompute the balance from stream_events
        const recomputed = await recomputeBalance(db, row.stream_id);

        if (!recomputed) {
          log("warn", `No events found for stream ${row.stream_id} during reconciliation`);
          continue;
        }

        // Compare recomputed claimed_total to stored value
        const storedTotal = BigInt(row.claimed_total);
        const recomputedTotal = BigInt(recomputed.claimed_total);

        if (storedTotal !== recomputedTotal) {
          corrected++;
          log("warn", `Balance drift detected for stream ${row.stream_id}`, {
            stored: row.claimed_total,
            recomputed: recomputed.claimed_total,
            corrected: true,
          });
        }
      } catch (err: any) {
        errors++;
        log("error", `Reconciliation failed for stream ${row.stream_id}`, {
          error: err?.message ?? String(err),
        });
      }
    }

    const durationMs = Date.now() - start;
    log("info", `Reconciliation complete`, { checked, corrected, errors, durationMs });

    return { checked, corrected, errors, durationMs };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    log("error", "Reconciliation job failed", {
      error: err?.message ?? String(err),
      durationMs,
    });
    return { checked, corrected, errors: errors + 1, durationMs };
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let _pool: Pool | null = null;

/**
 * Start the balance reconciliation cron job.
 * Runs daily at 02:30 UTC (offset from the drift-detection workflow at 02:00).
 *
 * @param pool  PostgreSQL connection pool.
 */
export function scheduleBalanceReconciliation(pool: Pool): void {
  _pool = pool;

  cron.schedule("30 2 * * *", () => {
    if (!_pool) return;
    runBalanceReconciliation(_pool).catch((err: any) => {
      log("error", "Balance reconciliation job threw an unhandled error", {
        error: err?.message ?? String(err),
      });
    });
  });

  log("info", "Balance reconciliation job scheduled (daily at 02:30 UTC)");
}
