# API Reference

This document is the canonical reference for all public entry points of the
`vesting-cliff-drip-stream` Soroban smart contract.  It also describes the
rate-limiting and abuse-prevention equivalents that apply to smart-contract callers.

---

## Authentication & Authorisation

Every state-changing function requires on-chain authentication via `require_auth()`.
Callers must sign the transaction with the appropriate key:

| Function | Required signer |
|---|---|
| `create_vesting_stream` | `sponsor` — the address paying the deposit |
| `cancel_stream` | `sponsor` — the same address that created the stream |
| `claim_vested` | `recipient` — the stream beneficiary |
| `get_schedule` | none (read-only) |
| `claimable_amount` | none (read-only) |
| `is_cliff_passed` | none (read-only) |
| `get_stream_info` | none (read-only) |
| `get_config` | none (read-only) |

---

## Entry Points

### `create_vesting_stream`

Creates a new cliff-vesting token stream.

```rust
pub fn create_vesting_stream(
    env: Env,
    sponsor: Address,      // must authorise; pays the full deposit
    recipient: Address,    // stream beneficiary
    token: Address,        // SAC token contract address
    rate: i128,            // tokens released per ledger (must be > 0)
    cliff_duration: u32,   // ledgers until cliff (must be < total_duration)
    total_duration: u32,   // total stream length in ledgers
) -> Result<(), VestingError>
```

**Side effects:**
- Transfers `rate × total_duration` tokens from `sponsor` to the contract vault.
- Persists a `VestingSchedule` in contract storage for `recipient`.
- Emits a `vc_create` event.

**Errors:**

| Code | Name | Condition |
|---|---|---|
| 4 | `InvalidRate` | `rate ≤ 0` |
| 3 | `InvalidDuration` | `total_duration ≤ cliff_duration` |
| 5 | `DepositOverflow` | `rate × total_duration` overflows `i128` or ledger arithmetic overflows `u32` |
| 6 | `ScheduleAlreadyExists` | A stream already exists for `recipient` |

**CLI example:**

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$SPONSOR" \
  --network testnet \
  -- create_vesting_stream \
  --sponsor "$SPONSOR_ADDRESS" \
  --recipient "$RECIPIENT_ADDRESS" \
  --token "$TOKEN_ADDRESS" \
  --rate 10 \
  --cliff-duration 17280 \
  --total-duration 172800
```

---

### `claim_vested`

Claims all tokens accrued since the last claim.

```rust
pub fn claim_vested(
    env: Env,
    recipient: Address,   // must authorise
) -> Result<i128, VestingError>
```

Returns the amount transferred.

**Side effects:**
- Transfers claimable tokens from the contract vault to `recipient`.
- Updates `last_claimed_ledger` in storage (or removes the schedule if stream ends).
- Emits a `vc_claim` event; also emits `vc_done` on final claim.

**Errors:**

| Code | Name | Condition |
|---|---|---|
| 1 | `ScheduleNotFound` | No active stream for `recipient` |
| 2 | `CliffNotReached` | `current_ledger < cliff_ledger` |
| 7 | `NothingToClaim` | No tokens have accrued since last claim |

**CLI example:**

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$RECIPIENT" \
  --network testnet \
  -- claim_vested \
  --recipient "$RECIPIENT_ADDRESS"
```

---

### `cancel_stream`

Cancels a stream before it completes.

```rust
pub fn cancel_stream(
    env: Env,
    sponsor: Address,     // must authorise; must be the original stream creator
    recipient: Address,   // identifies which stream to cancel
) -> Result<(), VestingError>
```

**Refund behaviour:**

- **Before cliff:** full remaining deposit refunded to `sponsor`; `recipient` receives nothing.
- **After cliff:** accrued tokens transferred to `recipient`; remaining balance refunded to `sponsor`.

**Side effects:**
- Removes the `VestingSchedule` from storage.
- Transfers tokens as described above.
- Emits a `vc_cancel` event (includes `sponsor`, `refunded_to_sponsor`, and `released_to_recipient`).

**Errors:**

| Code | Name | Condition |
|---|---|---|
| 1 | `ScheduleNotFound` | No active stream for `recipient` |

**CLI example:**

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$SPONSOR" \
  --network testnet \
  -- cancel_stream \
  --sponsor "$SPONSOR_ADDRESS" \
  --recipient "$RECIPIENT_ADDRESS"
```

---

### `get_schedule`

Returns the full vesting schedule for a recipient.

```rust
pub fn get_schedule(env: Env, recipient: Address) -> Option<VestingSchedule>
```

Returns `None` if no active stream exists.

`VestingSchedule` fields: `token`, `rate_per_ledger`, `start_ledger`, `cliff_ledger`, `end_ledger`, `last_claimed_ledger`.

---

### `claimable_amount`

Returns the number of tokens immediately claimable.

```rust
pub fn claimable_amount(env: Env, recipient: Address) -> i128
```

Returns `0` if: no stream exists, or cliff not reached.

---

### `is_cliff_passed`

Returns `true` if the cliff ledger has been reached.

```rust
pub fn is_cliff_passed(env: Env, recipient: Address) -> bool
```

Returns `false` if no stream exists.

---

### `get_stream_info`

Returns a rich analytics snapshot for a recipient's stream.

```rust
pub fn get_stream_info(env: Env, recipient: Address) -> Option<StreamInfo>
```

See [docs/analytics.md](analytics.md) for full field definitions.

---

### `get_config`

Returns the compiled-in contract configuration (TTL thresholds).

```rust
pub fn get_config(env: Env) -> ContractConfig
```

Fields: `persistent_ledger_threshold` (u32), `persistent_bump_amount` (u32).
See [docs/config.md](config.md) for full documentation.

---

## Error Code Reference

| Code | Name | HTTP equivalent | Description |
|---|---|---|---|
| 1 | `ScheduleNotFound` | 404 Not Found | No active stream for the given recipient. |
| 2 | `CliffNotReached` | 425 Too Early | Claim attempted before the cliff. |
| 3 | `InvalidDuration` | 422 Unprocessable Entity | `total_duration ≤ cliff_duration`. |
| 4 | `InvalidRate` | 422 Unprocessable Entity | `rate` is zero or negative. |
| 5 | `DepositOverflow` | 422 Unprocessable Entity | Arithmetic overflow on deposit computation. |
| 6 | `ScheduleAlreadyExists` | 409 Conflict | A stream already exists for this recipient. |
| 7 | `NothingToClaim` | 204 No Content | Claimable balance is zero. |

---

## Rate Limiting Equivalents

Soroban smart contracts do not have HTTP middleware.  The following contract-level
mechanisms serve the same purpose as API rate limiting:

### Per-invocation limits (protocol-enforced)

| Limit | Value | Mechanism |
|---|---|---|
| CPU budget | ~100 million instructions | Soroban protocol; transaction rejected on exceed |
| Ledger read/write budget | 40 ledger entries per tx | Soroban protocol |
| Transaction fee | Proportional to resources used | Stellar fee market; acts as natural spam deterrent |

### Contract-level duplicate guards

| Guard | Error | Purpose |
|---|---|---|
| Duplicate stream | `ScheduleAlreadyExists` (6) | Prevents a sponsor from accidentally creating two streams for the same recipient. Equivalent to a 409 + idempotency check. |
| Pre-auth duplicate check | checked before `require_auth()` | Fails cheaply (before signature verification) to save budget. |
| Negative-rate / overflow guard | `InvalidRate` (4) / `DepositOverflow` (5) | Guards against `i128::MIN` abuse and arithmetic overflow. |

### Suggested client-side throttling

For off-chain tooling calling these endpoints:

| Endpoint category | Suggested limit | Rationale |
|---|---|---|
| State-changing (create, claim, cancel) | 1 call per block (~5 s) per wallet | Limited by ledger confirmation time anyway |
| View functions (get_*, claimable_amount, is_cliff_passed) | 60 req/min per caller | No on-chain cost; throttle at RPC layer |
| Bulk analytics (indexer) | Use streaming event subscription | More efficient than polling view functions |
| Auth / key signing | 10 req/min per IP | Protect key-management endpoints |

For HTTP APIs wrapping this contract, implement:
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` response headers.
- `429 Too Many Requests` with `Retry-After` when limits are exceeded.
- IP-based limits for unauthenticated callers; wallet-address-based limits for authenticated callers.

---

## Idempotency

| Function | Idempotent? | Notes |
|---|---|---|
| `create_vesting_stream` | No — returns `ScheduleAlreadyExists` on repeat | Use `get_schedule` to check first |
| `claim_vested` | Safe to retry — returns `NothingToClaim` if already claimed this ledger | — |
| `cancel_stream` | No — returns `ScheduleNotFound` after first cancel | — |
| All view functions | Yes | Pure reads; no side effects |
