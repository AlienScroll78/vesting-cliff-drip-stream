/**
 * backend/src/middleware/validate.test.ts
 *
 * Tests for:
 *   1. Zod schemas in validation.ts   — valid and invalid inputs
 *   2. validate() middleware           — 400 field errors, 200 pass-through,
 *                                        params / query / body / headers targets
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import {
  StellarAddressSchema,
  SorobanContractAddressSchema,
  RecipientParamsSchema,
  SponsorParamsSchema,
  AddressParamsSchema,
  PaginationQuerySchema,
  SchedulesQuerySchema,
  CreateStreamBodySchema,
  ExportQuerySchema,
  WebhookBodySchema,
  WebhookHeaderSchema,
  validateAddress,
} from "../validation.js";
import { validate } from "./validate.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A valid 56-char Stellar public key. */
const VALID_ADDRESS = "G" + "A".repeat(55);
/** A valid 56-char Soroban contract address. */
const VALID_CONTRACT = "C" + "A".repeat(55);

function makeExpressMocks() {
  const jsonMock = vi.fn();
  const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
  const nextMock = vi.fn() as unknown as NextFunction;

  const res = {
    status: statusMock,
    json: vi.fn(),
  } as unknown as Response;

  return { res, statusMock, jsonMock, nextMock };
}

// ── StellarAddressSchema ──────────────────────────────────────────────────────

describe("StellarAddressSchema", () => {
  it("accepts a valid Stellar address", () => {
    expect(() => StellarAddressSchema.parse(VALID_ADDRESS)).not.toThrow();
  });

  it("rejects an address that does not start with G", () => {
    expect(() => StellarAddressSchema.parse("A" + "A".repeat(55))).toThrow(ZodError);
  });

  it("rejects an address shorter than 56 chars", () => {
    expect(() => StellarAddressSchema.parse("G" + "A".repeat(54))).toThrow(ZodError);
  });

  it("rejects an address longer than 56 chars", () => {
    expect(() => StellarAddressSchema.parse("G" + "A".repeat(56))).toThrow(ZodError);
  });

  it("rejects an address with lowercase letters", () => {
    expect(() => StellarAddressSchema.parse("G" + "a".repeat(55))).toThrow(ZodError);
  });

  it("rejects an empty string", () => {
    expect(() => StellarAddressSchema.parse("")).toThrow(ZodError);
  });

  it("rejects characters outside base-32 alphabet (e.g. 1, 8)", () => {
    // '1' and '8' are not in the Stellar base-32 alphabet (A-Z, 2-7)
    const bad = "G" + "1".repeat(55);
    expect(() => StellarAddressSchema.parse(bad)).toThrow(ZodError);
  });

  it("accepts addresses containing valid digits 2–7", () => {
    // Replace last char with '2'
    const addr = "G" + "A".repeat(54) + "2";
    expect(() => StellarAddressSchema.parse(addr)).not.toThrow();
  });
});

// ── SorobanContractAddressSchema ──────────────────────────────────────────────

describe("SorobanContractAddressSchema", () => {
  it("accepts a valid contract address", () => {
    expect(() => SorobanContractAddressSchema.parse(VALID_CONTRACT)).not.toThrow();
  });

  it("rejects a G-prefixed address", () => {
    expect(() => SorobanContractAddressSchema.parse(VALID_ADDRESS)).toThrow(ZodError);
  });

  it("rejects addresses shorter than 56 chars", () => {
    expect(() => SorobanContractAddressSchema.parse("C" + "A".repeat(54))).toThrow(ZodError);
  });

  it("rejects addresses with invalid characters", () => {
    expect(() => SorobanContractAddressSchema.parse("C" + "0".repeat(55))).toThrow(ZodError);
  });
});

// ── RecipientParamsSchema ─────────────────────────────────────────────────────

describe("RecipientParamsSchema", () => {
  it("passes with a valid recipient", () => {
    const result = RecipientParamsSchema.safeParse({ recipient: VALID_ADDRESS });
    expect(result.success).toBe(true);
  });

  it("fails when recipient is missing", () => {
    const result = RecipientParamsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("fails when recipient is malformed", () => {
    const result = RecipientParamsSchema.safeParse({ recipient: "not-an-address" });
    expect(result.success).toBe(false);
  });
});

// ── SponsorParamsSchema ───────────────────────────────────────────────────────

describe("SponsorParamsSchema", () => {
  it("passes with a valid sponsor", () => {
    expect(SponsorParamsSchema.safeParse({ sponsor: VALID_ADDRESS }).success).toBe(true);
  });

  it("fails with an invalid sponsor", () => {
    expect(SponsorParamsSchema.safeParse({ sponsor: "bad" }).success).toBe(false);
  });
});

// ── AddressParamsSchema ───────────────────────────────────────────────────────

describe("AddressParamsSchema", () => {
  it("passes with a valid address", () => {
    expect(AddressParamsSchema.safeParse({ address: VALID_ADDRESS }).success).toBe(true);
  });

  it("fails with an invalid address", () => {
    expect(AddressParamsSchema.safeParse({ address: "bad" }).success).toBe(false);
  });
});

// ── PaginationQuerySchema ─────────────────────────────────────────────────────

describe("PaginationQuerySchema", () => {
  it("applies sensible defaults", () => {
    const result = PaginationQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(25);
    }
  });

  it("coerces string numbers", () => {
    const result = PaginationQuerySchema.safeParse({ page: "3", limit: "50" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.limit).toBe(50);
    }
  });

  it("rejects page < 1", () => {
    expect(PaginationQuerySchema.safeParse({ page: "0" }).success).toBe(false);
  });

  it("rejects limit > 100", () => {
    expect(PaginationQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("rejects non-numeric strings", () => {
    expect(PaginationQuerySchema.safeParse({ page: "abc" }).success).toBe(false);
  });
});

// ── SchedulesQuerySchema ──────────────────────────────────────────────────────

describe("SchedulesQuerySchema", () => {
  const base = { sponsor: VALID_ADDRESS };

  it("passes with sponsor only (uses defaults)", () => {
    const result = SchedulesQuerySchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sort).toBe("cliff_asc");
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(25);
    }
  });

  it("accepts all valid status values", () => {
    for (const status of ["active", "pre_cliff", "expired", "cancelled"]) {
      expect(SchedulesQuerySchema.safeParse({ ...base, status }).success).toBe(true);
    }
  });

  it("rejects an invalid status", () => {
    expect(SchedulesQuerySchema.safeParse({ ...base, status: "unknown" }).success).toBe(false);
  });

  it("accepts all valid sort values", () => {
    for (const sort of ["cliff_asc", "end_desc", "claimable_asc", "recipient_desc"]) {
      expect(SchedulesQuerySchema.safeParse({ ...base, sort }).success).toBe(true);
    }
  });

  it("rejects invalid sort", () => {
    expect(SchedulesQuerySchema.safeParse({ ...base, sort: "bad_sort" }).success).toBe(false);
  });

  it("fails when sponsor is missing", () => {
    expect(SchedulesQuerySchema.safeParse({}).success).toBe(false);
  });

  it("fails when sponsor is not a valid Stellar address", () => {
    expect(SchedulesQuerySchema.safeParse({ sponsor: "bad" }).success).toBe(false);
  });
});

// ── CreateStreamBodySchema ────────────────────────────────────────────────────

describe("CreateStreamBodySchema", () => {
  const VALID_RECIPIENT = "G" + "B".repeat(55);

  const validBody = {
    sponsor: VALID_ADDRESS,
    recipient: VALID_RECIPIENT,
    token: VALID_CONTRACT,
    rate: 10,
    cliff_duration: 100,
    total_duration: 1000,
  };

  it("accepts a fully valid body", () => {
    expect(CreateStreamBodySchema.safeParse(validBody).success).toBe(true);
  });

  it("rejects when sponsor is not a valid Stellar address", () => {
    const result = CreateStreamBodySchema.safeParse({ ...validBody, sponsor: "bad" });
    expect(result.success).toBe(false);
  });

  it("rejects when recipient is not a valid Stellar address", () => {
    const result = CreateStreamBodySchema.safeParse({ ...validBody, recipient: "bad" });
    expect(result.success).toBe(false);
  });

  it("rejects when token is not a valid Soroban contract address", () => {
    const result = CreateStreamBodySchema.safeParse({ ...validBody, token: VALID_ADDRESS });
    expect(result.success).toBe(false);
  });

  it("rejects when rate is zero", () => {
    expect(CreateStreamBodySchema.safeParse({ ...validBody, rate: 0 }).success).toBe(false);
  });

  it("rejects when rate is negative", () => {
    expect(CreateStreamBodySchema.safeParse({ ...validBody, rate: -1 }).success).toBe(false);
  });

  it("rejects when rate is a float", () => {
    expect(CreateStreamBodySchema.safeParse({ ...validBody, rate: 1.5 }).success).toBe(false);
  });

  it("rejects when total_duration <= cliff_duration", () => {
    const result = CreateStreamBodySchema.safeParse({
      ...validBody,
      cliff_duration: 500,
      total_duration: 500,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const totalIssue = result.error.errors.find((e) => e.path[0] === "total_duration");
      expect(totalIssue?.message).toMatch(/greater than cliff_duration/);
    }
  });

  it("rejects when sponsor === recipient", () => {
    const result = CreateStreamBodySchema.safeParse({
      ...validBody,
      recipient: VALID_ADDRESS, // same as sponsor
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const recipientIssue = result.error.errors.find((e) => e.path[0] === "recipient");
      expect(recipientIssue?.message).toMatch(/different addresses/);
    }
  });

  it("rejects missing required fields", () => {
    const { rate, ...noRate } = validBody;
    expect(CreateStreamBodySchema.safeParse(noRate).success).toBe(false);
  });
});

// ── ExportQuerySchema ─────────────────────────────────────────────────────────

describe("ExportQuerySchema", () => {
  it("defaults format to json", () => {
    const result = ExportQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.format).toBe("json");
  });

  it("accepts csv and json formats", () => {
    expect(ExportQuerySchema.safeParse({ format: "csv" }).success).toBe(true);
    expect(ExportQuerySchema.safeParse({ format: "json" }).success).toBe(true);
  });

  it("rejects invalid format", () => {
    expect(ExportQuerySchema.safeParse({ format: "xml" }).success).toBe(false);
  });

  it("accepts valid ISO date strings", () => {
    const result = ExportQuerySchema.safeParse({
      from: "2024-01-01T00:00:00Z",
      to: "2025-01-01T00:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid date strings in from", () => {
    expect(ExportQuerySchema.safeParse({ from: "not-a-date" }).success).toBe(false);
  });

  it("rejects invalid date strings in to", () => {
    expect(ExportQuerySchema.safeParse({ to: "not-a-date" }).success).toBe(false);
  });
});

// ── WebhookBodySchema ─────────────────────────────────────────────────────────

describe("WebhookBodySchema", () => {
  const validBody = {
    url: "https://example.com/hooks/vesting",
    events: ["tokens_claimed"],
  };

  it("accepts a valid webhook registration", () => {
    expect(WebhookBodySchema.safeParse(validBody).success).toBe(true);
  });

  it("accepts an optional valid secret", () => {
    const result = WebhookBodySchema.safeParse({ ...validBody, secret: "mysecret1" });
    expect(result.success).toBe(true);
  });

  it("rejects a secret shorter than 8 characters", () => {
    const result = WebhookBodySchema.safeParse({ ...validBody, secret: "short" });
    expect(result.success).toBe(false);
  });

  it("rejects non-HTTPS urls", () => {
    const result = WebhookBodySchema.safeParse({ ...validBody, url: "http://example.com/hook" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toMatch(/HTTPS/);
    }
  });

  it("rejects invalid URLs", () => {
    const result = WebhookBodySchema.safeParse({ ...validBody, url: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty events array", () => {
    const result = WebhookBodySchema.safeParse({ ...validBody, events: [] });
    expect(result.success).toBe(false);
  });

  it("rejects unknown event types", () => {
    const result = WebhookBodySchema.safeParse({ ...validBody, events: ["unknown_event"] });
    expect(result.success).toBe(false);
  });

  it("accepts all supported event types", () => {
    const result = WebhookBodySchema.safeParse({
      url: "https://example.com/hook",
      events: ["tokens_claimed", "stream_cancelled", "stream_created", "stream_drained", "stream_clawed_back"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects when url is missing", () => {
    const { url, ...noUrl } = validBody;
    expect(WebhookBodySchema.safeParse(noUrl).success).toBe(false);
  });

  it("rejects when events is missing", () => {
    const { events, ...noEvents } = validBody;
    expect(WebhookBodySchema.safeParse(noEvents).success).toBe(false);
  });
});

// ── WebhookHeaderSchema ───────────────────────────────────────────────────────

describe("WebhookHeaderSchema", () => {
  it("accepts a valid x-sponsor-id header", () => {
    const result = WebhookHeaderSchema.safeParse({ "x-sponsor-id": VALID_ADDRESS });
    expect(result.success).toBe(true);
  });

  it("rejects when x-sponsor-id is missing", () => {
    const result = WebhookHeaderSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects when x-sponsor-id is not a valid Stellar address", () => {
    const result = WebhookHeaderSchema.safeParse({ "x-sponsor-id": "bad-address" });
    expect(result.success).toBe(false);
  });
});

// ── validateAddress (legacy helper) ──────────────────────────────────────────

describe("validateAddress (legacy)", () => {
  it("returns the address for a valid input", () => {
    expect(validateAddress(VALID_ADDRESS)).toBe(VALID_ADDRESS);
  });

  it("throws for an invalid address", () => {
    expect(() => validateAddress("bad")).toThrow("Invalid Stellar address");
  });

  it("throws for an empty string", () => {
    expect(() => validateAddress("")).toThrow("Invalid Stellar address");
  });
});

// ── validate() middleware ─────────────────────────────────────────────────────

describe("validate() middleware", () => {
  function buildReq(overrides: Partial<Request> = {}): Request {
    return {
      params: {},
      query: {},
      body: {},
      headers: {},
      ...overrides,
    } as unknown as Request;
  }

  describe("params validation", () => {
    const middleware = validate({ params: RecipientParamsSchema });

    it("calls next() for a valid recipient param", () => {
      const req = buildReq({ params: { recipient: VALID_ADDRESS } });
      const { res, nextMock } = makeExpressMocks();
      middleware(req, res, nextMock);
      expect(nextMock).toHaveBeenCalledOnce();
    });

    it("returns 400 for an invalid recipient param", () => {
      const req = buildReq({ params: { recipient: "bad" } });
      const { res, statusMock } = makeExpressMocks();
      const next = vi.fn();
      middleware(req, res, next);
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });

    it("writes parsed data back to req.params", () => {
      const req = buildReq({ params: { recipient: VALID_ADDRESS } });
      const { res, nextMock } = makeExpressMocks();
      middleware(req, res, nextMock);
      expect(req.params.recipient).toBe(VALID_ADDRESS);
    });
  });

  describe("query validation", () => {
    const middleware = validate({ query: PaginationQuerySchema });

    it("calls next() for valid query params", () => {
      const req = buildReq({ query: { page: "2", limit: "10" } as any });
      const { res, nextMock } = makeExpressMocks();
      middleware(req, res, nextMock);
      expect(nextMock).toHaveBeenCalledOnce();
    });

    it("coerces query strings and writes back to req.query", () => {
      const req = buildReq({ query: { page: "3", limit: "15" } as any });
      const { res, nextMock } = makeExpressMocks();
      middleware(req, res, nextMock);
      expect((req as any).query.page).toBe(3);
      expect((req as any).query.limit).toBe(15);
    });

    it("returns 400 for limit > 100", () => {
      const req = buildReq({ query: { limit: "200" } as any });
      const { res, statusMock } = makeExpressMocks();
      const next = vi.fn();
      middleware(req, res, next);
      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it("returns 400 for page = 0", () => {
      const req = buildReq({ query: { page: "0" } as any });
      const { res, statusMock } = makeExpressMocks();
      const next = vi.fn();
      middleware(req, res, next);
      expect(statusMock).toHaveBeenCalledWith(400);
    });
  });

  describe("body validation", () => {
    const VALID_RECIPIENT = "G" + "B".repeat(55);
    const validBody = {
      sponsor: VALID_ADDRESS,
      recipient: VALID_RECIPIENT,
      token: VALID_CONTRACT,
      rate: 10,
      cliff_duration: 100,
      total_duration: 1000,
    };
    const middleware = validate({ body: CreateStreamBodySchema });

    it("calls next() for a valid body", () => {
      const req = buildReq({ body: validBody });
      const { res, nextMock } = makeExpressMocks();
      middleware(req, res, nextMock);
      expect(nextMock).toHaveBeenCalledOnce();
    });

    it("returns 400 for an invalid body", () => {
      const req = buildReq({ body: { sponsor: "bad" } });
      const { res, statusMock } = makeExpressMocks();
      const next = vi.fn();
      middleware(req, res, next);
      expect(statusMock).toHaveBeenCalledWith(400);
    });
  });

  describe("headers validation", () => {
    const middleware = validate({ headers: WebhookHeaderSchema });

    it("calls next() when x-sponsor-id is valid", () => {
      const req = buildReq({ headers: { "x-sponsor-id": VALID_ADDRESS } });
      const { res, nextMock } = makeExpressMocks();
      middleware(req, res, nextMock);
      expect(nextMock).toHaveBeenCalledOnce();
    });

    it("returns 400 when x-sponsor-id is missing", () => {
      const req = buildReq({ headers: {} });
      const { res, statusMock } = makeExpressMocks();
      const next = vi.fn();
      middleware(req, res, next);
      expect(statusMock).toHaveBeenCalledWith(400);
    });
  });

  describe("error response shape", () => {
    it("includes error and fields array in 400 response", () => {
      const middleware = validate({ params: RecipientParamsSchema });
      const req = buildReq({ params: { recipient: "bad" } });

      let capturedBody: any = null;
      const res = {
        status: vi.fn().mockReturnValue({
          json: vi.fn((body) => { capturedBody = body; }),
        }),
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn();
      middleware(req, res, next);

      const statusCall = (res.status as any).mock.calls[0][0];
      expect(statusCall).toBe(400);

      const jsonCall = (res.status as any).mock.results[0].value.json.mock.calls[0][0];
      expect(jsonCall).toMatchObject({
        error: "Validation failed",
        fields: expect.arrayContaining([
          expect.objectContaining({ field: expect.any(String), message: expect.any(String) }),
        ]),
      });
    });

    it("accumulates errors from multiple failing targets", () => {
      const middleware = validate({
        params: RecipientParamsSchema,
        query: PaginationQuerySchema,
      });

      const req = buildReq({
        params: { recipient: "bad" },
        query: { page: "0" } as any,
      });

      let capturedBody: any = null;
      const res = {
        status: vi.fn().mockReturnValue({
          json: vi.fn((body) => { capturedBody = body; }),
        }),
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn();
      middleware(req, res, next);

      const jsonBody = (res.status as any).mock.results[0].value.json.mock.calls[0][0];
      expect(jsonBody.fields.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("combined params + query", () => {
    const middleware = validate({
      params: SponsorParamsSchema,
      query: PaginationQuerySchema,
    });

    it("passes when both params and query are valid", () => {
      const req = buildReq({
        params: { sponsor: VALID_ADDRESS },
        query: { page: "1", limit: "25" } as any,
      });
      const { res, nextMock } = makeExpressMocks();
      middleware(req, res, nextMock);
      expect(nextMock).toHaveBeenCalledOnce();
    });

    it("fails when only params is invalid", () => {
      const req = buildReq({
        params: { sponsor: "not-valid" },
        query: {} as any,
      });
      const { res, statusMock } = makeExpressMocks();
      const next = vi.fn();
      middleware(req, res, next);
      expect(statusMock).toHaveBeenCalledWith(400);
    });
  });
});
