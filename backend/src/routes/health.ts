/**
 * Issue #35: Health and readiness endpoints.
 * Issue #567: Contract version field added to both responses.
 *
 * GET /health — liveness probe (always 200 if process is alive)
 * GET /ready  — readiness probe (checks DB + RPC; 503 if either is unreachable)
 *
 * Both responses include service version, uptime, and contract_version.
 */

import type { Request, Response } from "express";
import { pool } from "../db.js";

const START_TIME = Date.now();
const VERSION = process.env.npm_package_version ?? process.env.SERVICE_VERSION ?? "unknown";

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
    contract_version: _contractVersion,
  });
}

/** GET /ready — readiness (checks DB + RPC) */
export async function readyHandler(_req: Request, res: Response): Promise<void> {
  const checks: Record<string, "ok" | "error"> = {};
  let healthy = true;

  // DB check
  try {
    await pool.query("SELECT 1");
    checks.db = "ok";
  } catch {
    checks.db = "error";
    healthy = false;
  }

  // RPC check (optional — skip when SOROBAN_RPC_URL not set)
  const rpcUrl = process.env.SOROBAN_RPC_URL;
  if (rpcUrl) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(`${rpcUrl}/`, { method: "HEAD", signal: ctrl.signal });
      clearTimeout(timer);
      checks.rpc = r.ok || r.status < 500 ? "ok" : "error";
    } catch {
      checks.rpc = "error";
      healthy = false;
    }
  }

  const status = healthy ? 200 : 503;
  res.status(status).json({
    status: healthy ? "ok" : "degraded",
    version: VERSION,
    uptime: uptimeSeconds(),
    contract_version: _contractVersion,
    checks,
  });
}
