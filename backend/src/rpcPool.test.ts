/**
 * backend/src/rpcPool.test.ts  (#751)
 *
 * Tests for RpcPool:
 *   - round-robin selection across healthy nodes
 *   - failover when a node is marked unhealthy
 *   - node re-entry after the unhealthy window expires
 *   - reportSuccess resets the failure counter
 *   - reportFailure marks unhealthy after FAILURE_THRESHOLD
 *   - health check loop marks unhealthy and recovers nodes
 *   - Prometheus gauge reflects health state
 *   - pick() returns null when all nodes are unhealthy
 *   - parseRpcUrls() falls back to SOROBAN_RPC_URL
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Registry } from "prom-client";
import { RpcPool, parseRpcUrls } from "./rpcPool.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePool(urls: string[], reg?: Registry): RpcPool {
  return new RpcPool(urls, reg ?? new Registry());
}

// ── parseRpcUrls ──────────────────────────────────────────────────────────────

describe("parseRpcUrls", () => {
  it("returns multi-URL list from SOROBAN_RPC_URLS", () => {
    const result = parseRpcUrls({
      SOROBAN_RPC_URLS: "https://rpc1.example.com,https://rpc2.example.com",
    });
    expect(result).toEqual([
      "https://rpc1.example.com",
      "https://rpc2.example.com",
    ]);
  });

  it("falls back to SOROBAN_RPC_URL when SOROBAN_RPC_URLS is absent", () => {
    const result = parseRpcUrls({ SOROBAN_RPC_URL: "https://rpc.example.com" });
    expect(result).toEqual(["https://rpc.example.com"]);
  });

  it("returns empty array when neither variable is set", () => {
    expect(parseRpcUrls({})).toEqual([]);
  });

  it("trims whitespace from entries", () => {
    const result = parseRpcUrls({
      SOROBAN_RPC_URLS: "  https://a.com , https://b.com  ",
    });
    expect(result).toEqual(["https://a.com", "https://b.com"]);
  });
});

// ── Round-robin selection ─────────────────────────────────────────────────────

describe("RpcPool.pick()", () => {
  it("returns null for an empty pool", () => {
    expect(makePool([]).pick()).toBeNull();
  });

  it("returns the only URL for a single-node pool", () => {
    const pool = makePool(["https://rpc1.com"]);
    expect(pool.pick()).toBe("https://rpc1.com");
    expect(pool.pick()).toBe("https://rpc1.com");
  });

  it("round-robins across healthy nodes", () => {
    const pool = makePool([
      "https://rpc1.com",
      "https://rpc2.com",
      "https://rpc3.com",
    ]);
    const picks = Array.from({ length: 6 }, () => pool.pick());
    expect(picks).toEqual([
      "https://rpc1.com",
      "https://rpc2.com",
      "https://rpc3.com",
      "https://rpc1.com",
      "https://rpc2.com",
      "https://rpc3.com",
    ]);
  });

  it("skips unhealthy nodes", () => {
    const pool = makePool([
      "https://rpc1.com",
      "https://rpc2.com",
      "https://rpc3.com",
    ]);

    // Mark rpc1 unhealthy by triggering 3 failures.
    pool.reportFailure("https://rpc1.com");
    pool.reportFailure("https://rpc1.com");
    pool.reportFailure("https://rpc1.com");

    // Next 6 picks should only use rpc2 and rpc3.
    const picks = new Set(Array.from({ length: 6 }, () => pool.pick()));
    expect(picks.has("https://rpc1.com")).toBe(false);
    expect(picks.has("https://rpc2.com")).toBe(true);
    expect(picks.has("https://rpc3.com")).toBe(true);
  });

  it("returns null when all nodes are unhealthy", () => {
    const pool = makePool(["https://rpc1.com", "https://rpc2.com"]);

    for (let i = 0; i < 3; i++) {
      pool.reportFailure("https://rpc1.com");
      pool.reportFailure("https://rpc2.com");
    }

    expect(pool.pick()).toBeNull();
    expect(pool.healthyCount()).toBe(0);
  });
});

// ── reportSuccess / reportFailure ─────────────────────────────────────────────

describe("RpcPool.reportFailure()", () => {
  it("does not mark unhealthy before reaching FAILURE_THRESHOLD", () => {
    const pool = makePool(["https://rpc1.com"]);
    pool.reportFailure("https://rpc1.com");
    pool.reportFailure("https://rpc1.com");
    // Only 2 failures — should still be healthy.
    expect(pool.pick()).toBe("https://rpc1.com");
  });

  it("marks node unhealthy on 3rd consecutive failure", () => {
    const pool = makePool(["https://rpc1.com"]);
    pool.reportFailure("https://rpc1.com");
    pool.reportFailure("https://rpc1.com");
    pool.reportFailure("https://rpc1.com");
    expect(pool.pick()).toBeNull();
  });

  it("does nothing for an unknown URL", () => {
    const pool = makePool(["https://rpc1.com"]);
    pool.reportFailure("https://unknown.com"); // should not throw
    expect(pool.pick()).toBe("https://rpc1.com");
  });
});

describe("RpcPool.reportSuccess()", () => {
  it("resets the failure counter", () => {
    const pool = makePool(["https://rpc1.com"]);
    pool.reportFailure("https://rpc1.com");
    pool.reportFailure("https://rpc1.com");
    pool.reportSuccess("https://rpc1.com");
    // After success the 2 prior failures are forgiven.
    pool.reportFailure("https://rpc1.com");
    pool.reportFailure("https://rpc1.com");
    // Only 2 failures since last success — still healthy.
    expect(pool.pick()).toBe("https://rpc1.com");
  });
});

// ── Node re-entry after unhealthy window ──────────────────────────────────────

describe("unhealthy window expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-admits a node after the 60-second window has expired", () => {
    const pool = makePool(["https://rpc1.com"]);

    // Mark unhealthy.
    for (let i = 0; i < 3; i++) pool.reportFailure("https://rpc1.com");
    expect(pool.pick()).toBeNull();

    // Advance past the 60-second window.
    vi.advanceTimersByTime(61_000);

    // The next pick() should re-admit the node.
    expect(pool.pick()).toBe("https://rpc1.com");
  });
});

// ── Prometheus gauge ──────────────────────────────────────────────────────────

describe("Prometheus rpc_node_health gauge", () => {
  it("starts at 1 for all nodes", async () => {
    const reg = new Registry();
    const pool = makePool(["https://rpc1.com", "https://rpc2.com"], reg);
    void pool; // pool initialises gauges on construction

    const metrics = await reg.getMetricsAsJSON();
    const healthGauge = metrics.find((m) => m.name === "rpc_node_health");
    expect(healthGauge).toBeDefined();

    for (const val of (healthGauge as any).values) {
      expect(val.value).toBe(1);
    }
  });

  it("sets gauge to 0 when a node is marked unhealthy", async () => {
    const reg = new Registry();
    const pool = makePool(["https://rpc1.com"], reg);

    for (let i = 0; i < 3; i++) pool.reportFailure("https://rpc1.com");

    const metrics = await reg.getMetricsAsJSON();
    const healthGauge = metrics.find((m) => m.name === "rpc_node_health");
    const val = (healthGauge as any).values.find(
      (v: any) => v.labels.url === "https://rpc1.com",
    );
    expect(val?.value).toBe(0);
  });

  it("resets gauge to 1 after reportSuccess", async () => {
    const reg = new Registry();
    const pool = makePool(["https://rpc1.com"], reg);

    for (let i = 0; i < 3; i++) pool.reportFailure("https://rpc1.com");
    pool.reportSuccess("https://rpc1.com");

    const metrics = await reg.getMetricsAsJSON();
    const healthGauge = metrics.find((m) => m.name === "rpc_node_health");
    const val = (healthGauge as any).values.find(
      (v: any) => v.labels.url === "https://rpc1.com",
    );
    expect(val?.value).toBe(1);
  });
});

// ── status() snapshot ─────────────────────────────────────────────────────────

describe("RpcPool.status()", () => {
  it("reflects current health for all nodes", () => {
    const pool = makePool(["https://rpc1.com", "https://rpc2.com"]);

    for (let i = 0; i < 3; i++) pool.reportFailure("https://rpc1.com");

    const snapshot = pool.status();
    const rpc1 = snapshot.find((n) => n.url === "https://rpc1.com")!;
    const rpc2 = snapshot.find((n) => n.url === "https://rpc2.com")!;

    expect(rpc1.healthy).toBe(false);
    expect(rpc1.consecutiveFailures).toBe(3);
    expect(rpc1.unhealthyUntil).not.toBeNull();

    expect(rpc2.healthy).toBe(true);
    expect(rpc2.consecutiveFailures).toBe(0);
    expect(rpc2.unhealthyUntil).toBeNull();
  });
});

// ── Health check loop (mock fetch) ────────────────────────────────────────────

describe("health check loop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks a node unhealthy when getLatestLedger returns an error", async () => {
    const pool = makePool(["https://rpc1.com"], new Registry());

    // Stub global fetch to return an HTTP 500.
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(null, { status: 500 }) as any,
    );

    // Trigger 3 health checks manually.
    for (let i = 0; i < 3; i++) {
      await (pool as any).checkNode((pool as any).nodes[0]);
    }

    expect(pool.pick()).toBeNull();
    fetchSpy.mockRestore();
  });

  it("recovers a node when health check succeeds after failure", async () => {
    const pool = makePool(["https://rpc1.com"], new Registry());

    // First mark unhealthy via call failures.
    for (let i = 0; i < 3; i++) pool.reportFailure("https://rpc1.com");
    expect(pool.pick()).toBeNull();

    // Stub fetch to return a healthy response.
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ result: { sequence: 52000000 } }),
    } as any);

    // The unhealthy node is re-tested by checkNode regardless of the window
    // when we call it directly.
    const node = (pool as any).nodes[0];
    node.unhealthyUntil = Date.now() - 1; // expire window
    await (pool as any).checkNode(node);

    expect(pool.pick()).toBe("https://rpc1.com");
    fetchSpy.mockRestore();
  });
});
