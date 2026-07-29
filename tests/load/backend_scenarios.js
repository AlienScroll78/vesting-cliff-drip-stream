/**
 * k6 load test suite for the vesting backend API.
 *
 * Benchmarks the Express backend under realistic traffic patterns and
 * establishes SLO baselines for response time and error rate.
 *
 * Scenarios:
 *   1. schedule_queries  — 100 concurrent users querying schedules (60 s)
 *   2. create_streams    — 10 users creating streams simultaneously
 *   3. claim_vested      — 50 users claiming every 5 seconds
 *   4. ramping_profile   — 0 -> 100 -> 200 -> 100 -> 0 VUs over 5 minutes
 *
 * SLO targets:
 *   - p95 response time < 500 ms  (all endpoints)
 *   - error rate         < 0.1 %
 *
 * Usage:
 *   k6 run tests/load/backend_scenarios.js
 *
 * Environment variables:
 *   BASE_URL       — Backend base URL (default: http://localhost:3001)
 *   SKIP_MUTATIONS — Set to "1" to skip create/claim scenarios (dry-run)
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// ── Configuration ────────────────────────────────────────────────────────────
const BASE_URL  = __ENV.BASE_URL || "http://localhost:3001";
const SKIP_MUT  = __ENV.SKIP_MUTATIONS === "1";

function recipientFor(vu, iter) {
  var idx = vu * 1000 + iter;
  return "G" + String(idx).padStart(55, "0");
}

function sponsorFor(i) {
  return "GA" + String(i).padStart(54, "0");
}

function tokenFor(i) {
  return "CA" + String(i).padStart(54, "0");
}

// ── Custom metrics ───────────────────────────────────────────────────────────
var scheduleDur   = new Trend("schedule_query_ms", true);
var claimableDur  = new Trend("claimable_query_ms", true);
var analyticsDur  = new Trend("analytics_query_ms", true);
var createDur     = new Trend("create_stream_ms", true);
var claimDur      = new Trend("claim_ms", true);
var healthDur     = new Trend("health_check_ms", true);
var errorRate     = new Rate("error_rate");
var createRt      = new Rate("create_success_rate");
var claimRt       = new Rate("claim_success_rate");
var mutTotal      = new Counter("mutations_total");
var qryTotal      = new Counter("queries_total");

// ── SLO thresholds ───────────────────────────────────────────────────────────
export var options = {
  setupTimeout: "10s",
  teardownTimeout: "10s",
  thresholds: {
    // p95 < 500 ms for all read endpoints (SLO #1)
    schedule_query_ms:  ["p(95)<500"],
    claimable_query_ms: ["p(95)<500"],
    analytics_query_ms: ["p(95)<500"],
    health_check_ms:    ["p(95)<500"],
    // p95 < 500 ms for write endpoints (local fast-path)
    create_stream_ms:   ["p(95)<500"],
    claim_ms:           ["p(95)<500"],
    // Error rate < 0.1 % (SLO #2)
    error_rate:         ["rate<0.001"],
    http_req_failed:    ["rate<0.001"],
    // Mutation success rates
    create_success_rate: ["rate>=0.95"],
    claim_success_rate:  ["rate>=0.95"],
  },
  scenarios: {
    schedule_queries: {
      executor: "constant-vus",
      vus: 100,
      duration: "60s",
      exec: "scheduleQueryScenario",
      tags: { scenario: "schedule_queries" },
    },
    create_streams: {
      executor: "shared-iterations",
      vus: 10,
      iterations: 10,
      maxDuration: "30s",
      startTime: "2s",
      exec: "createStreamScenario",
      tags: { scenario: "create_streams" },
    },
    claim_vested: {
      executor: "per-vu-iterations",
      vus: 50,
      iterations: 5,
      maxDuration: "60s",
      startTime: "5s",
      exec: "claimScenario",
      tags: { scenario: "claim_vested" },
    },
    ramping_profile: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 100 },
        { duration: "1m", target: 200 },
        { duration: "2m", target: 100 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
      startTime: "65s",
      exec: "rampingQueryScenario",
      tags: { scenario: "ramping_profile" },
    },
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getReq(url, trend) {
  var start = Date.now();
  var res   = http.get(url);
  trend.add(Date.now() - start);
  qryTotal.add(1);
  var ok = check(res, {
    "status 200": function(r) { return r.status === 200; },
  });
  if (!ok) { errorRate.add(1); }
  return res;
}

function postReq(url, body, trend) {
  var payload = JSON.stringify(body);
  var start   = Date.now();
  var res     = http.post(url, payload, {
    headers: { "Content-Type": "application/json" },
  });
  trend.add(Date.now() - start);
  mutTotal.add(1);
  var ok = check(res, {
    "status 2xx": function(r) { return r.status >= 200 && r.status < 300; },
  });
  if (!ok) { errorRate.add(1); }
  return res;
}

// ── Setup: probe backend reachability ────────────────────────────────────────
export function setup() {
  var r = http.get(BASE_URL + "/health");
  if (r.status !== 200) {
    console.error("[setup] Backend unreachable at " + BASE_URL + " (HTTP " + r.status + ")");
    return { reachable: false };
  }
  console.log("[setup] Backend OK at " + BASE_URL);
  return { reachable: true };
}

// ── Scenario: schedule queries (100 users, 60 s) ─────────────────────────────
export function scheduleQueryScenario(data) {
  if (data && data.reachable === false) { errorRate.add(1); return; }
  var recipient = recipientFor(__VU, __ITER);
  group("schedule_query", function() {
    getReq(BASE_URL + "/api/schedules/" + recipient, scheduleDur);
    sleep(0.5);
  });
}

// ── Scenario: create streams (10 users) ──────────────────────────────────────
export function createStreamScenario(data) {
  if (data && data.reachable === false) { errorRate.add(1); return; }
  if (SKIP_MUT) { getReq(BASE_URL + "/health", healthDur); return; }

  var recipient = recipientFor(__VU, __ITER);
  group("create_stream", function() {
    var res = postReq(BASE_URL + "/tx/submit", {
      operation: "create_vesting_stream",
      params: {
        sponsor:        sponsorFor(__VU),
        recipient:      recipient,
        token:          tokenFor(__VU),
        rate:           "10",
        cliff_duration: 17280,
        total_duration: 172800,
      },
    }, createDur);
    createRt.add(res.status >= 200 && res.status < 300 ? 1 : 0);
  });
}

// ── Scenario: claim vested (50 users, every 5 s) ────────────────────────────
export function claimScenario(data) {
  if (data && data.reachable === false) { errorRate.add(1); return; }
  if (SKIP_MUT) { getReq(BASE_URL + "/health", healthDur); sleep(5); return; }

  var recipient = recipientFor(__VU, __ITER);
  group("claim_vested", function() {
    var res = postReq(BASE_URL + "/tx/submit", {
      operation: "claim_vested",
      params: { recipient: recipient },
    }, claimDur);
    claimRt.add(res.status >= 200 && res.status < 300 ? 1 : 0);
  });
  sleep(5);
}

// ── Scenario: ramping profile (0 -> 100 -> 200 -> 100 -> 0, 5 min) ──────────
export function rampingQueryScenario(data) {
  if (data && data.reachable === false) { errorRate.add(1); return; }

  var recipient = recipientFor(__VU, __ITER);
  group("ramping_queries", function() {
    getReq(BASE_URL + "/api/schedules/" + recipient, scheduleDur);
    sleep(0.2);
    getReq(BASE_URL + "/api/claimable/" + recipient, claimableDur);
    sleep(0.2);
    getReq(BASE_URL + "/analytics/sponsor/" + sponsorFor(__VU % 10), analyticsDur);
    sleep(0.2);
    getReq(BASE_URL + "/health", healthDur);
    sleep(2);
  });
}

// ── Teardown ──────────────────────────────────────────────────────────────────
export function teardown(data) {
  console.log("[teardown] Load test complete.");
}

// ── Summary ───────────────────────────────────────────────────────────────────
export function handleSummary(data) {
  var m = data.metrics;

  var slo = {
    p95_under_500ms: {
      schedule:  getP95(m.schedule_query_ms)  < 500 ? "pass" : "fail",
      claimable: getP95(m.claimable_query_ms) < 500 ? "pass" : "fail",
      analytics: getP95(m.analytics_query_ms) < 500 ? "pass" : "fail",
      health:    getP95(m.health_check_ms)    < 500 ? "pass" : "fail",
      create:    getP95(m.create_stream_ms)   < 500 ? "pass" : "fail",
      claim:     getP95(m.claim_ms)           < 500 ? "pass" : "fail",
    },
    error_rate_under_01pct: (getRate(m.error_rate) * 100) < 0.1 ? "pass" : "fail",
  };

  var summary = {
    meta: {
      date: new Date().toISOString(),
      base_url: BASE_URL,
      skip_mutations: SKIP_MUT,
      duration_ms: data.state ? data.state.testRunDurationMs : 0,
    },
    summary: {
      error_rate_pct:        (getRate(m.error_rate) * 100).toFixed(4),
      schedule_query_p95:    getP95(m.schedule_query_ms),
      claimable_query_p95:   getP95(m.claimable_query_ms),
      analytics_query_p95:   getP95(m.analytics_query_ms),
      health_check_p95:      getP95(m.health_check_ms),
      create_stream_p95:     getP95(m.create_stream_ms),
      claim_p95:             getP95(m.claim_ms),
      create_success_rate:   (getRate(m.create_success_rate) * 100).toFixed(1),
      claim_success_rate:    (getRate(m.claim_success_rate) * 100).toFixed(1),
      queries_total:         getCount(m.queries_total),
      mutations_total:       getCount(m.mutations_total),
    },
    slo_results: slo,
  };

  var lines = [
    "",
    "================================================",
    "  Vesting Backend \u2014 k6 Load Test Results",
    "================================================",
    "",
    "  Base URL        : " + summary.meta.base_url,
    "  Duration        : " + (summary.meta.duration_ms / 1000).toFixed(1) + " s",
    "  Skip mutations  : " + summary.meta.skip_mutations,
    "",
    "  --- p95 latencies (ms) ---",
    "    schedule       : " + summary.summary.schedule_query_p95,
    "    claimable      : " + summary.summary.claimable_query_p95,
    "    analytics      : " + summary.summary.analytics_query_p95,
    "    health         : " + summary.summary.health_check_p95,
    "    create_stream  : " + summary.summary.create_stream_p95,
    "    claim          : " + summary.summary.claim_p95,
    "",
    "  --- Success rates ---",
    "    create         : " + summary.summary.create_success_rate + " %",
    "    claim          : " + summary.summary.claim_success_rate + " %",
    "",
    "  --- SLO verdict ---",
    "    p95 < 500 ms   : " + (p95ok(slo) ? "PASS" : "FAIL"),
    "    err < 0.1 %    : " + slo.error_rate_under_01pct + "  (" + summary.summary.error_rate_pct + " %)",
    "",
    "  Total queries   : " + summary.summary.queries_total,
    "  Total mutations : " + summary.summary.mutations_total,
    "",
    "  Results saved to: tests/load/results/backend_load_test.json",
    "",
  ];

  return {
    "tests/load/results/backend_load_test.json": JSON.stringify(summary, null, 2),
    stdout: lines.join("\n"),
  };
}

function getP95(metric) {
  return metric && metric.values ? (metric.values["p(95)"] || 0) : 0;
}

function getRate(metric) {
  return metric && metric.values ? (metric.values.rate || 0) : 0;
}

function getCount(metric) {
  return metric && metric.values ? (metric.values.count || 0) : 0;
}

function p95ok(slo) {
  var o = slo.p95_under_500ms;
  return o.schedule === "pass" && o.claimable === "pass" &&
         o.analytics === "pass" && o.health === "pass" &&
         o.create === "pass" && o.claim === "pass";
}
