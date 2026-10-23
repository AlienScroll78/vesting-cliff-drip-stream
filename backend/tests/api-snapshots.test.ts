/**
 * Issue #1062 — API response snapshot tests.
 *
 * These tests lock down the JSON *shape* of the backend's public read
 * endpoints so that an accidental breaking change (a renamed field, a
 * changed type, a dropped key) fails CI with a readable diff instead of
 * silently breaking the frontend.
 *
 * Covered endpoints:
 *   - GET /api/streams            (sponsor stream list)
 *   - GET /api/streams/:recipient (stream detail)
 *   - GET /api/claimable-batch    (batch claimable amounts)
 *   - GET /health                 (service health)
 *
 * Running the suite:
 *   npm run test:snapshots              — verify against committed snapshots
 *   npm run test:snapshots:update       — rewrite snapshots intentionally
 *
 * Snapshots live in `backend/tests/__snapshots__/` and MUST be committed.
 */

import type { Server } from "http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TEST_CONTRACT_ID,
  TEST_RECIPIENT_A,
  TEST_RECIPIENT_B,
  TEST_SPONSOR,
  resetSimulatedResults,
  setSimulatedResults,
} from "./mocks/stellar-sdk";

// ── Mocks ────────────────────────────────────────────────────────────────────
// The Stellar SDK is aliased to the local stub (vitest.snapshot.config.ts).
// `pg` and `redis` are mocked here so no live services are required.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("pg", () => {
  class Pool {
    constructor(public readonly options: unknown) {}
    query(...args: unknown[]) {
      return queryMock(...args);
    }
  }
  return { Pool, default: { Pool } };
});

vi.mock("redis", () => {
  const store = new Map<string, string>();
  const client = {
    isOpen: true,
    on: () => {},
    connect: async () => {},
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    },
    ping: async () => "PONG",
  };
  return {
    createClient: () => client,
    default: { createClient: () => client },
  };
});

vi.mock("../src/db.js", () => ({
  pool: { query: queryMock },
  query: queryMock,
  checkDbHealth: vi.fn(async () => true),
  default: { pool: { query: queryMock } },
}));

// The real logger pulls in `pino` and `pg`; keep the snapshot suite free of
// both so it stays hermetic and fast.
vi.mock("../src/logger.js", () => {
  const noop = () => {};
  const logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
  };
  return {
    logger,
    correlationStorage: { getStore: () => undefined, run: (_s: unknown, fn: () => unknown) => fn() },
    getRequestId: () => "00000000-0000-4000-8000-000000000000",
    getTraceId: () => "00000000000000000000000000000000",
    getCorrelationId: () => null,
    runWithIds: (_ids: unknown, fn: () => unknown) => fn(),
    runWithCorrelationId: (_id: unknown, fn: () => unknown) => fn(),
    redactAddress: (address: string) => address,
    redactSensitive: (value: unknown) => value,
    default: logger,
  };
});

vi.mock("../src/horizonCircuitBreaker.js", () => ({
  horizonCircuitBreaker: {
    getState: () => ({ state: "closed", failureCount: 0, openedAt: null }),
  },
}));

// ── Deterministic fixtures ───────────────────────────────────────────────────

const RECIPIENT_A = TEST_RECIPIENT_A;
const RECIPIENT_B = TEST_RECIPIENT_B;
const SPONSOR = TEST_SPONSOR;

/** Stable ISO timestamp so snapshots never drift. */
const CREATED_AT = "2026-01-15T10:30:00.000Z";

const STREAM_ROWS = [
  {
    id: "3f1c9a52-6d4e-4a1b-9f77-2c0e6b8d4a11",
    recipient: RECIPIENT_A,
    sponsor: SPONSOR,
    token: "USDC",
    rate_per_ledger: "1000000",
    start_ledger: 1000,
    cliff_ledger: 2000,
    end_ledger: 9000,
    status: "active",
    created_at: CREATED_AT,
  },
  {
    id: "8b7d2e14-5c93-4f2a-8d61-1e4a9b3c7d02",
    recipient: RECIPIENT_B,
    sponsor: SPONSOR,
    token: "USDC",
    rate_per_ledger: "2500000",
    start_ledger: 1000,
    cliff_ledger: 2500,
    end_ledger: 12000,
    status: "pre_cliff",
    created_at: CREATED_AT,
  },
];

const DETAIL_ROW = {
  recipient: RECIPIENT_A,
  sponsor: SPONSOR,
  token: "USDC",
  rate: "1000000",
  cliff_ledger: 2000,
  end_ledger: 9000,
  total_deposited: "8000000000",
  total_claimed: "1000000000",
  status: "active",
  created_at: CREATED_AT,
};

// ── Server harness ───────────────────────────────────────────────────────────

let server: Server;
let baseUrl: string;

/**
 * Fields whose values change between runs (uptime counters, build version).
 * They are replaced with a stable placeholder so the snapshot only records
 * the response *shape*, not the particular deployment.
 */
const VOLATILE_FIELDS = ["uptime", "uptime_seconds", "version"] as const;

function normalize(body: any): any {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const clone: Record<string, unknown> = { ...body };
  for (const field of VOLATILE_FIELDS) {
    if (field in clone) clone[field] = "<volatile>";
  }
  return clone;
}

async function getJson(path: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://snapshot:snapshot@localhost:5432/snapshot";
  process.env.CONTRACT_ID ??= TEST_CONTRACT_ID;
  process.env.TESTNET_CONTRACT_ID ??= process.env.CONTRACT_ID;
  process.env.REDIS_URL ??= "redis://localhost:6379";
  // Pin the reported version so the snapshot does not depend on how the
  // suite was invoked (`npm run` vs. `npx vitest`).
  process.env.npm_package_version = "1.0.0";
  process.env.SERVICE_VERSION = "1.0.0";

  const { default: app } = await import("../src/app.js");

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  resetSimulatedResults();
  queryMock.mockReset();
  stubRpcHealthy();
});

/**
 * Replaces outbound (non-loopback) HTTP with a deterministic stub so the
 * suite never depends on a live Soroban RPC endpoint.
 */
function stubRpcHealthy(): void {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: any,
    init?: any,
  ) => {
    const url = typeof input === "string" ? input : (input?.url ?? "");
    if (url.includes("127.0.0.1") || url.includes("localhost")) {
      return realFetch(input, init);
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: "ok" }),
    } as any;
  }) as typeof fetch);
}

// ── GET /health ──────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("matches the healthy service snapshot", async () => {
    queryMock.mockResolvedValue({ rows: [{ "?column?": 1 }] });

    const { status, body } = await getJson("/health");

    expect(status).toBe(200);
    expect(normalize(body)).toMatchSnapshot();
  });

  it("matches the degraded service snapshot", async () => {
    queryMock.mockRejectedValue(new Error("connection refused"));

    const { status, body } = await getJson("/health");

    expect(status).toBe(503);
    expect(normalize(body)).toMatchSnapshot();
  });
});

// ── GET /streams & GET /api/streams ──────────────────────────────────────────

describe("GET /streams", () => {
  it("matches the sponsor stream list snapshot (GET /streams)", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("COUNT(*)")) {
        return { rows: [{ total: "2" }] };
      }
      return { rows: STREAM_ROWS };
    });

    const { status, body } = await getJson(
      `/streams?sponsor=${SPONSOR}&status=all&sort=created_at&page=1&limit=20`,
    );

    expect(status).toBe(200);
    expect(normalize(body)).toMatchSnapshot();
  });

  it("matches the sponsor stream list snapshot (GET /api/streams)", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("COUNT(*)")) {
        return { rows: [{ total: "2" }] };
      }
      return { rows: STREAM_ROWS };
    });

    const { status, body } = await getJson(
      `/api/streams?sponsor=${SPONSOR}&status=all&sort=created_at&page=1&limit=20`,
    );

    expect(status).toBe(200);
    expect(normalize(body)).toMatchSnapshot();
  });

  it("matches the empty stream list snapshot", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("COUNT(*)")) {
        return { rows: [{ total: "0" }] };
      }
      return { rows: [] };
    });

    const { status, body } = await getJson(`/streams?sponsor=${SPONSOR}`);

    expect(status).toBe(200);
    expect(normalize(body)).toMatchSnapshot();
  });

  it("matches the validation error snapshot", async () => {
    const { status, body } = await getJson("/streams?sponsor=not-an-address");

    expect(status).toBe(400);
    expect(normalize(body)).toMatchSnapshot();
  });
});

// ── GET /streams/:id & GET /api/streams/:recipient ───────────────────────────

describe("GET /streams/:id", () => {
  it("matches the stream detail snapshot (GET /streams/:id)", async () => {
    queryMock.mockResolvedValue({ rows: [DETAIL_ROW] });
    setSimulatedResults({ claimable_amount: 4250000n });

    const { status, body } = await getJson(`/streams/${RECIPIENT_A}`);

    expect(status).toBe(200);
    expect(normalize(body)).toMatchSnapshot();
  });

  it("matches the stream detail snapshot (GET /api/streams/:recipient)", async () => {
    queryMock.mockResolvedValue({ rows: [DETAIL_ROW] });
    setSimulatedResults({ claimable_amount: 4250000n });

    const { status, body } = await getJson(`/api/streams/${RECIPIENT_A}`);

    expect(status).toBe(200);
    expect(normalize(body)).toMatchSnapshot();
  });

  it("matches the not-found snapshot", async () => {
    queryMock.mockResolvedValue({ rows: [] });

    const { status, body } = await getJson(`/streams/${RECIPIENT_B}`);

    expect(status).toBe(404);
    expect(normalize(body)).toMatchSnapshot();
  });
});

// ── GET /claimable-batch & GET /api/claimable-batch ───────────────────────────

describe("GET /claimable-batch", () => {
  it("matches the batch claimable snapshot (GET /claimable-batch)", async () => {
    setSimulatedResults({
      get_claimable_batch: [
        [RECIPIENT_A, 4250000n],
        [RECIPIENT_B, 0n],
      ],
    });

    const { status, body } = await getJson(
      `/claimable-batch?recipients=${RECIPIENT_A},${RECIPIENT_B}`,
    );

    expect(status).toBe(200);
    expect(normalize(body)).toMatchSnapshot();
  });

  it("matches the batch claimable snapshot (GET /api/claimable-batch)", async () => {
    setSimulatedResults({
      get_claimable_batch: [
        [RECIPIENT_A, 4250000n],
        [RECIPIENT_B, 0n],
      ],
    });

    const { status, body } = await getJson(
      `/api/claimable-batch?recipients=${RECIPIENT_A},${RECIPIENT_B}`,
    );

    expect(status).toBe(200);
    expect(normalize(body)).toMatchSnapshot();
  });

  it("matches the validation error snapshot", async () => {
    const { status, body } = await getJson("/claimable-batch?recipients=nope");

    expect(status).toBe(400);
    expect(normalize(body)).toMatchSnapshot();
  });
});
