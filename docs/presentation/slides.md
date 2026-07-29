# Vesting Cliff Drip Stream — Slide Deck
### A Soroban Smart Contract for Long-Term Contributor Retention

---

## Slide 1 — Title

**Vesting Cliff Drip Stream**
_Token vesting with cliff + linear streaming on Stellar Soroban_

> Follow along: https://github.com/AlienScroll78/vesting-cliff-drip-stream

---

## Slide 2 — The Problem

Traditional token grants have two failure modes:

- **Immediate unlock** — contributor leaves on day 1 with all tokens
- **Single cliff** — cliff hits, recipient gets everything, then disappears

We need: a lock-up period **plus** gradual release to keep contributors aligned.

---

## Slide 3 — The Solution

**Cliff + Linear Drip**

```
Ledger:  start_ledger     cliff_ledger              end_ledger
              │                │                         │
Tokens:  [   locked   ]  ← catch-up burst →  [ drip per ledger ──── ]
```

1. Sponsor deposits the **full allocation** upfront
2. Nothing is claimable before `cliff_ledger`
3. At the cliff, all accrued tokens release in one burst
4. Remaining tokens drip linearly until `end_ledger`

---

## Slide 4 — Tech Stack

| Layer | Technology |
|---|---|
| Smart Contract | Rust + Soroban SDK |
| Token Standard | Stellar Asset Contract (SAC) |
| Network | Stellar Testnet / Mainnet |
| CLI | Stellar CLI (`stellar`) |
| Build | Cargo + `wasm32-unknown-unknown` |

---

## Slide 5 — Contract Architecture

```
src/
├── contract.rs   ← public entry-points
├── types.rs      ← VestingSchedule struct
├── error.rs      ← VestingError enum
├── events.rs     ← on-chain event emitters
└── storage.rs    ← persistent storage helpers
```

Single contract, no admin key, no proxy — straightforward and auditable.

---

## Slide 6 — VestingSchedule Type

```rust
pub struct VestingSchedule {
    token:               Address,  // SAC token
    rate_per_ledger:     i128,     // tokens/ledger
    start_ledger:        u32,
    cliff_ledger:        u32,
    end_ledger:          u32,
    last_claimed_ledger: u32,      // claim cursor
}
```

One schedule per recipient, keyed by their address.

---

## Slide 7 — Flow 1: Create Stream

**Entry-point:** `create_vesting_stream`

```rust
create_vesting_stream(
    env, sponsor, recipient, token,
    rate,            // e.g. 10 tokens/ledger
    cliff_duration,  // e.g. 17280 ledgers ≈ 1 day
    total_duration,  // e.g. 172800 ledgers ≈ 10 days
)
```

Steps:
1. Validate rate > 0 and total_duration > cliff_duration
2. `sponsor.require_auth()` — must sign
3. Transfer `rate × total_duration` tokens into contract vault
4. Persist `VestingSchedule` to storage
5. Emit `vc_create` event

---

## Slide 8 — Flow 2: Claim Vested Tokens

**Entry-point:** `claim_vested`

```rust
claim_vested(env, recipient)  // returns i128 amount transferred
```

Steps:
1. `recipient.require_auth()`
2. Reject with `CliffNotReached` if `current_ledger < cliff_ledger`
3. Compute `(current_ledger.min(end_ledger) - last_claimed_ledger) × rate`
4. Update `last_claimed_ledger`; remove schedule if stream is finished
5. Transfer tokens; emit `vc_claim` event

**First claim** = instant catch-up from `start_ledger` to now.

---

## Slide 9 — Flow 3: Cancel Stream

**Entry-point:** `cancel_stream`

```rust
cancel_stream(env, sponsor, recipient)
```

Two outcomes:

| Condition | Recipient gets | Sponsor gets |
|---|---|---|
| Cliff **not** passed | 0 | Full deposit |
| Cliff **passed** | Accrued since last claim | Unearned remainder |

Auth: `sponsor.require_auth()` — only the original funder can cancel.

---

## Slide 10 — View Functions

| Function | Returns | Notes |
|---|---|---|
| `get_schedule(recipient)` | `Option<VestingSchedule>` | Full struct |
| `claimable_amount(recipient)` | `i128` | 0 before cliff |
| `is_cliff_passed(recipient)` | `bool` | Safe check |

These are read-only (no auth, no ledger changes).

---

## Slide 11 — Error Codes

| Code | Name | When |
|---|---|---|
| 1 | `ScheduleNotFound` | No active stream |
| 2 | `CliffNotReached` | Too early to claim |
| 3 | `InvalidDuration` | total ≤ cliff |
| 4 | `InvalidRate` | rate ≤ 0 |
| 5 | `DepositOverflow` | Arithmetic overflow |
| 6 | `ScheduleAlreadyExists` | Duplicate stream |
| 7 | `NothingToClaim` | Zero claimable |

---

## Slide 12 — Security Highlights

- **No admin backdoor** — only sponsor can cancel their own stream
- **Overflow-safe arithmetic** — all maths uses `checked_*` operations
- **Duplicate prevention** — `ScheduleAlreadyExists` blocks re-entrancy via create
- **TTL management** — storage entries are bumped on every access (~60-day window)
- **Auth on every mutation** — `require_auth()` on sponsor, recipient, and cancel caller

---

## Slide 13 — Live Demo Outline

1. Generate testnet key: `stellar keys generate default --network testnet --fund`
2. Deploy: `./scripts/deploy.sh default`
3. Create stream: `./scripts/invoke_create.sh`
4. Check `claimable_amount` before cliff → `0`
5. Advance ledgers (testnet auto-advances)
6. Claim: `./scripts/invoke_claim.sh`
7. Check `get_schedule` → updated `last_claimed_ledger`
8. Cancel: `stellar contract invoke ... -- cancel_stream ...`

---

## Slide 14 — Quick-Start Commands

```bash
# 1. Build
make build

# 2. Test
make test

# 3. Deploy to testnet
stellar keys generate default --network testnet --fund
./scripts/deploy.sh default

# 4. Create a stream
export VESTING_CONTRACT=<contract-id>
export RATE=10
export CLIFF_DURATION=17280   # ~1 day
export TOTAL_DURATION=172800  # ~10 days
./scripts/invoke_create.sh

# 5. Claim
./scripts/invoke_claim.sh
```

---

## Slide 15 — Recap

| Feature | Detail |
|---|---|
| Cliff period | Enforced on-chain; no early claims |
| Catch-up burst | All accrued tokens released at cliff |
| Linear drip | Tokens vest per ledger after cliff |
| Sponsor cancel | Safe refund with pro-rata split |
| Audit-friendly | No admin, open source, MIT license |

**Repository:** https://github.com/AlienScroll78/vesting-cliff-drip-stream

---

## Slide 16 — Questions?

Resources:
- Soroban Docs: https://developers.stellar.org/docs/build/smart-contracts
- Stellar CLI: https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli
- This repo: https://github.com/AlienScroll78/vesting-cliff-drip-stream

_MIT License — fork, extend, and build on it._
