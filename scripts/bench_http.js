#!/usr/bin/env node
/**
 * scripts/bench_http.js
 *
 * HTTP benchmarks for the Soroban RPC node using autocannon.
 *
 * Runs against a locally started Stellar Quickstart node (or any node
 * pointed to by --rpc-url). In CI, the workflow starts the Docker image
 * `stellar/quickstart:latest` before running this script.
 *
 * Usage:
 *   npm install --no-save autocannon
 *   node scripts/bench_http.js [--rpc-url http://localhost:8000] [--duration 10]
 *
 * Output:
 *   benchmarks/results.json  — merged with any existing instruction-count
 *   results from the Rust benchmarks so that check_perf.js sees everything
 *   in one place.
 *
 * The output shape matches what check_perf.js expects:
 *   {
 *     "benchmarks": [...],       // instruction counts (merged from results.json if present)
 *     "http_response_times": {
 *       "<endpoint>": { "p50_ms": N, "p95_ms": N, "p99_ms": N }
 *     }
 *   }
 */

import autocannon from "autocannon";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { parseArgs } from "util";

// ── CLI args ──────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    "rpc-url": { type: "string", default: "http://localhost:8000" },
    duration: { type: "string", default: "15" },
    connections: { type: "string", default: "10" },
    output: { type: "string", default: "benchmarks/results.json" },
  },
  strict: true,
});

const RPC_URL = args["rpc-url"];
const DURATION = parseInt(args.duration, 10);
const CONNECTIONS = parseInt(args.connections, 10);
const OUTPUT = args.output;

// ── Benchmark targets ─────────────────────────────────────────────────────────

/**
 * Endpoints to benchmark.
 *
 * Each entry defines:
 *   key       – matches the key in baseline.json `http_response_times`
 *   url       – full URL to request
 *   method    – HTTP method
 *   body      – request body (for POST)
 *   headers   – request headers
 */
const ENDPOINTS = [
  {
    key: "health_check",
    url: `${RPC_URL}/`,
    method: "GET",
    headers: {},
  },
  {
    key: "rpc_getHealth",
    url: `${RPC_URL}/soroban/rpc`,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getHealth",
      params: {},
    }),
  },
  {
    key: "rpc_getLatestLedger",
    url: `${RPC_URL}/soroban/rpc`,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "getLatestLedger",
      params: {},
    }),
  },
  {
    key: "rpc_simulateTransaction",
    url: `${RPC_URL}/soroban/rpc`,
    method: "POST",
    headers: { "content-type": "application/json" },
    // Minimal simulate call — the transaction XDR is intentionally a
    // placeholder. The RPC will return a decode error, but the latency of
    // receiving that error still benchmarks the RPC's request handling path.
    // For a real simulation you would provide a valid XDR envelope.
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "simulateTransaction",
      params: {
        transaction:
          "AAAAAgAAAABpench_placeholder_xdr_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
      },
    }),
  },
  {
    key: "rpc_sendTransaction",
    url: `${RPC_URL}/soroban/rpc`,
    method: "POST",
    headers: { "content-type": "application/json" },
    // Same rationale as simulateTransaction above.
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "sendTransaction",
      params: {
        transaction:
          "AAAAAgAAAABpench_placeholder_xdr_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
      },
    }),
  },
];

// ── Run benchmarks sequentially ───────────────────────────────────────────────

/**
 * Wraps autocannon in a Promise so we can await it.
 */
function runBenchmark(endpoint) {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url: endpoint.url,
        method: endpoint.method,
        headers: endpoint.headers ?? {},
        body: endpoint.body,
        duration: DURATION,
        connections: CONNECTIONS,
        pipelining: 1,
        // Don't throw on non-2xx — many RPC calls return 200 with a JSON error.
        // We only care about transport latency.
        expectBody: undefined,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );

    autocannon.track(instance, { renderProgressBar: true });
  });
}

/**
 * Extract the percentile latencies we care about from an autocannon result.
 */
function extractLatencies(result) {
  const lat = result.latency;
  return {
    p50_ms: lat.p50 ?? lat.median ?? 0,
    p95_ms: lat.p95 ?? 0,
    p99_ms: lat.p99 ?? 0,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\nRunning HTTP benchmarks against ${RPC_URL}`);
console.log(`Duration: ${DURATION}s per endpoint, Connections: ${CONNECTIONS}\n`);

const httpResults = {};
let anyEndpointFailed = false;

for (const endpoint of ENDPOINTS) {
  console.log(`\n── ${endpoint.key} ──`);
  try {
    const result = await runBenchmark(endpoint);
    const latencies = extractLatencies(result);
    httpResults[endpoint.key] = latencies;

    console.log(
      `  p50=${latencies.p50_ms}ms  p95=${latencies.p95_ms}ms  p99=${latencies.p99_ms}ms`
    );
    console.log(
      `  req/s=${result.requests?.mean?.toFixed(1) ?? "?"}  errors=${result.errors ?? 0}`
    );
  } catch (err) {
    console.error(`  ⚠️  Benchmark failed: ${err.message}`);
    // Record nulls so check_perf.js reports missing rather than crashing.
    httpResults[endpoint.key] = { p50_ms: null, p95_ms: null, p99_ms: null };
    anyEndpointFailed = true;
  }
}

// ── Merge with existing instruction-count results ─────────────────────────────

let existing = { benchmarks: [] };
if (existsSync(OUTPUT)) {
  try {
    existing = JSON.parse(readFileSync(OUTPUT, "utf8"));
  } catch {
    // Ignore parse errors; overwrite with fresh data.
  }
}

const merged = {
  ...existing,
  http_response_times: httpResults,
};

writeFileSync(OUTPUT, JSON.stringify(merged, null, 2), "utf8");
console.log(`\nResults written to ${OUTPUT}`);

if (anyEndpointFailed) {
  console.error("⚠️  One or more endpoints failed to benchmark. Results may be incomplete.");
  process.exit(1);
}
