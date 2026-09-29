/**
 * Admin — Indexer management endpoints.
 *
 *   GET  /admin/indexer/status   — returns current lag, cursor, and error count
 *   POST /admin/indexer/restart  — signals the indexer to stop and restart
 */

import { Router, type Request, type Response } from "express";
import { Pool } from "pg";

// ── DB pool (lazy singleton) ──────────────────────────────────────────────────

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

// ── In-process indexer state tracking ────────────────────────────────────────
// The EventIndexer class in ../indexer.ts manages its own lifecycle.
// We expose a lightweight control interface here so admin endpoints can
// read state and request a restart without importing the full module.

interface IndexerStatus {
  status: "running" | "stopped" | "error";
  lastCursor: string;
  lastIndexedLedger: number;
  chainTipLedger: number;
  lagLedgers: number;
  errorCount: number;
  lastError: string | null;
  uptimeSeconds: number | null;
}

// Mutable state updated by the indexer integration (see server.ts mount).
export const indexerState: IndexerStatus = {
  status: "stopped",
  lastCursor: "",
  lastIndexedLedger: 0,
  chainTipLedger: 0,
  lagLedgers: 0,
  errorCount: 0,
  lastError: null,
  uptimeSeconds: null,
};

let startedAt: number | null = null;

/** Call this when the indexer starts to record uptime. */
export function markIndexerStarted(): void {
  indexerState.status = "running";
  startedAt = Date.now();
}

/** Call this when the indexer stops or errors. */
export function markIndexerStopped(error?: string): void {
  indexerState.status = error ? "error" : "stopped";
  if (error) {
    indexerState.lastError = error;
    indexerState.errorCount += 1;
  }
  startedAt = null;
}

/** Refresh state from the DB cursor table (best-effort). */
async function refreshFromDb(): Promise<void> {
  try {
    const pool = getPool();
    const result = await pool.query(
      "SELECT cursor FROM indexer_cursor WHERE id = 1",
    );
    if (result.rows.length > 0) {
      indexerState.lastCursor = result.rows[0].cursor ?? "";
    }
  } catch {
    // Non-fatal — status endpoint degrades gracefully.
  }
}

// ── Restart control ───────────────────────────────────────────────────────────

// Holder for the restart callback registered by the indexer at startup.
let _restartFn: (() => Promise<void>) | null = null;

/** Register a restart function so the admin endpoint can trigger it. */
export function registerIndexerRestart(fn: () => Promise<void>): void {
  _restartFn = fn;
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function statusHandler(_req: Request, res: Response): Promise<void> {
  await refreshFromDb();

  if (startedAt !== null) {
    indexerState.uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
  }

  res.status(200).json({ ...indexerState });
}

async function restartHandler(_req: Request, res: Response): Promise<void> {
  if (!_restartFn) {
    // No restart function registered — running in a context without an
    // active indexer (e.g. test environment).  Return a sensible response.
    indexerState.status = "stopped";
    markIndexerStopped();
    res.status(200).json({ ok: true, message: "Indexer restart signalled (no active indexer)" });
    return;
  }

  try {
    await _restartFn();
    res.status(200).json({ ok: true, message: "Indexer restarted successfully" });
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? String(err);
    markIndexerStopped(msg);
    res.status(500).json({ error: `Restart failed: ${msg}` });
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export const indexerRouter = Router();
indexerRouter.get("/status", statusHandler);
indexerRouter.post("/restart", restartHandler);

// Export handlers for testing
export { statusHandler, restartHandler };
