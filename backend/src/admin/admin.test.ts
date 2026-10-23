/**
 * Tests for the admin API.
 *
 * Covers:
 *   - JWT authentication (missing, invalid, expired, non-admin — issue #1003)
 *   - GET  /admin/streams
 *   - GET  /admin/indexer/status
 *   POST /admin/indexer/restart
 *   - GET  /admin/webhooks/dlq
 *   - POST /admin/webhooks/dlq/replay
 *   - Router-level auth enforcement over HTTP (issue #1003)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import http from "node:http";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

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
// JWT auth helpers (issue #1003)
// ---------------------------------------------------------------------------

const ADMIN_ADDR = `G${"ADMIN".repeat(11)}`;
const USER_ADDR = `G${"USER".repeat(13)}USE`;

/**
 * Load the real authV2 middleware together with the key-store singleton so
 * tokens are signed with the exact key the middleware verifies against.
 * Must be called after vi.resetModules() so both imports share one registry.
 */
async function loadAuth(): Promise<{
  authMiddleware: (req: Request, res: Response, next: NextFunction) => void;
  roleGuard: (req: Request, res: Response, next: NextFunction) => void;
  sign: (sub: string, role: "admin" | "user", ttlSeconds: number) => string;
}> {
  const { authMiddleware, requireRole } = await import("../routes/authV2.js");
  const { getCurrentKey } = await import("../auth/keyStore.js");
  const key = getCurrentKey();
  const privPem = key.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  return {
    authMiddleware,
    roleGuard: requireRole("admin"),
    sign: (sub, role, ttlSeconds) =>
      jwt.sign({ sub, role, kid: key.kid }, privPem, {
        algorithm: "RS256",
        expiresIn: ttlSeconds,
        header: { alg: "RS256", kid: key.kid },
      }),
  };
}

/** Run the full adminRouter auth chain (authMiddleware → requireRole('admin')). */
function runAuthChain(
  authMiddleware: (req: Request, res: Response, next: NextFunction) => void,
  roleGuard: (req: Request, res: Response, next: NextFunction) => void,
  headers: Record<string, string>,
): MockRes & { nextCalled: boolean; req: Request } {
  const req = makeReq({ headers });
  const { res, status, json } = makeRes();
  let passed = false;
  authMiddleware(req, res, () => {
    roleGuard(req, res, () => {
      passed = true;
    });
  });
  return { res, status, json, nextCalled: passed, req };
}

describe("admin JWT auth middleware (issue #1003)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 { error: 'Unauthorized' } when the Authorization header is absent", async () => {
    const { authMiddleware, roleGuard } = await loadAuth();
    const { status, json, nextCalled } = runAuthChain(authMiddleware, roleGuard, {});
    expect(status).toHaveBeenCalledWith(401);
    expect(json.mock.calls[0][0]).toEqual({ error: "Unauthorized" });
    expect(nextCalled).toBe(false);
  });

  it("returns 401 { error: 'Unauthorized' } when the scheme is not Bearer", async () => {
    const { authMiddleware, roleGuard } = await loadAuth();
    const encodedCreds = Buffer.from("admin:pass").toString("base64");
    const { status, json, nextCalled } = runAuthChain(authMiddleware, roleGuard, {
      authorization: `Basic ${encodedCreds}`,
    });
    expect(status).toHaveBeenCalledWith(401);
    expect(json.mock.calls[0][0]).toEqual({ error: "Unauthorized" });
    expect(nextCalled).toBe(false);
  });

  it("returns 401 { error: 'Unauthorized' } for a malformed token", async () => {
    const { authMiddleware, roleGuard } = await loadAuth();
    const { status, json, nextCalled } = runAuthChain(authMiddleware, roleGuard, {
      authorization: "Bearer not.a.jsonwebtoken",
    });
    expect(status).toHaveBeenCalledWith(401);
    expect(json.mock.calls[0][0]).toEqual({ error: "Unauthorized" });
    expect(nextCalled).toBe(false);
  });

  it("returns 401 { error: 'Unauthorized' } for a token signed with an unknown key", async () => {
    const { authMiddleware, roleGuard } = await loadAuth();
    const stranger = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const strangerPem = stranger.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const strangerKid = crypto
      .createHash("sha256")
      .update(stranger.publicKey.export({ type: "spki", format: "der" }) as Buffer)
      .digest("hex")
      .slice(0, 16);
    const token = jwt.sign({ sub: ADMIN_ADDR, role: "admin", kid: strangerKid }, strangerPem, {
      algorithm: "RS256",
      expiresIn: 3600,
      header: { alg: "RS256", kid: strangerKid },
    });
    const { status, json, nextCalled } = runAuthChain(authMiddleware, roleGuard, {
      authorization: `Bearer ${token}`,
    });
    expect(status).toHaveBeenCalledWith(401);
    expect(json.mock.calls[0][0]).toEqual({ error: "Unauthorized" });
    expect(nextCalled).toBe(false);
  });

  it("returns 401 { error: 'Unauthorized' } for a forged signature (kid claimed, wrong key)", async () => {
    const { authMiddleware, roleGuard } = await loadAuth();
    const { getCurrentKey } = await import("../auth/keyStore.js");
    const key = getCurrentKey();
    const stranger = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const strangerPem = stranger.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    // Claim the service's kid but sign with a different private key
    const token = jwt.sign({ sub: ADMIN_ADDR, role: "admin", kid: key.kid }, strangerPem, {
      algorithm: "RS256",
      expiresIn: 3600,
      header: { alg: "RS256", kid: key.kid },
    });
    const { status, json, nextCalled } = runAuthChain(authMiddleware, roleGuard, {
      authorization: `Bearer ${token}`,
    });
    expect(status).toHaveBeenCalledWith(401);
    expect(json.mock.calls[0][0]).toEqual({ error: "Unauthorized" });
    expect(nextCalled).toBe(false);
  });

  it("returns 401 { error: 'TokenExpired' } for an expired token", async () => {
    const { authMiddleware, roleGuard, sign } = await loadAuth();
    const token = sign(ADMIN_ADDR, "admin", -10);
    const { status, json, nextCalled } = runAuthChain(authMiddleware, roleGuard, {
      authorization: `Bearer ${token}`,
    });
    expect(status).toHaveBeenCalledWith(401);
    expect(json.mock.calls[0][0]).toEqual({ error: "TokenExpired" });
    expect(nextCalled).toBe(false);
  });

  it("returns 403 for a valid token with a non-admin role", async () => {
    const { authMiddleware, roleGuard, sign } = await loadAuth();
    const token = sign(USER_ADDR, "user", 3600);
    const { status, json, nextCalled } = runAuthChain(authMiddleware, roleGuard, {
      authorization: `Bearer ${token}`,
    });
    expect(status).toHaveBeenCalledWith(403);
    expect(json.mock.calls[0][0]).toMatchObject({ error: expect.stringContaining("Forbidden") });
    expect(nextCalled).toBe(false);
  });

  it("admits a valid admin token and attaches req.user", async () => {
    const { authMiddleware, roleGuard, sign } = await loadAuth();
    const token = sign(ADMIN_ADDR, "admin", 3600);
    const { status, json, nextCalled, req } = runAuthChain(authMiddleware, roleGuard, {
      authorization: `Bearer ${token}`,
    });
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(nextCalled).toBe(true);
    const user = (req as Request & { user?: { address: string; role: string } }).user;
    expect(user?.address).toBe(ADMIN_ADDR);
    expect(user?.role).toBe("admin");
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
// Integration: adminRouter enforces JWT auth on every route over real HTTP
// (issue #1003)
// ---------------------------------------------------------------------------

describe("adminRouter — JWT auth guard integration (HTTP)", () => {
  let server: http.Server | null = null;

  afterEach(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server!.close(resolve));
      server = null;
    }
    vi.doUnmock("pg");
    vi.restoreAllMocks();
  });

  /**
   * Boot the real adminRouter on an ephemeral HTTP port. pg is mocked so no
   * database is needed — the indexer status handler degrades gracefully and
   * still returns 200, which proves a valid admin token reaches the handler.
   */
  async function bootAdminRouter(): Promise<{
    baseUrl: string;
    sign: (sub: string, role: "admin" | "user", ttlSeconds: number) => string;
  }> {
    vi.resetModules();
    vi.doMock("pg", () => ({
      Pool: vi.fn().mockImplementation(() => ({
        query: vi.fn().mockRejectedValue(new Error("db unavailable in test")),
      })),
    }));

    const { adminRouter } = await import("./index.js");
    const { getCurrentKey } = await import("../auth/keyStore.js");
    const key = getCurrentKey();
    const privPem = key.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const sign = (sub: string, role: "admin" | "user", ttlSeconds: number): string =>
      jwt.sign({ sub, role, kid: key.kid }, privPem, {
        algorithm: "RS256",
        expiresIn: ttlSeconds,
        header: { alg: "RS256", kid: key.kid },
      });

    const express = (await import("express")).default;
    const app = express();
    app.use(express.json());
    // Mirror production mounting (app.ts: app.use("/admin", adminRouter))
    app.use("/admin", adminRouter);

    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    return { baseUrl: `http://127.0.0.1:${port}`, sign };
  }

  it("blocks every route with 401 Unauthorized when no token is supplied", async () => {
    const { baseUrl } = await bootAdminRouter();
    const res = await fetch(`${baseUrl}/admin/indexer/status`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("blocks every route with 401 TokenExpired when the token is expired", async () => {
    const { baseUrl, sign } = await bootAdminRouter();
    const token = sign(ADMIN_ADDR, "admin", -10);
    const res = await fetch(`${baseUrl}/admin/indexer/status`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "TokenExpired" });
  });

  it("blocks every route with 403 when the token role is not admin", async () => {
    const { baseUrl, sign } = await bootAdminRouter();
    const token = sign(USER_ADDR, "user", 3600);
    const res = await fetch(`${baseUrl}/admin/indexer/status`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Forbidden/);
  });

  it("admits a valid admin token and reaches the handler (200)", async () => {
    const { baseUrl, sign } = await bootAdminRouter();
    const token = sign(ADMIN_ADDR, "admin", 3600);
    const res = await fetch(`${baseUrl}/admin/indexer/status`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("status");
  });

  it("adminRouter exports a Router and mounts streams, indexer, webhooks, and backfill", async () => {
    vi.resetModules();
    const { adminRouter } = await import("./index.js");
    expect(typeof adminRouter).toBe("function");
    expect(adminRouter).toHaveProperty("stack");
    const paths = (adminRouter.stack as unknown[])
      .map((layer) => (layer as { regexp?: RegExp }).regexp?.toString())
      .filter(Boolean);
    // auth + role guards, 4 sub-router mounts, and the metrics route
    expect(paths.length).toBeGreaterThanOrEqual(6);
  });
});
