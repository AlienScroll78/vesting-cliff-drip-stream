# Vesting Cliff Drip Stream — Walkthrough Guide

A written companion to the video tutorial. This guide covers the same content as
the video so you can follow along at your own pace, copy commands, and reference
details without scrubbing through footage.

**Repository:** https://github.com/AlienScroll78/vesting-cliff-drip-stream

---

## Contents

1. [The Problem](#1-the-problem)
2. [How It Works](#2-how-it-works)
3. [Project Layout](#3-project-layout)
4. [The VestingSchedule Type](#4-the-vestingschedule-type)
5. [Flow 1 — Create a Stream](#5-flow-1--create-a-stream)
6. [Flow 2 — Claim Vested Tokens](#6-flow-2--claim-vested-tokens)
7. [Flow 3 — Cancel a Stream](#7-flow-3--cancel-a-stream)
8. [View Functions](#8-view-functions)
9. [Error Reference](#9-error-reference)
10. [Security Model](#10-security-model)
11. [Deploy and Try It](#11-deploy-and-try-it)
12. [Next Steps](#12-next-steps)

---

## 1. The Problem

Token grants have two common failure modes:

- **Immediate unlock** — you give a contributor their full allocation on day one.
  They can leave immediately and sell everything. There is no retention pressure.
- **Single cliff** — the contributor waits a fixed period, then receives everything
  at once. The moment the cliff hits, the incentive to stay evaporates.

What we need is a **cliff followed by a gradual drip**: a lock-up period that tests
commitment, then continuous rewards that grow the longer the contributor stays.

---

## 2. How It Works

The contract combines two patterns:

1. **Cliff** — a mandatory waiting period before any tokens can be claimed.
2. **Linear stream** — tokens vest at a fixed rate per ledger after the cliff.

```
Ledger:   start_ledger      cliff_ledger                  end_ledger
               │                 │                              │
Tokens:        │   [locked]      │  ← instant catch-up claim → │ ← linear drip ──┤
               │                 │                              │
```

Key behaviours:

- The sponsor deposits the **full allocation** upfront. The contract holds it.
- Before `cliff_ledger`, every claim attempt fails with `CliffNotReached`.
- At or after `cliff_ledger`, the recipient can claim all tokens accrued from
  `start_ledger` to the current ledger in one transaction (the catch-up burst).
- Subsequent claims collect tokens accrued since the previous claim.
- The stream ends at `end_ledger`. Tokens stop accruing; the stream record is
  deleted once fully claimed.

---

## 3. Project Layout

```
src/
├── contract.rs       # Public entry-points
├── types.rs          # VestingSchedule and DataKey
├── error.rs          # VestingError enum
├── events.rs         # On-chain event emitters
├── storage.rs        # Persistent storage helpers
└── tests/
    ├── mod.rs
    ├── token_helper.rs
    ├── test_create.rs
    ├── test_claim.rs
    ├── test_cancel.rs
    ├── test_views.rs
    └── test_edge_cases.rs
scripts/
├── deploy.sh         # Build + optimise + deploy to testnet
├── invoke_create.sh  # CLI helper: create_vesting_stream
└── invoke_claim.sh   # CLI helper: claim_vested
```

---

## 4. The VestingSchedule Type

Every stream is represented by one `VestingSchedule` value, stored in persistent
contract storage keyed by the recipient's `Address`.

```rust
pub struct VestingSchedule {
    token:               Address,  // SAC-compatible token contract
    rate_per_ledger:     i128,     // tokens released per ledger
    start_ledger:        u32,      // ledger the stream was created
    cliff_ledger:        u32,      // first ledger where claiming is allowed
    end_ledger:          u32,      // last ledger of accrual
    last_claimed_ledger: u32,      // claim cursor; advances on each claim
}
```

The claimable amount at any ledger `L` is:

```
claimable = (min(L, end_ledger) - last_claimed_ledger) × rate_per_ledger
```

This formula only applies after the cliff. Before it, the result is always 0.

---

## 5. Flow 1 — Create a Stream

**Entry-point:** `create_vesting_stream`

```rust
pub fn create_vesting_stream(
    env: Env,
    sponsor: Address,     // must sign; pays the deposit
    recipient: Address,   // beneficiary
    token: Address,       // SAC token contract address
    rate: i128,           // tokens per ledger (must be > 0)
    cliff_duration: u32,  // ledgers from now until cliff
    total_duration: u32,  // total stream length (must be > cliff_duration)
) -> Result<(), VestingError>
```

### What happens step-by-step

1. **Validation**
   - `rate` must be positive; otherwise `InvalidRate` (code 4).
   - `total_duration` must exceed `cliff_duration`; otherwise `InvalidDuration`
     (code 3).
   - No existing stream for `recipient`; otherwise `ScheduleAlreadyExists`
     (code 6).

2. **Auth** — `sponsor.require_auth()`. The sponsor's wallet must sign.

3. **Derive ledger heights**
   ```
   start_ledger  = env.ledger().sequence()   // right now
   cliff_ledger  = start_ledger + cliff_duration
   end_ledger    = start_ledger + total_duration
   ```

4. **Deposit** — transfer `rate × total_duration` tokens from the sponsor to the
   contract address. Uses `checked_mul` to guard against overflow.

5. **Persist** — store the `VestingSchedule` in persistent storage.

6. **Event** — emit `vc_create` with all schedule parameters.

### Example: 10-day stream with 1-day cliff

At 5 seconds per ledger:
- 1 day ≈ 17 280 ledgers
- 10 days ≈ 172 800 ledgers

```bash
export RATE=10            # 10 tokens per ledger
export CLIFF_DURATION=17280
export TOTAL_DURATION=172800
./scripts/invoke_create.sh
```

Total deposit = `10 × 172800 = 1 728 000 tokens`.

---

## 6. Flow 2 — Claim Vested Tokens

**Entry-point:** `claim_vested`

```rust
pub fn claim_vested(env: Env, recipient: Address) -> Result<i128, VestingError>
```

Returns the number of tokens transferred.

### What happens step-by-step

1. **Auth** — `recipient.require_auth()`. Only the recipient can trigger their
   own claim.

2. **Cliff check** — if `current_ledger < cliff_ledger`, return `CliffNotReached`
   (code 2). Nothing is transferred.

3. **Compute claimable amount**
   ```
   active_end      = min(current_ledger, end_ledger)
   claimable       = (active_end - last_claimed_ledger) × rate_per_ledger
   ```
   If `claimable == 0`, return `NothingToClaim` (code 7).

4. **Update storage** — advance `last_claimed_ledger` to `active_end`. If
   `active_end == end_ledger` the stream is fully exhausted; delete the schedule.

5. **Transfer** — move `claimable` tokens from the contract to the recipient.

6. **Events** — emit `vc_claim`; emit `vc_done` if the stream just finished.

### First claim: the catch-up burst

On the very first claim (right at the cliff or later), `last_claimed_ledger` is
still `start_ledger`. So the formula covers the entire cliff duration:

```
active_end - start_ledger = cliff_duration (minimum)
```

All tokens that accrued during the locked period arrive in a single transfer.
This is the cliff "burst."

### Subsequent claims

Each additional call to `claim_vested` collects only the tokens that accrued
since the previous claim. The recipient can call as often or as rarely as they
want; the total they receive is always the same at any given ledger.

---

## 7. Flow 3 — Cancel a Stream

**Entry-point:** `cancel_stream`

```rust
pub fn cancel_stream(
    env: Env,
    sponsor: Address,
    recipient: Address,
) -> Result<(), VestingError>
```

### What happens step-by-step

1. **Auth** — `sponsor.require_auth()`. Only the original funder can cancel.

2. **Load schedule** — fail with `ScheduleNotFound` (code 1) if none exists.

3. **Compute split**

   | Condition | Recipient gets | Sponsor gets |
   |---|---|---|
   | `current_ledger < cliff_ledger` | 0 | Full remaining deposit |
   | `current_ledger ≥ cliff_ledger` | Accrued since last claim | Unearned remainder |

   When the cliff has passed the split is:
   ```
   earned_ledgers  = min(current, end) - last_claimed_ledger
   recipient_share = earned_ledgers × rate
   sponsor_refund  = (end_ledger - min(current, end)) × rate
   ```

4. **Delete schedule** from storage.

5. **Transfers** — pay the recipient their share (if > 0), then the sponsor their
   refund (if > 0). The contract always ends with zero balance for this stream.

6. **Event** — emit `vc_cancel` with the sponsor refund amount.

### Why the full deposit is held up front

Because the contract must be able to pay both the recipient and the sponsor on
cancellation at any point in time, without knowing in advance when cancellation
will occur. Holding the full budget is the simplest correct approach.

---

## 8. View Functions

These are read-only — no auth required, no state changes.

### `get_schedule(recipient) -> Option<VestingSchedule>`

Returns the full schedule struct, or `None` if no active stream exists.

```bash
stellar contract invoke \
  --id $VESTING_CONTRACT --network testnet \
  -- get_schedule --recipient $RECIPIENT
```

### `claimable_amount(recipient) -> i128`

Returns the number of tokens the recipient could claim right now. Returns 0 if
the cliff has not been reached or no schedule exists.

```bash
stellar contract invoke \
  --id $VESTING_CONTRACT --network testnet \
  -- claimable_amount --recipient $RECIPIENT
```

### `is_cliff_passed(recipient) -> bool`

Returns `true` if `current_ledger >= cliff_ledger`.

```bash
stellar contract invoke \
  --id $VESTING_CONTRACT --network testnet \
  -- is_cliff_passed --recipient $RECIPIENT
```

---

## 9. Error Reference

| Code | Name | Cause |
|---|---|---|
| 1 | `ScheduleNotFound` | No active stream for the given recipient |
| 2 | `CliffNotReached` | Claim attempted before `cliff_ledger` |
| 3 | `InvalidDuration` | `total_duration` ≤ `cliff_duration` |
| 4 | `InvalidRate` | `rate` is zero or negative |
| 5 | `DepositOverflow` | `rate × total_duration` overflows `i128` |
| 6 | `ScheduleAlreadyExists` | A stream already exists for this recipient |
| 7 | `NothingToClaim` | Claimable amount is zero at the current ledger |

Error codes are returned on-chain as numeric contract errors. Client tooling can
map the integer back to the name for user-facing messages.

---

## 10. Security Model

**No admin key.** The contract has no owner or privileged address. Only the
original sponsor of a stream can cancel it. There is no global drain function.

**Auth on every mutation.**
- `create_vesting_stream` — sponsor signs
- `claim_vested` — recipient signs
- `cancel_stream` — sponsor signs

**Overflow-safe arithmetic.** All multiplications use `checked_mul` and return
`DepositOverflow` (code 5) rather than panicking or wrapping.

**Duplicate prevention.** `ScheduleAlreadyExists` prevents a sponsor from
overwriting an existing stream by calling create again.

**TTL management.** `storage::get_schedule` and `storage::set_schedule` both bump
the persistent storage entry's TTL to approximately 60 days. An active stream will
not expire from ledger state during normal operation.

**Zero residual balance.** After a cancel or a fully-completed stream, the
schedule entry is deleted and the contract holds no tokens for that stream.

---

## 11. Deploy and Try It

### Prerequisites

```bash
# Rust and the WASM target
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Stellar CLI
# https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli
```

### Build and test locally

```bash
make build   # compile to WASM
make test    # run all unit/integration tests
```

### Deploy to testnet

```bash
# 1. Generate and fund a testnet key
stellar keys generate default --network testnet --fund

# 2. Build + optimise + deploy; copies contract ID to stdout
./scripts/deploy.sh default

# 3. Export the contract ID
export VESTING_CONTRACT=<contract-id-from-above>
```

### Create a stream

```bash
export SPONSOR=default        # key alias from stellar keys
export RECIPIENT=<G...>       # recipient public key
export TOKEN=<C...>           # SAC token contract ID
export RATE=10                # tokens per ledger
export CLIFF_DURATION=17280   # ~1 day at 5s/ledger
export TOTAL_DURATION=172800  # ~10 days at 5s/ledger

./scripts/invoke_create.sh
```

### Check claimable amount (before cliff)

```bash
stellar contract invoke \
  --id $VESTING_CONTRACT --network testnet \
  -- claimable_amount --recipient $RECIPIENT
# output: 0
```

### Claim (after cliff)

```bash
./scripts/invoke_claim.sh
# output: number of tokens transferred
```

### Cancel

```bash
stellar contract invoke \
  --id $VESTING_CONTRACT --network testnet \
  --source $SPONSOR \
  -- cancel_stream \
    --sponsor $SPONSOR \
    --recipient $RECIPIENT
```

---

## 12. Next Steps

- **Read the source** — `src/contract.rs` is under 300 lines and fully commented.
- **Run the tests** — `make test` runs 30+ cases covering create, claim, cancel,
  views, and edge cases. They are a good reference for expected behaviour.
- **Fork and extend** — the MIT license lets you add features like:
  - Multiple streams per recipient (keyed by stream ID)
  - Partial claim with a specified amount
  - Stream transfer (recipient reassignment)
  - On-chain metadata (label/memo per stream)
- **Open an issue** — if you find a bug or want to propose a feature, open an
  issue on GitHub.

**Repository:** https://github.com/AlienScroll78/vesting-cliff-drip-stream
