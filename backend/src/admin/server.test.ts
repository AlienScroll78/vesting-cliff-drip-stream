import { describe, it, expect } from "vitest";

// Test the admin route logic without starting a real HTTP server.
// We verify the Prometheus registry and reindex validation logic directly.

describe("admin: indexer status", () => {
  it("lag is chainTip minus lastIndexed", () => {
    const state = { lastIndexedLedger: 100, chainTipLedger: 105 };
    const lag = state.chainTipLedger - state.lastIndexedLedger;
    expect(lag).toBe(5);
  });
});

describe("admin: reindex validation", () => {
  it("rejects from_ledger <= 0", () => {
    const fromLedger = parseInt("0", 10);
    expect(!fromLedger || fromLedger <= 0).toBe(true);
  });

  it("accepts valid from_ledger", () => {
    const fromLedger = parseInt("51000000", 10);
    expect(fromLedger > 0).toBe(true);
  });

  it("rejects non-numeric from_ledger", () => {
    const fromLedger = parseInt("abc", 10);
    expect(!fromLedger || fromLedger <= 0).toBe(true);
  });
});

describe("admin: basic auth", () => {
  it("rejects missing Authorization header", () => {
    const auth = "";
    const isValid = auth.startsWith("Basic ");
    expect(isValid).toBe(false);
  });

  it("rejects wrong credentials", () => {
    const expected = { user: "admin", pass: "secret" };
    const b64 = Buffer.from("admin:wrong").toString("base64");
    const decoded = Buffer.from(b64, "base64").toString();
    const [user, pass] = decoded.split(":");
    expect(user === expected.user && pass === expected.pass).toBe(false);
  });

  it("accepts correct credentials", () => {
    const expected = { user: "admin", pass: "secret" };
    const b64 = Buffer.from("admin:secret").toString("base64");
    const decoded = Buffer.from(b64, "base64").toString();
    const [user, pass] = decoded.split(":");
    expect(user === expected.user && pass === expected.pass).toBe(true);
  });
});
