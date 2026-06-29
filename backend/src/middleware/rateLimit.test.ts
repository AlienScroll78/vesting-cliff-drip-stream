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
    socket: { remoteAddress: "1.2.3.4" },
    ...overrides,
  } as unknown as Request;
}

function makeRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; setHeader: ReturnType<typeof vi.fn> } {
  const res = {} as Response;
  res.setHeader = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return { res, status: res.status as ReturnType<typeof vi.fn>, json: res.json as ReturnType<typeof vi.fn>, setHeader: res.setHeader as ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  store.clear();
  ttlStore.clear();
  delete process.env.RATE_LIMIT_IP_MAX;
  delete process.env.RATE_LIMIT_KEY_MAX;
  delete process.env.RATE_LIMIT_WINDOW_SEC;
  delete process.env.RATE_LIMIT_BYPASS_IPS;
  delete process.env.RATE_LIMIT_BYPASS_KEYS;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("rateLimitMiddleware", () => {
  it("passes request under the limit (first request, limit=5)", async () => {
    // With an empty store, first incr returns 1 which is ≤ 5
    process.env.RATE_LIMIT_IP_MAX = "5";
    const next = vi.fn() as NextFunction;
    const { res } = makeRes();
    await rateLimitMiddleware(makeReq(), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 429 with Retry-After when IP limit exceeded", async () => {
    process.env.RATE_LIMIT_IP_MAX = "2";
    // Pre-fill so incr returns 3 > 2
    store.set("rl:ip:1.2.3.4", 2);
    ttlStore.set("rl:ip:1.2.3.4", 45);

    const next = vi.fn() as NextFunction;
    const { res, status, json, setHeader } = makeRes();
    await rateLimitMiddleware(makeReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: "Too Many Requests" }));
    expect(setHeader).toHaveBeenCalledWith("Retry-After", 45);
  });

  it("uses API key bucket when X-Api-Key is present", async () => {
    process.env.RATE_LIMIT_KEY_MAX = "3";
    // Pre-fill so incr returns 4 > 3
    store.set("rl:key:mykey", 3);
    ttlStore.set("rl:key:mykey", 30);

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

  it("bypasses rate limit for whitelisted IP", async () => {
    process.env.RATE_LIMIT_BYPASS_IPS = "1.2.3.4";
    process.env.RATE_LIMIT_IP_MAX = "0"; // would block everything

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
