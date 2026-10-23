"use strict";

/**
 * Tests for graphql-depth-limit.js — Issue #553.
 *
 * Covers:
 *  - checkDepth: passes when ≤ maxDepth, throws when > maxDepth
 *  - checkComplexity: passes when ≤ maxComplexity, throws when > maxComplexity
 *  - validateQuery: delegates to both, logs at warn on rejection
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { parse, buildSchema } from "graphql";

// CJS module — import with createRequire
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { checkDepth, checkComplexity, validateQuery } = require("./graphql-depth-limit");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a nested query string of a given depth. */
function nestedQuery(depth) {
  let q = "{ ";
  for (let i = 0; i < depth; i++) q += `level${i} { `;
  q += "leaf ";
  for (let i = 0; i < depth; i++) q += "}";
  q += " }";
  return q;
}

// ── checkDepth ────────────────────────────────────────────────────────────────

describe("checkDepth", () => {
  it("passes for a query at exactly maxDepth", () => {
    const doc = parse(nestedQuery(5));
    expect(() => checkDepth(doc, 5)).not.toThrow();
  });

  it("passes for a shallow query", () => {
    const doc = parse("{ field }");
    expect(() => checkDepth(doc, 5)).not.toThrow();
  });

  it("throws when depth exceeds maxDepth", () => {
    const doc = parse(nestedQuery(6));
    expect(() => checkDepth(doc, 5)).toThrow(/exceeds maximum allowed depth of 5/);
  });

  it("includes actual depth in error message", () => {
    const doc = parse(nestedQuery(8));
    expect(() => checkDepth(doc, 5)).toThrow(/depth 8/);
  });
});

// ── checkComplexity ───────────────────────────────────────────────────────────

describe("checkComplexity (schema-free)", () => {
  it("returns cost for a simple query", () => {
    // 3 fields → cost 3
    const doc = parse("{ a b c }");
    const cost = checkComplexity(doc, null, 100);
    expect(cost).toBe(3);
  });

  it("passes when complexity is within limit", () => {
    const doc = parse("{ a b c }");
    expect(() => checkComplexity(doc, null, 10)).not.toThrow();
  });

  it("throws when complexity exceeds maxComplexity", () => {
    const fields = Array.from({ length: 12 }, (_, i) => `f${i}`).join(" ");
    const doc = parse(`{ ${fields} }`);
    expect(() => checkComplexity(doc, null, 10)).toThrow(/exceeds maximum allowed complexity of 10/);
  });

  it("includes computed cost in error message", () => {
    const fields = Array.from({ length: 15 }, (_, i) => `f${i}`).join(" ");
    const doc = parse(`{ ${fields} }`);
    expect(() => checkComplexity(doc, null, 10)).toThrow(/complexity 15/);
  });
});

describe("checkComplexity (with schema — list multiplier)", () => {
  const schema = buildSchema(`
    type Query {
      streams: [Stream!]!
      schedule(recipient: String!): Schedule
    }
    type Stream {
      id: ID!
      recipient: String!
      rate: Int!
    }
    type Schedule {
      id: ID!
      token: String!
    }
  `);

  it("applies LIST_MULTIPLIER (10) for list fields", () => {
    // { streams { id } } → streams costs 10, id costs 1 → total 11
    const doc = parse("{ streams { id } }");
    const cost = checkComplexity(doc, schema, 1000);
    expect(cost).toBe(11);
  });

  it("charges 1 per scalar for non-list fields", () => {
    const doc = parse(`{ schedule(recipient: "G") { id token } }`);
    const cost = checkComplexity(doc, schema, 1000);
    expect(cost).toBe(3);
  });

  it("throws when list query exceeds complexity limit", () => {
    // streams(10) + id(1) + recipient(1) + rate(1) = 13 > 12
    const doc = parse("{ streams { id recipient rate } }");
    expect(() => checkComplexity(doc, schema, 12)).toThrow(/exceeds maximum allowed complexity/);
  });
});

// ── validateQuery ─────────────────────────────────────────────────────────────

describe("validateQuery", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes for a valid query", () => {
    const doc = parse("{ a b }");
    expect(() =>
      validateQuery(doc, null, { maxDepth: 5, maxComplexity: 100 })
    ).not.toThrow();
  });

  it("throws and warns at warn level on depth violation", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = parse(nestedQuery(6));
    expect(() =>
      validateQuery(doc, null, { maxDepth: 5, maxComplexity: 100 })
    ).toThrow(/depth/);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[graphql] Query rejected"),
      expect.anything()
    );
  });

  it("throws and warns at warn level on complexity violation", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fields = Array.from({ length: 20 }, (_, i) => `f${i}`).join(" ");
    const doc = parse(`{ ${fields} }`);
    expect(() =>
      validateQuery(doc, null, { maxDepth: 5, maxComplexity: 10 })
    ).toThrow(/complexity/);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[graphql] Query rejected"),
      expect.anything()
    );
  });
});
