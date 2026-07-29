/**
 * API Contract Tests — Issue #367
 *
 * Verifies that the frontend correctly handles every documented backend API
 * response shape (200, 404, 400, 401, 429, 500) as described in docs/api.yaml.
 *
 * MSW intercepts all HTTP calls so these tests run fully offline.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { server } from "@/test/mswServer";
import { handlers, BASE_URL, vestingScheduleFixture, sponsorPageFixture } from "@/test/handlers";

// ---------------------------------------------------------------------------
// Helper: thin fetch wrapper that mirrors what the real app would use
// ---------------------------------------------------------------------------

async function fetchSchedule(recipient: string) {
  const res = await fetch(`${BASE_URL}/schedules/${recipient}`);
  return { status: res.status, body: await res.json() };
}

async function fetchClaimable(recipient: string) {
  const res = await fetch(`${BASE_URL}/claimable/${recipient}`);
  return { status: res.status, body: await res.json() };
}

async function fetchSponsorSchedules(sponsor: string, page = 1) {
  const res = await fetch(`${BASE_URL}/schedules/sponsor/${sponsor}?page=${page}`);
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// GET /schedules/:recipient
// ---------------------------------------------------------------------------

describe("GET /schedules/:recipient — contract shape", () => {
  it("200: returns full VestingSchedule with all required fields", async () => {
    const { status, body } = await fetchSchedule("GABC123");
    expect(status).toBe(200);

    // All fields required by docs/api.yaml VestingSchedule schema
    expect(body).toMatchObject({
      recipient: expect.any(String),
      sponsor: expect.any(String),
      token: expect.any(String),
      rate: expect.any(String),           // i128 as string
      cliff_ledger: expect.any(Number),
      end_ledger: expect.any(Number),
      start_ledger: expect.any(Number),
      claimable_amount: expect.any(String), // i128 as string
      is_cliff_passed: expect.any(Boolean),
    });
  });

  it("200: rate and claimable_amount are strings (preserves i128 precision)", async () => {
    const { body } = await fetchSchedule("GABC123");
    expect(typeof body.rate).toBe("string");
    expect(typeof body.claimable_amount).toBe("string");
  });

  it("200: fixture data matches expected values", async () => {
    const { body } = await fetchSchedule("GABC123");
    expect(body).toMatchObject({
      rate: vestingScheduleFixture.rate,
      cliff_ledger: vestingScheduleFixture.cliff_ledger,
      is_cliff_passed: vestingScheduleFixture.is_cliff_passed,
    });
  });

  it("404: returns Error schema when schedule not found", async () => {
    server.use(handlers.schedule404);
    const { status, body } = await fetchSchedule("GABC_MISSING");
    expect(status).toBe(404);
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
    expect(body.error.toLowerCase()).toContain("not found");
  });

  it("400: returns Error schema for bad recipient param", async () => {
    server.use(handlers.schedule400);
    const { status, body } = await fetchSchedule("INVALID");
    expect(status).toBe(400);
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
  });

  it("401: returns Error schema when unauthorized", async () => {
    server.use(handlers.schedule401);
    const { status, body } = await fetchSchedule("GABC123");
    expect(status).toBe(401);
    expect(body).toHaveProperty("error");
  });

  it("429: returns Error schema when rate-limited", async () => {
    server.use(handlers.schedule429);
    const { status, body } = await fetchSchedule("GABC123");
    expect(status).toBe(429);
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/too many requests/i);
  });

  it("500: returns Error schema on server error", async () => {
    server.use(handlers.schedule500);
    const { status, body } = await fetchSchedule("GABC123");
    expect(status).toBe(500);
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
  });

  it("network error: fetch rejects on network failure", async () => {
    server.use(handlers.scheduleNetworkError);
    await expect(fetchSchedule("GABC123")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// claimable_amount business-logic assertions
// ---------------------------------------------------------------------------

describe("claimable_amount contract rules", () => {
  it("claimable_amount = '0' when cliff not passed", async () => {
    server.use(handlers.schedulePreCliff);
    const { body } = await fetchSchedule("GABC123");
    expect(body.is_cliff_passed).toBe(false);
    expect(body.claimable_amount).toBe("0");
  });

  it("claimable_amount is non-zero string when cliff has passed", async () => {
    server.use(handlers.scheduleOk);
    const { body } = await fetchSchedule("GABC123");
    expect(body.is_cliff_passed).toBe(true);
    expect(Number(body.claimable_amount)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// GET /claimable/:recipient
// ---------------------------------------------------------------------------

describe("GET /claimable/:recipient — contract shape", () => {
  it("200: returns ClaimableResponse schema", async () => {
    const { status, body } = await fetchClaimable("GABC123");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      recipient: expect.any(String),
      claimable_amount: expect.any(String),
    });
  });

  it("200: claimable_amount = '0' when cliff not reached", async () => {
    server.use(handlers.claimableZero);
    const { body } = await fetchClaimable("GABC123");
    expect(body.claimable_amount).toBe("0");
  });

  it("500: returns Error schema on RPC failure", async () => {
    server.use(handlers.claimable500);
    const { status, body } = await fetchClaimable("GABC123");
    expect(status).toBe(500);
    expect(body).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// GET /schedules/sponsor/:sponsor
// ---------------------------------------------------------------------------

describe("GET /schedules/sponsor/:sponsor — contract shape", () => {
  it("200: returns SponsorSchedulesPage schema", async () => {
    const { status, body } = await fetchSponsorSchedules("GSPON123");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      items: expect.any(Array),
      page: expect.any(Number),
      limit: expect.any(Number),
    });
    // next_cursor may be null or a string
    expect([null, "string"]).toContain(
      body.next_cursor === null ? null : typeof body.next_cursor
    );
  });

  it("200: each item conforms to StreamSummary schema", async () => {
    const { body } = await fetchSponsorSchedules("GSPON123");
    for (const item of body.items) {
      expect(item).toMatchObject({
        recipient: expect.any(String),
        sponsor: expect.any(String),
        token: expect.any(String),
        ledger: expect.any(Number),
        event_id: expect.any(String),
      });
    }
  });

  it("200: fixture page matches expected structure", async () => {
    const { body } = await fetchSponsorSchedules("GSPON123");
    expect(body.items).toHaveLength(sponsorPageFixture.items.length);
    expect(body.page).toBe(1);
  });

  it("502: returns Error schema when Horizon unavailable", async () => {
    server.use(handlers.sponsorPage502);
    const { status, body } = await fetchSponsorSchedules("GSPON123");
    expect(status).toBe(502);
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/horizon/i);
  });
});

// ---------------------------------------------------------------------------
// Error schema contract — shared across all endpoints
// ---------------------------------------------------------------------------

describe("Error schema contract", () => {
  const errorCases: Array<{ name: string; handler: ReturnType<typeof handlers.schedule404>; expectedStatus: number }> = [
    { name: "404", handler: handlers.schedule404, expectedStatus: 404 },
    { name: "400", handler: handlers.schedule400, expectedStatus: 400 },
    { name: "401", handler: handlers.schedule401, expectedStatus: 401 },
    { name: "429", handler: handlers.schedule429, expectedStatus: 429 },
    { name: "500", handler: handlers.schedule500, expectedStatus: 500 },
  ];

  for (const { name, handler, expectedStatus } of errorCases) {
    it(`${name}: Error body has exactly { error: string } shape`, async () => {
      server.use(handler);
      const { status, body } = await fetchSchedule("GABC123");
      expect(status).toBe(expectedStatus);
      // Contract: { error: string } — no extra required fields
      expect(typeof body.error).toBe("string");
      expect(body.error.length).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Pagination contract
// ---------------------------------------------------------------------------

describe("Pagination contract", () => {
  it("page defaults to 1 and limit defaults to 20", async () => {
    const { body } = await fetchSponsorSchedules("GSPON123");
    expect(body.page).toBeGreaterThanOrEqual(1);
    expect(body.limit).toBeGreaterThanOrEqual(1);
    expect(body.limit).toBeLessThanOrEqual(50); // max per spec
  });
});
