/**
 * Tests for GET /health and GET /ready endpoints.
 * Issue #555: verifies the new pool-based health checks and response shapes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../database.js", () => ({
  checkDbHealth: vi.fn(async () => true),
  pool: { query: vi.fn(async () => ({ rows: [{ "?column?": 1 }] })) },
}));

const { healthHandler, readyHandler } = await import("./health.js");
const { checkDbHealth } = await import("../database.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRes(): {
  res: Response;
  json: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
} {
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

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with status ok and db connected when DB is reachable", async () => {
    vi.mocked(checkDbHealth).mockResolvedValueOnce(true);
    const { res, status, json } = makeRes();
    await healthHandler(req, res);
    expect(status).toHaveBeenCalledWith(200);
    const body = json.mock.calls[0][0];
    expect(body.status).toBe("ok");
    expect(body.db).toBe("connected");
    expect(typeof body.uptime).toBe("number");
    expect(body.version).toBeDefined();
  });

  it("includes horizon_circuit state in response", () => {
    const { res, json } = makeRes();
    healthHandler(req, res);
    const body = json.mock.calls[0][0];
    expect(body).toHaveProperty("horizon_circuit");
    expect(["closed", "open", "half-open"]).toContain(body.horizon_circuit);
  });
});

// ---------------------------------------------------------------------------
// GET /ready
// ---------------------------------------------------------------------------

describe("GET /ready", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 when DB is reachable and no RPC configured", async () => {
    vi.mocked(checkDbHealth).mockResolvedValueOnce(true);
    delete process.env.SOROBAN_RPC_URL;
    const { res, status, json } = makeRes();
    await readyHandler(req, res);
    expect(status).toHaveBeenCalledWith(200);
    expect(json.mock.calls[0][0].checks.db).toBe("ok");
  });

  it("returns 503 when DB is unreachable", async () => {
    vi.mocked(checkDbHealth).mockResolvedValueOnce(false);
    delete process.env.SOROBAN_RPC_URL;
    const { res, status, json } = makeRes();
    await readyHandler(req, res);
    expect(status).toHaveBeenCalledWith(503);
    expect(json.mock.calls[0][0].checks.db).toBe("error");
  });

  it("response includes version and uptime", async () => {
    vi.mocked(checkDbHealth).mockResolvedValueOnce(true);
    delete process.env.SOROBAN_RPC_URL;
    const { res, json } = makeRes();
    await readyHandler(req, res);
    const body = json.mock.calls[0][0];
    expect(typeof body.uptime).toBe("number");
    expect(body.version).toBeDefined();
  });
});
