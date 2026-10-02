# Integration Tests — Full Stream Lifecycle

Integration tests for the VestingDrips contract that exercise the full stream lifecycle against a local `stellar/quickstart:testing` node. Unlike unit tests that use mock environments, these tests verify real XDR encoding, auth flows, event emission, and on-chain state transitions.

## Test Scenarios

| # | Scenario | Description |
|---|----------|-------------|
| 1 | **Full lifecycle** | Create stream → wait for cliff → claim → verify balance |
| 2 | **Cancel before cliff** | Full deposit refunded to sponsor |
| 3 | **Cancel after cliff** | Partial refund; recipient keeps accrued tokens |
| 4 | **Clawback** | Sponsor recovers all tokens regardless of cliff state |
| 5 | **Drain expired** | Any address can drain after 1-year delay (permissionless) |

## Prerequisites

- Docker and Docker Compose
- Rust with `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`)
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli) (`stellar`)
- Python ≥ 3.11

## Quick Start

```bash
# 1. Start the local Stellar node
docker compose -f docker-compose.integration.yml up -d

# 2. Wait for the node to be ready (~30 s)
#    (the healthcheck polls http://localhost:8000 every 5 s)

# 3. Fund test accounts
source scripts/fund_accounts.sh

# 4. Deploy the contract
export VESTING_CONTRACT=$(bash scripts/deploy_contract.sh)

# 5. Deploy a SAC test token and set TOKEN_CONTRACT
#    (see scripts/deploy_contract.sh for helpers)

# 6. Run all integration tests
make integration-test

# 7. Tear down
docker compose -f docker-compose.integration.yml down
```

Or run everything in one command:

```bash
make integration-test
```

This target automatically handles steps 1–6 and tears down the node afterwards.

## Running individual scenarios

```bash
python3 tests/integration/test_lifecycle.py TestStreamLifecycle.test_01_full_lifecycle_create_claim_verify
```

## Expected runtime

All 5 scenarios complete in **< 5 minutes** on a standard development machine. The stellar/quickstart:testing image closes ledgers at approximately 1 ledger/second, so cliff durations in the tests are kept to ≤ 30 ledgers.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SOROBAN_RPC_URL` | `http://localhost:8000/soroban/rpc` | Soroban RPC endpoint |
| `HORIZON_URL` | `http://localhost:8000` | Horizon API endpoint |
| `NETWORK_PASSPHRASE` | `Standalone Network ; February 2017` | Stellar network passphrase |
| `STELLAR_NETWORK` | `local` | Stellar CLI network alias |
| `VESTING_CONTRACT` | *(required)* | Deployed contract ID |
| `TOKEN_CONTRACT` | *(required)* | SAC token contract ID |
| `SPONSOR_KEY` | `integration-sponsor` | Sponsor key name in CLI keystore |
| `RECIPIENT_KEY` | `integration-recipient` | Recipient key name in CLI keystore |
| `SPONSOR2_KEY` | `integration-sponsor2` | Second sponsor key |
| `RECIPIENT2_KEY` | `integration-recipient2` | Second recipient key |
| `CALLER_KEY` | `integration-caller` | Permissionless caller key |
| `ADMIN_KEY` | `integration-admin` | Admin key for initialization |

## CI

The `integration-test` job in `.github/workflows/integration.yml` runs these tests automatically on every PR targeting `main`. It:

1. Starts a `stellar/quickstart:testing` container.
2. Waits for the node healthcheck to pass.
3. Funds all test accounts via Friendbot.
4. Builds the WASM and deploys the contract.
5. Deploys a SAC test token.
6. Runs all 5 lifecycle scenarios.
7. Fails the job if any scenario fails.

The job enforces a **5-minute timeout** to keep CI fast.
