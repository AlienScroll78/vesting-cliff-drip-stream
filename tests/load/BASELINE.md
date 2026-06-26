# Load Test Baseline — Concurrent Vesting Stream Creation

**Date:** 2026-06-25  
**Network:** Stellar Testnet  
**Contract:** `create_vesting_stream` (vesting-cliff-drip-stream)  
**Tool:** k6 v0.50+  
**Script:** `tests/load/create_streams_bundle.js` (esbuild bundle of `create_streams_bundle_src.js`)

---

## Test Parameters

| Parameter | Value |
|---|---|
| Concurrent VUs | 100 |
| Total iterations | 100 (1 per VU) |
| Max duration | 5 minutes |
| Stream rate | 10 tokens / ledger |
| Cliff duration | 17 280 ledgers (~1 day) |
| Total duration | 172 800 ledgers (~10 days) |
| Max fee per tx | 1 000 000 stroops (0.1 XLM) |

---

## Baseline Results

> **Status:** Pre-run — results below are expected ranges derived from Stellar testnet
> characteristics. Replace with actual numbers from `results/baseline_run.json` after
> running against testnet.

| Metric | Expected (testnet) | Threshold |
|---|---|---|
| `tx_success_rate` | 95 – 99 % | ≥ 95 % |
| `rpc_latency_ms` p50 | 800 – 1 500 ms | — |
| `rpc_latency_ms` p95 | 4 000 – 8 000 ms | < 10 000 ms |
| `rpc_latency_ms` p99 | 8 000 – 12 000 ms | — |
| `simulate_latency_ms` p50 | 300 – 600 ms | — |
| Transactions submitted | 100 | — |
| Transactions failed | < 5 | — |

Actual JSON output is written to `tests/load/results/baseline_run.json` by k6's
`handleSummary` hook at the end of each run.

---

## How to Run

### 1. Prerequisites

```bash
# Install k6 (https://grafana.com/docs/k6/latest/set-up/install-k6/)
# On Debian/Ubuntu:
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Install Node deps + build the bundle
cd tests/load
npm install
npm run bundle
```

### 2. Generate and fund 100 keypairs

```bash
# From repo root
node scripts/gen_keypairs.js 100 > tests/load/keypairs.json
node scripts/fund_keypairs.js tests/load/keypairs.json   # ~20s, rate-limited

export SPONSOR_SECRETS=$(node -e \
  "process.stdout.write(require('./tests/load/keypairs.json').map(k=>k.secret).join(','))")
```

### 3. Deploy the contract and mint a token (if not already done)

```bash
stellar keys generate load-sponsor --network testnet --fund
./scripts/deploy.sh load-sponsor
export VESTING_CONTRACT=<contract-id from above>
# Create a SAC token and export its contract address
export TOKEN=<SAC-contract-address>
```

### 4. Run the load test

```bash
cd tests/load
k6 run create_streams_bundle.js \
  -e RPC_URL=https://soroban-testnet.stellar.org \
  -e VESTING_CONTRACT=$VESTING_CONTRACT \
  -e TOKEN=$TOKEN \
  -e SPONSOR_SECRETS=$SPONSOR_SECRETS
```

### 5. CI / smoke test (no funded accounts)

```bash
k6 run tests/load/create_streams.js \
  -e SKIP_TX=1 \
  -e VESTING_CONTRACT=placeholder \
  -e TOKEN=placeholder
```

This verifies RPC reachability only — no transactions are submitted.

---

## Bottleneck Analysis

### Identified bottlenecks

#### 1. Stellar RPC transaction throughput (~30–50 tx/ledger ceiling)

Stellar closes a ledger every ~5 seconds. The validator set on testnet typically
processes 30–50 transactions per ledger. With 100 simultaneous submissions,
transactions queue across 2–4 ledger closes (~10–20 s end-to-end latency).

**Impact:** p95 latency spikes to 8–12 s under full concurrency.  
**Mitigation:** Batch submit across multiple ledgers, or spread VUs over time
using a `ramping-vus` executor instead of `shared-iterations`.

#### 2. Sequence number contention per sponsor account

Each Stellar account has a monotonically-increasing sequence number. Concurrent
transactions from the **same** account fail with `txBAD_SEQ` because two
concurrent builds both read the current sequence and increment to the same value.

**Impact:** Near-100% failure rate if all 100 VUs share one keypair.  
**Mitigation:** The test uses 1 keypair per VU (100 total). This is the primary
reason `gen_keypairs.js` + `fund_keypairs.js` are required before running.

#### 3. Soroban fee market under load

`create_vesting_stream` writes a persistent `VestingSchedule` entry (~200 bytes)
and reads the token contract. The resource fee for this footprint is ~50 000–
100 000 stroops. Under congestion, the fee market raises the inclusion fee
multiplier, causing transactions with a low `fee` to be dropped.

**Impact:** Occasional `txINSUFFICIENT_FEE` failures at high concurrency.  
**Mitigation:** The test sets `fee = 1 000 000` stroops (0.1 XLM), well above
the historical maximum inclusion fee on testnet.

#### 4. Friendbot rate limiting during keypair funding

Friendbot throttles to ~5 req/s. Funding 100 accounts takes ~20 s.  
**Mitigation:** `fund_keypairs.js` already enforces a 200 ms delay between
requests. Pre-fund accounts once and reuse `keypairs.json`.

#### 5. No smart contract-level concurrency limit

The contract itself is stateless per recipient — each `create_vesting_stream`
writes to a unique `DataKey::Schedule(recipient)`. There is no global mutex or
counter that could serialize concurrent writes. Concurrency is limited entirely
by the RPC layer and Stellar consensus, not by the contract code.

---

## Recommendations

| Priority | Action |
|---|---|
| High | Switch to a `ramping-vus` scenario to model realistic ramp-up (avoid cold-start spike) |
| High | Add a `getTransaction` status breakdown counter to separate `FAILED` vs `NOT_FOUND` |
| Medium | Run the same test on Stellar Mainnet to compare fee market behavior |
| Medium | Add a `claim_vested` phase after stream creation to measure end-to-end user flow |
| Low | Parameterize `rate`, `cliff_duration`, and `total_duration` via env vars for variant testing |
| Low | Integrate into CI with `SKIP_TX=1` to catch RPC regressions without funding overhead |
