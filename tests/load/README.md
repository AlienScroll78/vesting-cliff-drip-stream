# Load test for creating vesting streams

This folder contains a Locust script that invokes the repository's
`scripts/invoke_create.sh` helper to create vesting streams in parallel.

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
