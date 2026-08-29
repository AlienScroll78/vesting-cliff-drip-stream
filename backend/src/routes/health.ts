/**
 * Issue #35: Health and readiness endpoints.
 * Issue #567: Contract version field added to both responses.
 *
 * GET /health — liveness probe; checks DB connectivity.
 *   - 200  { status: 'ok',  db: 'connected', version, uptime }
 *   - 503  { status: 'error', db: 'disconnected', version, uptime }
 *
 * Both responses include service version, uptime, and contract_version.
 */

import type { Request, Response } from "express";
import { pool } from "../db.js";
import { horizonCircuitBreaker } from "../horizonCircuitBreaker.js";

const START_TIME = Date.now();
const VERSION =
  process.env.npm_package_version ?? process.env.SERVICE_VERSION ?? "unknown";

/** Module-level contract version, updated by startup after the version check. */
let _contractVersion = "unknown";

/**
 * Update the module-level contract version string.
 * Call this from startup.js once `checkContractVersion` succeeds.
 */
export function setContractVersion(v: string): void {
  _contractVersion = v;
}

function uptimeSeconds(): number {
  return Math.floor((Date.now() - START_TIME) / 1000);
}

/** GET /health — liveness (always 200) */
export function healthHandler(_req: Request, res: Response): void {
  res.json({
    status: "ok",
    version: VERSION,
    uptime: uptimeSeconds(),
    horizon_circuit: horizonCircuitBreaker.getState(),
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
    contract_version: _contractVersion,
    checks,
  });
}
