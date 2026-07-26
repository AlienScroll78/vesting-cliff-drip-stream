# Performance Baselines & Regression Detection

This document describes the performance baselines for **vesting-cliff-drip-stream**,
how automated regression detection works in CI, and how to update baselines when
intentional changes raise metrics.

---

## Automated regression detection

Every pull request runs the **Performance Regression Check** workflow
(`.github/workflows/perf.yml`), which:

1. Measures **WASM instruction counts** per contract entry point using the
   Soroban test environment's budget tracker.
2. Measures **HTTP response times** for the frontend dev server using
   [autocannon](https://github.com/mcollina/autocannon).
3. Checks **Lighthouse scores** against minimum thresholds.
4. Compares every metric against `benchmarks/baseline.json`.
5. **Fails the build** if any metric regresses more than **10 %** vs baseline.
6. Posts a **performance delta table** as a sticky PR comment.

---

## Baseline values

Baselines are stored in [`benchmarks/baseline.json`](../benchmarks/baseline.json).

### WASM instruction counts

Measured in the Soroban test environment. Values are upper bounds; the build
fails if a PR causes any entry point to exceed the baseline by more than 10 %.

| Entry point | CPU instructions (baseline) | Memory bytes (baseline) |
|---|---|---|
| `create_vesting_stream`    | 800 000  | 200 000 |
| `claim_vested`             | 600 000  | 180 000 |
| `cancel_stream_pre_cliff`  | 650 000  | 190 000 |
| `cancel_stream_post_cliff` | 700 000  | 195 000 |
| `get_schedule`             | 200 000  | 80 000  |
| `claimable_amount`         | 220 000  | 85 000  |
| `is_cliff_passed`          | 180 000  | 75 000  |

### HTTP response times (frontend dev server)

Measured with autocannon, 10 concurrent connections for 10 seconds.

| Endpoint | p50 (ms) | p95 (ms) | p99 (ms) | Req/s |
|---|---|---|---|---|
| `GET /`           | 50 | 150 | 300 | 200 |
| `GET /index.html` | 50 | 150 | 300 | 200 |

### Lighthouse scores (minimum thresholds)

| Category      | Minimum |
|---------------|---------|
| Performance   | 80      |
| Accessibility | 90      |
| Best Practices| 85      |
| SEO           | 80      |

### WASM binary size

Optimized WASM size is tracked separately by the **WASM Size Check** workflow
(`.github/workflows/wasm-size.yml`). The baseline is **50 KB** optimized.

---

## Soroban test environment performance (high-load scenarios)

> Original data from in-process Soroban test runner. Applies to correctness
> testing, not on-chain gas estimation.

### Scenario 1 — 1 000 recipients: cliff claim

| Metric | Result | Target |
|---|---|---|
| Error rate | **0 %** | < 1 % ✅ |
| Total recipients | 1 000 | — |
| Per-recipient claimed | 500 tokens (50 ledgers × 10) | — |
| Total tokens transferred | 500 000 | — |

### Scenario 2 — 1 000 recipients: full drain

| Metric | Result | Target |
|---|---|---|
| Error rate | **0 %** | < 1 % ✅ |
| Schedules cleared post-claim | 1 000 / 1 000 | — |

---

## Running benchmarks locally

```bash
# WASM instruction counts — writes benchmarks/results.json
make bench

# HTTP benchmarks (requires a running frontend server on port 3000)
cd frontend && npm run dev &
make bench-http

# Compare against baseline
make bench-compare
```

---

## Updating baselines

Baselines should only be updated when a performance change is **intentional**
(e.g., a new feature that adds necessary computation, or a deliberate
architectural trade-off).

### Process

1. Run benchmarks locally: `make bench && make bench-http`
2. Edit `benchmarks/baseline.json` with the new values.
3. Open a PR that includes **both** the code change and the baseline update.
4. In the PR description, add a **Performance Impact** section explaining:
   - Which metrics changed and by how much.
   - Why the regression is acceptable.
   - Whether any optimisation was attempted first.
5. Get approval from at least one maintainer before merging.

### What NOT to do

- Do not bump baselines to silence a CI failure without understanding the cause.
- Do not merge baseline-only PRs without a corresponding code change.

---

## CI workflow reference

| Workflow | File | Trigger |
|---|---|---|
| Performance Regression Check | `.github/workflows/perf.yml` | Every PR, push to `main` |
| WASM Size Check | `.github/workflows/wasm-size.yml` | Every PR, push |
| CI (tests, lint, build) | `.github/workflows/ci.yml` | Every push |

---

## Related files

| File | Purpose |
|---|---|
| `benchmarks/baseline.json` | Stored performance baselines |
| `benchmarks/results.json` | WASM benchmark results (generated, git-ignored) |
| `benchmarks/http_results.json` | HTTP benchmark results (generated, git-ignored) |
| `benchmarks/compare.js` | Regression comparator script |
| `benchmarks/http_bench.js` | autocannon HTTP benchmark runner |
| `tests/bench.rs` | Rust instruction-count benchmark harness |
| `.lighthouserc.json` | Lighthouse CI configuration |
