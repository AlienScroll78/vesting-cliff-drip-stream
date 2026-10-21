/**
 * Tests for the `db_migrations` field on GET /health (Issue #1013).
 *
 * Kept in a separate file from health.test.ts so the migration-status
 * assertion is not entangled with the pre-existing checks in that suite.
 *
 * The health route reads the status from `../migrate.js`, so the module is
 * mocked to drive each of the three states without touching a database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

let migrationStatus: "current" | "pending" | "failed" = "current";

vi.mock("../migrate.js", () => ({
  getMigrationStatus: () => migrationStatus,
}));

vi.mock("../db.js", () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
}));

vi.mock("../horizonCircuitBreaker.js", () => ({
  horizonCircuitBreaker: { getState: () => "closed" },
}));

vi.mock("../config/network.js", () => ({
  networkConfig: { network: "testnet", rpcUrl: "https://rpc.test" },
}));

vi.mock("redis", () => ({
  createClient: () => ({
    isOpen: true,
    on: () => {},
    connect: async () => {},
    ping: async () => "PONG",
  }),
}));

const { healthHandler, readyHandler } = await import("./health.js");

function makeRes() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return {
    res,
    json: res.json as ReturnType<typeof vi.fn>,
    status: res.status as ReturnType<typeof vi.fn>,
  };
}

const req = {} as Request;

// Keep dependency checks from hitting the network.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true })
  );
});

describe("#1013 — /health exposes db_migrations", () => {
  it("reports 'current' when migrations are up to date", async () => {
    migrationStatus = "current";
    const { res, json } = makeRes();
    await healthHandler(req, res);
    expect(json.mock.calls[0][0].db_migrations).toBe("current");
  });

  it("reports 'pending' while migrations are still being applied", async () => {
    migrationStatus = "pending";
    const { res, json } = makeRes();
    await healthHandler(req, res);
    expect(json.mock.calls[0][0].db_migrations).toBe("pending");
  });

  it("reports 'failed' when a migration could not be applied", async () => {
    migrationStatus = "failed";
    const { res, json } = makeRes();
    await healthHandler(req, res);
    expect(json.mock.calls[0][0].db_migrations).toBe("failed");
  });

  it("only ever reports one of the three documented values", async () => {
    for (const status of ["current", "pending", "failed"] as const) {
      migrationStatus = status;
      const { res, json } = makeRes();
      await healthHandler(req, res);
      expect(["current", "pending", "failed"]).toContain(
        json.mock.calls[0][0].db_migrations
      );
    }
  });

  it("also exposes db_migrations on /ready", async () => {
    migrationStatus = "current";
    const { res, json } = makeRes();
    await readyHandler(req, res);
    expect(json.mock.calls[0][0].db_migrations).toBe("current");
  });

  it("keeps the existing health fields intact", async () => {
    migrationStatus = "current";
    const { res, json } = makeRes();
    await healthHandler(req, res);
    const body = json.mock.calls[0][0];
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("uptime");
    expect(body).toHaveProperty("checks");
    expect(body).toHaveProperty("horizon_circuit");
  });
});
