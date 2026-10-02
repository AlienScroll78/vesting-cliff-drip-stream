/**
 * Issue #35: Health and readiness endpoints.
 * Issue #567: Contract version field added to both responses.
 *
 * GET /health checks PostgreSQL, Soroban RPC, and Redis.
 * GET /ready also checks indexer freshness.
 */

import type { Request, Response } from "express";
import { createClient } from "redis";
import { pool } from "../db.js";
import { networkConfig } from "../config/network.js";
import { horizonCircuitBreaker } from "../horizonCircuitBreaker.js";

const START_TIME = Date.now();
const VERSION =
  process.env.npm_package_version ?? process.env.SERVICE_VERSION ?? "unknown";

/** Module-level contract version, updated by startup after the version check. */
let _contractVersion = "unknown";
let redis: ReturnType<typeof createClient> | null = null;

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

async function withinTimeout<T>(check: Promise<T>, timeoutMs = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      check,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function checkDbHealth(): Promise<boolean> {
  try {
    await withinTimeout(pool.query("SELECT 1"), 900);
    return true;
  } catch {
    return false;
  }
}

async function checkRpcHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const rpcUrl = process.env.SOROBAN_RPC_URL ?? networkConfig.rpcUrl;
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function checkRedisHealth(): Promise<boolean> {
  try {
    if (!redis?.isOpen) {
      redis = createClient({
        url: process.env.REDIS_URL ?? "redis://localhost:6379",
      });
      redis.on("error", () => {});
      await withinTimeout(redis.connect());
    }
    return (await withinTimeout(redis.ping())) === "PONG";
  } catch {
    return false;
  }
}

async function runHealthChecks(): Promise<Record<string, string>> {
  const [db, rpc, redisHealthy] = await Promise.all([
    checkDbHealth(),
    withinTimeout(checkRpcHealth()).catch(() => false),
    withinTimeout(checkRedisHealth()).catch(() => false),
  ]);
  return {
    db: db ? "ok" : "timeout or unavailable",
    rpc: rpc ? "ok" : "timeout or unavailable",
    redis: redisHealthy ? "ok" : "timeout or unavailable",
  };
}

function sendHealthResponse(res: Response, checks: Record<string, string>): void {
  const healthy = Object.values(checks).every((value) => value === "ok");
  if (!healthy) console.warn("[health] degraded service checks", checks);
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    version: VERSION,
    uptime: uptimeSeconds(),
    uptime_seconds: uptimeSeconds(),
    contract_version: _contractVersion,
    checks,
    horizon_circuit: horizonCircuitBreaker.getState(),
  });
}

/** GET /health — checks dependencies and returns 503 when one is unavailable. */
export async function healthHandler(_req: Request, res: Response): Promise<void> {
  sendHealthResponse(res, await runHealthChecks());
}

/** GET /ready — dependencies must be healthy and the indexer less than 60s behind. */
export async function readyHandler(_req: Request, res: Response): Promise<void> {
  const checks = await runHealthChecks();
  try {
    const result = await withinTimeout(
      pool.query(
        `SELECT EXTRACT(EPOCH FROM (now() - updated_at)) AS lag_seconds
           FROM horizon_worker_cursor
          WHERE id = 1`,
      ),
    );
    const lag = Number(result.rows[0]?.lag_seconds);
    checks.indexer = Number.isFinite(lag) && lag < 60 ? "ok" : "lag > 60s";
  } catch {
    checks.indexer = "timeout or unavailable";
  }
  sendHealthResponse(res, checks);
}
