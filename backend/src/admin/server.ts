/**
 * Issue 3: Admin internal API
 * Runs on a separate port (default 3002). Secured by HTTP Basic Auth.
 * Not exposed through the public ingress — internal network only.
 *
 * Endpoints:
 *   GET  /admin/indexer/status
 *   POST /admin/indexer/reindex?from_ledger=X
 *   GET  /admin/metrics   (Prometheus text format)
 *   GET  /admin/webhooks/dlq              list DLQ items  (Issue #552)
 *   POST /admin/webhooks/dlq/replay       replay all DLQ items  (Issue #552)
 *   POST /admin/webhooks/dlq/:id/replay   replay one DLQ item  (Issue #552)
 *   DELETE /admin/webhooks/dlq/:id        delete one DLQ item  (Issue #552)
 */

import express from "express";
import * as promClient from "prom-client";
import { runStreamCleanup } from "../jobs/streamCleanup.js";
import { networkConfig } from "../config/network.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { replayDlqItem } = require("../webhookWorker.js") as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { pool } = require("../db.js") as any;

// ---------------------------------------------------------------------------
// Prometheus metrics
// ---------------------------------------------------------------------------

const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

const indexerLag = new promClient.Gauge({
  name: "indexer_lag_ledgers",
  help: "Number of ledgers the indexer is behind the chain tip",
  registers: [register],
});

const reindexTotal = new promClient.Counter({
  name: "indexer_reindex_total",
  help: "Total number of reindex operations triggered",
  registers: [register],
});

// ---------------------------------------------------------------------------
// Indexer state (stub — replace with real indexer state)
// ---------------------------------------------------------------------------

let indexerState = {
  status: "ok" as "ok" | "degraded" | "down",
  lastIndexedLedger: 51_203_447,
  chainTipLedger: 51_203_450,
  lastReindexFrom: null as number | null,
};

indexerLag.set(
  indexerState.chainTipLedger - indexerState.lastIndexedLedger
);

// ---------------------------------------------------------------------------
// Basic auth middleware
// ---------------------------------------------------------------------------

const ADMIN_USER = process.env.ADMIN_USER ?? "admin";
const ADMIN_PASS = process.env.ADMIN_PASS ?? "changeme";

function basicAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="admin"');
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const decoded = Buffer.from(auth.slice(6), "base64").toString();
  const [user, pass] = decoded.split(":");
  if (user !== ADMIN_USER || pass !== ADMIN_PASS) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Admin Express app
// ---------------------------------------------------------------------------

export function startAdminServer(): void {
  const admin = express();
  admin.use(express.json());
  admin.use(basicAuth);

  /** GET /admin/indexer/status */
  admin.get("/admin/indexer/status", (_req, res) => {
    const lag = indexerState.chainTipLedger - indexerState.lastIndexedLedger;
    indexerLag.set(lag);
    res.json({
      ...indexerState,
      lag,
      network: networkConfig.network,
    });
  });

  /**
   * POST /admin/indexer/reindex?from_ledger=X
   * Idempotent: re-triggering with the same from_ledger is safe.
   */
  admin.post("/admin/indexer/reindex", (req, res) => {
    const fromLedger = parseInt(
      (req.query.from_ledger as string | undefined) ?? "0",
      10
    );
    if (!fromLedger || fromLedger <= 0) {
      res.status(400).json({ error: "from_ledger must be a positive integer" });
      return;
    }

    reindexTotal.inc();
    indexerState.lastReindexFrom = fromLedger;

    // Stub: kick off real reindex process here
    console.log(`[admin] Reindex requested from ledger ${fromLedger}`);

    res.json({ ok: true, fromLedger });
  });

  /** GET /admin/metrics — Prometheus text format */
  admin.get("/admin/metrics", async (_req, res) => {
    res.set("Content-Type", register.contentType);
    res.send(await register.metrics());
  });

  /** POST /admin/cleanup — manual trigger for stream cleanup */
  admin.post("/admin/cleanup", async (_req, res) => {
    try {
      const result = await runStreamCleanup();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Webhook DLQ endpoints (Issue #552) ─────────────────────────────────

  /** GET /admin/webhooks/dlq — list all DLQ items (newest first, max 200) */
  admin.get("/admin/webhooks/dlq", async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, webhook_url, last_error, retry_count, failed_at, last_retry_at
           FROM webhook_dead_letter_queue
          ORDER BY failed_at DESC
          LIMIT 200`
      );
      res.json({ total: rows.length, items: rows });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** POST /admin/webhooks/dlq/replay — replay ALL DLQ items */
  admin.post("/admin/webhooks/dlq/replay", async (_req, res) => {
    const secret = process.env.WEBHOOK_SECRET ?? "";
    try {
      const { rows } = await pool.query(
        "SELECT id FROM webhook_dead_letter_queue ORDER BY failed_at ASC"
      );
      const results: Array<{ id: number; ok: boolean; error?: string }> = [];
      for (const row of rows as Array<{ id: number }>) {
        const result = await replayDlqItem(row.id, secret);
        results.push({ id: row.id, ...result });
      }
      const succeeded = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok).length;
      res.json({ replayed: results.length, succeeded, failed, results });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** POST /admin/webhooks/dlq/:id/replay — replay a single DLQ item */
  admin.post("/admin/webhooks/dlq/:id/replay", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "id must be a positive integer" });
      return;
    }
    const secret = process.env.WEBHOOK_SECRET ?? "";
    try {
      const result = await replayDlqItem(id, secret);
      res.json(result);
    } catch (err) {
      res.status(404).json({ error: String(err) });
    }
  });

  /** DELETE /admin/webhooks/dlq/:id — discard a DLQ item */
  admin.delete("/admin/webhooks/dlq/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "id must be a positive integer" });
      return;
    }
    try {
      const result = await pool.query(
        "DELETE FROM webhook_dead_letter_queue WHERE id = $1 RETURNING id",
        [id]
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: `DLQ item ${id} not found` });
        return;
      }
      res.json({ ok: true, deleted: id });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  const ADMIN_PORT = parseInt(process.env.ADMIN_PORT ?? "3002", 10);
  admin.listen(ADMIN_PORT, "127.0.0.1", () => {
    console.log(`[admin] Internal API listening on 127.0.0.1:${ADMIN_PORT}`);
  });
}
