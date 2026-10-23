/**
 * Pact consumer contract tests — issue #791
 *
 * These tests run against a Pact mock provider and generate JSON contract
 * files in <repo-root>/pacts/ that the backend then verifies.
 *
 * Four scenarios:
 *   1. GET /api/schedules/:recipient         — stream object shape
 *   2. GET /api/schedules/sponsor/:sponsor   — pagination envelope shape
 *   3. POST /api/tx/submit (claim_vested)    — tx hash/status response
 *   4. GET /api/schedules/:recipient 404     — error response shape { error: string }
 */

import path from "path";
import { fileURLToPath } from "url";
import { PactV3, MatchersV3 } from "@pact-foundation/pact";
import { describe, it, expect } from "vitest";

const { like, eachLike, string, integer, boolean, nullValue } = MatchersV3;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PACT_DIR = path.resolve(__dirname, "../../../pacts");

// ── Shared test address fixtures ──────────────────────────────────────────────

const RECIPIENT = "GABC1EXAMPLERECIPIENTADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const SPONSOR = "GSPON1EXAMPLESPONSORADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const UNKNOWN_RECIPIENT = "GUNKNOWNRECIPIENTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

// ── Helper ────────────────────────────────────────────────────────────────────

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const json = await res.json();
  return { status: res.status, body: json };
}

/** Create a fresh PactV3 provider for each scenario to avoid state leaks. */
function makeProvider() {
  return new PactV3({
    consumer: "vesting-frontend",
    provider: "vesting-backend",
    dir: PACT_DIR,
    logLevel: "warn",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: GET /api/schedules/:recipient — full stream object
// ─────────────────────────────────────────────────────────────────────────────

describe("Pact — GET /api/schedules/:recipient (stream found)", () => {
  it("stream response body matches the contract shape", async () => {
    const provider = makeProvider();

    await provider
      .given("a vesting schedule exists for recipient")
      .uponReceiving("a request for a recipient's vesting schedule")
      .withRequest({
        method: "GET",
        path: `/api/schedules/${RECIPIENT}`,
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: like({
          recipient: string(RECIPIENT),
          sponsor: string(SPONSOR),
          token: string("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK3M"),
          rate: string("100"),
          cliff_ledger: integer(51_200_000),
          end_ledger: integer(51_800_000),
          start_ledger: integer(51_000_000),
          claimable_amount: string("5000"),
          is_cliff_passed: boolean(true),
        }),
      })
      .executeTest(async (mockServer) => {
        const { status, body } = await fetchJson(
          `${mockServer.url}/api/schedules/${RECIPIENT}`,
        );

        expect(status).toBe(200);
        // Required top-level keys
        expect(body).toHaveProperty("recipient");
        expect(body).toHaveProperty("sponsor");
        expect(body).toHaveProperty("token");
        expect(body).toHaveProperty("rate");
        expect(body).toHaveProperty("cliff_ledger");
        expect(body).toHaveProperty("end_ledger");
        expect(body).toHaveProperty("start_ledger");
        expect(body).toHaveProperty("claimable_amount");
        expect(body).toHaveProperty("is_cliff_passed");
        // Types — rate and claimable_amount are strings to preserve i128 precision
        expect(typeof body.rate).toBe("string");
        expect(typeof body.claimable_amount).toBe("string");
        expect(typeof body.is_cliff_passed).toBe("boolean");
        expect(Number.isInteger(body.cliff_ledger)).toBe(true);
        expect(Number.isInteger(body.end_ledger)).toBe(true);
        expect(Number.isInteger(body.start_ledger)).toBe(true);
      });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: GET /api/schedules/sponsor/:sponsor — paginated list
// ─────────────────────────────────────────────────────────────────────────────

describe("Pact — GET /api/schedules/sponsor/:sponsor (paginated list)", () => {
  it("pagination envelope shape matches the contract", async () => {
    const provider = makeProvider();

    await provider
      .given("streams exist for sponsor")
      .uponReceiving("a paginated request for a sponsor's streams")
      .withRequest({
        method: "GET",
        path: `/api/schedules/sponsor/${SPONSOR}`,
        query: { page: "1", limit: "20" },
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: like({
          items: eachLike({
            recipient: string(RECIPIENT),
            sponsor: string(SPONSOR),
            token: string("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK3M"),
            ledger: integer(51_000_000),
            event_id: string("0000000000000000"),
          }),
          page: integer(1),
          limit: integer(20),
          // next_cursor may be null or a string; use nullValue() as the example
          next_cursor: nullValue(),
        }),
      })
      .executeTest(async (mockServer) => {
        const { status, body } = await fetchJson(
          `${mockServer.url}/api/schedules/sponsor/${SPONSOR}?page=1&limit=20`,
        );

        expect(status).toBe(200);
        // Envelope shape
        expect(body).toHaveProperty("items");
        expect(body).toHaveProperty("page");
        expect(body).toHaveProperty("limit");
        expect("next_cursor" in body).toBe(true); // may be null or string
        expect(Array.isArray(body.items)).toBe(true);
        expect(Number.isInteger(body.page)).toBe(true);
        expect(Number.isInteger(body.limit)).toBe(true);

        // Each item shape
        if (body.items.length > 0) {
          const item = body.items[0];
          expect(item).toHaveProperty("recipient");
          expect(item).toHaveProperty("sponsor");
          expect(item).toHaveProperty("token");
          expect(item).toHaveProperty("ledger");
          expect(item).toHaveProperty("event_id");
        }
      });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: POST /api/tx/submit — claim_vested tx hash/status response
// ─────────────────────────────────────────────────────────────────────────────

describe("Pact — POST /api/tx/submit (claim_vested)", () => {
  it("transaction response shape matches the contract", async () => {
    const provider = makeProvider();

    await provider
      .given("backend is configured with a valid signing key and contract")
      .uponReceiving("a claim_vested transaction submission request")
      .withRequest({
        method: "POST",
        path: "/api/tx/submit",
        headers: { "Content-Type": "application/json" },
        body: {
          operation: "claim_vested",
          params: { recipient: RECIPIENT },
        },
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: like({
          hash: string(
            "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
          ),
          status: string("SUCCESS"),
        }),
      })
      .executeTest(async (mockServer) => {
        const { status, body } = await fetchJson(
          `${mockServer.url}/api/tx/submit`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              operation: "claim_vested",
              params: { recipient: RECIPIENT },
            }),
          },
        );

        expect(status).toBe(200);
        expect(body).toHaveProperty("hash");
        expect(body).toHaveProperty("status");
        expect(typeof body.hash).toBe("string");
        expect(body.hash.length).toBeGreaterThan(0);
        // Backend returns "SUCCESS" or "PENDING"
        expect(["SUCCESS", "PENDING"]).toContain(body.status);
      });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: GET /api/schedules/:recipient 404 — error response shape
// ─────────────────────────────────────────────────────────────────────────────

describe("Pact — GET /api/schedules/:recipient (not found)", () => {
  it("error response shape { error: string } matches the contract", async () => {
    const provider = makeProvider();

    await provider
      .given("no vesting schedule exists for recipient")
      .uponReceiving("a request for an unknown recipient's schedule")
      .withRequest({
        method: "GET",
        path: `/api/schedules/${UNKNOWN_RECIPIENT}`,
      })
      .willRespondWith({
        status: 404,
        headers: { "Content-Type": "application/json" },
        body: like({
          error: string("schedule not found"),
        }),
      })
      .executeTest(async (mockServer) => {
        const { status, body } = await fetchJson(
          `${mockServer.url}/api/schedules/${UNKNOWN_RECIPIENT}`,
        );

        expect(status).toBe(404);
        expect(body).toHaveProperty("error");
        expect(typeof body.error).toBe("string");
        expect(body.error.length).toBeGreaterThan(0);
      });
  });
});
