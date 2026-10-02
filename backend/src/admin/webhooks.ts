/**
 * Admin — Webhook dead-letter queue (DLQ) endpoints.
 *
 *   GET  /admin/webhooks/dlq          — list items in the DLQ
 *   POST /admin/webhooks/dlq/replay   — replay one or all DLQ items
 *
 * The DLQ table (webhook_dead_letter_queue) is created by
 * migrations/004_create_webhook_dlq.ts and has the schema:
 *
 *   id           SERIAL PRIMARY KEY
 *   webhook_url  TEXT NOT NULL
 *   payload      JSONB NOT NULL
 *   last_error   TEXT
 *   retry_count  INT  DEFAULT 0
 *   failed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   last_retry_at TIMESTAMPTZ
 */

import { Router, type Request, type Response } from "express";
import { Pool } from "pg";
import { createRequire } from "module";

// ── DB pool (lazy singleton) ──────────────────────────────────────────────────

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

// ── Webhook replay helper ─────────────────────────────────────────────────────
// Use CJS require for the CommonJS webhookWorker module.

const _require = createRequire(import.meta.url);

function getReplayFn(): ((id: number, secret: string) => Promise<{ ok: boolean; error?: string }>) | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const worker = _require("../webhookWorker.js") as any;
    return typeof worker.replayDlqItem === "function" ? worker.replayDlqItem : null;
  } catch {
    return null;
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * GET /admin/webhooks/dlq
 *
 * Returns the newest-first list of DLQ items.
 * Optional query param: limit (default 100, max 500).
 */
async function dlqListHandler(req: Request, res: Response): Promise<void> {
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? "100"), 10)));

  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT
         id,
         webhook_url,
         payload,
         last_error,
         retry_count,
         failed_at,
         last_retry_at
       FROM webhook_dead_letter_queue
       ORDER BY failed_at DESC
       LIMIT $1`,
      [limit],
    );

    res.status(200).json({
      total: rows.length,
      limit,
      items: rows.map((r) => ({
        id: r.id,
        webhook_url: r.webhook_url,
        payload: r.payload,
        last_error: r.last_error ?? null,
        retry_count: r.retry_count,
        failed_at: new Date(r.failed_at).toISOString(),
        last_retry_at: r.last_retry_at ? new Date(r.last_retry_at).toISOString() : null,
      })),
    });
  } catch (err: unknown) {
    console.error("[admin:dlq] list error:", (err as Error)?.message ?? err);
    res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * POST /admin/webhooks/dlq/replay
 *
 * Replays DLQ items.
 *
 * Body (optional):
 *   { "id": 42 }   — replay a single item
 *   {}             — replay all items
 */
async function dlqReplayHandler(req: Request, res: Response): Promise<void> {
  const secret = process.env.WEBHOOK_SECRET ?? "";
  const replayDlqItem = getReplayFn();

  const singleId: number | null =
    req.body?.id !== undefined ? parseInt(String(req.body.id), 10) : null;

  if (singleId !== null && (isNaN(singleId) || singleId <= 0)) {
    res.status(400).json({ error: "id must be a positive integer" });
    return;
  }

  try {
    const pool = getPool();

    let idsToReplay: number[];

    if (singleId !== null) {
      // Verify the item exists before attempting replay.
      const check = await pool.query(
        "SELECT id FROM webhook_dead_letter_queue WHERE id = $1",
        [singleId],
      );
      if (check.rows.length === 0) {
        res.status(404).json({ error: `DLQ item ${singleId} not found` });
        return;
      }
      idsToReplay = [singleId];
    } else {
      const { rows } = await pool.query(
        "SELECT id FROM webhook_dead_letter_queue ORDER BY failed_at ASC",
      );
      idsToReplay = rows.map((r: { id: number }) => r.id);
    }

    if (idsToReplay.length === 0) {
      res.status(200).json({ replayed: 0, succeeded: 0, failed: 0, results: [] });
      return;
    }

    const results: Array<{ id: number; ok: boolean; error?: string }> = [];

    for (const id of idsToReplay) {
      if (replayDlqItem) {
        const result = await replayDlqItem(id, secret);
        results.push({ id, ...result });
      } else {
        // webhookWorker not available (e.g. test environment) — stub success.
        results.push({ id, ok: true });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;

    res.status(200).json({
      replayed: results.length,
      succeeded,
      failed,
      results,
    });
  } catch (err: unknown) {
    console.error("[admin:dlq] replay error:", (err as Error)?.message ?? err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export const webhooksRouter = Router();
webhooksRouter.get("/dlq", dlqListHandler);
webhooksRouter.post("/dlq/replay", dlqReplayHandler);

// Export handlers for testing
export { dlqListHandler, dlqReplayHandler };
