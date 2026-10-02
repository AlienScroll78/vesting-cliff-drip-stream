# VestingDrips Contract Event Schema

This document is the **canonical schema reference** for all events emitted by the
`VestingDrips` Soroban smart contract. Off-chain indexers (Horizon pollers, event
workers, webhooks) must use this document to decode event payloads reliably.

> **Indexer note:** When event fields change, this document must be updated in the
> same pull request. A CI workflow (`.github/workflows/events-doc-check.yml`)
> enforces this — any PR that modifies `src/events.rs` without also modifying
> `docs/events.md` will fail.

---

## Table of Contents

1. [How Soroban Events Work](#how-soroban-events-work)
2. [Primary Events](#primary-events)
   - [StreamCreated](#1-streamcreated)
   - [TokensClaimed](#2-tokensclaimed)
   - [StreamCancelled](#3-streamcancelled)
   - [StreamClawedBack](#4-streamclawedback)
   - [StreamDrained](#5-streamdrained)
3. [Lifecycle Events](#lifecycle-events)
   - [StreamCompleted](#6-streamcompleted)
   - [StreamTransferred](#7-streamtransferred)
   - [ContractInitialized](#8-contractinitialized)
4. [Variable-Rate Stream Events](#variable-rate-stream-events)
   - [VariableStreamCreated](#9-variablestreamcreated)
   - [VariableTokensClaimed](#10-variabletokensclaimed)
5. [Multi-Token Stream Events](#multi-token-stream-events)
   - [MultiStreamCreated](#11-multistreamcreated)
   - [MultiTokensClaimed](#12-multitokensclaimed)
   - [MultiStreamCompleted](#13-multistreamcompleted)
   - [MultiStreamCancelled](#14-multistreamcancelled)
6. [Event Versioning](#event-versioning)
7. [CI Enforcement](#ci-enforcement)

---

## How Soroban Events Work

Soroban events are structured as:

```json
{
  "topics": [ "topic_0", "topic_1", "..." ],
  "data":   "<single XDR SCVal>"
}
```

- **Topic 0** is always a `Symbol` (the event discriminator). Indexers filter by this value.
- **Topic 1–3** are typically `Address` values (recipient, sponsor, etc.) for indexed lookup.
- **Data** contains the event payload encoded as an XDR `SCVal`. Struct types are encoded
  as a `Vec<SCVal>` in field-declaration order.

All addresses are Stellar `Address` XDR (Ed25519 public key or contract ID).
All token amounts are `i128` (`Int128Parts` XDR).
All ledger sequences are `u32` (`Uint32` XDR).

To decode from Horizon's `/events` endpoint, base64-decode each topic and the data
field and parse as XDR `SCVal`.

---

## Primary Events

### 1. StreamCreated

Emitted by `create_vesting_stream` when a new flat-rate vesting stream is created.

**Topic discriminator:** `"StreamCreated"` (full-length Symbol)

| Position | Field | XDR Type | Description |
|----------|-------|----------|-------------|
| topics[0] | `discriminator` | `Symbol` | `"StreamCreated"` |
| topics[1] | `sponsor` | `Address` | Address that funded the stream |
| topics[2] | `recipient` | `Address` | Beneficiary address |

**Data payload** — `StreamCreatedData` struct (`Vec<SCVal>` in field order):

| Index | Field | XDR Type | Description |
|-------|-------|----------|-------------|
| 0 | `token` | `Address` | SAC token contract address |
| 1 | `rate` | `Int128Parts` | Tokens released per ledger |
| 2 | `start_ledger` | `Uint32` | Ledger when stream starts |
| 3 | `cliff_ledger` | `Uint32` | Ledger at which cliff is reached |
| 4 | `end_ledger` | `Uint32` | Ledger at which stream ends |
| 5 | `total_deposit` | `Int128Parts` | `rate × (end_ledger − start_ledger)` |

**Example JSON payload:**

```json
{
  "type": "contract",
  "id": "<CONTRACT_ID>",
  "topic": [
    { "type": "symbol",  "value": "StreamCreated" },
    { "type": "address", "value": "GSPONSOR..." },
    { "type": "address", "value": "GRECIPIENT..." }
  ],
  "value": {
    "token":         { "type": "address", "value": "CTOKEN..." },
    "rate":          { "type": "i128",    "value": "10" },
    "start_ledger":  { "type": "u32",     "value": 100 },
    "cliff_ledger":  { "type": "u32",     "value": 150 },
    "end_ledger":    { "type": "u32",     "value": 300 },
    "total_deposit": { "type": "i128",    "value": "2000" }
  }
}
```

**Indexer notes:**
- Use `sponsor` and `recipient` topics for indexed lookups without decoding data.
- `total_deposit = rate × (end_ledger − start_ledger)` can be recomputed off-chain.
- The optional `metadata` field is stored in the schedule but **not** emitted in
  this event (to stay within the 4-topic limit). Fetch it via `get_schedule` if needed.

---

### 2. TokensClaimed

Emitted by `claim_vested` when a recipient successfully claims vested tokens.

**Topic discriminator:** `"vc_claim"` (short Symbol, ≤ 8 chars)

| Position | Field | XDR Type | Description |
|----------|-------|----------|-------------|
| topics[0] | `discriminator` | `Symbol` | `"vc_claim"` |
| topics[1] | `recipient` | `Address` | Claiming address |

**Data payload** — tuple `(amount, ledger_claimed_through)`:

| Index | Field | XDR Type | Description |
|-------|-------|----------|-------------|
| 0 | `amount` | `Int128Parts` | Tokens transferred to recipient |
| 1 | `ledger_claimed_through` | `Uint32` | Last ledger included in this claim window |

**Example JSON payload:**

```json
{
  "topic": [
    { "type": "symbol",  "value": "vc_claim" },
    { "type": "address", "value": "GRECIPIENT..." }
  ],
  "value": {
    "amount":                 { "type": "i128", "value": "500" },
    "ledger_claimed_through": { "type": "u32",  "value": 150 }
  }
}
```

**Indexer notes:**
- `ledger_claimed_through` marks the end of this claim window. The next claim
  starts from `ledger_claimed_through + 1`.
- Amount is always positive (`NothingToClaim` error prevents zero-amount events).

---

### 3. StreamCancelled

Emitted by `cancel_stream` when a sponsor cancels a stream.

**Topic discriminator:** `"vc_cancel"`

| Position | Field | XDR Type | Description |
|----------|-------|----------|-------------|
| topics[0] | `discriminator` | `Symbol` | `"vc_cancel"` |
| topics[1] | `recipient` | `Address` | Stream recipient |

**Data payload** — single `i128` value:

| Field | XDR Type | Description |
|-------|----------|-------------|
| `refunded_amount` | `Int128Parts` | Tokens returned to the sponsor |

**Example JSON payload:**

```json
{
  "topic": [
    { "type": "symbol",  "value": "vc_cancel" },
    { "type": "address", "value": "GRECIPIENT..." }
  ],
  "value": { "type": "i128", "value": "2000" }
}
```

**Indexer notes:**
- Pre-cliff cancellation: `refunded_amount` = full deposit.
- Post-cliff cancellation: `refunded_amount` = remaining (unclaimed) tokens; the
  recipient received accrued tokens via a separate token transfer before this event.
- The `sponsor` address is not in this event's topics. Retrieve it from the
  corresponding `StreamCreated` event.

---

### 4. StreamClawedBack

Emitted by `clawback_stream` when a sponsor performs a compliance clawback.

**Topic discriminator:** `"vc_claw"`

| Position | Field | XDR Type | Description |
|----------|-------|----------|-------------|
| topics[0] | `discriminator` | `Symbol` | `"vc_claw"` |
| topics[1] | `recipient` | `Address` | Stream recipient |

**Data payload** — tuple `(sponsor, token, amount, reason)`:

| Index | Field | XDR Type | Description |
|-------|-------|----------|-------------|
| 0 | `sponsor` | `Address` | Original sponsor (receives tokens) |
| 1 | `token` | `Address` | SAC token address |
| 2 | `amount` | `Int128Parts` | Tokens returned to sponsor |
| 3 | `reason` | `String` | Compliance reason string (max 256 UTF-8 bytes) |

**Example JSON payload:**

```json
{
  "topic": [
    { "type": "symbol",  "value": "vc_claw" },
    { "type": "address", "value": "GRECIPIENT..." }
  ],
  "value": {
    "sponsor": { "type": "address", "value": "GSPONSOR..." },
    "token":   { "type": "address", "value": "CTOKEN..." },
    "amount":  { "type": "i128",    "value": "1500" },
    "reason":  { "type": "string",  "value": "Regulatory compliance — OFAC sanction" }
  }
}
```

**Indexer notes:**
- Only emitted on tokens with `AUTH_CLAWBACK_ENABLED_FLAG`. Regular cancellation
  uses `StreamCancelled`.
- `reason` is stored on-chain in the event — max 256 bytes enforced by contract error
  `ReasonTooLong` (code 22).
- Clawback bypasses cliff state; it recovers **all** remaining vault tokens regardless
  of how much has vested.

---

### 5. StreamDrained

Emitted by `drain_expired_stream` when an expired stream is permissionlessly cleaned up.

**Topic discriminator:** `"vc_drain"`

| Position | Field | XDR Type | Description |
|----------|-------|----------|-------------|
| topics[0] | `discriminator` | `Symbol` | `"vc_drain"` |
| topics[1] | `recipient` | `Address` | Drained stream's recipient |

**Data payload** — tuple `(caller, sponsor, token, amount)`:

| Index | Field | XDR Type | Description |
|-------|-------|----------|-------------|
| 0 | `caller` | `Address` | Address that triggered the drain (any address) |
| 1 | `sponsor` | `Address` | Original sponsor (receives tokens) |
| 2 | `token` | `Address` | SAC token address |
| 3 | `amount` | `Int128Parts` | Tokens transferred to sponsor |

**Example JSON payload:**

```json
{
  "topic": [
    { "type": "symbol",  "value": "vc_drain" },
    { "type": "address", "value": "GRECIPIENT..." }
  ],
  "value": {
    "caller":  { "type": "address", "value": "GCALLER..." },
    "sponsor": { "type": "address", "value": "GSPONSOR..." },
    "token":   { "type": "address", "value": "CTOKEN..." },
    "amount":  { "type": "i128",    "value": "2000" }
  }
}
```

**Indexer notes:**
- `caller` is informational only — it is **not** the recipient of tokens.
- Available only after `end_ledger + DRAIN_DELAY_LEDGERS` (~1 year at 5 s/ledger).
- Tokens always go to `sponsor`, regardless of who calls.
- No authentication required (`drain_expired_stream` is permissionless).

---

## Lifecycle Events

### 6. StreamCompleted

Emitted when a stream is fully vested and auto-cleaned up after the final claim.

**Topic discriminator:** `"vc_done"`

| Position | Field | XDR Type | Description |
|----------|-------|----------|-------------|
| topics[0] | `discriminator` | `Symbol` | `"vc_done"` |
| topics[1] | `recipient` | `Address` | Stream's recipient |

**Data payload** — single `Address`:

| Field | XDR Type | Description |
|-------|----------|-------------|
| `token` | `Address` | The SAC token address |

**Example JSON payload:**

```json
{
  "topic": [
    { "type": "symbol",  "value": "vc_done" },
    { "type": "address", "value": "GRECIPIENT..." }
  ],
  "value": { "type": "address", "value": "CTOKEN..." }
}
```

---

### 7. StreamTransferred

Emitted when a stream's recipient address is transferred to a new address.

**Topic discriminator:** `"StreamTransferred"` (full Symbol)

| Position | Field | XDR Type | Description |
|----------|-------|----------|-------------|
| topics[0] | `discriminator` | `Symbol` | `"StreamTransferred"` |
| topics[1] | `current_recipient` | `Address` | The previous recipient address |

**Data payload** — single `Address`:

| Field | XDR Type | Description |
|-------|----------|-------------|
| `new_recipient` | `Address` | The new recipient address |

---

### 8. ContractInitialized

Emitted once when `initialize` is called to configure the contract.

**Topic discriminator:** `"ContractInit"` (full Symbol)

| Position | Field | XDR Type | Description |
|----------|-------|----------|-------------|
| topics[0] | `discriminator` | `Symbol` | `"ContractInit"` |
| topics[1] | `admin` | `Address` | The admin address |

**Data payload** — tuple `(fee_bps, treasury)`:

| Index | Field | XDR Type | Description |
|-------|-------|----------|-------------|
| 0 | `fee_bps` | `Uint32` | Protocol fee in basis points (0–500) |
| 1 | `treasury` | `Address` | Fee recipient address |

---

## Variable-Rate Stream Events

### 9. VariableStreamCreated

Emitted by `create_variable_rate_stream` when a variable-rate stream is created.

**Topic discriminator:** `"vc_vrcre"` (short Symbol)

| Position | Field | XDR Type | Description |
|----------|-------|----------|-------------|
| topics[0] | `discriminator` | `Symbol` | `"vc_vrcre"` |
| topics[1] | `recipient` | `Address` | Beneficiary |

**Data payload** — tuple `(sponsor, token, start_ledger, cliff_ledger, end_ledger, total_deposited)`:

| Index | Field | XDR Type | Description |
|-------|-------|----------|-------------|
| 0 | `sponsor` | `Address` | Funder |
| 1 | `token` | `Address` | SAC token |
| 2 | `start_ledger` | `Uint32` | Stream start |
| 3 | `cliff_ledger` | `Uint32` | Cliff ledger |
| 4 | `end_ledger` | `Uint32` | Stream end |
| 5 | `total_deposited` | `Int128Parts` | Total tokens deposited across all segments |

---

### 10. VariableTokensClaimed

Emitted when a recipient claims from a variable-rate stream.

**Topic discriminator:** `"vc_vrclam"` (short Symbol)

| Position | Field | XDR Type | Description |
|----------|-------|----------|-------------|
| topics[0] | `discriminator` | `Symbol` | `"vc_vrclam"` |
| topics[1] | `recipient` | `Address` | Claimant |

**Data payload** — tuple `(amount, ledger_claimed_through)`:

| Index | Field | XDR Type | Description |
|-------|-------|----------|-------------|
| 0 | `amount` | `Int128Parts` | Tokens transferred |
| 1 | `ledger_claimed_through` | `Uint32` | Claim window end ledger |

---

## Multi-Token Stream Events

### 11. MultiStreamCreated

Emitted when a multi-token vesting stream is created.

**Topic discriminator:** `"vmt_crt"` (short Symbol)

| Position | Field | XDR Type | Description |
|----------|-------|----------|-------------|
| topics[0] | `discriminator` | `Symbol` | `"vmt_crt"` |
| topics[1] | `recipient` | `Address` | Beneficiary |

**Data payload** — tuple `(sponsor, allocations, start_ledger, cliff_ledger, end_ledger)`:

| Index | Field | XDR Type | Description |
|-------|-------|----------|-------------|
| 0 | `sponsor` | `Address` | Funder |
| 1 | `allocations` | `Vec<TokenAllocation>` | Per-token rate allocations |
| 2 | `start_ledger` | `Uint32` | Stream start |
| 3 | `cliff_ledger` | `Uint32` | Cliff ledger |
| 4 | `end_ledger` | `Uint32` | Stream end |

---

### 12. MultiTokensClaimed

Emitted when a recipient claims from a multi-token stream.

**Topic discriminator:** `"vmt_clm"` (short Symbol)

| Position | Field | XDR Type | Description |
|----------|-------|----------|-------------|
| topics[0] | `discriminator` | `Symbol` | `"vmt_clm"` |
| topics[1] | `recipient` | `Address` | Claimant |

**Data payload** — single `Uint32`:

| Field | XDR Type | Description |
|-------|----------|-------------|
| `ledger_claimed_through` | `Uint32` | Claim window end ledger |

**Indexer notes:** Per-token amounts are not emitted. Reconstruct off-chain from the
stored `allocations` and the ledger range `[last_claimed + 1, ledger_claimed_through]`.

---

### 13. MultiStreamCompleted

Emitted when a multi-token stream is fully exhausted.

**Topic discriminator:** `"vmt_don"` (short Symbol)

| Position | Field | XDR Type | Description |
|----------|-------|----------|-------------|
| topics[0] | `discriminator` | `Symbol` | `"vmt_don"` |
| topics[1] | `recipient` | `Address` | Stream's recipient |

**Data payload:** Empty tuple `()`.

---

### 14. MultiStreamCancelled

Emitted when a sponsor cancels a multi-token stream.

**Topic discriminator:** `"vmt_cnl"` (short Symbol)

| Position | Field | XDR Type | Description |
|----------|-------|----------|-------------|
| topics[0] | `discriminator` | `Symbol` | `"vmt_cnl"` |
| topics[1] | `recipient` | `Address` | Stream's recipient |

**Data payload** — single `Address`:

| Field | XDR Type | Description |
|-------|----------|-------------|
| `sponsor` | `Address` | The original sponsor |

---

## Event Versioning

Events are versioned implicitly by the contract upgrade mechanism. When a field is
added, removed, or reordered:

1. Bump the contract version in `src/contract.rs`.
2. Update this document in the **same PR** as the `src/events.rs` change.
3. Add a row to the changelog table below.

### Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0.0 | 2026-10-02 | Initial schema documentation for all 14 events |

---

## CI Enforcement

A GitHub Actions workflow (`.github/workflows/events-doc-check.yml`) runs on every
pull request that touches `src/events.rs`. If `docs/events.md` is not also changed
in the same PR, the workflow fails with:

```
ERROR: src/events.rs was modified but docs/events.md was not updated.
Please update docs/events.md when changing event definitions.
```

This prevents silent schema drift between the on-chain event implementation and the
indexer reference. See [docs/architecture.md](architecture.md) for the broader
backend indexer design.
