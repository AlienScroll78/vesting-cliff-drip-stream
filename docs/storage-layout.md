# Storage Layout

This document is the authoritative reference for every storage key used by the
VestingDrips contract. It is intended for auditors, upgraders, and developers
writing migration code.

> **CI enforcement** — A GitHub Actions workflow
> (`.github/workflows/storage-layout-check.yml`) fails the build if
> `src/types.rs` is modified without a corresponding update to this file.
> See the [CI check section](#ci-check) for details.

---

## Table of Contents

1. [Storage Tiers](#storage-tiers)
2. [TTL Constants](#ttl-constants)
3. [DataKey Variant Reference](#datakey-variant-reference)
4. [XDR Key Encoding](#xdr-key-encoding)
5. [Function-to-Key Matrix](#function-to-key-matrix)
6. [CI Check](#ci-check)

---

## Storage Tiers

Soroban exposes two storage tiers relevant to this contract:

| Tier | Soroban API | Semantics |
|------|-------------|-----------|
| **Instance** | `env.storage().instance()` | Shared with the contract instance. All instance keys share a single TTL that is bumped together. Used for configuration that must always be available. |
| **Persistent** | `env.storage().persistent()` | Independent entry per key. Each entry has its own TTL, allowing fine-grained expiry control. Used for per-recipient stream state. |

There is no `Temporary` storage in this contract.

---

## TTL Constants

Defined in `src/storage.rs`:

| Constant | Value (ledgers) | Approximate wall-clock | Purpose |
|----------|-----------------|------------------------|---------|
| `PERSISTENT_LEDGER_THRESHOLD` | 3,000,000 | ~174 days | Trigger threshold: extend TTL when remaining TTL falls below this value. |
| `PERSISTENT_BUMP_AMOUNT` | 3,110,400 | ~180 days / ~6 months | Standard bump target: the TTL is extended to this value above the current ledger. This is also the Soroban-enforced maximum persistent TTL. |
| `TTL_BUFFER_LEDGERS` | 6,307,200 | ~365 days / ~1 year | Proactive buffer added beyond `end_ledger` when computing stream TTL at creation time (Issue #585). Capped to `PERSISTENT_BUMP_AMOUNT`. |

### TTL Strategy by Key Type

**Instance keys** (`Admin`, `MinDeposit`, `FeeBps`, `Treasury`, `ConfigMaxCliffRatio`,
`ConfigMinRate`, `Initialized`, `Lock`, `AllowedTokens`):

- Bumped via `bump_instance()` on every state-mutating call.
- TTL is shared; bumping any instance key bumps all of them.
- Threshold: `PERSISTENT_LEDGER_THRESHOLD`; target: `PERSISTENT_BUMP_AMOUNT`.

**Persistent schedule keys** (`Schedule(Address)`, `VariableSchedule(Address)`,
`MilestoneSchedule(Address)`):

- At **creation** (`set_schedule`, `set_variable_schedule`, `set_milestone_schedule`):
  TTL is set proactively to `end_ledger + TTL_BUFFER_LEDGERS` (capped at
  `PERSISTENT_BUMP_AMOUNT`). This ensures the entry survives the full stream
  lifetime without relying solely on passive bump-on-access.
- On every **read or write** (`get_schedule`, `set_schedule`, etc.): TTL is
  re-extended via `ensure_ttl_for_stream` / `bump_persistent`.
- At **removal** (`remove_schedule`, etc.): the entry is deleted and rent is
  reclaimed automatically.

---

## DataKey Variant Reference

The `DataKey` enum is defined in `src/types.rs`. Every variant listed below
corresponds to exactly one entry in contract storage.

### `Schedule(Address)`

| Attribute | Value |
|-----------|-------|
| **Rust type** | `VestingSchedule` |
| **Storage tier** | Persistent |
| **Cardinality** | One entry per recipient `Address` |
| **TTL strategy** | Proactive: `end_ledger + TTL_BUFFER_LEDGERS` at creation; bumped on every access |
| **Lifecycle** | Created by `create_vesting_stream`; removed by `cancel_stream`, `clawback_stream`, `drain_expired_stream`, or on final `claim_vested` (auto-cleanup) |

Stores all state for a fixed-rate vesting stream. Key fields:

```rust
pub struct VestingSchedule {
    pub token: Address,
    pub sponsor: Address,
    pub rate_per_ledger: i128,
    pub start_ledger: u32,
    pub cliff_ledger: u32,
    pub end_ledger: u32,
    pub last_claimed_ledger: u32,
    pub total_claimed: i128,
    pub claimed_amount: i128,
    pub metadata: Option<String>,
    pub paused_at_ledger: Option<u32>,
    pub accumulated_pause_ledgers: u32,
    pub version: u32,
}
```

The `version` field is incremented on every successful `claim_vested` call to
provide a monotonic mutation counter for off-chain indexers.

---

### `VariableSchedule(Address)`

| Attribute | Value |
|-----------|-------|
| **Rust type** | `VariableRateSchedule` |
| **Storage tier** | Persistent |
| **Cardinality** | One entry per recipient `Address` |
| **TTL strategy** | Standard: bumped via `bump_persistent` on every access |
| **Lifecycle** | Created by `create_variable_stream`; removed by `claim_variable_vested` (auto-cleanup) or on cancellation |

Stores all state for a variable-rate (multi-segment) vesting stream:

```rust
pub struct VariableRateSchedule {
    pub token: Address,
    pub sponsor: Address,
    pub start_ledger: u32,
    pub cliff_ledger: u32,
    pub end_ledger: u32,
    pub last_claimed_ledger: u32,
    pub total_deposited: i128,
    pub claimed_amount: i128,
    pub total_claimed: i128,
    pub segments: Vec<RateSegment>,
    pub paused_at_ledger: Option<u32>,
}
```

Each `RateSegment` contains `{ end_ledger: u32, rate: i128 }`. Up to 10 segments
are allowed (`MAX_SEGMENTS = 10`).

---

### `MilestoneSchedule(Address)`

| Attribute | Value |
|-----------|-------|
| **Rust type** | `MilestoneSchedule` |
| **Storage tier** | Persistent |
| **Cardinality** | One entry per recipient `Address` |
| **TTL strategy** | Standard: bumped via `bump_persistent` on every access |
| **Lifecycle** | Created by `create_variable_vesting_stream`; removed by `claim_milestone` (auto-cleanup) |

Stores all state for a milestone-based vesting stream:

```rust
pub struct MilestoneSchedule {
    pub token: Address,
    pub sponsor: Address,
    pub total_deposited: i128,
    pub milestones: Vec<Milestone>,
    pub next_milestone_idx: u32,
    pub drip_start_ledger: u32,
    pub drip_rate_per_ledger: i128,
    pub end_ledger: u32,
    pub total_claimed: i128,
    pub claimed_amount: i128,
    pub paused_at_ledger: Option<u32>,
}
```

Each `Milestone` contains `{ ledger: u32, bps_unlock: u32 }`. Up to 20 milestones
are allowed (`MAX_MILESTONES = 20`). All `bps_unlock` values must sum to 10,000.

---

### `MinDeposit`

| Attribute | Value |
|-----------|-------|
| **Rust type** | `i128` |
| **Storage tier** | Instance |
| **Cardinality** | Singleton |
| **TTL strategy** | Standard instance bump |
| **Default** | `100` (see `DEFAULT_MIN_DEPOSIT` in `storage.rs`) |
| **Lifecycle** | Set by `initialize` (optional) or `set_min_deposit`; never removed |

The minimum total deposit (in token base units) required when creating any
stream. `create_vesting_stream` validates `rate × total_duration ≥ min_deposit`.

---

### `Admin`

| Attribute | Value |
|-----------|-------|
| **Rust type** | `Address` |
| **Storage tier** | Instance |
| **Cardinality** | Singleton |
| **TTL strategy** | Standard instance bump |
| **Lifecycle** | Set by `initialize`; updated by `transfer_admin`; never removed |

The contract administrator address. Admin is required to call `set_min_deposit`,
`set_fee`, `set_config`, `upgrade`, and `transfer_admin`.

---

### `FeeBps`

| Attribute | Value |
|-----------|-------|
| **Rust type** | `u32` |
| **Storage tier** | Instance |
| **Cardinality** | Singleton |
| **TTL strategy** | Standard instance bump |
| **Valid range** | `0`–`500` (0–5%) |
| **Lifecycle** | Set by `initialize`; updated by `set_fee`; never removed |

Protocol fee in basis points deducted from each new stream deposit and
forwarded to `Treasury`. A value of `0` disables fee collection.

---

### `Treasury`

| Attribute | Value |
|-----------|-------|
| **Rust type** | `Address` |
| **Storage tier** | Instance |
| **Cardinality** | Singleton |
| **TTL strategy** | Standard instance bump |
| **Lifecycle** | Set by `initialize`; updated by `set_fee`; never removed |

The address that receives protocol fees. Only meaningful when `FeeBps > 0`.

---

### `ConfigMaxCliffRatio`

| Attribute | Value |
|-----------|-------|
| **Rust type** | `u32` |
| **Storage tier** | Instance |
| **Cardinality** | Singleton |
| **TTL strategy** | Standard instance bump |
| **Default** | `5000` (50% of total duration) |
| **Valid range** | `0`–`10000` |
| **Lifecycle** | Set by `set_config("max_cliff_ratio", …)`; read by `get_config`; never removed |

Maximum cliff duration as a proportion of total stream duration, expressed in
basis points. `create_vesting_stream` rejects streams where
`(cliff_duration / total_duration) × 10000 > ConfigMaxCliffRatio`.

---

### `ConfigMinRate`

| Attribute | Value |
|-----------|-------|
| **Rust type** | `i128` |
| **Storage tier** | Instance |
| **Cardinality** | Singleton |
| **TTL strategy** | Standard instance bump |
| **Default** | `1` |
| **Valid range** | `≥ 1` |
| **Lifecycle** | Set by `set_config("min_rate", …)`; read by `get_config`; never removed |

Minimum `rate_per_ledger` accepted by `create_vesting_stream`. Ensures streams
cannot be created with a near-zero drip rate that would never accumulate
meaningful value.

---

### `Initialized` *(instance, implicit)*

| Attribute | Value |
|-----------|-------|
| **Rust type** | `bool` (`true`) |
| **Storage tier** | Instance |
| **Cardinality** | Singleton |
| **TTL strategy** | Standard instance bump |
| **Lifecycle** | Written once by `initialize`; never updated or removed |

Sentinel key that prevents `initialize` from being called more than once. The
presence of this key (checked with `.has()`) is the initialization guard.

> **Note:** `Initialized` is used as a `DataKey` variant in `storage.rs` but
> does not appear in the `DataKey` enum in `src/types.rs`. It is treated as an
> implicit instance-storage sentinel.

---

### `Lock` *(instance, transient)*

| Attribute | Value |
|-----------|-------|
| **Rust type** | `bool` (`true`) |
| **Storage tier** | Instance |
| **Cardinality** | Singleton |
| **TTL strategy** | N/A – removed immediately after use |
| **Lifecycle** | Set by `acquire_lock` before token transfers; removed by `release_lock` after |

Reentrancy guard (Issue #13). Set immediately before any outbound
`token::Client::try_transfer` call and cleared immediately after. Because
Soroban reverts all storage changes on panic, the lock cannot become
permanently stuck even on an unexpected abort.

---

### `AllowedTokens` *(instance)*

| Attribute | Value |
|-----------|-------|
| **Rust type** | `Vec<Address>` |
| **Storage tier** | Instance |
| **Cardinality** | Singleton |
| **TTL strategy** | Standard instance bump |
| **Default** | Empty `Vec` (permissive mode — all tokens accepted) |
| **Lifecycle** | Updated by `add_allowed_token` / `remove_allowed_token`; never explicitly removed |

Allowlist of SAC token contract addresses. When non-empty, `create_vesting_stream`
rejects any `token` argument not present in this list. An empty list enables
permissive mode.

---

## XDR Key Encoding

Soroban encodes `contracttype` enum variants as XDR `SCVal` discriminants. The
discriminant is the zero-based index of the variant in the enum declaration.

> **How to derive the hex prefix:** `stellar contract invoke … --print-footprint`
> or `stellar xdr encode` with the `SCVal` type will show the exact serialised
> bytes. The table below lists the discriminant index; prepend the standard XDR
> `SCVal::LedgerKeyContractData` envelope for the full footprint key.

| Variant | Enum index | Notes |
|---------|-----------|-------|
| `Schedule(Address)` | 0 | Parameterised with recipient `Address` |
| `VariableSchedule(Address)` | 1 | Parameterised with recipient `Address` |
| `MilestoneSchedule(Address)` | 2 | Parameterised with recipient `Address` |
| `MinDeposit` | 3 | Unit variant |
| `Admin` | 4 | Unit variant |
| `FeeBps` | 5 | Unit variant |
| `Treasury` | 6 | Unit variant |
| `ConfigMaxCliffRatio` | 7 | Unit variant |
| `ConfigMinRate` | 8 | Unit variant |

Variants used as keys that are **not** part of the `DataKey` enum (they rely
on implicit string-keyed instance storage) — `Initialized`, `Lock`,
`AllowedTokens` — are encoded using their Rust symbol names as `SCSymbol`
values in instance storage.

---

## Function-to-Key Matrix

The table below maps each public contract function to the storage keys it reads
(`R`) or writes / removes (`W`).

| Function | `Schedule` | `VariableSchedule` | `MilestoneSchedule` | `Admin` | `MinDeposit` | `FeeBps` | `Treasury` | `ConfigMaxCliffRatio` | `ConfigMinRate` | `Initialized` | `Lock` | `AllowedTokens` |
|----------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `initialize` | | | | W | | W | W | | | W | | |
| `upgrade` | | | | R | | | | | | | | |
| `transfer_admin` | | | | R/W | | | | | | | | |
| `add_allowed_token` | | | | R | | | | | | | | W |
| `remove_allowed_token` | | | | R | | | | | | | | W |
| `get_allowed_tokens` | | | | | | | | | | | | R |
| `create_vesting_stream` | W | | | | R | R | R | R | R | R | | R |
| `create_variable_stream` | | W | | | R | | | | | R | | |
| `create_variable_vesting_stream` | | | W | | R | | | | | R | | |
| `claim_vested` | R/W | | | | | | | | | | W | |
| `claim_variable_vested` | | R/W | | | | | | | | | W | |
| `claim_milestone` | | | R/W | | | | | | | | | |
| `cancel_stream` | R/W | | | | | | | | | | W | |
| `clawback_stream` | R/W | | | | | | | | | | | |
| `drain_expired_stream` | R/W | | | | | | | | | | | |
| `pause_stream` | R/W | | | | | | | | | | | |
| `resume_stream` | R/W | | | | | | | | | | | |
| `transfer_recipient` | R/W | | | | | | | | | | | |
| `migrate_schedule` | R/W | | | R | | | | | | | | |
| `set_fee` | | | | R | | W | W | | | | | |
| `set_min_deposit` | | | | R | W | | | | | | | |
| `set_config` | | | | R | | | | W | W | | | |
| `get_config` | | | | | | | | R | R | | | |
| `get_schedule` | R | | | | | | | | | | | |
| `get_variable_schedule` | | R | | | | | | | | | | |
| `claimable_amount` | R | | | | | | | | | | | |
| `claimable_variable_amount` | | R | | | | | | | | | | |
| `is_cliff_passed` | R | | | | | | | | | | | |
| `get_status` / `stream_status` | R | | | | | | | | | | | |
| `get_stats` | R | | | | | | | | | | | |
| `get_min_deposit` | | | | | R | | | | | | | |
| `get_total_claimed` | R | | | | | | | | | | | |
| `get_streams_for_sponsor` | | | | | | | | | | | | R |
| `emergency_drain` | R/W | | | | | | | | | | | |

> **R** = key is read; **W** = key is written or removed; **R/W** = both in the
> same invocation. Instance bump calls are omitted from this table; every
> state-mutating function bumps instance TTL via `bump_instance()`.

---

## CI Check

A dedicated workflow (`.github/workflows/storage-layout-check.yml`) enforces
that this document is updated whenever `src/types.rs` changes the `DataKey`
enum.

### How it works

1. On every pull request and push, the workflow extracts a canonical
   **fingerprint** of the `DataKey` enum from `src/types.rs` (a sorted list of
   variant names).
2. It compares that fingerprint against the `DATAKEY_FINGERPRINT` marker
   embedded at the bottom of this file.
3. If they differ, the job fails with an actionable error message.

### Updating after a DataKey change

1. Add or remove the variant in `src/types.rs`.
2. Update the relevant rows in the [DataKey Variant Reference](#datakey-variant-reference)
   and [Function-to-Key Matrix](#function-to-key-matrix) sections above.
3. Run the check script locally to regenerate the fingerprint:
   ```bash
   bash scripts/check-storage-layout.sh --update
   ```
4. Commit both files together.

---

<!-- DATAKEY_FINGERPRINT: Admin,ConfigMaxCliffRatio,ConfigMinRate,FeeBps,MilestoneSchedule,MinDeposit,Schedule,Treasury,VariableSchedule -->
