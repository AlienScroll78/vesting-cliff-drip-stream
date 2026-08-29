/**
 * Issue #35 / #555: Health and readiness endpoints.
 *
 * GET /health — liveness probe; checks DB connectivity.
 *   - 200  { status: 'ok',  db: 'connected', version, uptime }
 *   - 503  { status: 'error', db: 'disconnected', version, uptime }
 *
 * GET /ready  — readiness probe; checks DB + optional RPC.
 *   - 200  { status: 'ok',      checks: { db: 'ok', ... }, version, uptime }
 *   - 503  { status: 'degraded', checks: { db: 'error', ... }, version, uptime }
 */

import type { Request, Response } from "express";
import { checkDbHealth } from "../database.js";

const START_TIME = Date.now();
const VERSION =
  process.env.npm_package_version ?? process.env.SERVICE_VERSION ?? "unknown";

function uptimeSeconds(): number {
  return Math.floor((Date.now() - START_TIME) / 1000);
}

// ── GET /health ───────────────────────────────────────────────────────────────

/**
 * Liveness probe — always 200 if the process is alive; checks DB connectivity
 * and reflects the result in the response body and HTTP status code.
 */
export async function healthHandler(_req: Request, res: Response): Promise<void> {
  const dbOk = await checkDbHealth();

  const status = dbOk ? 200 : 503;
  res.status(status).json({
    status: dbOk ? "ok" : "error",
    db: dbOk ? "connected" : "disconnected",
    version: VERSION,
    uptime: uptimeSeconds(),
  });
}

// ── GET /ready ────────────────────────────────────────────────────────────────

/**
 * Readiness probe — checks DB + RPC (optional); returns 503 if either fails.
 */
export async function readyHandler(_req: Request, res: Response): Promise<void> {
  const checks: Record<string, "ok" | "error"> = {};
  let healthy = true;

  // DB check
  const dbOk = await checkDbHealth();
  checks.db = dbOk ? "ok" : "error";
  if (!dbOk) healthy = false;

  // RPC check (optional — skip when SOROBAN_RPC_URL not set)
  const rpcUrl = process.env.SOROBAN_RPC_URL;
  if (rpcUrl) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(`${rpcUrl}/`, {
        method: "HEAD",
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      checks.rpc = r.ok || r.status < 500 ? "ok" : "error";
    } catch {
      checks.rpc = "error";
      healthy = false;
    }
  }

  const httpStatus = healthy ? 200 : 503;
  res.status(httpStatus).json({
    status: healthy ? "ok" : "degraded",
    version: VERSION,
    uptime: uptimeSeconds(),
    checks,
  });
}
