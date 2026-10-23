# Test Suite — Vesting Cliff Drip Stream

This directory contains all unit tests for the `vesting-cliff-drip-stream` Soroban contract.

---

## Directory Layout

```
src/tests/
├── mod.rs              # Shared helpers: setup_env(), advance_ledger()
├── token_helper.rs     # SAC token creation & minting helpers
├── factory.rs          # 🏭 Test data factory (named stream scenarios)
├── test_create.rs      # Stream creation tests
├── test_claim.rs       # Claim / vesting logic tests
├── test_cancel.rs      # Cancellation & refund tests
├── test_views.rs       # Read-only view function tests
└── test_edge_cases.rs  # Boundary & integration scenarios
```

---

## Running the Tests

```bash
make test
# or directly:
cargo test --features testutils
```

---

## Test Data Factory (`factory.rs`)

The factory module provides reproducible, named stream scenarios so test files
do not need to repeat boilerplate setup. Every factory function returns a
`(TestStream, Addresses)` pair.

### Default Stream Parameters

All factories (unless using the builder override) use these canonical parameters:

| Parameter         | Value | Derived (with start = 100) |
|-------------------|-------|---------------------------|
| `rate_per_ledger` | 10    |                           |
| `cliff_duration`  | 50    | cliff at ledger **150**   |
| `total_duration`  | 200   | end at ledger **300**     |
| `deposit`         | 2 000 | rate × total_duration     |

---

### Named Scenario Functions

#### `pre_cliff_stream(env)`

Creates a stream and advances the ledger to **120** (30 ledgers before the cliff
at 150).

**Invariants:**
- `is_cliff_passed()` → `false`
- `claimable_amount()` → `0`
- `claim_vested()` → `Err(CliffNotReached)`

```rust
let env = setup_env();
let (stream, addrs) = factory::pre_cliff_stream(&env);
assert!(!stream.client.is_cliff_passed(&addrs.recipient));
```

---

#### `at_cliff_stream(env)`

Creates a stream and advances the ledger **exactly to the cliff** (ledger 150).

**Invariants:**
- `is_cliff_passed()` → `true`
- `claimable_amount()` → `500` (50 ledgers × 10)

```rust
let env = setup_env();
let (stream, addrs) = factory::at_cliff_stream(&env);
let claimed = stream.client.claim_vested(&addrs.recipient).unwrap();
assert_eq!(claimed, 500);
```

---

#### `post_cliff_stream(env, ledgers_past_cliff)`

Creates a stream and advances to **cliff + N** ledgers past the cliff.

**Invariants (N = 50):**
- Current ledger: 200
- `claimable_amount()` → `1 000` (100 ledgers × 10)

```rust
let env = setup_env();
let (stream, addrs) = factory::post_cliff_stream(&env, 50);
assert_eq!(stream.client.claimable_amount(&addrs.recipient), 1_000);
```

> **Panics** if `ledgers_past_cliff > 150` (would push past `end_ledger`).

---

#### `fully_claimed_stream(env)`

Creates a stream, jumps past the end ledger, and calls `claim_vested` to drain
the entire deposit. The schedule is removed from storage.

**Invariants:**
- `get_schedule()` → `None`
- `claim_vested()` → `Err(ScheduleNotFound)`

```rust
let env = setup_env();
let (stream, addrs) = factory::fully_claimed_stream(&env);
assert!(stream.client.get_schedule(&addrs.recipient).is_none());
```

---

#### `cancelled_stream(env)`

Creates a stream and cancels it **before the cliff** (full refund path).

**Invariants:**
- `get_schedule()` → `None`
- `claim_vested()` → `Err(ScheduleNotFound)`

```rust
let env = setup_env();
let (stream, addrs) = factory::cancelled_stream(&env);
assert!(stream.client.get_schedule(&addrs.recipient).is_none());
```

---

#### `expired_stream(env)`

Creates a stream and advances the ledger well past `end_ledger` **without
claiming**. The schedule remains active.

**Invariants:**
- `claimable_amount()` → `2 000` (full deposit, capped at end_ledger)
- `get_schedule()` → `Some(_)` (not yet claimed)

```rust
let env = setup_env();
let (stream, addrs) = factory::expired_stream(&env);
assert_eq!(stream.client.claimable_amount(&addrs.recipient), 2_000);
```

---

### Builder Pattern (Custom Overrides)

Use `StreamBuilder` when you need non-default parameters:

```rust
use crate::tests::factory::StreamBuilder;

let env = setup_env();
let (stream, addrs) = StreamBuilder::default()
    .rate(5)
    .cliff_duration(20)
    .total_duration(100)
    .build(&env);

// start=100, cliff=120, end=200, deposit=500
```

`StreamBuilder` methods:

| Method                    | Description                              |
|---------------------------|------------------------------------------|
| `.rate(i128)`             | Tokens released per ledger (default: 10) |
| `.cliff_duration(u32)`    | Ledgers until cliff (default: 50)        |
| `.total_duration(u32)`    | Total stream length (default: 200)       |
| `.build(&env)`            | Registers contract and creates stream    |

---

### `TestStream` and `Addresses` types

```rust
pub struct TestStream<'env> {
    pub contract_id: Address,          // on-chain contract address
    pub client: VestingDripsClient,    // pre-wired client
    pub token: Address,                // SAC token address
    pub params: StreamParams,          // rate, durations, deposit, ledger heights
}

pub struct Addresses {
    pub sponsor: Address,    // stream funder & potential canceller
    pub recipient: Address,  // stream beneficiary
}
```

---

## Shared Helpers (`mod.rs`)

### `setup_env() -> Env`

Creates a fresh Soroban test environment with `mock_all_auths()` and sets the
initial ledger sequence to **100**.

### `advance_ledger(env, n)`

Advances the ledger sequence by `n` while preserving all other `LedgerInfo`
fields.

---

## Adding New Tests

1. Pick the closest named scenario from the factory (or use `StreamBuilder`).
2. Import it: `use crate::tests::factory::your_scenario;`
3. Write your test around the returned `(stream, addrs)`.
4. Avoid duplicating the `env.register` / `mint_to` boilerplate — that's what
   the factory is for.
