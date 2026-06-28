# API Reference — VestingDrips Contract

Contract ID is referred to as `$VESTING_CONTRACT` throughout the CLI examples.
All amounts are in the token's smallest unit (stroops for XLM-based SAC tokens).
Ledger sequences are `u32` values from `env.ledger().sequence()`.

---

## Table of Contents

- [Mutating Functions](#mutating-functions)
  - [create_vesting_stream](#create_vesting_stream)
  - [claim_vested](#claim_vested)
  - [cancel_stream](#cancel_stream)
- [View Functions](#view-functions)
  - [get_schedule](#get_schedule)
  - [claimable_amount](#claimable_amount)
  - [is_cliff_passed](#is_cliff_passed)
  - [get_status](#get_status)
- [Types](#types)
  - [VestingSchedule](#vestingschedule)
  - [StreamStatus](#streamstatus)
- [Error Codes](#error-codes)
- [Events](#events)

---

## Mutating Functions

### `create_vesting_stream`

Creates a new cliff-vesting stream. The sponsor transfers the full token deposit (`rate × total_duration`) into the contract vault at creation time.

**Auth required:** `sponsor`

```rust
pub fn create_vesting_stream(
    env: Env,
    sponsor: Address,       // funder; must authorise and hold sufficient tokens
    recipient: Address,     // beneficiary
    token: Address,         // SAC-compatible token contract
    rate: i128,             // tokens per ledger; must be > 0
    cliff_duration: u32,    // ledgers from now until cliff
    total_duration: u32,    // total stream length in ledgers; must be > cliff_duration
) -> Result<(), VestingError>
```

**Derived values stored:**

| Field | Computed as |
|---|---|
| `start_ledger` | `env.ledger().sequence()` at call time |
| `cliff_ledger` | `start_ledger + cliff_duration` |
| `end_ledger` | `start_ledger + total_duration` |
| `total_deposit` | `rate × total_duration` |

**Errors:**

| Code | Name | Condition |
|---|---|---|
| 4 | `InvalidRate` | `rate ≤ 0` |
| 3 | `InvalidDuration` | `total_duration ≤ cliff_duration` |
| 5 | `DepositOverflow` | `rate × total_duration` overflows `i128`, or ledger addition overflows `u32` |
| 6 | `ScheduleAlreadyExists` | A stream already exists for `recipient` |

**CLI example:**

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$SPONSOR" \
  --network testnet \
  -- \
  create_vesting_stream \
  --sponsor  "$SPONSOR" \
  --recipient "$RECIPIENT" \
  --token    "$TOKEN" \
  --rate     10 \
  --cliff_duration  17280 \
  --total_duration  172800
```

Or use the provided helper:

```bash
export VESTING_CONTRACT=<contract-id>
export SPONSOR=default          # stellar key name
export RECIPIENT=G...
export TOKEN=C...
export RATE=10
export CLIFF_DURATION=17280     # ~1 day  (5 s/ledger)
export TOTAL_DURATION=172800    # ~10 days

./scripts/invoke_create.sh
```

---

### `claim_vested`

Claims all tokens accrued since the last claim (or since `start_ledger` on the first claim after the cliff). The cliff produces an instant "catch-up" payout covering every ledger from `start_ledger` to now.

**Auth required:** `recipient`

```rust
pub fn claim_vested(
    env: Env,
    recipient: Address,
) -> Result<i128, VestingError>
```

**Returns:** `i128` — amount transferred to `recipient`.

**Claim calculation:**

```
active_end      = min(current_ledger, end_ledger)
claimable       = (active_end − last_claimed_ledger) × rate_per_ledger
```

After a successful claim `last_claimed_ledger` is updated to `active_end`. When `active_end == end_ledger` the schedule is removed from storage and a `vc_done` event is emitted.

**Errors:**

| Code | Name | Condition |
|---|---|---|
| 1 | `ScheduleNotFound` | No active schedule for `recipient` |
| 2 | `CliffNotReached` | `current_ledger < cliff_ledger` |
| 7 | `NothingToClaim` | Computed claimable amount is 0 |

**CLI example:**

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$RECIPIENT" \
  --network testnet \
  -- \
  claim_vested \
  --recipient "$RECIPIENT"
```

Or use the provided helper:

```bash
export VESTING_CONTRACT=<contract-id>
export RECIPIENT=<key-name-or-address>

./scripts/invoke_claim.sh
```

---

### `cancel_stream`

Cancels an active stream. Token distribution depends on whether the cliff has been reached:

- **Cliff passed:** recipient receives all accrued-but-unclaimed tokens; sponsor is refunded the remainder.
- **Cliff not passed:** sponsor receives the full remaining deposit; recipient receives nothing.

The schedule is removed from storage in both cases.

**Auth required:** `sponsor`

```rust
pub fn cancel_stream(
    env: Env,
    sponsor: Address,
    recipient: Address,
) -> Result<(), VestingError>
```

**Returns:** `()` on success.

**Payout logic:**

```
# Cliff passed
active_end       = min(current_ledger, end_ledger)
recipient_share  = (active_end − last_claimed_ledger) × rate_per_ledger
sponsor_refund   = (end_ledger − active_end)          × rate_per_ledger

# Cliff NOT passed
recipient_share  = 0
sponsor_refund   = (end_ledger − last_claimed_ledger) × rate_per_ledger
```

**Errors:**

| Code | Name | Condition |
|---|---|---|
| 1 | `ScheduleNotFound` | No active schedule for `recipient` |

**CLI example:**

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$SPONSOR" \
  --network testnet \
  -- \
  cancel_stream \
  --sponsor   "$SPONSOR" \
  --recipient "$RECIPIENT"
```

---

## View Functions

View functions do not require auth, do not modify state, and return `0` / `false` / `None` when no schedule exists rather than erroring.

### `get_schedule`

Returns the full vesting schedule for `recipient`.

```rust
pub fn get_schedule(env: Env, recipient: Address) -> Option<VestingSchedule>
```

**Returns:** `Some(VestingSchedule)` or `None` if no schedule exists.

**CLI example:**

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network testnet \
  -- \
  get_schedule \
  --recipient "$RECIPIENT"
```

---

### `claimable_amount`

Returns the number of tokens currently claimable. Returns `0` if the cliff has not been reached or no schedule exists.

```rust
pub fn claimable_amount(env: Env, recipient: Address) -> i128
```

**Returns:** `i128` ≥ 0.

**CLI example:**

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network testnet \
  -- \
  claimable_amount \
  --recipient "$RECIPIENT"
```

---

### `is_cliff_passed`

Returns whether the cliff ledger has been reached.

```rust
pub fn is_cliff_passed(env: Env, recipient: Address) -> bool
```

**Returns:** `true` if `current_ledger ≥ cliff_ledger`, `false` otherwise (including when no schedule exists).

**CLI example:**

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network testnet \
  -- \
  is_cliff_passed \
  --recipient "$RECIPIENT"
```

---

### `get_status`

Returns the lifecycle status of the stream.

```rust
pub fn get_status(env: Env, recipient: Address) -> Option<StreamStatus>
```

**Returns:** `Some(StreamStatus)` or `None` when no schedule exists.

| Return value | Meaning |
|---|---|
| `Some(PreCliff)` | Stream exists; cliff not yet reached |
| `Some(Active)` | Cliff passed; tokens dripping until `end_ledger` |
| `Some(Completed)` | `end_ledger` reached; all tokens vested |
| `None` | No schedule (never created, cancelled, or completed and removed) |

**CLI example:**

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network testnet \
  -- \
  get_status \
  --recipient "$RECIPIENT"
```

---

## Types

### `VestingSchedule`

XDR type: `SCVal::Map` (Soroban `contracttype`). Stored in persistent contract storage keyed by `DataKey::Schedule(recipient)`.

```rust
#[contracttype]
pub struct VestingSchedule {
    pub token:               Address,  // SAC token contract
    pub rate_per_ledger:     i128,     // tokens released per ledger
    pub start_ledger:        u32,      // ledger at stream creation
    pub cliff_ledger:        u32,      // ledger where cliff is reached
    pub end_ledger:          u32,      // ledger where stream ends
    pub last_claimed_ledger: u32,      // last ledger through which tokens were claimed
                                       // (initialised to start_ledger)
}
```

**XDR field encoding:**

| Field | XDR type |
|---|---|
| `token` | `SCVal::Address` |
| `rate_per_ledger` | `SCVal::I128` |
| `start_ledger` | `SCVal::U32` |
| `cliff_ledger` | `SCVal::U32` |
| `end_ledger` | `SCVal::U32` |
| `last_claimed_ledger` | `SCVal::U32` |

---

### `StreamStatus`

XDR type: `SCVal::Vec` (Soroban enum contracttype).

```rust
#[contracttype]
pub enum StreamStatus {
    PreCliff,   // 0 — cliff not yet reached
    Active,     // 1 — cliff passed, stream dripping
    Completed,  // 2 — end_ledger reached
    Cancelled,  // 3 — sponsor cancelled (schedule removed from storage)
}
```

> `Cancelled` is never returned by `get_status` at runtime because the schedule is deleted on cancellation, causing `get_status` to return `None`. The variant exists for use by off-chain indexers reconstructing state from events.

---

## Error Codes

All errors are returned as `u32` in the XDR `ScError::Contract` envelope.

| Code | Name | Returned by | Meaning |
|---|---|---|---|
| 1 | `ScheduleNotFound` | `claim_vested`, `cancel_stream` | No active schedule for the recipient |
| 2 | `CliffNotReached` | `claim_vested` | `current_ledger < cliff_ledger` |
| 3 | `InvalidDuration` | `create_vesting_stream` | `total_duration ≤ cliff_duration` |
| 4 | `InvalidRate` | `create_vesting_stream` | `rate ≤ 0` |
| 5 | `DepositOverflow` | `create_vesting_stream` | `rate × total_duration` overflows `i128` |
| 6 | `ScheduleAlreadyExists` | `create_vesting_stream` | Stream already exists for recipient |
| 7 | `NothingToClaim` | `claim_vested` | Claimable amount is 0 at current ledger |

Safe deposit upper bound: `rate ≤ i128::MAX / total_duration`. One unit above that limit returns `DepositOverflow`.

---

## Events

Events are emitted via `env.events().publish()`. Topics and data are XDR-encoded `SCVal` sequences.

### `vc_create` — Stream created

Emitted by `create_vesting_stream`.

| Field | Type | Value |
|---|---|---|
| Topic[0] | `SCVal::Symbol` | `"vc_create"` |
| Topic[1] | `SCVal::Address` | `recipient` |
| Data[0] | `SCVal::Address` | `sponsor` |
| Data[1] | `SCVal::Address` | `token` |
| Data[2] | `SCVal::I128` | `rate_per_ledger` |
| Data[3] | `SCVal::U32` | `start_ledger` |
| Data[4] | `SCVal::U32` | `cliff_ledger` |
| Data[5] | `SCVal::U32` | `end_ledger` |

### `vc_claim` — Tokens claimed

Emitted by `claim_vested` on every successful claim (including final claim).

| Field | Type | Value |
|---|---|---|
| Topic[0] | `SCVal::Symbol` | `"vc_claim"` |
| Topic[1] | `SCVal::Address` | `recipient` |
| Data[0] | `SCVal::I128` | `amount` transferred |
| Data[1] | `SCVal::U32` | `ledger_claimed_through` |

### `vc_done` — Stream completed

Emitted by `claim_vested` when the final claim drains the stream.

| Field | Type | Value |
|---|---|---|
| Topic[0] | `SCVal::Symbol` | `"vc_done"` |
| Topic[1] | `SCVal::Address` | `recipient` |
| Data | `SCVal::Address` | `token` |

### `vc_cancel` — Stream cancelled

Emitted by `cancel_stream`.

| Field | Type | Value |
|---|---|---|
| Topic[0] | `SCVal::Symbol` | `"vc_cancel"` |
| Topic[1] | `SCVal::Address` | `recipient` |
| Data | `SCVal::I128` | `refunded_amount` returned to sponsor |
