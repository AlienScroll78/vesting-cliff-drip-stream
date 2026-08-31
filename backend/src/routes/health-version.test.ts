/**
 * Issue #567: health and readiness endpoints include contract_version field.
 *
 * Verifies:
 *  - /health response includes contract_version (defaults to "unknown")
 *  - /ready  response includes contract_version (defaults to "unknown")
 *  - After setContractVersion(), both handlers return the updated value
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../db.js", () => ({
  pool: { query: vi.fn(async () => ({ rows: [{ "?column?": 1 }] })) },
}));

// Import module under test — must happen after vi.mock() calls.
const healthModule = await import("./health.js");
const { healthHandler, readyHandler, setContractVersion } = healthModule;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /health — contract_version field", () => {
  it('includes contract_version field defaulting to "unknown"', () => {
    // Reset to default by re-importing or calling setContractVersion back.
    setContractVersion("unknown");
    const { res, json } = makeRes();
    healthHandler(req, res);
    const body = json.mock.calls[0][0];
    expect(body).toHaveProperty("contract_version");
    expect(body.contract_version).toBe("unknown");
  });

  it("reflects the version set via setContractVersion", () => {
    setContractVersion("ledger-99001");
    const { res, json } = makeRes();
    healthHandler(req, res);
    const body = json.mock.calls[0][0];
    expect(body.contract_version).toBe("ledger-99001");
  });

  it("still includes status, version, and uptime alongside contract_version", () => {
    setContractVersion("ledger-99001");
    const { res, json } = makeRes();
    healthHandler(req, res);
    const body = json.mock.calls[0][0];
    expect(body.status).toBe("ok");
    expect(body.version).toBeDefined();
    expect(typeof body.uptime).toBe("number");
    expect(body.contract_version).toBeDefined();
  });
});

describe("GET /ready — contract_version field", () => {
  beforeEach(() => vi.clearAllMocks());

  it('includes contract_version field defaulting to "unknown" when not set', async () => {
    setContractVersion("unknown");
    delete process.env.SOROBAN_RPC_URL;
    const { res, json } = makeRes();
    await readyHandler(req, res);
    const body = json.mock.calls[0][0];
    expect(body).toHaveProperty("contract_version");
    expect(body.contract_version).toBe("unknown");
  });

  it("reflects the version set via setContractVersion", async () => {
    setContractVersion("ledger-77777");
    delete process.env.SOROBAN_RPC_URL;
    const { res, json } = makeRes();
    await readyHandler(req, res);
    const body = json.mock.calls[0][0];
    expect(body.contract_version).toBe("ledger-77777");
  });

  it("still includes status, version, uptime, and checks alongside contract_version", async () => {
    setContractVersion("ledger-77777");
    delete process.env.SOROBAN_RPC_URL;
    const { res, json } = makeRes();
    await readyHandler(req, res);
    const body = json.mock.calls[0][0];
    expect(body.status).toBeDefined();
    expect(body.version).toBeDefined();
    expect(typeof body.uptime).toBe("number");
    expect(body.checks).toBeDefined();
    expect(body.contract_version).toBe("ledger-77777");
  });
});
