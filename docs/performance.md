# Performance Benchmarks & Testing Methodology

This document outlines the performance testing methodology, automated CI regression gate, baseline schemas, runner environment requirements, and local execution workflows for **vesting-cliff-drip-stream**.

---

## Table of Contents

1. [Benchmark Suite Overview](#1-benchmark-suite-overview)
2. [How to Run Benchmarks Locally (`make bench`)](#2-how-to-run-benchmarks-locally-make-bench)
3. [How to Update Baselines (`make bench-update`)](#3-how-to-update-baselines-make-bench-update)
4. [Regression Threshold Policy & CI Configuration](#4-regression-threshold-policy--ci-configuration)
5. [Benchmark Environment Requirements](#5-benchmark-environment-requirements)
6. [Baseline Format & JSON Schema](#6-baseline-format--json-schema)
7. [WASM Instruction Counts & Budget Measurement](#7-wasm-instruction-counts--budget-measurement)
8. [HTTP Response Times](#8-http-response-times)
9. [Backend API Load Testing (k6)](#9-backend-api-load-testing-k6)
10. [Lighthouse Frontend Scores](#10-lighthouse-frontend-scores)
11. [Related Files](#11-related-files)

---

## 1. Benchmark Suite Overview

Performance in **vesting-cliff-drip-stream** is measured across four distinct tiers to ensure predictability, gas-efficiency, and low latency for all users and indexers:

| Tier | Target | Tool / Harness | What is Measured | Why It Matters |
|---|---|---|---|---|
| **Contract Budget** | Soroban Host | `env.budget()` in Rust test harness | CPU instructions & memory bytes per entry point | Lower CPU/memory directly reduces Soroban on-chain transaction fees and prevents resource limit exhaustion. |
| **HTTP RPC Node** | Local Quickstart RPC | [autocannon](https://github.com/mcollina/autocannon) | p50, p95, p99 latencies for Soroban JSON-RPC calls | Ensures standard RPC methods (`simulateTransaction`, `sendTransaction`, ledger queries) execute within predictable SLA boundaries. |
| **Backend API Server** | Node.js Express API | [k6](https://k6.io/) load testing scenarios | Throughput (req/s), latency percentiles, error rates | Validates indexer query performance and transaction submission under concurrent client load. |
| **Frontend UI** | Vite Web App | [Lighthouse CI](https://github.com/treosh/lighthouse-ci-action) | Performance, Accessibility, Best Practices, SEO scores | Prevents regressions in frontend asset weight, initial render times, and responsive UX. |

---

## 2. How to Run Benchmarks Locally (`make bench`)

You can run the full benchmark suite locally using the Makefile target:

```bash
make bench
```

This target executes:
1. **Smart contract instruction & memory benchmarks:** Runs all `bench_` tests in `src/tests/test_benchmarks.rs` with `cargo test --features testutils bench_ -- --nocapture`.
2. **Parses machine-readable output:** Extracts `BENCH` JSON lines and saves them to `benchmarks/results.json`.
3. **Compares with baseline:** Executes `node scripts/check_perf.js --results benchmarks/results.json --baseline benchmarks/baseline.json`.

### Individual Local Benchmark Commands

```bash
# Run contract CPU/memory benchmarks only and output JSON
cargo test --features testutils bench_ -- --nocapture 2>/dev/null \
  | grep '^BENCH' \
  | sed 's/^BENCH //' \
  | jq -s '{benchmarks: .}'

# Run a specific benchmark verbosely
cargo test --features testutils bench_create_vesting_stream -- --nocapture

# Run HTTP RPC benchmarks (requires a local Stellar quickstart node running on port 8000)
npm install --no-save autocannon
node scripts/bench_http.js --rpc-url http://localhost:8000 --output benchmarks/http_results.json

# Run backend load test scenarios (requires backend on localhost:3001)
npm run test:load
```

---

## 3. How to Update Baselines (`make bench-update`)

When intentional contract changes (e.g. adding compliance allowlist checks, new event fields, or schema expansions) legitimately increase CPU instructions or memory consumption, baselines must be updated via a dedicated pull request.

### Step 1: Run the baseline update target

```bash
make bench-update
```

This command runs the benchmark suite, extracts the newly observed metrics, formats them, and writes the updated values to `benchmarks/baseline.json` with the current date timestamp.

### Step 2: Open a Pull Request with Written Justification

Open a PR containing:
1. The modified `benchmarks/baseline.json`.
2. A section in the PR description titled `## Performance Baseline Update` following this template:

```markdown
## Performance Baseline Update

- **Metrics Modified:** `create_vesting_stream` CPU instructions (+4.2%), memory (+2.1%)
- **Root Cause:** Added token allowlist validation in instance storage lookup.
- **Justification:** Necessary for compliance; overhead is sub-linear and well within Soroban transaction limits.
- **Local Runner Environment:** Ubuntu 24.04 x86_64, 4 vCPU, 8GB RAM, fixed clock governor.
```

### Review Rules for Baseline PRs
- Baseline bumps greater than **20%** require approval from two maintainers.
- Never update baselines to hide unintended performance regressions or accidental quadratic loops.

---

## 4. Regression Threshold Policy & CI Configuration

### Regression Threshold Formula

The regression threshold is defined in `benchmarks/baseline.json` via the `"regression_threshold": 0.10` property (representing **10% maximum allowable slowdown**).

For any metric $M_{\text{current}}$ and baseline $M_{\text{base}}$:

$$\Delta = \frac{M_{\text{current}} - M_{\text{base}}}{M_{\text{base}}}$$

- **Pass (Green ✅):** $\Delta \le 0.05$ (within 5% of baseline)
- **Warning (Yellow 🟡):** $0.05 < \Delta \le 0.10$ (approaching threshold)
- **Failure (Red 🔴):** $\Delta > 0.10$ (exceeds 10% regression threshold $\rightarrow$ CI exits code `1` and blocks merge)

For **Lighthouse Scores** (where higher is better), the threshold is inverted: CI fails if the score drops below `baseline × (1 - regression_threshold)`.

### CI Workflow Configuration

The performance gate runs on every PR and push to `main` in [`.github/workflows/performance.yml`](../.github/workflows/performance.yml):

```
pull_request / push to main
  │
  ├── instruction-counts  (WASM CPU/memory budget)
  ├── http-benchmarks     (Autocannon against local quickstart container)
  ├── lighthouse          (Vite preview server + Lighthouse CI)
  └── performance-gate    (Runs always; merges artifacts, evaluates check_perf.js,
                           posts delta table comment to PR, enforces gate)
```

The script `scripts/check_perf.js` evaluates the results against `benchmarks/baseline.json`, renders a Markdown report for the PR comment, and exits with code `1` if any regression exceeds the threshold.

---

## 5. Benchmark Environment Requirements

To prevent flaky benchmark results and false positive regressions caused by noisy neighbors, CI and local benchmark runners must meet specific hardware and kernel configuration standards:

### Hardware Specifications
- **Architecture:** `x86_64` (AMD64)
- **vCPU:** Minimum 4 dedicated cores (no burstable / shared CPU instances)
- **Memory:** Minimum 8 GB RAM
- **Storage:** NVMe SSD with $\ge 500\text{ MB/s}$ sustained sequential I/O

### Runner OS & Environment Configuration
- **Operating System:** Ubuntu 24.04 LTS (Kernel $\ge 6.8$)
- **CPU Governor:** `performance` (disable frequency scaling / dynamic boost variation where possible)
- **Isolated Execution:** No concurrent high-load processes running during budget collection
- **Rust Toolchain:** Fixed stable toolchain pinned to the version in `rust-toolchain.toml` / CI workflow (`wasm32-unknown-unknown` target installed)
- **Deterministic Budget Reset:** Always invoke `env.budget().reset_default()` immediately before the operation under test to isolate measurement from fixture setup.

---

## 6. Baseline Format & JSON Schema

The authoritative baseline file is [`benchmarks/baseline.json`](../benchmarks/baseline.json), validated against the JSON Schema at [`benchmarks/baseline.schema.json`](../benchmarks/baseline.schema.json).

### Schema Structure

```json
{
  "$schema": "./baseline.schema.json",
  "description": "Performance baselines for vesting-cliff-drip-stream",
  "updated": "2026-07-26",
  "regression_threshold": 0.10,
  "wasm_instruction_counts": {
    "create_vesting_stream": {
      "cpu_instructions": 2500000,
      "memory_bytes": 600000
    },
    "claim_vested_at_cliff": {
      "cpu_instructions": 3000000,
      "memory_bytes": 700000
    },
    "claim_vested_mid_stream": {
      "cpu_instructions": 2800000,
      "memory_bytes": 650000
    },
    "cancel_stream_before_cliff": {
      "cpu_instructions": 2800000,
      "memory_bytes": 650000
    },
    "cancel_stream_after_cliff": {
      "cpu_instructions": 3200000,
      "memory_bytes": 720000
    },
    "get_schedule": {
      "cpu_instructions": 800000,
      "memory_bytes": 200000
    },
    "claimable_amount_before_cliff": {
      "cpu_instructions": 900000,
      "memory_bytes": 220000
    },
    "claimable_amount_after_cliff": {
      "cpu_instructions": 950000,
      "memory_bytes": 230000
    },
    "is_cliff_passed": {
      "cpu_instructions": 800000,
      "memory_bytes": 200000
    },
    "get_min_deposit": {
      "cpu_instructions": 600000,
      "memory_bytes": 150000
    }
  },
  "http_response_times": {
    "health_check": { "p50_ms": 5, "p95_ms": 20, "p99_ms": 50 },
    "rpc_getHealth": { "p50_ms": 10, "p95_ms": 40, "p99_ms": 100 },
    "rpc_getLatestLedger": { "p50_ms": 15, "p95_ms": 60, "p99_ms": 150 },
    "rpc_simulateTransaction": { "p50_ms": 200, "p95_ms": 600, "p99_ms": 1200 },
    "rpc_sendTransaction": { "p50_ms": 300, "p95_ms": 900, "p99_ms": 2000 }
  },
  "lighthouse": {
    "performance": 85,
    "accessibility": 95,
    "best_practices": 90,
    "seo": 80
  }
}
```

---

## 7. WASM Instruction Counts & Budget Measurement

### Methodology in Rust

Each benchmark in `src/tests/test_benchmarks.rs` follows this sequence:

```rust
// 1. Reset budget counters to discard setup overhead
env.budget().reset_default();

// 2. Execute target function
let result = client.claim_vested(&recipient);

// 3. Emit structured machine-readable BENCH output
println!(
    r#"BENCH {{"fn":"claim_vested_at_cliff","cpu_instructions":{},"memory_bytes":{}}}"#,
    env.budget().cpu_instruction_cost(),
    env.budget().memory_bytes_cost(),
);
```

> **Note on Native vs WASM execution:** The Soroban test environment budget API runs Rust natively. On-chain Soroban WASM execution is typically 2–5× higher in raw instructions. The baselines represent native test measurements, serving as an exact relative regression indicator across code revisions.

---

## 8. HTTP Response Times

Measured using `autocannon` against a local `stellar/quickstart` Docker container running in CI:

| Endpoint | Method | Latency Target (p95) | Max Allowed (p99) |
|---|---|---|---|
| `/` | `GET` | < 20 ms | 50 ms |
| `/soroban/rpc` (`getHealth`) | `POST` | < 40 ms | 100 ms |
| `/soroban/rpc` (`getLatestLedger`) | `POST` | < 60 ms | 150 ms |
| `/soroban/rpc` (`simulateTransaction`) | `POST` | < 600 ms | 1,200 ms |
| `/soroban/rpc` (`sendTransaction`) | `POST` | < 900 ms | 2,000 ms |

---

## 9. Backend API Load Testing (k6)

The k6 scenario suite lives in `tests/load/backend_scenarios.js` and tests the backend Express server under 100 concurrent users.

```bash
# Run full backend load scenario
npm run test:load

# Run dry-run mode (read queries only)
npm run test:load:dryrun
```

### Targets:
- **p95 Latency:** < 500 ms across all endpoints
- **Error Rate:** < 0.1% HTTP 4xx/5xx responses
- **Mutation Success Rate:** $\ge 95\%$

---

## 10. Lighthouse Frontend Scores

The frontend is tested on production build (`npm run build && npm run preview`) with desktop presets and no CPU throttling:

- **Performance:** $\ge 85$
- **Accessibility:** $\ge 95$
- **Best Practices:** $\ge 90$
- **SEO:** $\ge 80$

---

## 11. Related Files

| File | Description |
|---|---|
| [`benchmarks/baseline.json`](../benchmarks/baseline.json) | Authoritative baseline upper bounds and regression threshold |
| [`benchmarks/baseline.schema.json`](../benchmarks/baseline.schema.json) | JSON Schema validation definition for baseline.json |
| [`scripts/check_perf.js`](../scripts/check_perf.js) | Comparison evaluation script executed during CI gate |
| [`scripts/bench_http.js`](../scripts/bench_http.js) | HTTP RPC latency benchmark script using autocannon |
| [`src/tests/test_benchmarks.rs`](../src/tests/test_benchmarks.rs) | Soroban contract budget benchmark tests |
| [`.github/workflows/performance.yml`](../.github/workflows/performance.yml) | GitHub Actions CI workflow for performance gate |
| [`Makefile`](../Makefile) | Build and test automation definitions (`make bench`, `make bench-update`) |
