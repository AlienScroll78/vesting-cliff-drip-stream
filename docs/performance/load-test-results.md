# Backend API Load Test Results (k6)

Load testing for the vesting backend API is implemented with [k6](https://k6.io/).
This document defines the scenarios, their SLOs, how to run them, and where the
latest results are recorded.

> Issue: #1054 — Implement load testing for backend API with k6

## Scenarios & SLOs

| # | Scenario | Executor | Load | Endpoint | SLO |
|---|---|---|---|---|---|
| 1 | `steady_streams` | constant-vus | 100 VUs for 5 min | `GET /api/streams` | p95 < 200 ms |
| 2 | `stream_details` | constant-vus | 50 VUs for 2 min | `GET /api/streams/:recipient` | p95 < 150 ms |
| 3 | `spike` | ramping-vus | 10 → 200 VUs in 30 s, recover | `GET /api/streams/:recipient` | recovers within 60 s |
| 4 | `claimable_batch` | constant-vus | 20 VUs, 20 recipients each | `GET /claimable/:recipient` × 20 | p95 < 500 ms (RPC-bound) |

Global error budget: `slo_error_rate < 0.1 %`.

The executable definition of these scenarios (including k6 `thresholds`) lives in
[`tests/load/slo_scenarios.js`](../../tests/load/slo_scenarios.js).

The broader, long-running suite (soak, WebSocket subscribers, read-heavy mixes)
lives in [`tests/load/backend_scenarios.js`](../../tests/load/backend_scenarios.js).

## How to run

Start the backend locally, then:

```bash
# SLO scenarios (all four)
k6 run tests/load/slo_scenarios.js

# Point at a different environment
BASE_URL=https://staging.example.com k6 run tests/load/slo_scenarios.js

# Makefile shortcuts
make test-load           # full backend_scenarios.js suite
make test-load-dryrun    # skips create/claim mutations
```

For CI, the [`k6-load-tests.yml`](../../.github/workflows/k6-load-tests.yml)
workflow runs the suite on PRs that touch `tests/load/**` or `backend/src/**`,
on pushes to `main`, nightly, and on manual dispatch. The job fails when an SLO
threshold is missed.

## Recording results

After a run, record the summary below (k6 prints it on completion and can emit a
JSON summary with `--summary-export`). Copy the relevant lines into the table.

```bash
k6 run --summary-export=tests/load/results/slo-summary.json tests/load/slo_scenarios.js
```

| Date | Commit | Environment | Scenario | p95 | Error rate | SLO met |
|---|---|---|---|---|---|---|
| _populate from the latest CI/staging run_ | | | `steady_streams` | | | |
| | | | `stream_details` | | | |
| | | | `spike` | | | |
| | | | `claimable_batch` | | | |

> Results are environment-dependent (hardware, database, RPC latency). For CI the
> backend is started with mocked RPC responses; for staging the real testnet RPC
> is used, so absolute latencies differ. Compare runs on the same environment.

## Notes

- `GET /claimable/:recipient` is RPC-bound; scenario 4 issues 20 sequential
  requests per iteration to approximate a batch claimable lookup. A dedicated
  `claimable-batch` endpoint would allow a single round-trip.
- The spike scenario verifies recovery by requiring the tail of the run
  (`target: 10`) to satisfy the same latency thresholds after the peak.
