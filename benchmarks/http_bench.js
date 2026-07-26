#!/usr/bin/env node
/**
 * HTTP performance benchmark using autocannon.
 *
 * Measures response-time distributions for the frontend HTTP server and writes
 * results to benchmarks/http_results.json for comparison against baselines.
 *
 * Usage:
 *   node benchmarks/http_bench.js [options]
 *
 * Options:
 *   --url <url>            Base URL to benchmark (default: http://localhost:3000)
 *   --duration <secs>      Seconds per endpoint (default: 10)
 *   --connections <n>      Concurrent connections (default: 10)
 *   --output <path>        Output file (default: benchmarks/http_results.json)
 *
 * Prerequisites:
 *   npm install autocannon   (or npx autocannon will be used automatically)
 *
 * The output JSON matches the http_response_times section of baseline.json so
 * that compare.js can diff the two files directly.
 */

import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CLI argument parsing ──────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    url: "http://localhost:3000",
    duration: 10,
    connections: 10,
    output: path.join(__dirname, "http_results.json"),
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--url":         args.url         = argv[++i]; break;
      case "--duration":    args.duration    = parseInt(argv[++i], 10); break;
      case "--connections": args.connections = parseInt(argv[++i], 10); break;
      case "--output":      args.output      = argv[++i]; break;
    }
  }
  return args;
}

const args = parseArgs(process.argv);

// ── Endpoints to benchmark ────────────────────────────────────────────────────

const ENDPOINTS = [
  { name: "GET /",           path: "/" },
  { name: "GET /index.html", path: "/index.html" },
];

// ── Load autocannon (local install or npx fallback) ───────────────────────────

function loadAutocannon() {
  try {
    return require("autocannon");
  } catch {
    // Try to install it on the fly if we're running in CI.
    try {
      console.error("autocannon not found locally — installing via npm...");
      execSync("npm install --no-save autocannon", { stdio: "inherit" });
      return require("autocannon");
    } catch {
      console.error(
        "Could not load autocannon. Run: npm install autocannon"
      );
      process.exit(1);
    }
  }
}

// ── Benchmark runner ──────────────────────────────────────────────────────────

function runBenchmark(autocannon, url, duration, connections) {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      { url, duration, connections, pipelining: 1, timeout: 10 },
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      }
    );
    autocannon.track(instance, {
      renderProgressBar: true,
      renderResultsTable: false,
    });
  });
}

function shapeResult(result) {
  return {
    p50_ms:           result.latency.p50,
    p95_ms:           result.latency.p95,
    p99_ms:           result.latency.p99,
    requests_per_sec: Math.round(result.requests.mean),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const autocannon = loadAutocannon();

  console.error(
    `\nHTTP benchmark: ${args.url} | duration=${args.duration}s | connections=${args.connections}\n`
  );

  const output = { http_response_times: {} };
  let anyFailed = false;

  for (const endpoint of ENDPOINTS) {
    const targetUrl = `${args.url}${endpoint.path}`;
    console.error(`Benchmarking ${endpoint.name} → ${targetUrl}`);

    try {
      const result = await runBenchmark(
        autocannon,
        targetUrl,
        args.duration,
        args.connections
      );
      const shaped = shapeResult(result);
      output.http_response_times[endpoint.name] = shaped;
      console.error(
        `  p50=${shaped.p50_ms}ms  p95=${shaped.p95_ms}ms  ` +
        `p99=${shaped.p99_ms}ms  rps=${shaped.requests_per_sec}`
      );
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      anyFailed = true;
      output.http_response_times[endpoint.name] = {
        p50_ms: -1, p95_ms: -1, p99_ms: -1, requests_per_sec: -1,
        error: String(err.message),
      };
    }
  }

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2) + "\n");
  console.error(`\nResults written to ${args.output}`);

  if (anyFailed) {
    console.error("WARNING: one or more endpoint benchmarks failed.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
