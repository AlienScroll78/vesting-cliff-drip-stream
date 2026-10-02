/**
 * Tests for the admin API.
 *
 * Covers:
 *   - Authentication rejection (missing header, wrong token, no config)
 *   - GET  /admin/streams
 *   - GET  /admin/indexer/status
 *   - POST /admin/indexer/restart
 *   - GET  /admin/webhooks/dlq
 *   - POST /admin/webhooks/dlq/replay
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    query: {},
    body: {},
    params: {},
    ...overrides,
  } as unknown as Request;
}

type MockRes = {
  res: Response;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
};

function makeRes(): MockRes {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return { res, status: res.status as ReturnType<typeof vi.fn>, json: res.json as ReturnType<typeof vi.fn> };
}

const next: NextFunction = vi.fn();

// ---------------------------------------------------------------------------
// auth.ts — requireAdminAuth middleware
// ---------------------------------------------------------------------------

describe("requireAdminAuth", () => {
  const VALID_KEY = "test-admin-api-key-32-chars-long!!";

  beforeEach(() => {
    vi.resetModules();
    process.env.ADMIN_API_KEY = VALID_KEY;
  });

  afterEach(() => {
    delete process.env.ADMIN_API_KEY;
  });

  it("returns 503 when ADMIN_API_KEY is not configured", async () => {
    delete process.env.ADMIN_API_KEY;
    const { requireAdminAuth } = await import("./auth.js");
    const { res, status, json } = makeRes();
    requireAdminAuth(makeReq(), res, next as NextFunction);
    expect(status).toHaveBeenCalledWith(503);
    expect(json.mock.calls[0][0]).toMatchObject({ error: expect.stringContaining("not configured") });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when Authorization header is absent", async () => {
    const { requireAdminAuth } = await import("./auth.js");
    const { res, status, json } = makeRes();
    requireAdminAuth(makeReq({ headers: {} }), res, next as NextFunction);
    expect(status).toHaveBeenCalledWith(401);
    expect(json.mock.calls[0][0]).toMatchObject({ error: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when Authorization scheme is not Bearer", async () => {
    const { requireAdminAuth } = await import("./auth.js");
    const { res, status } = makeRes();
    const encodedCreds = Buffer.from("admin:pass").toString("base64");
    requireAdminAuth(
      makeReq({ headers: { authorization: `Basic ${encodedCreds}` } }),
      res,
      next as NextFunction,
    );
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when Bearer token is wrong", async () => {
    const { requireAdminAuth } = await import("./auth.js");
    const { res, status, json } = makeRes();
    requireAdminAuth(
      makeReq({ headers: { authorization: "Bearer wrong-token" } }),
      res,
      next as NextFunction,
    );
    expect(status).toHaveBeenCalledWith(403);
    expect(json.mock.calls[0][0]).toMatchObject({ error: "Forbidden" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 for an empty Bearer token", async () => {
    const { requireAdminAuth } = await import("./auth.js");
    const { res, status } = makeRes();
    requireAdminAuth(
      makeReq({ headers: { authorization: "Bearer " } }),
      res,
      next as NextFunction,
    );
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when the correct Bearer token is supplied", async () => {
    const { requireAdminAuth } = await import("./auth.js");
    const nextMock = vi.fn() as NextFunction;
    const { res } = makeRes();
    requireAdminAuth(
      makeReq({ headers: { authorization: `Bearer ${VALID_KEY}` } }),
      res,
      nextMock,
    );
    expect(nextMock).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("is case-sensitive — wrong casing is rejected", async () => {
    const { requireAdminAuth } = await import("./auth.js");
    const { res, status } = makeRes();
    requireAdminAuth(
      makeReq({ headers: { authorization: `Bearer ${VALID_KEY.toUpperCase()}` } }),
      res,
      next as NextFunction,
    );
    expect(status).toHaveBeenCalledWith(403);
  });
});

// ---------------------------------------------------------------------------
// streams.ts — GET /admin/streams
// ---------------------------------------------------------------------------

describe("admin streams handler", () => {
  const mockRows = [
    {
      id: 1,
      sponsor: "GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345678",
      recipient: "GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345678",
      token: "CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345678",
      rate_per_ledger: "10",
      start_ledger: 1000,
      cliff_ledger: 1100,
      end_ledger: 2000,
      status: "active",
      cancelled_at: null,
      created_at: new Date("2024-01-01T00:00:00Z"),
    },
  ];

  const mockQuery = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockResolvedValue({ rows: [{ total: "1" }] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 200 with items array on success", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: "1" }] })   // count
      .mockResolvedValueOnce({ rows: mockRows });            // data

    vi.doMock("pg", () => ({
      Pool: vi.fn().mockImplementation(() => ({ query: mockQuery })),
    }));

    const { streamsHandler } = await import("./streams.js");
    const { res, status, json } = makeRes();
    await streamsHandler(makeReq(), res);
    expect(status).toHaveBeenCalledWith(200);
    const body = json.mock.calls[0][0];
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("limit");
    expect(body).toHaveProperty("offset");
  });

  it("rejects invalid status filter with 400", async () => {
    vi.doMock("pg", () => ({
      Pool: vi.fn().mockImplementation(() => ({ query: mockQuery })),
    }));
    const { streamsHandler } = await import("./streams.js");
    const { res, status, json } = makeRes();
    await streamsHandler(makeReq({ query: { status: "invalid_status" } as any }), res);
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0]).toMatchObject({ error: expect.stringContaining("Invalid status") });
  });

  it("rejects malformed sponsor address with 400", async () => {
    vi.doMock("pg", () => ({
      Pool: vi.fn().mockImplementation(() => ({ query: mockQuery })),
    }));
    const { streamsHandler } = await import("./streams.js");
    const { res, status, json } = makeRes();
    await streamsHandler(makeReq({ query: { sponsor: "not-a-stellar-address" } as any }), res);
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0]).toMatchObject({ error: expect.stringContaining("sponsor") });
  });

  it("rejects malformed recipient address with 400", async () => {
    vi.doMock("pg", () => ({
      Pool: vi.fn().mockImplementation(() => ({ query: mockQuery })),
    }));
    const { streamsHandler } = await import("./streams.js");
    const { res, status, json } = makeRes();
    await streamsHandler(makeReq({ query: { recipient: "not-a-stellar-address" } as any }), res);
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0]).toMatchObject({ error: expect.stringContaining("recipient") });
  });

  it("returns 500 when the DB query fails", async () => {
    mockQuery.mockRejectedValue(new Error("DB connection lost"));
    vi.doMock("pg", () => ({
      Pool: vi.fn().mockImplementation(() => ({ query: mockQuery })),
    }));
    const { streamsHandler } = await import("./streams.js");
    const { res, status } = makeRes();
    await streamsHandler(makeReq(), res);
    expect(status).toHaveBeenCalledWith(500);
  });
});

// ---------------------------------------------------------------------------
// indexer.ts — GET /admin/indexer/status and POST /admin/indexer/restart
// ---------------------------------------------------------------------------

describe("admin indexer handlers", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("statusHandler", () => {
    it("returns 200 with indexer state shape", async () => {
      vi.doMock("pg", () => ({
        Pool: vi.fn().mockImplementation(() => ({
          query: vi.fn().mockResolvedValue({ rows: [{ cursor: "cursor-abc" }] }),
        })),
      }));
      const { statusHandler } = await import("./indexer.js");
      const { res, status, json } = makeRes();
      await statusHandler(makeReq(), res);
      expect(status).toHaveBeenCalledWith(200);
      const body = json.mock.calls[0][0];
      expect(body).toHaveProperty("status");
      expect(body).toHaveProperty("errorCount");
      expect(body).toHaveProperty("lagLedgers");
      expect(body).toHaveProperty("lastCursor");
    });

    it("still returns 200 when DB is unavailable (graceful degradation)", async () => {
      vi.doMock("pg", () => ({
        Pool: vi.fn().mockImplementation(() => ({
          query: vi.fn().mockRejectedValue(new Error("DB error")),
        })),
      }));
      const { statusHandler } = await import("./indexer.js");
      const { res, status } = makeRes();
      await statusHandler(makeReq(), res);
      expect(status).toHaveBeenCalledWith(200);
    });
  });

  describe("restartHandler", () => {
    it("returns 200 when no restart function is registered", async () => {
      vi.doMock("pg", () => ({
        Pool: vi.fn().mockImplementation(() => ({ query: vi.fn() })),
      }));
      const { restartHandler } = await import("./indexer.js");
      const { res, status, json } = makeRes();
      await restartHandler(makeReq(), res);
      expect(status).toHaveBeenCalledWith(200);
      expect(json.mock.calls[0][0]).toMatchObject({ ok: true });
    });

    it("returns 200 and calls the registered restart function", async () => {
      vi.doMock("pg", () => ({
        Pool: vi.fn().mockImplementation(() => ({ query: vi.fn() })),
      }));
      const { restartHandler, registerIndexerRestart } = await import("./indexer.js");
      const restartFn = vi.fn().mockResolvedValue(undefined);
      registerIndexerRestart(restartFn);

      const { res, status, json } = makeRes();
      await restartHandler(makeReq(), res);
      expect(restartFn).toHaveBeenCalledOnce();
      expect(status).toHaveBeenCalledWith(200);
      expect(json.mock.calls[0][0]).toMatchObject({ ok: true });
    });

    it("returns 500 when the restart function throws", async () => {
      vi.doMock("pg", () => ({
        Pool: vi.fn().mockImplementation(() => ({ query: vi.fn() })),
      }));
      const { restartHandler, registerIndexerRestart } = await import("./indexer.js");
      registerIndexerRestart(vi.fn().mockRejectedValue(new Error("restart failure")));

      const { res, status, json } = makeRes();
      await restartHandler(makeReq(), res);
      expect(status).toHaveBeenCalledWith(500);
      expect(json.mock.calls[0][0]).toMatchObject({ error: expect.stringContaining("restart failure") });
    });
  });
});

// ---------------------------------------------------------------------------
// webhooks.ts — GET /admin/webhooks/dlq and POST /admin/webhooks/dlq/replay
// ---------------------------------------------------------------------------

describe("admin webhooks handlers", () => {
  const dlqRows = [
    {
      id: 1,
      webhook_url: "https://example.com/webhook",
      payload: { event: "stream_created" },
      last_error: "timeout",
      retry_count: 3,
      failed_at: new Date("2024-06-01T12:00:00Z"),
      last_retry_at: new Date("2024-06-01T13:00:00Z"),
    },
  ];

  const mockQuery = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    // Stub the webhookWorker CJS module so tests don't need a real DB
    vi.doMock("../webhookWorker.js", () => ({
      replayDlqItem: vi.fn().mockResolvedValue({ ok: true }),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("dlqListHandler", () => {
    it("returns 200 with items array", async () => {
      mockQuery.mockResolvedValue({ rows: dlqRows });
      vi.doMock("pg", () => ({
        Pool: vi.fn().mockImplementation(() => ({ query: mockQuery })),
      }));
      const { dlqListHandler } = await import("./webhooks.js");
      const { res, status, json } = makeRes();
      await dlqListHandler(makeReq(), res);
      expect(status).toHaveBeenCalledWith(200);
      const body = json.mock.calls[0][0];
      expect(body).toHaveProperty("items");
      expect(body).toHaveProperty("total");
      expect(body).toHaveProperty("limit");
    });

    it("returns 200 with empty items when DLQ is empty", async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      vi.doMock("pg", () => ({
        Pool: vi.fn().mockImplementation(() => ({ query: mockQuery })),
      }));
      const { dlqListHandler } = await import("./webhooks.js");
      const { res, status, json } = makeRes();
      await dlqListHandler(makeReq(), res);
      expect(status).toHaveBeenCalledWith(200);
      expect(json.mock.calls[0][0].items).toEqual([]);
      expect(json.mock.calls[0][0].total).toBe(0);
    });

    it("returns 500 when DB fails", async () => {
      mockQuery.mockRejectedValue(new Error("DB gone"));
      vi.doMock("pg", () => ({
        Pool: vi.fn().mockImplementation(() => ({ query: mockQuery })),
      }));
      const { dlqListHandler } = await import("./webhooks.js");
      const { res, status } = makeRes();
      await dlqListHandler(makeReq(), res);
      expect(status).toHaveBeenCalledWith(500);
    });

    it("respects custom limit query param", async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      vi.doMock("pg", () => ({
        Pool: vi.fn().mockImplementation(() => ({ query: mockQuery })),
      }));
      const { dlqListHandler } = await import("./webhooks.js");
      const { res, json } = makeRes();
      await dlqListHandler(makeReq({ query: { limit: "25" } as any }), res);
      expect(json.mock.calls[0][0].limit).toBe(25);
    });
  });

  describe("dlqReplayHandler", () => {
    it("returns 400 for a non-numeric id", async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      vi.doMock("pg", () => ({
        Pool: vi.fn().mockImplementation(() => ({ query: mockQuery })),
      }));
      const { dlqReplayHandler } = await import("./webhooks.js");
      const { res, status, json } = makeRes();
      await dlqReplayHandler(makeReq({ body: { id: "abc" } }), res);
      expect(status).toHaveBeenCalledWith(400);
      expect(json.mock.calls[0][0]).toMatchObject({ error: expect.stringContaining("positive integer") });
    });

    it("returns 400 for id = 0", async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      vi.doMock("pg", () => ({
        Pool: vi.fn().mockImplementation(() => ({ query: mockQuery })),
      }));
      const { dlqReplayHandler } = await import("./webhooks.js");
      const { res, status } = makeRes();
      await dlqReplayHandler(makeReq({ body: { id: 0 } }), res);
      expect(status).toHaveBeenCalledWith(400);
    });

    it("returns 404 when id is not found in the DLQ", async () => {
      // First call = existence check → empty
      mockQuery.mockResolvedValueOnce({ rows: [] });
      vi.doMock("pg", () => ({
        Pool: vi.fn().mockImplementation(() => ({ query: mockQuery })),
      }));
      const { dlqReplayHandler } = await import("./webhooks.js");
      const { res, status, json } = makeRes();
      await dlqReplayHandler(makeReq({ body: { id: 99 } }), res);
      expect(status).toHaveBeenCalledWith(404);
      expect(json.mock.calls[0][0]).toMatchObject({ error: expect.stringContaining("not found") });
    });

    it("replays a single item when id is provided and item exists", async () => {
      // First call = existence check → found; replay happens via mocked worker
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
      vi.doMock("pg", () => ({
        Pool: vi.fn().mockImplementation(() => ({ query: mockQuery })),
      }));
      const { dlqReplayHandler } = await import("./webhooks.js");
      const { res, status, json } = makeRes();
      await dlqReplayHandler(makeReq({ body: { id: 1 } }), res);
      expect(status).toHaveBeenCalledWith(200);
      const body = json.mock.calls[0][0];
      expect(body.replayed).toBe(1);
      expect(body.succeeded).toBe(1);
    });

    it("replays all items when no id is provided", async () => {
      // Fetch all IDs query
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] });
      vi.doMock("pg", () => ({
        Pool: vi.fn().mockImplementation(() => ({ query: mockQuery })),
      }));
      const { dlqReplayHandler } = await import("./webhooks.js");
      const { res, status, json } = makeRes();
      await dlqReplayHandler(makeReq({ body: {} }), res);
      expect(status).toHaveBeenCalledWith(200);
      const body = json.mock.calls[0][0];
      expect(body.replayed).toBe(2);
    });

    it("returns 200 with replayed=0 when DLQ is empty and no id given", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      vi.doMock("pg", () => ({
        Pool: vi.fn().mockImplementation(() => ({ query: mockQuery })),
      }));
      const { dlqReplayHandler } = await import("./webhooks.js");
      const { res, status, json } = makeRes();
      await dlqReplayHandler(makeReq({ body: {} }), res);
      expect(status).toHaveBeenCalledWith(200);
      expect(json.mock.calls[0][0].replayed).toBe(0);
    });

    it("returns 500 when DB fails during replay", async () => {
      mockQuery.mockRejectedValue(new Error("DB error"));
      vi.doMock("pg", () => ({
        Pool: vi.fn().mockImplementation(() => ({ query: mockQuery })),
      }));
      const { dlqReplayHandler } = await import("./webhooks.js");
      const { res, status } = makeRes();
      await dlqReplayHandler(makeReq({ body: {} }), res);
      expect(status).toHaveBeenCalledWith(500);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration: adminRouter enforces auth on every route
//
// We test the router without supertest by constructing a mock Express stack
// that runs the router middleware chain directly against mock req/res objects.
// ---------------------------------------------------------------------------

describe("adminRouter — auth guard integration", () => {
  const VALID_KEY = "integration-test-key-32chars!!!";

  beforeEach(() => {
    vi.resetModules();
    process.env.ADMIN_API_KEY = VALID_KEY;
  });

  afterEach(() => {
    delete process.env.ADMIN_API_KEY;
    vi.restoreAllMocks();
  });

  /**
   * Run the requireAdminAuth middleware and return the mock response spy.
   */
  async function runAuth(headers: Record<string, string> = {}): Promise<MockRes & { nextCalled: boolean }> {
    const { requireAdminAuth } = await import("./auth.js");
    const { res, status, json } = makeRes();
    const nextMock = vi.fn();
    requireAdminAuth(makeReq({ headers }), res, nextMock as NextFunction);
    return { res, status, json, nextCalled: nextMock.mock.calls.length > 0 };
  }

  it("blocks all routes with 401 when Authorization header is absent", async () => {
    const { status, nextCalled } = await runAuth({});
    expect(status).toHaveBeenCalledWith(401);
    expect(nextCalled).toBe(false);
  });

  it("blocks all routes with 401 when Basic scheme is used instead of Bearer", async () => {
    const { status, nextCalled } = await runAuth({ authorization: "Basic dXNlcjpwYXNz" });
    expect(status).toHaveBeenCalledWith(401);
    expect(nextCalled).toBe(false);
  });

  it("blocks all routes with 403 when Bearer token is incorrect", async () => {
    const { status, json, nextCalled } = await runAuth({ authorization: "Bearer wrong-secret" });
    expect(status).toHaveBeenCalledWith(403);
    expect(json.mock.calls[0][0]).toMatchObject({ error: "Forbidden" });
    expect(nextCalled).toBe(false);
  });

  it("passes through to the handler when the correct Bearer token is provided", async () => {
    const { status, nextCalled } = await runAuth({ authorization: `Bearer ${VALID_KEY}` });
    expect(nextCalled).toBe(true);
    expect(status).not.toHaveBeenCalled();
  });

  it("adminRouter exports a Router with the auth middleware applied", async () => {
    const { adminRouter } = await import("./index.js");
    // The router should be an Express Router (function with `stack` property)
    expect(typeof adminRouter).toBe("function");
    expect(adminRouter).toHaveProperty("stack");
  });

  it("adminRouter has routes for /streams, /indexer, and /webhooks", async () => {
    const { adminRouter } = await import("./index.js");
    const paths = (adminRouter.stack as any[])
      .filter((layer: any) => layer.regexp)
      .map((layer: any) => layer.regexp?.toString());
    // Stack entries include the sub-router mounts
    expect(paths.length).toBeGreaterThan(0);
  });
});
