# Performance

This document describes the automated performance gate that runs on every pull
request, the metrics it tracks, the current baseline values, and the process for
updating baselines when intentional regressions are accepted.

---

## What is measured

The CI pipeline tracks three categories of performance:

| Category | Tool | Where it runs |
|---|---|---|
| WASM instruction counts | Soroban budget API (`env.budget()`) | `instruction-counts` job |
| HTTP response times | [autocannon](https://github.com/mcollina/autocannon) | `http-benchmarks` job |
| Frontend Lighthouse scores | [Lighthouse CI](https://github.com/treosh/lighthouse-ci-action) | `lighthouse` job |

All three categories feed into the `performance-gate` job which posts a delta
table to the PR and fails the build if any metric regresses by more than **10%**
against the stored baseline.

---

## CI workflow

File: `.github/workflows/performance.yml`

```
pull_request / push to main
  │
  ├── instruction-counts
  │     cargo test --features testutils bench_
  │     Captures BENCH lines → benchmarks/results.json
  │
  ├── http-benchmarks
  │     Docker: stellar/quickstart:latest
  │     node scripts/bench_http.js → benchmarks/results.json
  │
  ├── lighthouse
  │     npm run build + preview
  │     treosh/lighthouse-ci-action → benchmarks/lighthouse.json
  │
  └── performance-gate  (needs all three, runs if: always())
        Merges artifacts → benchmarks/merged.json
        node scripts/check_perf.js
        Posts PR comment via peter-evans/create-or-update-comment
        Fails if any metric > baseline × 1.10
```

The `performance-gate` job always runs even when upstream jobs fail, so the PR
always receives a delta comment showing which metrics are missing or regressed.

---

## WASM instruction counts

### How they are measured

Each contract entry point has a dedicated test in
`src/tests/test_benchmarks.rs`. The tests:

1. Set up a fresh Soroban test environment (`setup_env()`).
2. Call `env.budget().reset_default()` immediately before the measured call.
3. Execute the contract function under test.
4. Read `env.budget().cpu_instruction_cost()` and
   `env.budget().memory_bytes_cost()`.
5. Print a `BENCH` line to stdout.

The CI script captures these lines:

```sh
cargo test --features testutils bench_ -- --nocapture 2>/dev/null \
  | grep '^BENCH' \
  | sed 's/^BENCH //' \
  | jq -s '{benchmarks: .}' > benchmarks/results.json
```

### Important caveat

The Soroban budget API measures host-side Rust execution, not WASM bytecode
execution. WASM instruction counts are typically **2–5× higher** than the
Rust-native values. The baselines are calibrated for Rust-native measurement and
are internally consistent as long as all runs use the same mode (which CI
guarantees). They are useful for detecting regressions, not for predicting
on-chain fees.

### Current baselines

All values are upper bounds. A run that produces a higher value by more than 10%
fails the gate.

| Function | CPU instructions (max) | Memory bytes (max) |
|---|---|---|
| `create_vesting_stream` | 2,500,000 | 600,000 |
| `claim_vested_at_cliff` | 3,000,000 | 700,000 |
| `claim_vested_mid_stream` | 2,800,000 | 650,000 |
| `cancel_stream_before_cliff` | 2,800,000 | 650,000 |
| `cancel_stream_after_cliff` | 3,200,000 | 720,000 |
| `get_schedule` | 800,000 | 200,000 |
| `claimable_amount_before_cliff` | 900,000 | 220,000 |
| `claimable_amount_after_cliff` | 950,000 | 230,000 |
| `is_cliff_passed` | 800,000 | 200,000 |

The authoritative values live in `benchmarks/baseline.json`.

---

## HTTP response times

### How they are measured

`scripts/bench_http.js` uses autocannon to benchmark five endpoints on a local
`stellar/quickstart` Docker node. Each endpoint is exercised for 15 seconds with
10 concurrent connections. The p50, p95, and p99 latencies are recorded.

The quickstart node is started as a GitHub Actions service container. HTTP
benchmarks do **not** run against the public testnet — latency there is
non-deterministic and unsuitable for regression detection.

### Endpoint descriptions

| Key | Method | What it tests |
|---|---|---|
| `health_check` | `GET /` | Node availability |
| `rpc_getHealth` | `POST /soroban/rpc` | RPC health probe |
| `rpc_getLatestLedger` | `POST /soroban/rpc` | Ledger query path |
| `rpc_simulateTransaction` | `POST /soroban/rpc` | Simulate a transaction (decode path) |
| `rpc_sendTransaction` | `POST /soroban/rpc` | Submit a transaction (decode path) |

The `simulate` and `send` benchmarks use a placeholder XDR that returns a decode
error, but still exercise the full HTTP/JSON-RPC request-handling path. Replace
these with real XDR envelopes if you want to measure end-to-end simulation
latency.

### Current baselines

| Endpoint | p50 (max) | p95 (max) | p99 (max) |
|---|---|---|---|
| `health_check` | 5 ms | 20 ms | 50 ms |
| `rpc_getHealth` | 10 ms | 40 ms | 100 ms |
| `rpc_getLatestLedger` | 15 ms | 60 ms | 150 ms |
| `rpc_simulateTransaction` | 200 ms | 600 ms | 1,200 ms |
| `rpc_sendTransaction` | 300 ms | 900 ms | 2,000 ms |

---

## Lighthouse scores

The `lighthouse` job builds the frontend with `npm run build`, starts a preview
server on port 4173, and runs Lighthouse CI against the root URL using a desktop
preset with no CPU throttling (to avoid CI noise).

### Current baselines (minimum acceptable scores)

| Category | Minimum score |
|---|---|
| Performance | 85 |
| Accessibility | 95 |
| Best Practices | 90 |
| SEO | 80 |

---

## Baseline update process

### When to update

Update baselines when a known, intentional change makes the old values
unachievable:

- Adding a new storage operation to an entry point (CPU/memory increase).
- Switching from a light SAC call to a heavier one.
- Accepting a Lighthouse tradeoff (e.g., adding a heavy font for brand reasons).

Do **not** update baselines to paper over unexpected regressions. Investigate the
root cause first.

### How to update

1. **Run the benchmarks locally** to get the new values:

   ```sh
   # WASM instruction counts
   cargo test --features testutils bench_ -- --nocapture 2>/dev/null \
     | grep '^BENCH' \
     | sed 's/^BENCH //' \
     | jq -s '{benchmarks: .}'

   # HTTP (requires a local quickstart node on port 8000)
   npm install --no-save autocannon
   node scripts/bench_http.js
   ```

2. **Edit `benchmarks/baseline.json`** with the new values. Round up to the
   nearest round number to give a small buffer.

3. **Open a PR** with:
   - The updated `benchmarks/baseline.json`.
   - A section in the PR description titled **Performance Baseline Update** that
     explains:
     - Which metric(s) changed.
     - Why the change is expected and acceptable.
     - What code change caused it.

4. **Get review** from at least one other contributor before merging. The
   performance gate will pass on the new values once the PR is merged to `main`.

### Review checklist for baseline PRs

When reviewing a PR that updates `benchmarks/baseline.json`:

- [ ] The PR description includes a **Performance Baseline Update** section.
- [ ] The new values are no more than 20% above the old values (large increases
  warrant deeper investigation).
- [ ] The code change that caused the regression is identified.
- [ ] The regression is proportionate to the feature value delivered.

---

## k6 Load Test Suite

A comprehensive k6 load test suite lives in `tests/load/backend_scenarios.js`. It
benchmarks the Express backend API under realistic traffic patterns and validates
SLO targets.

### Test scenarios

| # | Scenario | Executor | Load | Duration |
|---|---|---|---|---|
| 1 | Schedule queries | `constant-vus` | 100 concurrent users | 60 s |
| 2 | Create streams | `shared-iterations` | 10 users, 10 iterations | 30 s max |
| 3 | Claim vested | `per-vu-iterations` | 50 users, 5 iterations each | 60 s max |
| 4 | Ramping profile | `ramping-vus` | 0 → 100 → 200 → 100 → 0 | 5 min |

### SLO targets

- **p95 response time < 500 ms** — all API endpoints (schedule, claimable,
  analytics, health, stream creation, claim submission).
- **Error rate < 0.1 %** — HTTP 4xx/5xx responses across every request.
- **Mutation success rate ≥ 95 %** — create and claim operations.

### API endpoints covered

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/schedules/:recipient` | GET | Full vesting schedule + claimable amount |
| `/api/claimable/:recipient` | GET | Claimable amount only |
| `/analytics/sponsor/:address` | GET | Sponsor aggregate statistics |
| `/health` | GET | Liveness probe |
| `/tx/submit` | POST | Create stream / claim vested (mutations) |

### Results export

Each run writes structured JSON results to
`tests/load/results/backend_load_test.json` via k6's `handleSummary` hook.  The
JSON includes per-metric p50/p95/p99, error rates, threshold pass/fail, and SLO
verdicts.

### Running the tests

```bash
# Full load test (requires a running backend on localhost:3001)
npm run test:load

# Dry-run (skips create/claim mutations, only probes read endpoints)
npm run test:load:dryrun

# Export results as JSON only
npm run test:load:report
```

The `test:load` command is defined in `tests/load/package.json`:

```json
"test:load": "k6 run backend_scenarios.js"
```

### Baseline results

The tables below show the most recent baseline run on the reference
infrastructure.  Values will drift when the backend or Stellar network
characteristics change; re-baseline by running `npm run test:load:report` and
committing the updated JSON.

| Endpoint | p50 (ms) | p95 (ms) | p99 (ms) |
|---|---|---|---|
| `GET /health` | < 5 | < 20 | < 50 |
| `GET /api/schedules/:recipient` | < 50 | < 200 | < 400 |
| `GET /api/claimable/:recipient` | < 30 | < 150 | < 300 |
| `GET /analytics/sponsor/:address` | < 60 | < 250 | < 500 |
| `POST /tx/submit` (create) | < 100 | < 400 | < 800 |
| `POST /tx/submit` (claim) | < 80 | < 300 | < 600 |

| SLO | Target | Baseline |
|---|---|---|
| p95 response time | < 500 ms | ✓ Pass |
| Error rate | < 0.1 % | ✓ Pass |
| Create success rate | ≥ 95 % | ✓ Pass |
| Claim success rate | ≥ 95 % | ✓ Pass |

---



## High-load scenario results

The tests below use the Soroban test environment only (no network). They verify
correctness under load; they do not measure wall-clock performance.

### Scenario 1 — 1,000 Recipients: Cliff Claim

**Test**: `test_high_load_1000_recipients_claim`

Each of 1,000 independent recipients has a stream created
(`rate=10`, `cliff_duration=50`, `total_duration=100`). After advancing to the
cliff, all 1,000 `claim_vested` calls are executed sequentially.

| Metric | Result | Target |
|---|---|---|
| Error rate | **0%** | < 1% ✅ |
| Total recipients | 1,000 | — |
| Per-recipient claimed | 500 tokens | — |
| Total tokens transferred | 500,000 | — |

### Scenario 2 — 1,000 Recipients: Full Drain

**Test**: `test_high_load_1000_recipients_full_drain`

Same setup with `cliff_duration=10`. Ledger advances past `end_ledger` before
all recipients claim their full allocation in one pass.

| Metric | Result | Target |
|---|---|---|
| Error rate | **0%** | < 1% ✅ |
| Schedules cleared post-claim | 1,000 / 1,000 | — |

---

## Related files

| File | Purpose |
|---|---|
| `benchmarks/baseline.json` | Stored performance baselines |
| `benchmarks/results.json` | Latest benchmark run results (generated by CI) |
| `scripts/bench_http.js` | autocannon HTTP benchmark script |
| `scripts/check_perf.js` | Comparison script; posts PR comment; exits 1 on regression |
| `src/tests/test_benchmarks.rs` | Soroban instruction-count benchmark tests |
| `.github/workflows/performance.yml` | CI workflow |
| `.github/lighthouserc.json` | Lighthouse CI configuration |
