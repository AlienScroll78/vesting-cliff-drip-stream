/**
 * Tests for idempotencyMiddleware (issue #569 — Redis-backed deduplication).
 *
 * createRedisClient is mocked so tests run without a real Redis instance.
 * When the mock throws, the middleware falls back to the in-memory Map.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { clearIdempotencyCache, idempotencyMiddleware } from "../middleware/idempotency.js";

// ── Mock Redis client ──────────────────────────────────────────────────────────

/** Minimal in-process Redis substitute for unit tests. */
function buildMockRedisClient() {
  const store = new Map<string, string>();

  return {
    store,
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string, _opts?: { EX?: number }): Promise<void> {
      store.set(key, value);
    },
    isOpen: true,
  };
}

// Mock the redisClient module so createRedisClient returns our fake.
vi.mock("../redisClient.js", () => ({
  createRedisClient: vi.fn(),
}));

// Import *after* vi.mock so we get the mocked version.
import { createRedisClient } from "../redisClient.js";
const mockCreateRedisClient = vi.mocked(createRedisClient);

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Create a minimal mock Request. */
function makeReq(
  method: string,
  headers: Record<string, string> = {},
  ip = "127.0.0.1"
): Request {
  return {
    method,
    headers,
    ip,
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

/** Create a minimal mock Response that captures status + body. */
function makeRes(): Response & { _status: number; _body: unknown; _headers: Record<string, string> } {
  const r = {
    _status: 200,
    _body: null as unknown,
    _headers: {} as Record<string, string>,
    get statusCode() { return this._status; },
    set statusCode(v: number) { this._status = v; },
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
    set(header: string, value: string) { this._headers[header.toLowerCase()] = value; return this; },
  };
  return r as unknown as Response & { _status: number; _body: unknown; _headers: Record<string, string> };
}

/** Run the middleware and wait for it to complete (it is async internally). */
async function runMiddleware(
  req: Request,
  res: Response,
  handler?: (req: Request, res: Response) => void
): Promise<void> {
  return new Promise((resolve) => {
    const next: NextFunction = () => {
      if (handler) handler(req, res);
      resolve();
    };
    idempotencyMiddleware(req, res, next);

    // Allow async work (Redis calls) to complete.
    setTimeout(resolve, 50);
  });
}

// ── Test suites ────────────────────────────────────────────────────────────────

describe("idempotencyMiddleware — Redis-backed", () => {
  let mockRedis: ReturnType<typeof buildMockRedisClient>;

  beforeEach(() => {
    clearIdempotencyCache();
    mockRedis = buildMockRedisClient();
    mockCreateRedisClient.mockResolvedValue(mockRedis as never);
  });

  // ── Method filtering ─────────────────────────────────────────────────────────

  it("passes through GET requests without checking idempotency key", async () => {
    const req = makeReq("GET", { "idempotency-key": "k1" });
    const res = makeRes();
    let nextCalled = false;
    await runMiddleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it("passes through PUT requests (only POST and DELETE are deduplicated)", async () => {
    const req = makeReq("PUT", { "idempotency-key": "k1" });
    const res = makeRes();
    let nextCalled = false;
    await runMiddleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it("passes through POST requests without Idempotency-Key header", async () => {
    const req = makeReq("POST");
    const res = makeRes();
    let nextCalled = false;
    await runMiddleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  // ── DELETE support ───────────────────────────────────────────────────────────

  it("deduplicates DELETE requests with Idempotency-Key header", async () => {
    const key = "del-key-1";
    const ip = "10.0.0.1";

    // First DELETE — should call next and cache the response.
    const req1 = makeReq("DELETE", { "idempotency-key": key }, ip);
    const res1 = makeRes();
    await runMiddleware(req1, res1, (_req, r) => {
      (r as typeof res1)._status = 200;
      r.json({ deleted: true });
    });

    // Second DELETE — should be a cache hit.
    const req2 = makeReq("DELETE", { "idempotency-key": key }, ip);
    const res2 = makeRes();
    let secondNextCalled = false;
    await runMiddleware(req2, res2, () => { secondNextCalled = true; });

    expect(secondNextCalled).toBe(false);
    expect(res2._headers["x-idempotent-replay"]).toBe("true");
    expect(res2._body).toEqual({ deleted: true });
  });

  // ── Redis key format ─────────────────────────────────────────────────────────

  it("stores keys in format idempotency:{key}:{ip}", async () => {
    const key = "my-idempotency-key";
    const ip = "192.168.1.50";
    const req = makeReq("POST", { "idempotency-key": key }, ip);
    const res = makeRes();

    await runMiddleware(req, res, (_req, r) => {
      (r as typeof res)._status = 201;
      r.json({ created: true });
    });

    const expectedRedisKey = `idempotency:${key}:${ip}`;
    expect(mockRedis.store.has(expectedRedisKey)).toBe(true);
  });

  it("uses req.socket.remoteAddress when req.ip is absent", async () => {
    const key = "sock-key";
    const socketIp = "172.16.0.5";
    const req = {
      method: "POST",
      headers: { "idempotency-key": key },
      ip: undefined,
      socket: { remoteAddress: socketIp },
    } as unknown as Request;
    const res = makeRes();

    await runMiddleware(req, res, (_req, r) => {
      r.json({ ok: true });
    });

    const expectedKey = `idempotency:${key}:${socketIp}`;
    expect(mockRedis.store.has(expectedKey)).toBe(true);
  });

  it("falls back to 'unknown' IP when neither req.ip nor socket.remoteAddress is set", async () => {
    const key = "unknown-ip-key";
    const req = {
      method: "POST",
      headers: { "idempotency-key": key },
      ip: undefined,
      socket: {},
    } as unknown as Request;
    const res = makeRes();

    await runMiddleware(req, res, (_req, r) => {
      r.json({ ok: true });
    });

    const expectedKey = `idempotency:${key}:unknown`;
    expect(mockRedis.store.has(expectedKey)).toBe(true);
  });

  // ── Cache hit / replay ───────────────────────────────────────────────────────

  it("returns cached response with X-Idempotent-Replay: true on second identical POST", async () => {
    const key = "replay-key";
    const ip = "10.0.0.2";

    // First request — populate cache.
    const req1 = makeReq("POST", { "idempotency-key": key }, ip);
    const res1 = makeRes();
    await runMiddleware(req1, res1, (_req, r) => {
      (r as typeof res1)._status = 201;
      r.json({ id: 42 });
    });

    // Second request — expect replay.
    const req2 = makeReq("POST", { "idempotency-key": key }, ip);
    const res2 = makeRes();
    let nextCalledOnReplay = false;
    await runMiddleware(req2, res2, () => { nextCalledOnReplay = true; });

    expect(nextCalledOnReplay).toBe(false);
    expect(res2._headers["x-idempotent-replay"]).toBe("true");
    expect(res2._body).toEqual({ id: 42 });
    expect(res2._status).toBe(201);
  });

  // ── Different IPs — same key → separate cache entries ────────────────────────

  it("treats the same idempotency key from different IPs as distinct", async () => {
    const key = "shared-key";

    const req1 = makeReq("POST", { "idempotency-key": key }, "1.2.3.4");
    const res1 = makeRes();
    let next1Called = false;
    await runMiddleware(req1, res1, () => { next1Called = true; });

    const req2 = makeReq("POST", { "idempotency-key": key }, "5.6.7.8");
    const res2 = makeRes();
    let next2Called = false;
    await runMiddleware(req2, res2, () => { next2Called = true; });

    expect(next1Called).toBe(true);
    expect(next2Called).toBe(true);
  });

  // ── 5xx responses are not cached ─────────────────────────────────────────────

  it("does not cache 5xx responses", async () => {
    const key = "error-key";
    const ip = "10.0.0.3";

    // First request returns 500 — should NOT be cached.
    const req1 = makeReq("POST", { "idempotency-key": key }, ip);
    const res1 = makeRes();
    await runMiddleware(req1, res1, (_req, r) => {
      (r as typeof res1)._status = 500;
      r.json({ error: "internal" });
    });

    const redisKey = `idempotency:${key}:${ip}`;
    expect(mockRedis.store.has(redisKey)).toBe(false);

    // Second request should reach next() again.
    const req2 = makeReq("POST", { "idempotency-key": key }, ip);
    const res2 = makeRes();
    let next2Called = false;
    await runMiddleware(req2, res2, () => { next2Called = true; });
    expect(next2Called).toBe(true);
  });

  // ── No auth requirement ───────────────────────────────────────────────────────

  it("does not require Authorization header — uses IP for deduplication", async () => {
    const req = makeReq("POST", { "idempotency-key": "no-auth-key" }, "1.1.1.1");
    const res = makeRes();
    let nextCalled = false;
    await runMiddleware(req, res, () => { nextCalled = true; });

    // No 401 should be returned; next() should be called.
    expect(nextCalled).toBe(true);
    expect(res._status).not.toBe(401);
  });
});

// ── In-memory fallback when Redis is unavailable ──────────────────────────────

describe("idempotencyMiddleware — in-memory fallback (Redis unavailable)", () => {
  beforeEach(() => {
    clearIdempotencyCache();
    // Simulate Redis being unavailable.
    mockCreateRedisClient.mockRejectedValue(new Error("Redis connection refused"));
  });

  it("falls through to next() on the first request when Redis is down", async () => {
    const req = makeReq("POST", { "idempotency-key": "fallback-key" }, "10.0.0.10");
    const res = makeRes();
    let nextCalled = false;
    await runMiddleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it("deduplicates using in-memory Map when Redis is unavailable", async () => {
    const key = "mem-fallback";
    const ip = "10.0.0.11";

    // First request — caches in memory.
    const req1 = makeReq("POST", { "idempotency-key": key }, ip);
    const res1 = makeRes();
    await runMiddleware(req1, res1, (_req, r) => {
      (r as typeof res1)._status = 201;
      r.json({ value: "first" });
    });

    // Second request — should hit memory cache.
    const req2 = makeReq("POST", { "idempotency-key": key }, ip);
    const res2 = makeRes();
    let next2Called = false;
    await runMiddleware(req2, res2, () => { next2Called = true; });

    expect(next2Called).toBe(false);
    expect(res2._headers["x-idempotent-replay"]).toBe("true");
    expect(res2._body).toEqual({ value: "first" });
  });
});

// ── clearIdempotencyCache ─────────────────────────────────────────────────────

describe("clearIdempotencyCache", () => {
  beforeEach(() => {
    clearIdempotencyCache();
    mockCreateRedisClient.mockRejectedValue(new Error("Redis unavailable"));
  });

  it("clears the in-memory fallback so subsequent requests are treated as new", async () => {
    const key = "clear-test";
    const ip = "10.0.0.20";

    const req1 = makeReq("POST", { "idempotency-key": key }, ip);
    const res1 = makeRes();
    await runMiddleware(req1, res1, (_req, r) => {
      r.json({ round: 1 });
    });

    // Clear cache.
    clearIdempotencyCache();
    // After clear, Redis unavailability flag is also reset — keep it unavailable.
    mockCreateRedisClient.mockRejectedValue(new Error("Redis unavailable"));

    const req2 = makeReq("POST", { "idempotency-key": key }, ip);
    const res2 = makeRes();
    let next2Called = false;
    await runMiddleware(req2, res2, () => { next2Called = true; });

    expect(next2Called).toBe(true);
    expect(res2._headers["x-idempotent-replay"]).toBeUndefined();
  });
});
