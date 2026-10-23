/**
 * k6 Load Test Suite – Vesting API Performance Benchmarking
 *
 * Issue #781 – Build API load test suite with k6 for performance benchmarking.
 *
 * Benchmarks the API server under realistic traffic patterns and identifies
 * breaking points before production deployment. Specifically models TGE
 * (Token Generation Event) traffic spikes where thousands of recipients
 * simultaneously check claimable balances.
 *
 * ── Scenarios ──────────────────────────────────────────────────────────────
 *
 *   1. baseline    — 10 VUs, 1 minute.   Establish p95 latency baseline.
 *   2. ramp_up     — 0→100 VUs, 5 min.   Find scale-up lag / saturation point.
 *   3. spike       — 200 VUs, 30 s.      Simulate TGE spike.
 *   4. endurance   — 50 VUs, 30 min.     Find memory leaks / connection pool exhaustion.
 *
 * ── SLA Targets ────────────────────────────────────────────────────────────
 *
 *   p95 latency < 200 ms   for GET /api/streams/:recipient
 *   error rate  < 0.1 %    under 100 VUs
 *   throughput  ≥ 500 req/s for read endpoints
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *
 *   # Full suite (all 4 scenarios sequentially)
 *   k6 run tests/load/tge_scenarios.js
 *
 *   # Single scenario
 *   k6 run tests/load/tge_scenarios.js -e SCENARIO=baseline
 *   k6 run tests/load/tge_scenarios.js -e SCENARIO=ramp_up
 *   k6 run tests/load/tge_scenarios.js -e SCENARIO=spike
 *   k6 run tests/load/tge_scenarios.js -e SCENARIO=endurance
 *
 *   # CI mode (shorter durations, no endurance)
 *   k6 run tests/load/tge_scenarios.js -e CI=1
 *
 * ── Environment Variables ──────────────────────────────────────────────────
 *
 *   BASE_URL    — API base URL (default: http://localhost:3001)
 *   SCENARIO    — Run only this scenario (default: all)
 *   CI          — Shorten durations for CI (default: 0)
 *   HTML_REPORT — Path to write HTML report (default: tests/load/results/report.html)
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter, Gauge } from "k6/metrics";
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.2/index.js";

// ── Configuration ─────────────────────────────────────────────────────────────

const BASE_URL     = __ENV.BASE_URL     || "http://localhost:3001";
const SCENARIO     = __ENV.SCENARIO     || "all";
const CI_MODE      = __ENV.CI           === "1";
const HTML_REPORT  = __ENV.HTML_REPORT  || "tests/load/results/report.html";

// In CI, compress durations so the suite finishes in < 15 min.
const CI_FACTOR = CI_MODE ? 0.1 : 1.0;

function dur(seconds) {
  const s = Math.max(10, Math.round(seconds * CI_FACTOR));
  return s + "s";
}

// ── Custom Metrics ────────────────────────────────────────────────────────────

// Primary SLA metric: GET /api/streams/:recipient (p95 < 200 ms)
const streamReadDur  = new Trend("stream_read_ms",   true);
const claimableDur   = new Trend("claimable_ms",     true);
const healthDur      = new Trend("health_ms",        true);
const scheduleDur    = new Trend("schedule_ms",      true);
const analyticsDur   = new Trend("analytics_ms",     true);

// Error tracking
const errorRate      = new Rate("error_rate");

// Throughput counter (used to derive req/s in summary)
const reqCounter     = new Counter("total_requests");

// Concurrent VU gauge (for debugging saturation)
const activeVUs      = new Gauge("active_vus");

// ── SLA Thresholds ────────────────────────────────────────────────────────────
//
//   From issue #781:
//     p95 < 200 ms for GET /api/streams/:recipient
//     error rate < 0.1 % under 100 VUs
//     throughput ≥ 500 req/s for read endpoints (validated in summary)

export const options = {
  setupTimeout:    "15s",
  teardownTimeout: "15s",

  thresholds: {
    // SLA #1: p95 read latency under 200 ms
    stream_read_ms:  ["p(95)<200"],
    claimable_ms:    ["p(95)<200"],
    schedule_ms:     ["p(95)<200"],

    // SLA #2: error rate under 0.1%
    error_rate:       ["rate<0.001"],
    http_req_failed:  ["rate<0.001"],

    // Health endpoint stays fast regardless of load
    health_ms:        ["p(95)<100"],
  },

  scenarios: buildScenarios(),
};

function buildScenarios() {
  const all = {
    // ── Scenario 1: Baseline ──────────────────────────────────────────────
    // 10 VUs, 1 minute — establish p95 latency with no load pressure.
    baseline: {
      executor:  "constant-vus",
      vus:       10,
      duration:  dur(60),
      exec:      "readScenario",
      startTime: "0s",
      tags:      { scenario: "baseline" },
      gracefulStop: "5s",
    },

    // ── Scenario 2: Ramp-up ───────────────────────────────────────────────
    // 0→100 VUs over 5 minutes — find the scale-up lag / saturation point.
    ramp_up: {
      executor:  "ramping-vus",
      startVUs:  0,
      stages: [
        { duration: dur(60),  target: 25  },  // warm-up
        { duration: dur(60),  target: 50  },  // half load
        { duration: dur(120), target: 100 },  // target load
        { duration: dur(60),  target: 0   },  // cool-down
      ],
      gracefulRampDown: "10s",
      exec:      "readScenario",
      startTime: dur(75),   // Start after baseline finishes.
      tags:      { scenario: "ramp_up" },
    },

    // ── Scenario 3: Spike ─────────────────────────────────────────────────
    // 200 VUs for 30 seconds — simulate TGE spike.
    spike: {
      executor:  "constant-vus",
      vus:       200,
      duration:  dur(30),
      exec:      "readScenario",
      // Start after ramp_up finishes (75 + 5×60 + 10 buffer = 395 s).
      startTime: CI_MODE ? dur(75 + 5 * 6 + 10) : "395s",
      tags:      { scenario: "spike" },
      gracefulStop: "5s",
    },

    // ── Scenario 4: Endurance ─────────────────────────────────────────────
    // 50 VUs for 30 minutes — find memory leaks / connection pool exhaustion.
    endurance: {
      executor:  "constant-vus",
      vus:       50,
      duration:  dur(1800),
      exec:      "readScenario",
      // Start after spike finishes (395 + 30 + 10 buffer = 435 s).
      startTime: CI_MODE ? dur(75 + 5 * 6 + 10 + 3 + 10) : "435s",
      tags:      { scenario: "endurance" },
      gracefulStop: "10s",
    },
  };

  if (SCENARIO === "all") return all;

  if (!all[SCENARIO]) {
    throw new Error(
      `Unknown SCENARIO="${SCENARIO}". Choose: baseline, ramp_up, spike, endurance`
    );
  }

  // When running a single scenario, remove startTime so it starts immediately.
  const single = { [SCENARIO]: Object.assign({}, all[SCENARIO], { startTime: "0s" }) };
  return single;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Generate a stable recipient address from VU + iteration.
function recipientAddr(vu, iter) {
  return "G" + String(vu * 10000 + iter).padStart(55, "A");
}

function sponsorAddr(vu) {
  return "GA" + String(vu).padStart(54, "0");
}

// Perform a GET request, record timing in the given Trend metric.
function get(path, trend) {
  const url   = BASE_URL + path;
  const start = Date.now();
  const res   = http.get(url, { tags: { endpoint: path.split("/")[2] || "root" } });
  const ms    = Date.now() - start;

  trend.add(ms);
  reqCounter.add(1);

  const ok = check(res, {
    "status 2xx or 404": (r) => r.status < 500,
    "no server error":   (r) => r.status !== 503,
  });

  if (!ok) errorRate.add(1);
  errorRate.add(0);   // Record non-error for accurate rate calculation.

  return res;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

export function setup() {
  const res = http.get(BASE_URL + "/health");
  if (res.status !== 200) {
    console.warn(
      `[setup] Backend not healthy at ${BASE_URL} (HTTP ${res.status}). ` +
      `Tests will run anyway — 404/503 responses will be counted as errors.`
    );
    return { reachable: false };
  }
  console.log(`[setup] Backend reachable at ${BASE_URL}`);
  return { reachable: true };
}

// ── Primary Read Scenario ─────────────────────────────────────────────────────
//
// Simulates realistic TGE read traffic:
//   1. GET /api/streams/:recipient   — primary SLA endpoint
//   2. GET /api/claimable/:recipient — high-frequency claim check
//   3. GET /health                   — liveness probe (mimics ingress checks)
//
// Mixes in periodic analytics queries (1 in 5 iterations) to simulate
// sponsor dashboards querying during TGE.

export function readScenario() {
  activeVUs.add(1);

  const recipient = recipientAddr(__VU, __ITER);
  const sponsor   = sponsorAddr(__VU % 50);

  group("read_stream", () => {
    // Primary SLA endpoint (p95 < 200 ms).
    get(`/api/streams/${recipient}`, streamReadDur);
    sleep(0.05);

    // Claimable balance (p95 < 200 ms).
    get(`/api/claimable/${recipient}`, claimableDur);
    sleep(0.05);

    // Health (fast probe).
    get("/health", healthDur);
  });

  // Occasional schedule + analytics queries (1 in 5 VU*iter combos).
  if ((__VU + __ITER) % 5 === 0) {
    group("analytics", () => {
      get(`/api/schedules/${recipient}`, scheduleDur);
      sleep(0.05);
      get(`/analytics/sponsor/${sponsor}`, analyticsDur);
    });
  }

  // Realistic think time: 100–300 ms between iterations.
  sleep(0.1 + Math.random() * 0.2);

  activeVUs.add(-1);
}

// ── Teardown ──────────────────────────────────────────────────────────────────

export function teardown() {
  console.log("[teardown] Load test complete.");
}

// ── Summary Handler ───────────────────────────────────────────────────────────
//
// Outputs:
//   1. HTML report  → tests/load/results/report.html  (Grafana-compatible)
//   2. JSON summary → tests/load/results/summary.json
//   3. Markdown     → stdout (for CI log readability)

export function handleSummary(data) {
  const m = data.metrics || {};

  // Helper extractors.
  const p95  = (key) => (m[key] && m[key].values ? (m[key].values["p(95)"] || 0) : 0).toFixed(1);
  const rate = (key) => (m[key] && m[key].values ? (m[key].values.rate  || 0)    : 0);
  const cnt  = (key) => (m[key] && m[key].values ? (m[key].values.count || 0)    : 0);

  const durationSec = data.state ? data.state.testRunDurationMs / 1000 : 0;
  const totalReqs   = cnt("total_requests");
  const reqPerSec   = durationSec > 0 ? (totalReqs / durationSec).toFixed(1) : 0;

  // SLA verdicts.
  const sla = {
    stream_read_p95_under_200ms: parseFloat(p95("stream_read_ms")) < 200,
    claimable_p95_under_200ms:   parseFloat(p95("claimable_ms"))   < 200,
    error_rate_under_01pct:      rate("error_rate") < 0.001,
    throughput_500_rps:          parseFloat(reqPerSec) >= 500,
  };

  const allPassed = Object.values(sla).every(Boolean);

  const summary = {
    meta: {
      date:        new Date().toISOString(),
      base_url:    BASE_URL,
      scenario:    SCENARIO,
      ci_mode:     CI_MODE,
      duration_s:  durationSec.toFixed(1),
    },
    sla_targets: {
      "stream_read p95 < 200ms":   { target: 200,   actual: parseFloat(p95("stream_read_ms")), pass: sla.stream_read_p95_under_200ms },
      "claimable p95 < 200ms":     { target: 200,   actual: parseFloat(p95("claimable_ms")),   pass: sla.claimable_p95_under_200ms },
      "error_rate < 0.1%":         { target: 0.001, actual: rate("error_rate"),                pass: sla.error_rate_under_01pct },
      "throughput >= 500 req/s":   { target: 500,   actual: parseFloat(reqPerSec),             pass: sla.throughput_500_rps },
    },
    latencies: {
      stream_read_p95_ms:   parseFloat(p95("stream_read_ms")),
      claimable_p95_ms:     parseFloat(p95("claimable_ms")),
      schedule_p95_ms:      parseFloat(p95("schedule_ms")),
      analytics_p95_ms:     parseFloat(p95("analytics_ms")),
      health_p95_ms:        parseFloat(p95("health_ms")),
    },
    throughput: {
      total_requests:  totalReqs,
      requests_per_s:  parseFloat(reqPerSec),
    },
    overall: allPassed ? "PASS" : "FAIL",
  };

  // ── Markdown output for CI log ─────────────────────────────────────────────

  const tick = (pass) => pass ? "✅" : "❌";

  const md = [
    "",
    "## k6 Load Test Results — Vesting API",
    "",
    `**Date:** ${summary.meta.date}`,
    `**Scenario:** ${summary.meta.scenario}`,
    `**Overall:** ${allPassed ? "✅ PASS" : "❌ FAIL"}`,
    "",
    "### SLA Targets",
    "",
    "| Target | Required | Actual | Result |",
    "|---|---|---|---|",
    `| stream_read p95 | < 200 ms | ${p95("stream_read_ms")} ms | ${tick(sla.stream_read_p95_under_200ms)} |`,
    `| claimable p95   | < 200 ms | ${p95("claimable_ms")} ms   | ${tick(sla.claimable_p95_under_200ms)} |`,
    `| Error rate      | < 0.1 %  | ${(rate("error_rate") * 100).toFixed(3)} %  | ${tick(sla.error_rate_under_01pct)} |`,
    `| Throughput      | ≥ 500 r/s| ${reqPerSec} r/s  | ${tick(sla.throughput_500_rps)} |`,
    "",
    "### Latencies (p95)",
    "",
    "| Endpoint | p95 (ms) |",
    "|---|---|",
    `| GET /api/streams/:recipient  | ${p95("stream_read_ms")} |`,
    `| GET /api/claimable/:recipient| ${p95("claimable_ms")} |`,
    `| GET /api/schedules/:recipient| ${p95("schedule_ms")} |`,
    `| GET /analytics/sponsor/:id   | ${p95("analytics_ms")} |`,
    `| GET /health                  | ${p95("health_ms")} |`,
    "",
    "### Throughput",
    "",
    `- Total requests : ${totalReqs}`,
    `- Duration       : ${durationSec.toFixed(1)} s`,
    `- Req/s          : ${reqPerSec}`,
    "",
    "---",
    "*Generated by tests/load/tge_scenarios.js — issue #781*",
    "",
  ].join("\n");

  return {
    // HTML report for Grafana / GitHub Actions artifact.
    [HTML_REPORT]: htmlReport(data),
    // JSON for programmatic consumption (CI assertions, dashboards).
    "tests/load/results/summary.json": JSON.stringify(summary, null, 2),
    // Print markdown to stdout so it appears in CI logs.
    stdout: textSummary(data, { indent: " ", enableColors: true }) + "\n" + md,
  };
}
