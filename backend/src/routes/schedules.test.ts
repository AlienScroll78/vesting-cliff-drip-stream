/**
 * backend/src/routes/schedules.test.ts  (#289)
 *
 * Unit tests for the paginated schedules route.
 * Uses mocked pg Pool to avoid needing a real DB.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { encodeCursor, decodeCursor, buildQuery } from "./schedules.js";

// ── cursor helpers ────────────────────────────────────────────────────────────

describe("encodeCursor / decodeCursor", () => {
  it("round-trips a cursor payload", () => {
    const payload = { page: 3, offset: 50 };
    const encoded = encodeCursor(payload);
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(payload);
  });

  it("returns null for invalid cursor strings", () => {
    expect(decodeCursor("not-valid-base64!!!")).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("e30="  )).toBeNull(); // {} without required fields
  });

  it("returns null for structurally invalid JSON", () => {
    const garbage = Buffer.from("{}BAD", "utf8").toString("base64url");
    expect(decodeCursor(garbage)).toBeNull();
  });
});

// ── buildQuery ────────────────────────────────────────────────────────────────

describe("buildQuery", () => {
  it("produces a valid sponsor filter", () => {
    const { sql, values } = buildQuery({
      sponsor: "GABC",
      status: null,
      sort: "cliff_asc",
      limit: 25,
      offset: 0,
    });
    expect(sql).toContain("sponsor_address = $1");
    expect(values[0]).toBe("GABC");
  });

  it("includes status filter when provided", () => {
    const { sql, values } = buildQuery({
      sponsor: "GABC",
      status: "active",
      sort: "cliff_asc",
      limit: 25,
      offset: 0,
    });
    expect(sql).toContain("vs.status = $2");
    expect(values[1]).toBe("active");
  });

  it("omits status filter when null", () => {
    const { sql } = buildQuery({
      sponsor: "GABC",
      status: null,
      sort: "end_desc",
      limit: 10,
      offset: 0,
    });
    expect(sql).not.toContain("vs.status");
  });

  it("applies sort order for cliff_asc", () => {
    const { sql } = buildQuery({
      sponsor: "GABC",
      status: null,
      sort: "cliff_asc",
      limit: 25,
      offset: 0,
    });
    expect(sql).toContain("cliff_ledger ASC");
  });

  it("applies sort order for recipient_desc", () => {
    const { sql } = buildQuery({
      sponsor: "GABC",
      status: null,
      sort: "recipient_desc",
      limit: 25,
      offset: 0,
    });
    expect(sql).toContain("recipient_address DESC");
  });

  it("applies sort order for claimable_asc", () => {
    const { sql } = buildQuery({
      sponsor: "GABC",
      status: null,
      sort: "claimable_asc",
      limit: 25,
      offset: 0,
    });
    expect(sql).toContain("claimable_amount ASC");
  });

  it("applies limit and offset to values", () => {
    const { values } = buildQuery({
      sponsor: "GABC",
      status: null,
      sort: "cliff_asc",
      limit: 10,
      offset: 30,
    });
    // Without status: values = [sponsor, limit, offset]
    expect(values).toContain(10);
    expect(values).toContain(30);
  });

  it("countSql does not contain LIMIT / OFFSET", () => {
    const { countSql } = buildQuery({
      sponsor: "GABC",
      status: null,
      sort: "cliff_asc",
      limit: 25,
      offset: 0,
    });
    expect(countSql.toUpperCase()).not.toContain("LIMIT");
    expect(countSql.toUpperCase()).not.toContain("OFFSET");
  });

  it("produces correct parameter count with status", () => {
    const { values } = buildQuery({
      sponsor: "GABC",
      status: "cancelled",
      sort: "cliff_asc",
      limit: 25,
      offset: 50,
    });
    // [sponsor, status, limit, offset] = 4 params
    expect(values).toHaveLength(4);
  });

  it("produces correct parameter count without status", () => {
    const { values } = buildQuery({
      sponsor: "GABC",
      status: null,
      sort: "cliff_asc",
      limit: 25,
      offset: 50,
    });
    // [sponsor, limit, offset] = 3 params
    expect(values).toHaveLength(3);
  });
});
