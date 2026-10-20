# Load Tests – Vesting API

This folder contains two k6 load test suites for the Vesting API (issue #781)
and a Locust script for Soroban stream creation.

---

## TGE Load Test Suite (`tge_scenarios.js`)

Benchmarks the API server under realistic TGE (Token Generation Event) traffic
patterns. Identifies breaking points before production deployment.

### Scenarios

| # | Name | VUs | Duration | Purpose |
|---|---|---|---|---|
| 1 | `baseline`  | 10       | 1 min    | Establish p95 latency baseline |
| 2 | `ramp_up`   | 0 → 100  | 5 min    | Find scale-up lag / saturation |
| 3 | `spike`     | 200      | 30 s     | Simulate TGE spike |
| 4 | `endurance` | 50       | 30 min   | Find memory leaks |

### SLA Targets

| Metric | Target |
|---|---|
| p95 latency `GET /api/streams/:recipient` | < 200 ms |
| Error rate under 100 VUs | < 0.1 % |
| Throughput (read endpoints) | ≥ 500 req/s |

### Usage

```bash
# Full suite
make test-load-tge

# Single scenario
k6 run tests/load/tge_scenarios.js -e SCENARIO=baseline
k6 run tests/load/tge_scenarios.js -e SCENARIO=ramp_up
k6 run tests/load/tge_scenarios.js -e SCENARIO=spike
k6 run tests/load/tge_scenarios.js -e SCENARIO=endurance

# CI mode (short durations, no endurance)
k6 run tests/load/tge_scenarios.js -e CI=1
```

### Output

- `tests/load/results/report.html` — HTML report (open in browser)
- `tests/load/results/summary.json` — JSON SLA summary
- `tests/load/grafana-dashboard.json` — Import into Grafana for live monitoring

### CI

Runs on every PR to `tests/load/**` via `.github/workflows/k6-load-tests.yml`.
Full suite runs nightly at 04:00 UTC.

---

## Backend Scenarios (`backend_scenarios.js`)

Original k6 backend benchmark suite (100 VU schedule queries, stream creation,
claim vested, ramping profile). See inline JSDoc for details.

```bash
make test-load
```

---

## Soroban Stream Creation (`locustfile.py`, `create_streams.js`)

Load test for creating vesting streams

Prerequisites

- `locust` (install with `pip install locust`)
- `stellar` CLI installed and configured with the sponsor key and funded accounts
- The contract deployed and `VESTING_CONTRACT`, `TOKEN` environment variables set
- A pool of unique, funded recipient accounts (or a strategy to generate/fund recipients)

Running the test (headless)

```bash
export VESTING_CONTRACT=<contract-id>
export SPONSOR=default
export TOKEN=<token-contract>
# Optionally set RECIPIENT pool variables or ensure the sponsor can create recipients

pip install locust
locust -f tests/load/locustfile.py --headless -u 100 -r 100 -t 1m
```

Notes and expectations

- The script calls `./scripts/invoke_create.sh` which uses the `stellar` CLI. The
  test runner environment must have `stellar` on PATH and pre-funded accounts.
- To avoid `ScheduleAlreadyExists` errors, run with unique recipients per create.
- If you prefer an RPC-based test (no CLI), replace the task implementation with
  a direct HTTP/JSON-RPC implementation that signs transactions.

Collecting baseline results

- Run the headless Locust command above and capture the console output. Locust will
  print aggregate statistics (requests/s, failures, median/p95 latency).
- Save the full run output and any logs to `tests/load/baseline-<YYYYMMDD>.md`.

Limitations

- I could not run the test from this environment because the `stellar` CLI
  is not installed here and no funded keys were available. The script is
  ready-to-run in an environment with the prerequisites described above.
