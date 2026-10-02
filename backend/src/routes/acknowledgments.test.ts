import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

const RECIPIENT = "GAH5H7EKIVT3VMYLDRZL4PJ732EXGBNFWLUQGHRKTUQ6HK2TN3RQXMG5";
const SPONSOR = "GSPONSOR1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const query = vi.fn();

vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query })),
}));

function makeRes(): {
  res: Response;
  json: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
} {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return { res, json: res.json as ReturnType<typeof vi.fn>, status: res.status as ReturnType<typeof vi.fn> };
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    params: { recipient: RECIPIENT },
    body: {},
    ...overrides,
  } as unknown as Request;
}

const storedRow = {
  recipient: RECIPIENT,
  sponsor: SPONSOR,
  token: "USDC",
  acknowledged_at: "2026-01-02T03:04:05.000Z",
  skipped_at: null,
  signed_message: "c2lnbmF0dXJl",
};

describe("getAcknowledgmentsHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the recipient's acknowledgments with a pending flag", async () => {
    query.mockResolvedValueOnce({
      rows: [storedRow, { ...storedRow, acknowledged_at: null, skipped_at: null }],
    });
    const { getAcknowledgmentsHandler } = await import("./acknowledgments.js");
    const { res, json } = makeRes();

    await getAcknowledgmentsHandler(makeReq(), res);

    expect(json).toHaveBeenCalledTimes(1);
    const body = json.mock.calls[0]?.[0] as {
      recipient: string;
      items: Array<{ pending: boolean; acknowledged_at: string | null }>;
    };
    expect(body.recipient).toBe(RECIPIENT);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]?.pending).toBe(false);
    expect(body.items[0]?.acknowledged_at).toBe("2026-01-02T03:04:05.000Z");
    expect(body.items[1]?.pending).toBe(true);
  });

  it("scopes the query to the recipient and orders newest first", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const { getAcknowledgmentsHandler } = await import("./acknowledgments.js");
    const { res } = makeRes();

    await getAcknowledgmentsHandler(makeReq(), res);

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("FROM stream_acknowledgments");
    expect(sql).toContain("WHERE recipient = $1");
    expect(sql).toContain("ORDER BY created_at DESC");
    expect(values).toEqual([RECIPIENT]);
  });

  it("treats a skipped acknowledgment as no longer pending", async () => {
    query.mockResolvedValueOnce({
      rows: [
        { ...storedRow, acknowledged_at: null, skipped_at: "2026-01-03T00:00:00.000Z" },
      ],
    });
    const { getAcknowledgmentsHandler } = await import("./acknowledgments.js");
    const { res, json } = makeRes();

    await getAcknowledgmentsHandler(makeReq(), res);

    const body = json.mock.calls[0]?.[0] as { items: Array<{ pending: boolean }> };
    expect(body.items[0]?.pending).toBe(false);
  });

  it("returns 500 when the database query fails", async () => {
    query.mockRejectedValueOnce(new Error("connection terminated"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { getAcknowledgmentsHandler } = await import("./acknowledgments.js");
    const { res, status, json } = makeRes();

    await getAcknowledgmentsHandler(makeReq(), res);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: "Failed to retrieve acknowledgments" });
  });
});

describe("upsertAcknowledgmentHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores an acknowledgment and returns 201 with the timestamp", async () => {
    query.mockResolvedValueOnce({ rows: [storedRow] });
    const { upsertAcknowledgmentHandler } = await import("./acknowledgments.js");
    const { res, status, json } = makeRes();

    await upsertAcknowledgmentHandler(
      makeReq({ body: { sponsor: SPONSOR, token: "USDC", action: "acknowledge", signedMessage: "c2ln" } } as Partial<Request>),
      res,
    );

    expect(status).toHaveBeenCalledWith(201);
    const body = json.mock.calls[0]?.[0] as { acknowledged_at: string; pending: boolean };
    expect(body.acknowledged_at).toBe("2026-01-02T03:04:05.000Z");
    expect(body.pending).toBe(false);
  });

  it("upserts on conflict so acknowledging twice is idempotent", async () => {
    query.mockResolvedValueOnce({ rows: [storedRow] });
    const { upsertAcknowledgmentHandler } = await import("./acknowledgments.js");
    const { res } = makeRes();

    await upsertAcknowledgmentHandler(
      makeReq({ body: { sponsor: SPONSOR, token: "USDC", action: "acknowledge" } } as Partial<Request>),
      res,
    );

    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("ON CONFLICT (recipient, sponsor, token) DO UPDATE");
    expect(sql).toContain("RETURNING");
  });

  it("preserves a previous acknowledgment timestamp when the recipient later skips", async () => {
    query.mockResolvedValueOnce({
      rows: [{ ...storedRow, skipped_at: "2026-01-04T00:00:00.000Z" }],
    });
    const { upsertAcknowledgmentHandler } = await import("./acknowledgments.js");
    const { res } = makeRes();

    await upsertAcknowledgmentHandler(
      makeReq({ body: { sponsor: SPONSOR, token: "USDC", action: "skip" } } as Partial<Request>),
      res,
    );

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("CASE\n               WHEN $4 = 'skip' THEN now()");
    expect(values).toEqual([RECIPIENT, SPONSOR, "USDC", "skip", null]);
  });

  it("keeps the existing signed message when a skip supplies none", async () => {
    query.mockResolvedValueOnce({ rows: [storedRow] });
    const { upsertAcknowledgmentHandler } = await import("./acknowledgments.js");
    const { res } = makeRes();

    await upsertAcknowledgmentHandler(
      makeReq({ body: { sponsor: SPONSOR, token: "USDC", action: "skip" } } as Partial<Request>),
      res,
    );

    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("COALESCE(");
    expect(sql).toContain("EXCLUDED.signed_message");
  });

  it("returns 500 when no row comes back", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const { upsertAcknowledgmentHandler } = await import("./acknowledgments.js");
    const { res, status, json } = makeRes();

    await upsertAcknowledgmentHandler(
      makeReq({ body: { sponsor: SPONSOR, token: "USDC", action: "acknowledge" } } as Partial<Request>),
      res,
    );

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: "Failed to store acknowledgment" });
  });

  it("returns 500 when the insert fails", async () => {
    query.mockRejectedValueOnce(new Error("duplicate key"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { upsertAcknowledgmentHandler } = await import("./acknowledgments.js");
    const { res, status, json } = makeRes();

    await upsertAcknowledgmentHandler(
      makeReq({ body: { sponsor: SPONSOR, token: "USDC", action: "acknowledge" } } as Partial<Request>),
      res,
    );

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: "Failed to store acknowledgment" });
  });
});

describe("acknowledgmentsRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes GET and POST under /streams/:recipient/acknowledgments", async () => {
    const { acknowledgmentsRouter } = await import("./acknowledgments.js");
    const paths = acknowledgmentsRouter.stack
      .map((layer) => (layer as { route?: { path: string } }).route?.path)
      .filter(Boolean);
    expect(paths).toEqual([
      "/streams/:recipient/acknowledgments",
      "/streams/:recipient/acknowledgments",
    ]);
  });

  it("rejects a malformed recipient with 400 before touching the database", async () => {
    const { acknowledgmentsRouter } = await import("./acknowledgments.js");
    const { res, status, json } = makeRes();
    const noop = vi.fn();

    await (
      acknowledgmentsRouter.stack[0] as unknown as {
        route: { stack: Array<{ handle: (req: Request, res: Response, next: unknown) => void }> };
      }
    ).route.stack[0]!.handle(makeReq({ params: { recipient: "nope" } } as Partial<Request>), res, noop);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Validation failed" }),
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects an unknown action with 400", async () => {
    const { acknowledgmentsRouter } = await import("./acknowledgments.js");
    const { res, status } = makeRes();
    const noop = vi.fn();

    await (
      acknowledgmentsRouter.stack[1] as unknown as {
        route: { stack: Array<{ handle: (req: Request, res: Response, next: unknown) => void }> };
      }
    ).route.stack[0]!.handle(
      makeReq({ body: { sponsor: SPONSOR, token: "USDC", action: "delete" } } as Partial<Request>),
      res,
      noop,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
  });
});
