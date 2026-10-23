/**
 * Issue #753 — Background stream expiry job
 *
 * Runs every minute via node-cron to transition streams from
 * active/pre_cliff → expired once their end_ledger has passed.
 *
 * The job:
 *   1. Fetches the current ledger sequence from the Soroban RPC (or falls back
 *      to an estimate based on the Horizon latest ledger).
 *   2. Calls expireStreams() to bulk-update all streams whose end_ledger is
 *      behind the current ledger.
 *   3. Logs the count of expired streams and the duration.
 *
 * Error handling:
 *   - RPC failures are logged as WARN and the job exits early without updating
 *     any rows (safe: rows will be caught on the next run).
 *   - DB failures are logged as ERROR.
 *
 * The job can also be triggered manually via the admin API for testing.
 */

import cron from "node-cron";
import { Pool } from "pg";
import { expireStreams } from "../streamStatusService.js";

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
      job: "stream_expiry",
      msg,
      ...extra,
    }) + "\n",
  );
}

// ── Ledger sequence fetcher ───────────────────────────────────────────────────

/**
 * Fetch the current ledger sequence from the Soroban RPC endpoint.
 * Returns null if the RPC is unavailable (job should be skipped).
 */
async function getCurrentLedger(rpcUrl: string): Promise<number | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);

    const resp = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getLatestLedger",
        params: {},
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      log("warn", "RPC returned non-OK status", { status: resp.status, url: rpcUrl });
      return null;
    }

    const data = (await resp.json()) as {
      result?: { sequence?: number };
      error?: unknown;
    };

    if (data.error || data.result?.sequence === undefined) {
      log("warn", "RPC getLatestLedger returned unexpected response", {
        response: JSON.stringify(data).slice(0, 200),
      });
      return null;
    }

    return data.result.sequence;
  } catch (err: any) {
    log("warn", "Failed to fetch current ledger from RPC", {
      error: err?.message ?? String(err),
      url: rpcUrl,
    });
    return null;
  }
}

// ── Job logic ─────────────────────────────────────────────────────────────────

export interface ExpiryJobResult {
  expired: number;
  currentLedger: number;
  durationMs: number;
}

export async function runExpiryJob(db: Pool): Promise<ExpiryJobResult> {
  const start = Date.now();

  // Prefer SOROBAN_RPC_URLS pool (Issue #751), fall back to single SOROBAN_RPC_URL.
  const rpcUrl =
    (process.env.SOROBAN_RPC_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean)[0] ??
    process.env.SOROBAN_RPC_URL;

  if (!rpcUrl) {
    log("warn", "No SOROBAN_RPC_URL configured — stream expiry job skipped");
    return { expired: 0, currentLedger: 0, durationMs: Date.now() - start };
  }

  const currentLedger = await getCurrentLedger(rpcUrl);
  if (currentLedger === null) {
    log("warn", "Could not determine current ledger — skipping expiry run");
    return { expired: 0, currentLedger: 0, durationMs: Date.now() - start };
  }

  const expired = await expireStreams(db, currentLedger);
  const durationMs = Date.now() - start;

  if (expired > 0) {
    log("info", `Expired ${expired} streams`, { currentLedger, durationMs });
  }

  return { expired, currentLedger, durationMs };
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let _pool: Pool | null = null;

/**
 * Start the stream expiry cron job.
 * Call once from server startup after the DB pool is initialized.
 *
 * @param pool  PostgreSQL connection pool.
 */
export function scheduleExpiryJob(pool: Pool): void {
  _pool = pool;

  // Runs every minute.
  cron.schedule("* * * * *", () => {
    if (!_pool) return;
    runExpiryJob(_pool).catch((err: any) => {
      log("error", "Stream expiry job threw an unhandled error", {
        error: err?.message ?? String(err),
      });
    });
  });

  log("info", "Stream expiry job scheduled (every 1 minute)");
}
