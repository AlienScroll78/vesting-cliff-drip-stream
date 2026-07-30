import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../db.js", () => ({
  pool: { query: vi.fn(async () => ({ rows: [{ "?column?": 1 }] })) },
}));

const { healthHandler, readyHandler } = await import("./health.js");
const { pool } = await import("../db.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRes(): { res: Response; json: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> } {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return { res, json: res.json as ReturnType<typeof vi.fn>, status: res.status as ReturnType<typeof vi.fn> };
}

const req = {} as Request;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  it("returns 200 with status ok and uptime", () => {
    const { res, json } = makeRes();
    healthHandler(req, res);
    const body = json.mock.calls[0][0];
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
    expect(body.version).toBeDefined();
  });
});

describe("GET /ready", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 when DB is reachable", async () => {
    delete process.env.SOROBAN_RPC_URL;
    const { res, status, json } = makeRes();
    await readyHandler(req, res);
    expect(status).toHaveBeenCalledWith(200);
    expect(json.mock.calls[0][0].checks.db).toBe("ok");
  });

  it("returns 503 when DB is unreachable", async () => {
    vi.mocked(pool.query).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    delete process.env.SOROBAN_RPC_URL;
    const { res, status, json } = makeRes();
    await readyHandler(req, res);
    expect(status).toHaveBeenCalledWith(503);
    expect(json.mock.calls[0][0].checks.db).toBe("error");
  });

  it("response includes version and uptime", async () => {
    delete process.env.SOROBAN_RPC_URL;
    const { res, json } = makeRes();
    await readyHandler(req, res);
    const body = json.mock.calls[0][0];
    expect(typeof body.uptime).toBe("number");
    expect(body.version).toBeDefined();
  });
});
