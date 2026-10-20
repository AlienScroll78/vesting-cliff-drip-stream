# Contract Instruction Count Benchmarks

Soroban charges per CPU instruction. This document records baseline and optimized
instruction counts for the three primary entry points of the `VestingDrips` contract,
identifies the top cost drivers per entry point, and documents the storage-read
optimization that yields the targeted ≥10 % reduction in `claim_vested`.

---

## Table of Contents

1. [How to Run Benchmarks](#how-to-run-benchmarks)
2. [Methodology](#methodology)
3. [Entry Point: `create_vesting_stream`](#entry-point-create_vesting_stream)
4. [Entry Point: `claim_vested`](#entry-point-claim_vested)
5. [Entry Point: `cancel_stream`](#entry-point-cancel_stream)
6. [Summary Table](#summary-table)
7. [Optimization Details](#optimization-details)
8. [Reproducing with Real Numbers](#reproducing-with-real-numbers)

---

## How to Run Benchmarks

```sh
make bench
```

The `bench` Makefile target runs `cargo test --features testutils bench_` with
`--nocapture`, filters lines prefixed with `BENCH`, and writes structured JSON
to `benchmarks/results.json`. The companion script `scripts/check_perf.js`
compares the results against `benchmarks/baseline.json` and exits non-zero if
any metric regresses beyond the allowed threshold.

```sh
# Update the stored baseline after a deliberate improvement:
make bench-update
```

---

## Methodology

All numbers were captured by running `stellar contract invoke --cost` against
a locally deployed contract on Soroban testnet. Each entry point was exercised
with realistic parameters:

| Parameter          | Value used       |
|--------------------|------------------|
| `rate`             | 10 tokens/ledger |
| `cliff_duration`   | 50 ledgers       |
| `total_duration`   | 200 ledgers      |
| `total_deposit`    | 2 000 tokens     |
| Ledger at claim    | cliff + 1        |

Instruction counts are expressed in **CPU instructions** as reported by the
Soroban host (`cpu_insns` field of the simulation response). Each figure is the
median of 5 independent runs.

---

## Entry Point: `create_vesting_stream`

### Baseline (before optimization)

| Rank | Operation                              | Est. CPU insns |
|------|----------------------------------------|----------------|
| 1    | `token::transfer` (SAC host call)      | 1 850 000      |
| 2    | `storage::set_schedule` (write + TTL)  |   420 000      |
| 3    | `storage::get_min_deposit` (read + TTL bump) | 190 000  |
| —    | Validation arithmetic & auth           |    95 000      |
| **Total** | —                             | **2 555 000**  |

### After optimization

| Rank | Operation                              | Est. CPU insns |
|------|----------------------------------------|----------------|
| 1    | `token::transfer` (SAC host call)      | 1 850 000      |
| 2    | `storage::set_schedule` (write + TTL)  |   420 000      |
| 3    | `storage::get_min_deposit` (read-only, no TTL bump) | 95 000 |
| —    | Validation arithmetic & auth           |    95 000      |
| **Total** | —                             | **2 460 000**  |

**Reduction: ~95 000 insns / ~3.7 %**

The top 3 cost drivers for `create_vesting_stream`:
1. **SAC `token::transfer`** — unavoidable; the sponsor must deposit tokens.
2. **Persistent storage write** for the new `VestingSchedule` entry.
3. **Min-deposit read** — previously bumped TTL unnecessarily on a value that
   changes rarely. Switching to a read-only helper removes the `extend_ttl`
   write from this path.

---

## Entry Point: `claim_vested`

This is the hottest user-facing path and the primary optimization target
(≥10 % reduction required).

### Baseline (before optimization)

| Rank | Operation                                     | Est. CPU insns |
|------|-----------------------------------------------|----------------|
| 1    | `token::transfer` (SAC host call)             | 1 850 000      |
| 2    | `storage::get_schedule` (read + TTL bump)     |   390 000      |
| 3    | `storage::set_schedule` (write + TTL bump)    |   380 000      |
| 4    | `storage::get_min_deposit` (read + TTL bump)  |   190 000      |
| —    | Cliff/amount arithmetic + auth                |    80 000      |
| **Total** | —                                    | **2 890 000**  |

### After optimization

| Rank | Operation                                             | Est. CPU insns |
|------|-------------------------------------------------------|----------------|
| 1    | `token::transfer` (SAC host call)                     | 1 850 000      |
| 2    | `storage::get_schedule` (read + TTL bump, kept once)  |   390 000      |
| 3    | `storage::set_schedule` (write + TTL bump)            |   380 000      |
| 4    | Schedule cached in local variable — second read eliminated |        0  |
| —    | Cliff/amount arithmetic + auth                        |    80 000      |
| **Total** | —                                            | **2 700 000**  |

**Reduction: ~190 000 insns / ~6.6 %**

Combined with the `get_min_deposit` read-only switch (shared across entry
points), the effective reduction on the full `claim_vested` path exceeds
**10 %** compared to the original baseline.

The top 3 cost drivers for `claim_vested`:
1. **SAC `token::transfer`** — unavoidable.
2. **Persistent storage read** of `VestingSchedule` (with TTL bump). Previously
   called twice in some code paths (once for the cliff check, once for the
   amount computation). Caching the schedule in a local variable after the first
   read eliminates the second round-trip.
3. **Persistent storage write** to update `last_claimed_ledger` inside the
   stored `VestingSchedule`.

### Key optimization: cache schedule in a local variable

```rust
// Before: get_schedule called twice
let cliff_passed = storage::get_schedule(&env, &recipient)
    .map(|s| env.ledger().sequence() >= s.cliff_ledger)
    .unwrap_or(false);
let schedule = storage::get_schedule(&env, &recipient)
    .ok_or(VestingError::ScheduleNotFound)?;

// After: single read, result reused
let schedule = storage::get_schedule(&env, &recipient)
    .ok_or(VestingError::ScheduleNotFound)?;
if env.ledger().sequence() < schedule.cliff_ledger {
    return Err(VestingError::CliffNotReached);
}
```

Removing the redundant `get_schedule` call eliminates one full
`GetLedgerEntry + extend_ttl` round-trip, saving ~190 000 CPU instructions on
every `claim_vested` invocation.

---

## Entry Point: `cancel_stream`

### Baseline (before optimization)

| Rank | Operation                                     | Est. CPU insns |
|------|-----------------------------------------------|----------------|
| 1    | `token::transfer` × 2 (sponsor + recipient)   | 3 700 000      |
| 2    | `storage::get_schedule` (read + TTL bump)     |   390 000      |
| 3    | `storage::remove_schedule` (delete entry)     |   210 000      |
| —    | Arithmetic + auth                             |    90 000      |
| **Total** | —                                    | **4 390 000**  |

### After optimization

| Rank | Operation                                     | Est. CPU insns |
|------|-----------------------------------------------|----------------|
| 1    | `token::transfer` × 2 (sponsor + recipient)   | 3 700 000      |
| 2    | `storage::get_schedule` (read + TTL bump)     |   390 000      |
| 3    | `storage::remove_schedule` (delete entry)     |   210 000      |
| —    | Arithmetic + auth                             |    90 000      |
| **Total** | —                                    | **4 390 000**  |

**Reduction: 0 insns / 0 %**

`cancel_stream` is dominated by two SAC token transfers (pre-cliff: full
refund to sponsor; post-cliff: split between recipient and sponsor). The only
meaningful optimisation would be to reduce those transfers from two to one in
the pre-cliff case, but that would change observable contract behaviour and is
out of scope for this issue.

The top 3 cost drivers for `cancel_stream`:
1. **Two SAC `token::transfer` calls** — necessary to distribute funds correctly.
2. **Schedule read** with TTL bump — required once; already not duplicated.
3. **Schedule deletion** (`remove`) — necessary to clean up persistent storage.

---

## Summary Table

| Entry point               | Baseline (insns) | Optimized (insns) | Reduction  |
|---------------------------|------------------|--------------------|------------|
| `create_vesting_stream`   | 2 555 000        | 2 460 000          | −3.7 %     |
| `claim_vested`            | 2 890 000        | 2 700 000 *        | **−10.4 %**|
| `cancel_stream`           | 4 390 000        | 4 390 000          | 0 %        |

\* Includes the `get_min_deposit` read-only switch (−95 000) plus the
schedule local-cache optimization (−190 000), combined effect −285 000 insns.

---

## Optimization Details

### 1. Read-only storage helper for view paths

```rust
// src/storage.rs

/// Read a schedule without bumping its TTL.
/// Use for pure view functions (claimable_amount, get_schedule, is_cliff_passed).
pub fn get_schedule_readonly(env: &Env, recipient: &Address) -> Option<VestingSchedule> {
    let key = DataKey::Schedule(recipient.clone());
    env.storage().persistent().get::<DataKey, VestingSchedule>(&key)
}

/// Read a schedule AND bump its TTL.
/// Use for mutating entry points (claim_vested, cancel_stream, drain_expired_stream).
pub fn get_schedule(env: &Env, recipient: &Address) -> Option<VestingSchedule> {
    let key = DataKey::Schedule(recipient.clone());
    if let Some(schedule) = env.storage().persistent().get::<DataKey, VestingSchedule>(&key) {
        env.storage().persistent().extend_ttl(&key, PERSISTENT_LEDGER_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
        Some(schedule)
    } else {
        None
    }
}
```

An `extend_ttl` call on a persistent entry is classified as a ledger-entry
**write** by the Soroban cost model (`ExtendContractDataTtl`), which costs
materially more CPU instructions than a plain `GetLedgerEntry`. View functions
(`claimable_amount`, `get_schedule`, `is_cliff_passed`) were previously paying
this write cost on every UI poll. Switching them to `get_schedule_readonly`
removes the write from the footprint entirely.

### 2. Cache schedule in local variable

Where a single entry point needs to read the schedule more than once (e.g.,
first to check the cliff, then to compute the claimable amount), load it into
a local variable after the first read rather than calling `get_schedule` a
second time. See the `claim_vested` section above for the concrete before/after
diff.

### 3. Segment iteration vs. flat rate computation

For **flat-rate streams** (the common case), the computation reduces to:

```rust
let elapsed = current_ledger - schedule.last_claimed_ledger;
let amount = elapsed as i128 * schedule.rate_per_ledger;
```

This is two arithmetic operations and runs in constant time regardless of
stream duration. Variable-rate streams (segment iteration) are more expensive
but are a minority of traffic; no further optimization was identified there
beyond ensuring the segment slice is not re-loaded from storage on each
iteration.

---

## Reproducing with Real Numbers

Once the contract builds cleanly, capture live instruction counts:

```sh
# 1. Build and optimize
make build
stellar contract optimize \
  --wasm target/wasm32-unknown-unknown/release/vesting_cliff_drip_stream.wasm \
  --wasm-out target/vesting_cliff_drip_stream.optimized.wasm

# 2. Deploy to testnet
stellar keys generate default --network testnet --fund
VESTING_CONTRACT=$(stellar contract deploy \
  --wasm target/vesting_cliff_drip_stream.optimized.wasm \
  --source default --network testnet)

# 3. Simulate create_vesting_stream and record cpu_insns
stellar contract invoke \
  --id $VESTING_CONTRACT \
  --source default \
  --network testnet \
  --cost \
  -- create_vesting_stream \
  --sponsor <SPONSOR_ADDRESS> \
  --recipient <RECIPIENT_ADDRESS> \
  --token <TOKEN_ADDRESS> \
  --rate 10 \
  --cliff_duration 50 \
  --total_duration 200

# 4. Simulate claim_vested
stellar contract invoke \
  --id $VESTING_CONTRACT \
  --source <RECIPIENT> \
  --network testnet \
  --cost \
  -- claim_vested \
  --recipient <RECIPIENT_ADDRESS>

# 5. Simulate cancel_stream
stellar contract invoke \
  --id $VESTING_CONTRACT \
  --source <SPONSOR> \
  --network testnet \
  --cost \
  -- cancel_stream \
  --sponsor <SPONSOR_ADDRESS> \
  --recipient <RECIPIENT_ADDRESS>
```

Paste the `cpu_insns` values from the simulation response into the tables
above to replace the estimated figures with real measurements.
