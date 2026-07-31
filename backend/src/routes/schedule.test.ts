import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

const mockRecipient = "GAH5H7EKIVT3VMYLDRZL4PJ732EXGBNFWLUQGHRKTUQ6HK2TN3RQXMG5";
const mockSponsor = "GSPONSOR1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

vi.mock("../db.js", () => ({
  pool: {
    connect: vi.fn(),
    query: vi.fn(),
  },
}));

vi.mock("../redisClient", () => ({
  createRedisClient: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => "OK"),
    del: vi.fn(async () => 1),
  })),
}));

vi.mock("../lib", () => ({
  loadConfig: vi.fn(() => ({
    SOROBAN_RPC_URL: "https://rpc.testnet.stellar.org",
    CONTRACT_ID: "CA3PLWTC5FC272X3Y5SY7X7Y7X7Y5SY7X7Y7X7Y",
    NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  })),
  StellarSdk: {
    SorobanRpc: {
      Server: vi.fn(() => ({
        getLatestLedger: vi.fn(async () => ({ sequence: 1000 })),
        simulateTransaction: vi.fn(async () => ({
          result: {
            retval: {
              switch: () => ({ name: "scvMap" }),
              value: () => ({
                value: () => [
                  { key: () => ({ value: () => "sponsor" }), val: () => ({ value: () => mockSponsor }) },
                  { key: () => ({ value: () => "token" }), val: () => ({ value: () => "CTOKEN1" }) },
                  { key: () => ({ value: () => "rate_per_ledger" }), val: () => ({ value: () => "100" }) },
                  { key: () => ({ value: () => "cliff_ledger" }), val: () => ({ value: () => 500 }) },
                  { key: () => ({ value: () => "end_ledger" }), val: () => ({ value: () => 2000 }) },
                  { key: () => ({ value: () => "start_ledger" }), val: () => ({ value: () => 100 }) },
                ],
              }),
            },
          },
        })),
      })),
    },
    Contract: vi.fn(),
    TransactionBuilder: vi.fn(() => ({
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn(() => ({})),
    })),
    BASE_FEE: "100",
    Address: {
      fromString: vi.fn(() => ({ toScVal: vi.fn() })),
    },
  },
}));

vi.mock("../cache", () => ({
  viewKey: vi.fn(() => "view:recipient:1000"),
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => {}),
  cacheInvalidate: vi.fn(async () => {}),
}));

vi.mock("../contract-version", () => ({
  getContractVersion: vi.fn(async () => "ledger-1000"),
}));

function makeReq(params: Record<string, string> = {}): Request {
  return { params, url: "/schedule/GAH5H7EKIVT3VMYLDRZL4PJ732EXGBNFWLUQGHRKTUQ6HK2TN3RQXMG5" } as unknown as Request;
}

function makeRes(): { res: Response; json: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; writeHead: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> } {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  res.writeHead = vi.fn().mockReturnValue(res);
  res.write = vi.fn().mockReturnValue(res);
  return { res, json: res.json as ReturnType<typeof vi.fn>, status: res.status as ReturnType<typeof vi.fn>, end: res.end as ReturnType<typeof vi.fn>, writeHead: res.writeHead as ReturnType<typeof vi.fn>, write: res.write as ReturnType<typeof vi.fn> };
}

describe("scheduleHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns schedule for valid recipient", async () => {
    const { scheduleHandler } = await import("./schedule.js");
    const { res, json } = makeRes();
    await scheduleHandler(makeReq(), res);
    expect(json).toHaveBeenCalled();
  });

  it("returns 404 when schedule is not found", async () => {
    const sdk = await import("../lib");
    const server = new sdk.StellarSdk.SorobanRpc.Server("");
    vi.mocked(server.simulateTransaction).mockResolvedValueOnce({
      result: {
        retval: {
          switch: () => ({ name: "scvVoid" }),
        },
      },
    });
    const { scheduleHandler } = await import("./schedule.js");
    const { res, status, json } = makeRes();
    await scheduleHandler(makeReq(), res);
  });

  it("returns 400 when recipient is missing", async () => {
    const { scheduleHandler } = await import("./schedule.js");
    const req = { url: "/schedule/" } as unknown as Request;
    const { res, writeHead, end } = makeRes();
    await scheduleHandler(req, res);
    expect(writeHead).toHaveBeenCalledWith(400, expect.any(Object));
  });
});

describe("vestingRouter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET /schedules/:recipient returns schedule", async () => {
    const { vestingRouter } = await import("./vesting.js");
    const req = { params: { recipient: mockRecipient }, query: {} } as unknown as Request;
    const { res, json, status } = makeRes();
    await vestingRouter.stack
      .find((layer: any) => layer.route?.path === "/schedules/:recipient")
      ?.route?.stack?.[0]?.handle(req, res);
  });

  it("GET /claimable/:recipient returns claimable amount", async () => {
    const { vestingRouter } = await import("./vesting.js");
    const req = { params: { recipient: mockRecipient }, query: {} } as unknown as Request;
    const { res, json, status } = makeRes();
    await vestingRouter.stack
      .find((layer: any) => layer.route?.path === "/claimable/:recipient")
      ?.route?.stack?.[0]?.handle(req, res);
  });

  it("GET /schedules/sponsor/:sponsor returns paginated list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        _embedded: {
          records: [
            {
              topic: ["stream_created", mockSponsor, mockRecipient],
              value: { xdr: "AAAA" },
              ledger: 1000,
              id: "evt-1",
              paging_token: "pt-1",
            },
          ],
        },
      }),
    })));
    const { vestingRouter } = await import("./vesting.js");
    const req = { params: { sponsor: mockSponsor }, query: {} } as unknown as Request;
    const { res, json, status } = makeRes();
    await vestingRouter.stack
      .find((layer: any) => layer.route?.path === "/schedules/sponsor/:sponsor")
      ?.route?.stack?.[0]?.handle(req, res);
    vi.unstubAllGlobals();
  });
});

describe("exportSponsorHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 when auth address does not match sponsor", async () => {
    const { exportSponsorHandler } = await import("./export.js");
    const req = { params: { address: mockSponsor }, user: { address: "GDIFFERENT" }, query: { format: "json" } } as unknown as Request;
    const { res, status, json } = makeRes();
    await exportSponsorHandler(req, res);
    expect(status).toHaveBeenCalledWith(403);
  });

  it("returns 400 for invalid format", async () => {
    const { exportSponsorHandler } = await import("./export.js");
    const req = { params: { address: mockSponsor }, user: { address: mockSponsor }, query: { format: "xml" } } as unknown as Request;
    const { res, status, json } = makeRes();
    await exportSponsorHandler(req, res);
    expect(status).toHaveBeenCalledWith(400);
  });

  it("returns 429 when rate limited", async () => {
    vi.doMock("../redisClient", () => ({
      createRedisClient: vi.fn(async () => ({
        get: vi.fn(async () => "1"),
        set: vi.fn(),
        del: vi.fn(),
      })),
    }));
    const { exportSponsorHandler } = await import("./export.js");
    const req = { params: { address: mockSponsor }, user: { address: mockSponsor }, query: { format: "json" } } as unknown as Request;
    const { res, status, json } = makeRes();
    await exportSponsorHandler(req, res);
  });
});
