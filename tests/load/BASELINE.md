# Load Test Baseline — Concurrent Vesting Stream Creation

**Date:** 2026-06-25 (updated 2026-08-29 — Issue #629: sustained traffic scenarios)
**Network:** Stellar Testnet  
**Contract:** `create_vesting_stream` (vesting-cliff-drip-stream)  
**Tool:** k6 v0.50+  
**Script:** `tests/load/backend_scenarios.js`

---

## Scenarios Overview

### Original Scenarios (Pre-#629)

| # | Name | Description |
|---|------|-------------|
| 1 | `schedule_queries` | 100 concurrent users querying schedules for 60 s |
| 2 | `create_streams` | 10 users creating streams simultaneously |
| 3 | `claim_vested` | 50 users claiming every 5 seconds |
| 4 | `ramping_profile` | 0 → 100 → 200 → 100 → 0 VUs over 5 minutes |

### Issue #629: Sustained Traffic Scenarios

| # | Name | Description | SLO |
|---|------|-------------|-----|
| 5 | `soak_test` | 12-hour soak at 20 RPS; 95% GET /streams, 5% GET /health | p99 < 1 s, err < 0.1 % |
| 6 | `claim_surge` | 10x spike (5 → 50 RPS) in claimable_amount queries at cliff time | p99 < 1 s, err < 0.1 % |
| 7 | `websocket_subs` | 500 concurrent WebSocket subscribers receiving stream updates | success rate ≥ 95 % |
| 8 | `read_heavy` | Sustained 95 % GET /streams + 5 % GET /health at 20 RPS for 2 min | p99 < 1 s, err < 0.1 % |

**Soak test runtime:** The `soak_test` scenario runs for 12 hours by default when `SKIP_SOAK=0`. All other scenarios complete in < 10 minutes. Set `SKIP_SOAK=0` only when running overnight validation.

---

## Test Parameters

### Original: Concurrent Stream Creation

| Parameter | Value |
|---|---|
| Concurrent VUs | 100 |
| Total iterations | 100 (1 per VU) |
| Max duration | 5 minutes |
| Stream rate | 10 tokens / ledger |
| Cliff duration | 17 280 ledgers (~1 day) |
| Total duration | 172 800 ledgers (~10 days) |
| Max fee per tx | 1 000 000 stroops (0.1 XLM) |

### Soak Test (#629–5)

| Parameter | Value |
|---|---|
| Arrival rate | 20 RPS (constant) |
| Duration | 12 hours (SKIP_SOAK=0) / 10 s (default) |
| Traffic mix | 95% GET /api/streams/:recipient, 5% GET /health |
| Pre-allocated VUs | 50 |
| Max VUs | 200 |

### Claim Surge (#629–6)

| Parameter | Value |
|---|---|
| Baseline rate | 5 RPS |
| Surge rate | 50 RPS (10x spike at cliff time) |
| Stages | 30s baseline → 10s ramp → 30s sustain → 30s ramp-down |
| Pre-allocated VUs | 100 |
| Max VUs | 300 |

### WebSocket Subscribers (#629–7)

| Parameter | Value |
|---|---|
| Concurrent connections | 500 |
| Duration | 60 s |
| WebSocket URL | `WS_URL` env var (default: `ws://localhost:3001`) |
| Endpoint | `/ws/streams/:recipient` |
| Protocol | Subscribe → receive JSON events |

### Read-Heavy (#629–8)

| Parameter | Value |
|---|---|
| Arrival rate | 20 RPS (constant) |
| Duration | 2 min |
| Traffic mix | 95% GET /api/streams/:recipient, 5% GET /health |
| Pre-allocated VUs | 30 |
| Max VUs | 100 |

---

## SLO Thresholds

| Metric | Threshold | Scenario |
|---|---|---|
| p95 response time | < 500 ms | All |
| **p99 response time** | **< 1 000 ms** | **#629: soak, surge, read-heavy** |
| Error rate | < 0.1 % | All |
| WebSocket success rate | ≥ 95 % | websocket_subs |
| Create stream success | ≥ 95 % | create_streams |
| Claim success | ≥ 95 % | claim_vested |

---

## Baseline Results

> **Status:** Pre-run — results below are expected ranges derived from Stellar testnet
> characteristics. Replace with actual numbers from `results/backend_load_test.json` after
> running against a local backend.

### Original Scenarios

| Metric | Expected (local backend) | Threshold |
|---|---|---|
| `schedule_query_ms` p95 | 5 – 50 ms | < 500 ms |
| `claimable_query_ms` p95 | 5 – 50 ms | < 500 ms |
| `health_check_ms` p95 | 1 – 10 ms | < 500 ms |
| Error rate | < 0.01 % | < 0.1 % |

### Sustained Traffic Scenarios (#629)

| Metric | Expected (local backend) | Threshold |
|---|---|---|
| `soak_query_ms` p99 | 50 – 200 ms | < 1 000 ms |
| `surge_claimable_ms` p99 | 100 – 400 ms (spike) | < 1 000 ms |
| `read_heavy_ms` p99 | 50 – 200 ms | < 1 000 ms |
| WebSocket connect success | 98 – 100 % | ≥ 95 % |
| WebSocket message received | ≥ 90 % of subs | — |

---

## How to Run

### 1. Prerequisites

```bash
# Install k6 (https://grafana.com/docs/k6/latest/set-up/install-k6/)
sudo apt-get install k6

# Install Node deps + build the bundle
cd tests/load
npm install
npm run bundle
```

### 2. Run all scenarios (skip soak + skip mutations)

```bash
k6 run tests/load/backend_scenarios.js \
  -e BASE_URL=http://localhost:3001 \
  -e SKIP_MUTATIONS=1 \
  -e SKIP_SOAK=1
```

### 3. Run soak test (overnight)

```bash
k6 run tests/load/backend_scenarios.js \
  -e BASE_URL=http://localhost:3001 \
  -e SKIP_MUTATIONS=1 \
  -e SKIP_SOAK=0
```

### 4. Run claim surge only

```bash
k6 run tests/load/backend_scenarios.js \
  -e BASE_URL=http://localhost:3001 \
  --scenario claim_surge
```

### 5. Run WebSocket test only

```bash
k6 run tests/load/backend_scenarios.js \
  -e BASE_URL=http://localhost:3001 \
  -e WS_URL=ws://localhost:3001 \
  --scenario websocket_subs
```

### 6. CI smoke test (no funded accounts)

```bash
k6 run tests/load/backend_scenarios.js \
  -e SKIP_MUTATIONS=1 \
  -e SKIP_SOAK=1
```

---

## Bottleneck Analysis

### Soak Test Bottlenecks

**Scenario 5 — 12-hour soak at 20 RPS**

At 20 RPS sustained, the primary risk is:

1. **Database connection pool exhaustion** — PostgreSQL connections held open by persistent queries.  
   *Mitigation:* Set `pool.max = 20` and monitor `pg_stat_activity`.

2. **Redis cache eviction under long-duration load** — LRU eviction of schedule caches causes cache misses.  
   *Mitigation:* Use `allkeys-lru` with sufficient memory to hold the hot key set.

3. **Node.js event loop lag** — Under sustained 20 RPS, GC pauses can spike p99 latency.  
   *Mitigation:* Monitor `process.cpuUsage()` and `gc` events; use `--expose-gc` for heap inspection.

### Claim Surge Bottlenecks

**Scenario 6 — 10x spike at cliff time**

At 50 RPS during the spike:

1. **Hot key contention** — All VUs query the same claimable endpoint for recipients near cliff.  
   *Mitigation:* Cache `claimable_amount` with a short TTL (5–10 s) keyed by `(recipient, ledger_bucket)`.

2. **Soroban RPC simulate burst** — If the backend calls `simulateTransaction` per request, 50 RPS × simulation cost = ~50 concurrent RPC calls.  
   *Mitigation:* The backend should use the indexed DB schedule, not on-chain simulation, for `claimable_amount` reads.

### WebSocket Bottlenecks

**Scenario 7 — 500 concurrent WebSocket connections**

1. **File descriptor limit** — Each WebSocket holds one FD. Default Linux limit is 1024.  
   *Mitigation:* `ulimit -n 65535` on the backend host.

2. **Memory per connection** — Each connection holds ~8 KB of socket buffer.  
   500 × 8 KB = 4 MB minimum; Node.js process overhead adds ~50–100 MB.  
   *Mitigation:* Monitor heap usage; ensure container memory limit ≥ 512 MB.

---

## Original Bottleneck Analysis (Stellar Testnet)

### 1. Stellar RPC transaction throughput (~30–50 tx/ledger ceiling)

Stellar closes a ledger every ~5 seconds. With 100 simultaneous submissions,
transactions queue across 2–4 ledger closes (~10–20 s end-to-end latency).

**Impact:** p95 latency spikes to 8–12 s under full concurrency.  
**Mitigation:** Batch submit across multiple ledgers, or spread VUs over time.

### 2. Sequence number contention per sponsor account

Each account has a monotonically-increasing sequence number. Concurrent
transactions from the **same** account fail with `txBAD_SEQ`.  
**Mitigation:** 1 keypair per VU (100 total).

### 3. Soroban fee market under load

`create_vesting_stream` writes a persistent `VestingSchedule` entry (~200 bytes).
Under congestion, the fee market raises the inclusion fee multiplier.  
**Mitigation:** `fee = 1_000_000` stroops (0.1 XLM).

---

## Recommendations

| Priority | Action |
|---|---|
| High | Deploy WebSocket server (`/ws/streams/:recipient`) before running scenario 7 |
| High | Cache `claimable_amount` in Redis with 5–10 s TTL to absorb cliff-time surge |
| Medium | Run soak test overnight before production launch (`SKIP_SOAK=0`) |
| Medium | Add `pg_stat_activity` monitoring during soak to catch connection leaks |
| Low | Parameterize soak duration via `SOAK_DURATION` env var for shorter smoke runs |
| Low | Add `--out influxdb` to persist soak metrics to Grafana for time-series analysis |

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
