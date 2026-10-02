import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Mock redis so tests don't need a live instance
// ---------------------------------------------------------------------------

const store = new Map<string, number>();
const ttlStore = new Map<string, number>();

vi.mock("redis", () => ({
  createClient: () => ({
    connect: vi.fn(),
    on: vi.fn(),
    incr: vi.fn(async (key: string) => {
      const v = (store.get(key) ?? 0) + 1;
      store.set(key, v);
      return v;
    }),
    expire: vi.fn(async (key: string, ttl: number) => {
      ttlStore.set(key, ttl);
    }),
    ttl: vi.fn(async (key: string) => ttlStore.get(key) ?? 60),
  }),
}));

// Import AFTER mocking redis
const { rateLimitMiddleware } = await import("./rateLimit.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    path: "/api/other",
    socket: { remoteAddress: "1.2.3.4" },
    ...overrides,
  } as unknown as Request;
}

function makeWriteReq(path = "/api/streams"): Request {
  return makeReq({ path });
}

function makeRes(): {
  res: Response;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
} {
  const res = {} as Response;
  res.setHeader = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return {
    res,
    status: res.status as ReturnType<typeof vi.fn>,
    json: res.json as ReturnType<typeof vi.fn>,
    setHeader: res.setHeader as ReturnType<typeof vi.fn>,
  };
}

beforeEach(() => {
  store.clear();
  ttlStore.clear();
  delete process.env.RATE_LIMIT_IP_MAX;
  delete process.env.RATE_LIMIT_KEY_MAX;
  delete process.env.RATE_LIMIT_WRITE_MAX;
  delete process.env.RATE_LIMIT_WINDOW_SEC;
  delete process.env.RATE_LIMIT_BYPASS_IPS;
  delete process.env.RATE_LIMIT_BYPASS_KEYS;
});

// ---------------------------------------------------------------------------
// Standard IP limit tests
// ---------------------------------------------------------------------------

describe("rateLimitMiddleware – standard IP limit", () => {
  it("passes request under the limit (first request, limit=5)", async () => {
    process.env.RATE_LIMIT_IP_MAX = "5";
    const next = vi.fn() as NextFunction;
    const { res } = makeRes();
    await rateLimitMiddleware(makeReq(), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 429 with Retry-After when IP limit exceeded", async () => {
    process.env.RATE_LIMIT_IP_MAX = "2";
    // Pre-fill so incr returns 3 > 2
    store.set("ratelimit:ip:1.2.3.4:60", 2);
    ttlStore.set("ratelimit:ip:1.2.3.4:60", 45);

    const next = vi.fn() as NextFunction;
    const { res, status, json, setHeader } = makeRes();
    await rateLimitMiddleware(makeReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Too Many Requests" })
    );
    expect(setHeader).toHaveBeenCalledWith("Retry-After", 45);
  });

  it("sets X-RateLimit-* headers on every request", async () => {
    process.env.RATE_LIMIT_IP_MAX = "100";
    const next = vi.fn() as NextFunction;
    const { res, setHeader } = makeRes();
    await rateLimitMiddleware(makeReq(), res, next);

    expect(setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", 100);
    expect(setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", expect.any(Number));
    expect(setHeader).toHaveBeenCalledWith("X-RateLimit-Reset", expect.any(Number));
  });
});

// ---------------------------------------------------------------------------
// Write endpoint stricter limit tests (Issue #551)
// ---------------------------------------------------------------------------

describe("rateLimitMiddleware – write endpoint stricter limit", () => {
  it("applies write limit to /api/streams (POST)", async () => {
    process.env.RATE_LIMIT_WRITE_MAX = "2";
    process.env.RATE_LIMIT_IP_MAX = "100";
    // Pre-fill write bucket so incr returns 3 > 2
    store.set("ratelimit:ip:1.2.3.4:write:60", 2);
    ttlStore.set("ratelimit:ip:1.2.3.4:write:60", 30);

    const next = vi.fn() as NextFunction;
    const { res, status } = makeRes();
    await rateLimitMiddleware(makeWriteReq("/api/streams"), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(429);
  });

  it("applies write limit to /api/cancel", async () => {
    process.env.RATE_LIMIT_WRITE_MAX = "2";
    store.set("ratelimit:ip:1.2.3.4:write:60", 2);
    ttlStore.set("ratelimit:ip:1.2.3.4:write:60", 20);

    const next = vi.fn() as NextFunction;
    const { res, status } = makeRes();
    await rateLimitMiddleware(makeWriteReq("/api/cancel"), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(429);
  });

  it("applies write limit to /api/claim", async () => {
    process.env.RATE_LIMIT_WRITE_MAX = "2";
    store.set("ratelimit:ip:1.2.3.4:write:60", 2);
    ttlStore.set("ratelimit:ip:1.2.3.4:write:60", 20);

    const next = vi.fn() as NextFunction;
    const { res, status } = makeRes();
    await rateLimitMiddleware(makeWriteReq("/api/claim"), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(429);
  });

  it("passes write request within write limit", async () => {
    process.env.RATE_LIMIT_WRITE_MAX = "10";
    const next = vi.fn() as NextFunction;
    const { res } = makeRes();
    await rateLimitMiddleware(makeWriteReq("/api/streams"), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("sets X-RateLimit-Limit to write limit for write endpoints", async () => {
    process.env.RATE_LIMIT_WRITE_MAX = "10";
    const next = vi.fn() as NextFunction;
    const { res, setHeader } = makeRes();
    await rateLimitMiddleware(makeWriteReq("/api/streams"), res, next);

    expect(setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", 10);
  });

  it("read endpoint does NOT use write limit bucket", async () => {
    process.env.RATE_LIMIT_WRITE_MAX = "1";
    process.env.RATE_LIMIT_IP_MAX = "100";

    // Fill the write bucket (should not affect read)
    store.set("ratelimit:ip:1.2.3.4:write:60", 99);

    const next = vi.fn() as NextFunction;
    const { res } = makeRes();
    // GET /api/schedule is not a write endpoint
    await rateLimitMiddleware(makeReq({ path: "/api/schedule" }), res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// API key limit tests
// ---------------------------------------------------------------------------

describe("rateLimitMiddleware – API key limit", () => {
  it("uses API key bucket when X-Api-Key is present", async () => {
    process.env.RATE_LIMIT_KEY_MAX = "3";
    store.set("ratelimit:key:mykey:60", 3);
    ttlStore.set("ratelimit:key:mykey:60", 30);

    const next = vi.fn() as NextFunction;
    const { res, status } = makeRes();
    await rateLimitMiddleware(
      makeReq({ headers: { "x-api-key": "mykey" } } as Partial<Request>),
      res,
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(429);
  });

  it("API key takes precedence over write limit on write endpoints", async () => {
    process.env.RATE_LIMIT_KEY_MAX = "1000";
    process.env.RATE_LIMIT_WRITE_MAX = "0"; // write limit would block everything

    const next = vi.fn() as NextFunction;
    const { res } = makeRes();
    await rateLimitMiddleware(
      makeReq({
        path: "/api/streams",
        headers: { "x-api-key": "svc-key" },
      } as Partial<Request>),
      res,
      next
    );
    expect(next).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Bypass whitelist tests
// ---------------------------------------------------------------------------

describe("rateLimitMiddleware – bypass whitelist", () => {
  it("bypasses rate limit for whitelisted IP", async () => {
    process.env.RATE_LIMIT_BYPASS_IPS = "1.2.3.4";
    process.env.RATE_LIMIT_IP_MAX = "0";

    const next = vi.fn() as NextFunction;
    const { res } = makeRes();
    await rateLimitMiddleware(makeReq(), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("bypasses rate limit for whitelisted API key", async () => {
    process.env.RATE_LIMIT_BYPASS_KEYS = "internal-svc";
    process.env.RATE_LIMIT_KEY_MAX = "0";

    const next = vi.fn() as NextFunction;
    const { res } = makeRes();
    await rateLimitMiddleware(
      makeReq({ headers: { "x-api-key": "internal-svc" } } as Partial<Request>),
      res,
      next
    );
    expect(next).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Redis key format verification (Issue #551 acceptance criteria)
// ---------------------------------------------------------------------------

describe("Redis key format", () => {
  it("uses ratelimit:{ip}:{window} format for standard IP requests", async () => {
    process.env.RATE_LIMIT_IP_MAX = "100";
    process.env.RATE_LIMIT_WINDOW_SEC = "60";
    const next = vi.fn() as NextFunction;
    const { res } = makeRes();
    await rateLimitMiddleware(makeReq(), res, next);

    // The store should contain a key with the ratelimit: prefix
    const keys = [...store.keys()];
    expect(keys.some((k) => k.startsWith("ratelimit:"))).toBe(true);
    expect(keys.some((k) => k.includes("1.2.3.4"))).toBe(true);
    expect(keys.some((k) => k.includes("60"))).toBe(true);
  });
});
