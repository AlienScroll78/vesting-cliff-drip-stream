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
4. [Key Types](#4-key-types)
5. [Testnet Setup](#5-testnet-setup)
6. [Flow 1 — Deploy and Initialize](#6-flow-1--deploy-and-initialize)
7. [Flow 2 — Create a Stream](#7-flow-2--create-a-stream)
8. [Flow 3 — Claim Vested Tokens](#8-flow-3--claim-vested-tokens)
9. [Flow 4 — Cancel a Stream](#9-flow-4--cancel-a-stream)
10. [Flow 5 — Variable-Rate Streams](#10-flow-5--variable-rate-streams)
11. [View Functions and History](#11-view-functions-and-history)
12. [Error Scenarios](#12-error-scenarios)
13. [Error Reference](#13-error-reference)
14. [Security Model](#14-security-model)
15. [Next Steps](#15-next-steps)

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
2. **Linear stream** — tokens vest at a fixed (or variable) rate per ledger after the cliff.

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
- The stream ends at `end_ledger`. **Dust collection** ensures the full deposit is
  always distributed: at `end_ledger`, the claimable amount is `total_deposited −
  claimed_amount` rather than `rate × elapsed_ledgers`, so no sub-1-token
  remainder is ever permanently locked.

---

## 3. Project Layout

```
src/
├── contract.rs       # Public entry-points
├── types.rs          # VestingSchedule, VariableRateSchedule, DataKey
├── error.rs          # VestingError enum (codes 1–20)
├── events.rs         # On-chain event emitters
├── storage.rs        # Persistent storage helpers
└── tests/
    ├── mod.rs
    ├── token_helper.rs
    ├── test_create.rs
    ├── test_claim.rs
    ├── test_cancel.rs
    ├── test_dust.rs           # #322 dust collection tests
    ├── test_initialize.rs     # #325 initialization tests
    ├── test_variable_rate.rs  # #326 variable-rate stream tests
    ├── test_views.rs
    └── test_edge_cases.rs
scripts/
├── deploy.sh         # Build + optimise + deploy + initialize
├── invoke_create.sh  # CLI helper: create_vesting_stream
└── invoke_claim.sh   # CLI helper: claim_vested
```

---

## 4. Key Types

### VestingSchedule (fixed-rate stream)

```rust
pub struct VestingSchedule {
    token:               Address, // SAC-compatible token contract
    sponsor:             Address, // funder who created the stream
    rate_per_ledger:     i128,    // tokens released per ledger
    start_ledger:        u32,     // ledger the stream was created
    cliff_ledger:        u32,     // first ledger where claiming is allowed
    end_ledger:          u32,     // last ledger of accrual
    last_claimed_ledger: u32,     // claim cursor; advances on each claim
    total_claimed:       i128,    // audit counter of all tokens claimed
    claimed_amount:      i128,    // used for dust-collection formula
}
```

Claimable amount formula:

```
// Normal (before end_ledger)
claimable = (min(L, end_ledger) − last_claimed_ledger) × rate_per_ledger

// At or past end_ledger (dust collection)
claimable = total_deposited − claimed_amount
```

### VariableRateSchedule (variable-rate stream)

```rust
pub struct VariableRateSchedule {
    // ... same header fields as VestingSchedule ...
    total_deposited: i128,            // pre-computed at creation
    segments:        Vec<RateSegment>,// ordered rate segments (max 10)
}

pub struct RateSegment {
    end_ledger: u32,  // absolute ledger where this segment ends
    rate:       i128, // tokens per ledger during this segment
}
```

Deposit formula for variable-rate streams:

```
total_deposit = Σ rate_i × (end_i − start_i)
```

where `start_i` is `end_{i-1}` (or `start_ledger` for the first segment).

---

## 5. Testnet Setup

### Prerequisites

```bash
# Rust and the WASM target
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Stellar CLI
# https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli
```

### Generate and fund a testnet key

```bash
stellar keys generate default --network testnet --fund

# Confirm the address
stellar keys address default --network testnet
```

### Build and test locally

```bash
make build   # compile to WASM
make test    # run all unit / integration tests
```

---

## 6. Flow 1 — Deploy and Initialize

**This is a new required step.** The contract must be initialized once after
deployment before any streams can be created. `deploy.sh` handles this automatically.

```bash
# Deploy and initialize in one command
./scripts/deploy.sh default 0 $(stellar keys address default --network testnet)

# Export the contract ID for subsequent commands
export VESTING_CONTRACT=<contract-id-from-above>
```

What `deploy.sh` does:
1. Compiles the contract to optimized WASM.
2. Deploys it to testnet and captures the contract ID.
3. Calls `initialize(admin, fee_bps, treasury)`:
   - `admin` = your key address (controls upgrades and admin config).
   - `fee_bps` = protocol fee in basis points (0 = no fee; max 500 = 5 %).
   - `treasury` = address that would receive fees.
4. Emits a `ContractInitialized` event on-chain.

### Manual initialization (if you deployed without the script)

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source default \
  --network testnet \
  -- initialize \
  --admin $(stellar keys address default --network testnet) \
  --fee_bps 0 \
  --treasury $(stellar keys address default --network testnet)
```

**Error scenario:** calling `initialize` a second time returns `AlreadyInitialized`
(code 13). This prevents accidental or malicious admin replacement after deployment.

```bash
# Second call → error 13
stellar contract invoke --id "$VESTING_CONTRACT" --source default --network testnet \
  -- initialize --admin $ATTACKER --fee_bps 0 --treasury $ATTACKER
# Error: AlreadyInitialized (13)
```

---

## 7. Flow 2 — Create a Stream

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

1. **NotInitialized check** — fails with code 18 if `initialize` was never called.
2. **Validation** — `rate > 0`; `total_duration > cliff_duration`; no existing stream.
3. **Auth** — `sponsor.require_auth()`.
4. **Ledger heights** — `cliff_ledger = now + cliff_duration`, `end_ledger = now + total_duration`.
5. **Deposit** — transfer `rate × total_duration` tokens from sponsor to contract.
6. **Persist** — store `VestingSchedule` with `claimed_amount = 0`.
7. **Event** — emit `vc_create`.

### Example: 10-day stream with 1-day cliff

```bash
export SPONSOR=default
export RECIPIENT=<G...>
export TOKEN=<C...>
export RATE=10
export CLIFF_DURATION=17280   # ~1 day at 5 s/ledger
export TOTAL_DURATION=172800  # ~10 days at 5 s/ledger

./scripts/invoke_create.sh
```

Total deposit = `10 × 172800 = 1 728 000 tokens`.

---

## 8. Flow 3 — Claim Vested Tokens

**Entry-point:** `claim_vested`

```rust
pub fn claim_vested(env: Env, recipient: Address) -> Result<i128, VestingError>
```

Returns the number of tokens transferred.

### What happens step-by-step

1. **Auth** — `recipient.require_auth()`.
2. **Cliff check** — fails with `CliffNotReached` (code 2) before `cliff_ledger`.
3. **Compute claimable amount**:
   - Before `end_ledger`: `(min(now, end_ledger) − last_claimed_ledger) × rate`
   - At or past `end_ledger` (dust collection): `total_deposited − claimed_amount`
4. **Transfer** — move tokens from contract vault to recipient.
5. **Update storage** — advance `last_claimed_ledger`; increment `claimed_amount`.
6. **If fully claimed** — delete schedule, emit `vc_done`.
7. **Events** — emit `vc_claim`.

### First claim: catch-up burst

At the cliff, `last_claimed_ledger` is still `start_ledger`, so the formula
covers the entire cliff duration in one transfer.

### CLI example

```bash
./scripts/invoke_claim.sh
# output: number of tokens transferred
```

---

## 9. Flow 4 — Cancel a Stream

**Entry-point:** `cancel_stream`

```rust
pub fn cancel_stream(
    env: Env,
    sponsor: Address,
    recipient: Address,
) -> Result<(), VestingError>
```

**Auth:** Only the original sponsor can cancel. A third party attempting to cancel
gets a transaction-level auth failure (not a contract error).

### Split rules

| Condition | Recipient gets | Sponsor gets |
|---|---|---|
| `current < cliff_ledger` | 0 | Full remaining deposit |
| `current ≥ cliff_ledger` | Accrued since last claim | Unearned remainder |

### CLI example

```bash
stellar contract invoke \
  --id $VESTING_CONTRACT --source $SPONSOR --network testnet \
  -- cancel_stream --sponsor $SPONSOR --recipient $RECIPIENT
```

**Error scenario — sponsor-only cancel:**

```bash
# Third party cannot cancel
stellar contract invoke \
  --id $VESTING_CONTRACT --source $ATTACKER --network testnet \
  -- cancel_stream --sponsor $ATTACKER --recipient $RECIPIENT
# Transaction fails: auth error (sponsor address mismatch)
```

---

## 10. Flow 5 — Variable-Rate Streams

**Entry-point:** `create_variable_rate_stream`

```rust
pub fn create_variable_rate_stream(
    env: Env,
    sponsor: Address,
    recipient: Address,
    token: Address,
    cliff_duration: u32,
    segments: Vec<(u32, i128)>,  // (absolute_end_ledger, rate)
) -> Result<(), VestingError>
```

### Segment rules

- 1–10 segments (max).
- `end_ledger` values must be strictly ascending.
- All rates must be > 0.
- `cliff_duration` must produce a `cliff_ledger < end_ledger` of the last segment.

### Example: stepped 3-year grant

At 5 s/ledger: 1 year ≈ 6 307 200 ledgers.

```
Year 1 (cliff): rate 5 tokens/ledger
Year 2:         rate 10 tokens/ledger
Year 3:         rate 20 tokens/ledger
```

Assuming current ledger is L:

```bash
# Calculate segment end ledgers
YEAR1_END=$((L + 6307200))
YEAR2_END=$((L + 12614400))
YEAR3_END=$((L + 18921600))

stellar contract invoke \
  --id $VESTING_CONTRACT --source $SPONSOR --network testnet \
  -- create_variable_rate_stream \
  --sponsor $SPONSOR \
  --recipient $RECIPIENT \
  --token $TOKEN \
  --cliff_duration 6307200 \
  --segments "[[$YEAR1_END, 5], [$YEAR2_END, 10], [$YEAR3_END, 20]]"
```

Deposit = `5×6307200 + 10×6307200 + 20×6307200 = 220 752 000 tokens`.

### Claiming from a variable-rate stream

```bash
stellar contract invoke \
  --id $VESTING_CONTRACT --source $RECIPIENT --network testnet \
  -- claim_variable_vested --recipient $RECIPIENT
```

The claim function iterates over segments, accumulating tokens proportional to
time spent in each rate tier. Dust collection applies at `end_ledger`.

---

## 11. View Functions and History

These are read-only — no auth required, no state changes.

### `get_schedule` / `get_variable_schedule`

Returns the full schedule struct (or `None`).

```bash
stellar contract invoke --id $VESTING_CONTRACT --network testnet \
  -- get_schedule --recipient $RECIPIENT

stellar contract invoke --id $VESTING_CONTRACT --network testnet \
  -- get_variable_schedule --recipient $RECIPIENT
```

### `claimable_amount` / `claimable_variable_amount`

Returns the number of tokens the recipient can claim right now.

```bash
stellar contract invoke --id $VESTING_CONTRACT --network testnet \
  -- claimable_amount --recipient $RECIPIENT

stellar contract invoke --id $VESTING_CONTRACT --network testnet \
  -- claimable_variable_amount --recipient $RECIPIENT
```

### `is_cliff_passed`

```bash
stellar contract invoke --id $VESTING_CONTRACT --network testnet \
  -- is_cliff_passed --recipient $RECIPIENT
# true / false
```

### `get_stats`

Returns `total_deposited`, `total_claimed`, `remaining`, and `claimable_now`.

```bash
stellar contract invoke --id $VESTING_CONTRACT --network testnet \
  -- get_stats --recipient $RECIPIENT
```

### Viewing event history (off-chain)

All contract events are indexed by Horizon. Query by contract ID:

```bash
curl "https://horizon-testnet.stellar.org/contracts/$VESTING_CONTRACT/operations"
```

Event topics and meanings:

| Topic | Event |
|---|---|
| `vc_init` | Contract initialized |
| `vc_create` | Fixed-rate stream created |
| `vc_vrcreat` | Variable-rate stream created |
| `vc_claim` | Fixed-rate tokens claimed |
| `vc_vrclam` | Variable-rate tokens claimed |
| `vc_done` | Stream fully exhausted |
| `vc_cancel` | Stream cancelled |
| `vc_drain` | Emergency drain executed |
| `vc_xdrain` | Permissionless drain executed |
| `vc_clawbk` | Compliance clawback executed |

---

## 12. Error Scenarios

### Pre-cliff claim attempt

```bash
# Advance to a ledger before the cliff (e.g. cliff is 17280 away)
stellar contract invoke --id $VESTING_CONTRACT --source $RECIPIENT --network testnet \
  -- claim_vested --recipient $RECIPIENT
# Error: CliffNotReached (2)
```

**Explanation:** `claim_vested` checks `current_ledger < cliff_ledger` and returns
error code 2. No tokens are transferred; no state is mutated.

**How to proceed:** wait until `cliff_ledger` is reached. Check with:

```bash
stellar contract invoke --id $VESTING_CONTRACT --network testnet \
  -- is_cliff_passed --recipient $RECIPIENT
```

### Sponsor-only cancel

```bash
# Third party (not the original sponsor) tries to cancel
stellar contract invoke --id $VESTING_CONTRACT --source $THIRD_PARTY --network testnet \
  -- cancel_stream --sponsor $THIRD_PARTY --recipient $RECIPIENT
# Transaction fails at auth layer
```

**Explanation:** `cancel_stream` calls `sponsor.require_auth()`. The Soroban
runtime rejects the transaction before the contract body runs if the signing key
doesn't match.

### Contract not initialized

```bash
# Attempt to create a stream on a freshly deployed, un-initialized contract
stellar contract invoke --id $NEW_CONTRACT --source $SPONSOR --network testnet \
  -- create_vesting_stream --sponsor $SPONSOR --recipient $RECIPIENT \
  --token $TOKEN --rate 10 --cliff_duration 1000 --total_duration 10000
# Error: NotInitialized (18)
```

**Fix:** call `initialize` first (see Flow 1).

### Invalid segments (variable-rate stream)

```bash
# Segments not in ascending order
stellar contract invoke --id $VESTING_CONTRACT --source $SPONSOR --network testnet \
  -- create_variable_rate_stream \
  --sponsor $SPONSOR --recipient $RECIPIENT --token $TOKEN \
  --cliff_duration 1000 \
  --segments "[[2000, 10], [1500, 5]]"
# Error: InvalidSegments (19)
```

---

## 13. Error Reference

| Code | Name | Cause |
|---|---|---|
| 1 | `ScheduleNotFound` | No active stream for the given recipient |
| 2 | `CliffNotReached` | Claim attempted before `cliff_ledger` |
| 3 | `InvalidDuration` | `total_duration` ≤ `cliff_duration` |
| 4 | `InvalidRate` | `rate` is zero or negative; or `fee_bps` > 500 |
| 5 | `DepositOverflow` | `rate × total_duration` overflows `i128` |
| 6 | `ScheduleAlreadyExists` | A stream already exists for this recipient |
| 7 | `NothingToClaim` | Claimable amount is zero at the current ledger |
| 8 | `StreamNotExpired` | `end_ledger` has not yet been reached |
| 9 | `TransferFailed` | Token transfer rejected by the SAC |
| 10 | `DrainDelayNotExpired` | 1-year drain delay has not elapsed |
| 11 | `InvalidRecipient` | `sponsor == recipient` |
| 12 | `Unauthorized` | Caller is not the stored admin |
| 13 | `AlreadyInitialized` | `initialize` called a second time |
| 14 | `ClawbackNotSupported` | Token does not support SAC clawback |
| 15 | `DepositBelowMinimum` | Total deposit < `get_min_deposit()` |
| 16 | `BatchSizeExceeded` | Batch create exceeds max recipients |
| 18 | `NotInitialized` | `initialize` not yet called; streams cannot be created |
| 19 | `InvalidSegments` | Variable-rate segments empty, too many, not ascending, or non-positive rate |
| 20 | `InvalidMilestones` | Milestone ledgers not ascending or BPS sum ≠ 10000 |

---

## 14. Security Model

**Explicit initialization required.** `initialize(admin, fee_bps, treasury)` must
be called once after deployment. Streams cannot be created before it, preventing
misconfigured deployments from ever accepting user funds.

**One-shot initialization.** Calling `initialize` twice returns `AlreadyInitialized`
(code 13), preventing admin hijack after deployment.

**Auth on every mutation.**
- `initialize` — admin signs
- `create_vesting_stream` — sponsor signs
- `claim_vested` / `claim_variable_vested` — recipient signs
- `cancel_stream` / `clawback_stream` — sponsor signs
- `upgrade` / `transfer_admin` — admin signs

**Dust collection.** At `end_ledger`, the contract distributes `total_deposited −
claimed_amount` rather than `rate × elapsed`, ensuring no tokens are permanently
stranded due to integer division remainder.

**Overflow-safe arithmetic.** All multiplications use `checked_mul` and return
`DepositOverflow` (code 5) on overflow.

**TTL management.** Persistent storage entries are bumped on every read/write
(~60-day window) to prevent expiry of active streams.

**Zero residual balance.** After cancel or full claim, the schedule is deleted and
the contract holds no tokens for that stream.

---

## 15. Next Steps

- **Read the source** — `src/contract.rs` is fully commented.
- **Run the tests** — `make test` covers all four new issue areas plus existing
  stream lifecycle tests.
- **Try the scripts** — `deploy.sh` will build, deploy, and initialize in one step.
- **Open an issue** — https://github.com/AlienScroll78/vesting-cliff-drip-stream

---

## Video Script (10-minute demo)

> The following script mirrors this written guide and is intended for a screen-capture
> recording. All timestamps are approximate. Narrator notes appear in *italics*.
> Screen action callouts appear in `[brackets]`.

---

### [00:00–00:45] Introduction

*Narrator:* "In this video we'll walk through the Vesting Cliff Drip Stream contract
from deployment to final claim. The contract runs on the Stellar testnet using
Soroban smart contracts."

`[Show repository README on screen]`

"The core idea: a sponsor locks tokens for a contributor with a mandatory cliff
period, then a linear drip. The tokens can't be touched until the cliff passes.
After that, they stream at a fixed or variable rate until the stream ends."

`[Show the ASCII diagram from the README]`

---

### [00:45–02:00] Testnet Setup

*Narrator:* "Let's set up a testnet environment."

`[Open terminal]`

```bash
# Install Stellar CLI (if not already installed)
# https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli

# Generate and fund a testnet key
stellar keys generate default --network testnet --fund
stellar keys address default --network testnet
```

`[Show the generated address]`

"We now have a funded testnet account. Let's build and deploy the contract."

---

### [02:00–03:30] Deploy and Initialize

*Narrator:* "Deploying the contract now. Notice that `deploy.sh` also calls
`initialize` automatically — this is a new requirement. Without initialization,
no streams can be created."

`[Run deploy.sh in terminal]`

```bash
./scripts/deploy.sh default 0
export VESTING_CONTRACT=<contract-id>
```

`[Highlight the 'initialize' call in the deploy.sh output]`

"The contract is now live and configured. The admin is our testnet key, the fee
is zero, and the treasury is also our key."

`[Screenshot placeholder: terminal showing 'Contract deployed and initialized']`

---

### [03:30–05:00] Create a Stream

*Narrator:* "Now let's create a vesting stream. We'll use a 10-token-per-ledger
rate, a 1-day cliff, and a 10-day total duration."

```bash
export SPONSOR=default
export RECIPIENT=<G...recipient...>
export TOKEN=<C...token...>
export RATE=10
export CLIFF_DURATION=17280
export TOTAL_DURATION=172800

./scripts/invoke_create.sh
```

`[Show the transaction result]`

"The sponsor's wallet signed the transaction. 1 728 000 tokens were transferred
from the sponsor to the contract vault. The stream is now active."

```bash
stellar contract invoke --id $VESTING_CONTRACT --network testnet \
  -- get_schedule --recipient $RECIPIENT
```

`[Screenshot placeholder: get_schedule output showing all fields]`

---

### [05:00–06:30] Pre-Cliff Claim Attempt (Error Scenario)

*Narrator:* "What happens if the recipient tries to claim before the cliff?"

```bash
./scripts/invoke_claim.sh
```

`[Show error output]`

"We get `CliffNotReached`, error code 2. No tokens moved. No state changed.
Let's check `is_cliff_passed` to confirm."

```bash
stellar contract invoke --id $VESTING_CONTRACT --network testnet \
  -- is_cliff_passed --recipient $RECIPIENT
# false
```

`[Screenshot placeholder: is_cliff_passed returning false]`

"On testnet, we can simulate time passing by waiting or using a local test
environment where we advance the ledger directly. In the unit tests, we use
`advance_ledger(env, cliff_duration)` to jump ahead."

---

### [06:30–07:30] Claim After Cliff

*Narrator:* "After the cliff passes, all tokens accrued since stream start are
released in one catch-up burst."

`[In a local test environment or after real time has passed on testnet]`

```bash
./scripts/invoke_claim.sh
# output: 172800  (or similar — all ledgers × rate since start)
```

"The full accrual including the cliff period arrived at once. Subsequent claims
will be smaller — only the tokens that dripped since the last claim."

`[Screenshot placeholder: claim output with token balance]`

---

### [07:30–08:30] Cancel a Stream (Sponsor Only)

*Narrator:* "The sponsor can cancel an active stream. Let's see what happens if
someone other than the sponsor tries."

```bash
# Third party attempt — this will fail at the auth layer
stellar contract invoke --id $VESTING_CONTRACT --source $THIRD_PARTY --network testnet \
  -- cancel_stream --sponsor $THIRD_PARTY --recipient $RECIPIENT
# Error: transaction auth failure
```

`[Show the auth error]`

"Now the real sponsor cancels."

```bash
stellar contract invoke --id $VESTING_CONTRACT --source default --network testnet \
  -- cancel_stream --sponsor $SPONSOR --recipient $RECIPIENT
```

"The recipient keeps any tokens they've already accrued. The sponsor gets the
unearned remainder back."

`[Screenshot placeholder: balances before and after cancel]`

---

### [08:30–09:30] Variable-Rate Streams

*Narrator:* "New in this release: variable-rate streams. Instead of a single rate,
you define segments where the rate changes at specific ledgers."

"Here's a simple two-segment stream: slow drip for the first year, faster for
the second."

```bash
CURRENT=$(stellar ledger --network testnet | jq '.sequence')
SEG1=$((CURRENT + 6307200))   # 1 year
SEG2=$((CURRENT + 12614400))  # 2 years

stellar contract invoke --id $VESTING_CONTRACT --source $SPONSOR --network testnet \
  -- create_variable_rate_stream \
  --sponsor $SPONSOR \
  --recipient $RECIPIENT2 \
  --token $TOKEN \
  --cliff_duration 6307200 \
  --segments "[[$SEG1, 5], [$SEG2, 20]]"
```

`[Screenshot placeholder: variable schedule output]`

"Claiming works the same way — call `claim_variable_vested`. The contract
automatically computes how many tokens accrued in each rate tier."

---

### [09:30–10:00] Summary

*Narrator:* "Let's recap what we covered:"

- ✅ Testnet setup and key generation
- ✅ Deploy and initialize (new required step — `initialize` with admin, fee, treasury)
- ✅ Create a fixed-rate cliff stream
- ✅ Pre-cliff claim rejection (error code 2)
- ✅ Claim after cliff — catch-up burst
- ✅ Cancel — sponsor-only, recipient keeps accrued tokens
- ✅ Variable-rate streams — up to 10 segments, changing rates over time

"The full source code, test suite, and documentation are at
https://github.com/AlienScroll78/vesting-cliff-drip-stream. Star the repo if
you found this useful, and open an issue if you have questions."

`[Show repository homepage]`

---

*End of script.*
