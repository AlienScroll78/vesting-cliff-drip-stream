/**
 * Issue 3: Admin internal API
 * Runs on a separate port (default 3002). Secured by HTTP Basic Auth.
 * Not exposed through the public ingress — internal network only.
 *
 * Endpoints:
 *   GET  /admin/indexer/status
 *   POST /admin/indexer/reindex?from_ledger=X
 *   GET  /admin/metrics   (Prometheus text format)
 *
 * Issue #741: Prometheus metrics for the connection pool:
 *   db_pool_active_connections — connections currently checked out
 *   db_pool_idle_connections   — connections waiting in the pool
 *   db_pool_total_connections  — total connections (active + idle)
 *   db_pool_waiting_requests   — requests queued waiting for a connection
 */

import express from "express";
import * as promClient from "prom-client";
import { pool } from "../db.js";
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

// ── Issue #741: DB connection-pool metrics ──────────────────────────────────

/**
 * Active connections — pool clients currently checked out and executing a
 * query.  Computed as: totalCount - idleCount.
 */
const dbPoolActiveConnections = new promClient.Gauge({
  name: "db_pool_active_connections",
  help: "Number of PostgreSQL connections currently checked out from the pool",
  registers: [register],
});

/**
 * Idle connections — clients sitting in the pool ready to be acquired.
 */
const dbPoolIdleConnections = new promClient.Gauge({
  name: "db_pool_idle_connections",
  help: "Number of PostgreSQL connections currently idle in the pool",
  registers: [register],
});

/**
 * Total connections — all open connections (active + idle).
 */
const dbPoolTotalConnections = new promClient.Gauge({
  name: "db_pool_total_connections",
  help: "Total number of open PostgreSQL connections (active + idle)",
  registers: [register],
});

/**
 * Waiting requests — callers blocked waiting for a free connection.
 * Non-zero values indicate pool pressure; should alert when sustained.
 */
const dbPoolWaitingRequests = new promClient.Gauge({
  name: "db_pool_waiting_requests",
  help: "Number of requests waiting for a PostgreSQL connection from the pool",
  registers: [register],
});

/** Refresh pool gauges from the live pg.Pool stats. */
function refreshPoolMetrics(): void {
  const total = pool.totalCount;
  const idle = pool.idleCount;
  const waiting = pool.waitingCount;
  const active = total - idle;

  dbPoolTotalConnections.set(total);
  dbPoolIdleConnections.set(idle);
  dbPoolActiveConnections.set(active);
  dbPoolWaitingRequests.set(waiting);
}

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

  /**
   * GET /admin/metrics — Prometheus text format.
   * Pool gauges are refreshed on every scrape so Grafana always sees live data.
   */
  admin.get("/admin/metrics", async (_req, res) => {
    // Refresh pool metrics immediately before serialising
    refreshPoolMetrics();

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

  /**
   * GET /admin/pool — real-time pool stats in JSON (useful for dashboards
   * and health scripts that prefer JSON over the Prometheus text format).
   */
  admin.get("/admin/pool", (_req, res) => {
    refreshPoolMetrics();
    res.json({
      total: pool.totalCount,
      idle: pool.idleCount,
      active: pool.totalCount - pool.idleCount,
      waiting: pool.waitingCount,
    });
  });

  const ADMIN_PORT = parseInt(process.env.ADMIN_PORT ?? "3002", 10);
  admin.listen(ADMIN_PORT, "127.0.0.1", () => {
    console.log(`[admin] Internal API listening on 127.0.0.1:${ADMIN_PORT}`);
    console.log(`[admin] Pool metrics exposed at /admin/metrics (db_pool_* gauges)`);
  });
}
