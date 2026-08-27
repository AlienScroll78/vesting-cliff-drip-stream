/**
 * MSW handlers for the vesting backend REST API.
 * Shapes are kept in sync with docs/api.yaml.
 *
 * BASE_URL mirrors the local dev server defined in the OpenAPI spec.
 */
import { http, HttpResponse } from "msw";

export const BASE_URL = "http://localhost:3001/api";

// ── Canonical fixture data ────────────────────────────────────────────────────

export const RECIPIENT = "GABC1RECIPIENTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
export const SPONSOR = "GSPON1SPONSORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

export const vestingScheduleFixture = {
  recipient: RECIPIENT,
  sponsor: SPONSOR,
  token: "CUSDC1TOKENXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  rate: "10",
  cliff_ledger: 51_100_000,
  end_ledger: 52_000_000,
  start_ledger: 51_000_000,
  claimable_amount: "1500",
  is_cliff_passed: true,
};

export const claimableZeroFixture = {
  ...vestingScheduleFixture,
  claimable_amount: "0",
  is_cliff_passed: false,
};

export const preCliffScheduleFixture = {
  ...vestingScheduleFixture,
  is_cliff_passed: false,
  claimable_amount: "0",
  cliff_ledger: 51_500_000, // in the future
};

export const sponsorPageFixture = {
  items: [
    {
      recipient: RECIPIENT,
      sponsor: SPONSOR,
      token: "CUSDC1TOKENXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      ledger: 51_000_000,
      event_id: "evt_001",
    },
  ],
  page: 1,
  limit: 20,
  next_cursor: null,
};

// ── Default happy-path handlers ───────────────────────────────────────────────

export const defaultHandlers = [
  // GET /schedules/:recipient
  http.get(`${BASE_URL}/schedules/:recipient`, ({ params }) => {
    const { recipient } = params as { recipient: string };
    if (recipient === "NOTFOUND") {
      return HttpResponse.json({ error: "schedule not found" }, { status: 404 });
    }
    return HttpResponse.json({ ...vestingScheduleFixture, recipient });
  }),

  // GET /schedules/sponsor/:sponsor
  http.get(`${BASE_URL}/schedules/sponsor/:sponsor`, () => {
    return HttpResponse.json(sponsorPageFixture);
  }),

  // GET /claimable/:recipient
  http.get(`${BASE_URL}/claimable/:recipient`, ({ params }) => {
    const { recipient } = params as { recipient: string };
    return HttpResponse.json({ recipient, claimable_amount: "1500" });
  }),

  // Horizon fee_stats — default happy-path for issue #71 fee estimation
  http.get("https://horizon-testnet.stellar.org/fee_stats", () =>
    HttpResponse.json({
      last_ledger: "51200000",
      last_ledger_base_fee: "100",
      ledger_capacity_usage: "0.30",
      fee_charged: {
        max: "1500", min: "100", mode: "100",
        p10: "100", p20: "100", p30: "100", p40: "100", p50: "100",
        p60: "100", p70: "100", p80: "200", p90: "1000", p95: "1200", p99: "1500",
      },
    })
  ),

  // CoinGecko XLM price — default happy-path for issue #71 USD equivalent
  http.get("https://api.coingecko.com/api/v3/simple/price", () =>
    HttpResponse.json({ stellar: { usd: 0.12 } })
  ),
];

// ── Error scenario handlers (for use with server.use()) ───────────────────────

export const handlers = {
  // 200 with data (default – re-exported for explicitness in tests)
  scheduleOk: http.get(`${BASE_URL}/schedules/:recipient`, () =>
    HttpResponse.json(vestingScheduleFixture)
  ),

  // 200 with claimable_amount = "0"
  scheduleClaimableZero: http.get(`${BASE_URL}/schedules/:recipient`, () =>
    HttpResponse.json(claimableZeroFixture)
  ),

  // 200 pre-cliff (cliff not yet passed)
  schedulePreCliff: http.get(`${BASE_URL}/schedules/:recipient`, () =>
    HttpResponse.json(preCliffScheduleFixture)
  ),

  // 404 schedule not found
  schedule404: http.get(`${BASE_URL}/schedules/:recipient`, () =>
    HttpResponse.json({ error: "schedule not found" }, { status: 404 })
  ),

  // 400 bad request
  schedule400: http.get(`${BASE_URL}/schedules/:recipient`, () =>
    HttpResponse.json({ error: "invalid recipient address" }, { status: 400 })
  ),

  // 401 unauthorized
  schedule401: http.get(`${BASE_URL}/schedules/:recipient`, () =>
    HttpResponse.json({ error: "Unauthorized" }, { status: 401 })
  ),

  // 429 rate limited
  schedule429: http.get(`${BASE_URL}/schedules/:recipient`, () =>
    HttpResponse.json({ error: "Too Many Requests" }, { status: 429 })
  ),

  // 500 server error
  schedule500: http.get(`${BASE_URL}/schedules/:recipient`, () =>
    HttpResponse.json({ error: "internal server error" }, { status: 500 })
  ),

  // Network error (no response)
  scheduleNetworkError: http.get(`${BASE_URL}/schedules/:recipient`, () =>
    HttpResponse.error()
  ),

  // Claimable endpoint variants
  claimableZero: http.get(`${BASE_URL}/claimable/:recipient`, ({ params }) =>
    HttpResponse.json({ recipient: (params as { recipient: string }).recipient, claimable_amount: "0" })
  ),

  claimable500: http.get(`${BASE_URL}/claimable/:recipient`, () =>
    HttpResponse.json({ error: "RPC error" }, { status: 500 })
  ),

  // Sponsor list variants
  sponsorPageOk: http.get(`${BASE_URL}/schedules/sponsor/:sponsor`, () =>
    HttpResponse.json(sponsorPageFixture)
  ),

  sponsorPage502: http.get(`${BASE_URL}/schedules/sponsor/:sponsor`, () =>
    HttpResponse.json({ error: "horizon unavailable" }, { status: 502 })
  ),
};
