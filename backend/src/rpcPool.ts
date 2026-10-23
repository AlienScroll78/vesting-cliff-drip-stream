/**
 * Issue #751 — Soroban RPC connection pool with round-robin failover
 *
 * Replaces the single-node SOROBAN_RPC_URL with a pool of nodes configured
 * via SOROBAN_RPC_URLS (comma-separated list).
 *
 * Features:
 *   - Round-robin selection across all healthy nodes.
 *   - Health check every 30 seconds via getLatestLedger JSON-RPC call.
 *   - Nodes are marked unhealthy for 60 seconds after 3 consecutive failures.
 *   - Automatic re-entry: nodes are re-tested after the 60-second window and
 *     returned to rotation if they respond successfully.
 *   - Prometheus gauge: rpc_node_health{url="..."} — 1 = healthy, 0 = unhealthy.
 *   - WARN log on failover / mark-unhealthy events.
 *
 * Usage:
 *
 *   import { rpcPool } from './rpcPool.js';
 *
 *   const rpcUrl = rpcPool.pick();
 *   if (!rpcUrl) throw new Error('No RPC nodes available');
 *
 *   try {
 *     const result = await callSorobanRpc(rpcUrl, ...);
 *     rpcPool.reportSuccess(rpcUrl);
 *   } catch (err) {
 *     rpcPool.reportFailure(rpcUrl);
 *   }
 *
 * Environment variables:
 *   SOROBAN_RPC_URLS  — comma-separated list of RPC endpoint URLs (preferred)
 *   SOROBAN_RPC_URL   — single endpoint fallback (backwards-compatible)
 */

import { Gauge, Registry } from "prom-client";
import { registry as appRegistry } from "./metrics.js";

// ── Config constants ──────────────────────────────────────────────────────────

const HEALTH_CHECK_INTERVAL_MS = 30_000;  // 30 seconds
const UNHEALTHY_WINDOW_MS      = 60_000;  // 60 seconds
const FAILURE_THRESHOLD        = 3;       // consecutive failures before mark unhealthy
const HEALTH_CHECK_TIMEOUT_MS  = 5_000;   // per-check fetch timeout

// ── Logging ───────────────────────────────────────────────────────────────────

function log(
  level: "info" | "warn" | "error",
  msg: string,
  extra?: Record<string, unknown>,
): void {
  process.stderr.write(
    JSON.stringify({
      level,
      time: new Date().toISOString(),
      component: "rpc_pool",
      msg,
      ...extra,
    }) + "\n",
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface NodeState {
  url: string;
  healthy: boolean;
  /** Timestamp (ms) after which the node may re-enter the healthy pool. */
  unhealthyUntil: number;
  consecutiveFailures: number;
  lastChecked: number;
}

export interface RpcNodeStatus {
  url: string;
  healthy: boolean;
  consecutiveFailures: number;
  unhealthyUntil: string | null;
}

// ── Prometheus metric ─────────────────────────────────────────────────────────

function createHealthGauge(reg: Registry): Gauge {
  return new Gauge({
    name: "rpc_node_health",
    help: "Health status of each Soroban RPC node (1=healthy, 0=unhealthy)",
    labelNames: ["url"] as const,
    registers: [reg],
  });
}

// ── RpcPool ───────────────────────────────────────────────────────────────────

export class RpcPool {
  private readonly nodes: NodeState[] = [];
  private rrIndex = 0;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private readonly gauge: Gauge;

  constructor(urls: string[], reg: Registry = appRegistry) {
    this.gauge = createHealthGauge(reg);

    if (urls.length === 0) {
      log("warn", "RpcPool initialized with no URLs — all RPC calls will fail");
    }

    for (const url of urls) {
      this.nodes.push({
        url,
        healthy: true,
        unhealthyUntil: 0,
        consecutiveFailures: 0,
        lastChecked: 0,
      });
      this.gauge.set({ url }, 1);
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Pick the next healthy RPC node URL using round-robin selection.
   * Returns null when no healthy nodes are available.
   */
  pick(): string | null {
    const now = Date.now();
    const total = this.nodes.length;
    if (total === 0) return null;

    // Attempt one full rotation.
    for (let i = 0; i < total; i++) {
      const node = this.nodes[this.rrIndex % total];
      this.rrIndex = (this.rrIndex + 1) % total;

      // Nodes whose unhealthy window expired are tentatively re-admitted.
      if (!node.healthy && now >= node.unhealthyUntil) {
        node.healthy = true;
        node.consecutiveFailures = 0;
        this.gauge.set({ url: node.url }, 1);
        log("info", "RPC node re-admitted to rotation after unhealthy window", {
          url: node.url,
        });
      }

      if (node.healthy) return node.url;
    }

    return null;
  }

  /**
   * Report a successful RPC call — resets the node's consecutive-failure counter.
   */
  reportSuccess(url: string): void {
    const node = this.findNode(url);
    if (!node) return;

    const wasUnhealthy = !node.healthy;
    node.consecutiveFailures = 0;
    node.healthy = true;
    node.unhealthyUntil = 0;
    this.gauge.set({ url }, 1);

    if (wasUnhealthy) {
      log("info", "RPC node recovered after successful call", { url });
    }
  }

  /**
   * Report a failed RPC call.
   * After FAILURE_THRESHOLD consecutive failures the node is quarantined for
   * UNHEALTHY_WINDOW_MS milliseconds and a WARN log is emitted.
   */
  reportFailure(url: string): void {
    const node = this.findNode(url);
    if (!node) return;

    node.consecutiveFailures += 1;

    if (node.consecutiveFailures >= FAILURE_THRESHOLD && node.healthy) {
      node.healthy = false;
      node.unhealthyUntil = Date.now() + UNHEALTHY_WINDOW_MS;
      this.gauge.set({ url }, 0);

      log("warn", "RPC node marked unhealthy after consecutive failures", {
        url,
        consecutiveFailures: node.consecutiveFailures,
        unhealthyUntil: new Date(node.unhealthyUntil).toISOString(),
      });
    }
  }

  /**
   * Current health snapshot for all nodes — used by the admin status endpoint.
   */
  status(): RpcNodeStatus[] {
    const now = Date.now();
    return this.nodes.map((n) => ({
      url: n.url,
      healthy: n.healthy || now >= n.unhealthyUntil,
      consecutiveFailures: n.consecutiveFailures,
      unhealthyUntil:
        n.unhealthyUntil > 0
          ? new Date(n.unhealthyUntil).toISOString()
          : null,
    }));
  }

  /** Count of currently healthy nodes. */
  healthyCount(): number {
    const now = Date.now();
    return this.nodes.filter((n) => n.healthy || now >= n.unhealthyUntil)
      .length;
  }

  // ── Health-check loop ───────────────────────────────────────────────────────

  /**
   * Start the 30-second background health-check loop.
   * Idempotent — safe to call multiple times.
   */
  startHealthChecks(): void {
    if (this.healthTimer) return;

    this.healthTimer = setInterval(() => {
      this.runHealthChecks().catch((err: any) =>
        log("error", "Health check loop threw an unhandled error", {
          error: err?.message ?? String(err),
        }),
      );
    }, HEALTH_CHECK_INTERVAL_MS);

    // Unref the timer so it does not prevent process exit in tests.
    if (this.healthTimer.unref) this.healthTimer.unref();

    log("info", "RPC health checks started", {
      intervalMs: HEALTH_CHECK_INTERVAL_MS,
      nodeCount: this.nodes.length,
    });
  }

  /** Stop the background health-check loop. */
  stopHealthChecks(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private findNode(url: string): NodeState | undefined {
    return this.nodes.find((n) => n.url === url);
  }

  private async runHealthChecks(): Promise<void> {
    await Promise.all(this.nodes.map((node) => this.checkNode(node)));
  }

  private async checkNode(node: NodeState): Promise<void> {
    const now = Date.now();
    node.lastChecked = now;

    // Skip nodes still inside their unhealthy quarantine window.
    if (!node.healthy && now < node.unhealthyUntil) return;

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(
        () => ctrl.abort(),
        HEALTH_CHECK_TIMEOUT_MS,
      );

      const resp = await fetch(node.url, {
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

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = (await resp.json()) as {
        result?: { sequence?: number };
        error?: unknown;
      };

      if (data.error || data.result?.sequence === undefined) {
        throw new Error("unexpected RPC response format");
      }

      // Success — mark healthy and reset failure counter.
      const wasUnhealthy = !node.healthy;
      node.consecutiveFailures = 0;
      node.healthy = true;
      node.unhealthyUntil = 0;
      this.gauge.set({ url: node.url }, 1);

      if (wasUnhealthy) {
        log("info", "RPC node recovered via health check", {
          url: node.url,
          latestLedger: data.result.sequence,
        });
      }
    } catch (err: any) {
      node.consecutiveFailures += 1;

      if (node.consecutiveFailures >= FAILURE_THRESHOLD && node.healthy) {
        node.healthy = false;
        node.unhealthyUntil = now + UNHEALTHY_WINDOW_MS;
        this.gauge.set({ url: node.url }, 0);

        log("warn", "RPC node marked unhealthy by health check", {
          url: node.url,
          error: err?.message ?? String(err),
          consecutiveFailures: node.consecutiveFailures,
        });
      }
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

/**
 * Parse the list of RPC URLs from environment variables.
 * Prefers SOROBAN_RPC_URLS (comma-separated); falls back to SOROBAN_RPC_URL.
 */
export function parseRpcUrls(env: NodeJS.ProcessEnv = process.env): string[] {
  const multi = (env.SOROBAN_RPC_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (multi.length > 0) return multi;

  const single = env.SOROBAN_RPC_URL?.trim();
  if (single) return [single];

  return [];
}

/**
 * Application-wide singleton RPC pool.
 *
 * Health checks start automatically outside of test environments.
 */
export const rpcPool = new RpcPool(parseRpcUrls());

if (process.env.NODE_ENV !== "test") {
  rpcPool.startHealthChecks();
}
