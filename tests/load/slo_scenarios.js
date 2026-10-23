/**
 * k6 SLO scenarios for the vesting backend API (issue #1054).
 *
 * These four scenarios encode the acceptance criteria from issue #1054 and are
 * the source of truth for the documented results in
 * `docs/performance/load-test-results.md`.
 *
 *   1. steady_streams   — 100 concurrent users, steady RPS for 5 min,
 *                         p95 < 200 ms for GET /api/streams
 *   2. stream_details   — 50 concurrent users on GET /api/streams/:recipient,
 *                         p95 < 150 ms
 *   3. spike            — 10 -> 200 VUs in 30 s, recovery within 60 s
 *   4. claimable_batch  — GET /claimable/:recipient for 20 recipients,
 *                         p95 < 500 ms (RPC-bound)
 *
 * Usage:
 *   k6 run tests/load/slo_scenarios.js
 *   BASE_URL=http://localhost:3001 k6 run tests/load/slo_scenarios.js
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Trend, Rate } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";

// ── Custom metrics ───────────────────────────────────────────────────────────
const streamsDur = new Trend("slo_streams_ms", true);
const detailsDur = new Trend("slo_details_ms", true);
const batchDur = new Trend("slo_batch_ms", true);
const errorRate = new Rate("slo_error_rate");

function recipientFor(vu, iter) {
  return "G" + String(vu * 1000 + iter).padStart(55, "0");
}

export const options = {
  thresholds: {
    // Scenario 1
    slo_streams_ms: ["p(95)<200"],
    // Scenario 2
    slo_details_ms: ["p(95)<150"],
    // Scenario 4
    slo_batch_ms: ["p(95)<500"],
    // Global error budget
    slo_error_rate: ["rate<0.001"],
  },
  scenarios: {
    // Scenario 1: 100 concurrent users, steady load for 5 minutes.
    steady_streams: {
      executor: "constant-vus",
      vus: 100,
      duration: "5m",
      exec: "steadyStreamsScenario",
      tags: { scenario: "steady_streams" },
    },
    // Scenario 2: 50 concurrent users hitting stream details.
    stream_details: {
      executor: "constant-vus",
      vus: 50,
      duration: "2m",
      exec: "streamDetailsScenario",
      tags: { scenario: "stream_details" },
    },
    // Scenario 3: spike 10 -> 200 users in 30 s, then recover.
    spike: {
      executor: "ramping-vus",
      startVUs: 10,
      stages: [
        { duration: "30s", target: 200 },
        { duration: "1m", target: 200 },
        { duration: "30s", target: 10 },
        { duration: "1m", target: 10 },
      ],
      gracefulRampDown: "30s",
      exec: "spikeScenario",
      tags: { scenario: "spike" },
    },
    // Scenario 4: claimable batch of 20 recipients (RPC-bound).
    claimable_batch: {
      executor: "constant-vus",
      vus: 20,
      duration: "2m",
      exec: "claimableBatchScenario",
      tags: { scenario: "claimable_batch" },
    },
  },
};

// ── Scenario implementations ─────────────────────────────────────────────────

export function steadyStreamsScenario() {
  const res = http.get(`${BASE_URL}/api/streams`);
  streamsDur.add(res.timings.duration);
  errorRate.add(res.status >= 500);
  check(res, { "GET /api/streams is 2xx/4xx": (r) => r.status < 500 });
  sleep(1);
}

export function streamDetailsScenario() {
  const recipient = recipientFor(__VU, __ITER);
  const res = http.get(`${BASE_URL}/api/streams/${recipient}`);
  detailsDur.add(res.timings.duration);
  errorRate.add(res.status >= 500);
  check(res, { "GET /api/streams/:recipient is 2xx/4xx": (r) => r.status < 500 });
  sleep(1);
}

export function spikeScenario() {
  const recipient = recipientFor(__VU, __ITER);
  const res = http.get(`${BASE_URL}/api/streams/${recipient}`);
  detailsDur.add(res.timings.duration);
  errorRate.add(res.status >= 500);
  sleep(0.5);
}

export function claimableBatchScenario() {
  group("claimable_batch_20", function () {
    const start = Date.now();
    for (let i = 0; i < 20; i++) {
      const recipient = recipientFor(__VU * 20 + i, __ITER);
      const res = http.get(`${BASE_URL}/claimable/${recipient}`);
      errorRate.add(res.status >= 500);
    }
    batchDur.add(Date.now() - start);
  });
  sleep(1);
}
