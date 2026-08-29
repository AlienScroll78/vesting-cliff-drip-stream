# Persistent Storage Design

This document covers the contract's on-chain storage layout, TTL management strategy, cost estimates, size constraints, and risk scenarios for active streams. For the formal architectural decision behind the TTL strategy, see [ADR-0005](adr/0005-ttl-persistent-storage-strategy.md) and [ADR-0001](adr/0001-per-recipient-storage-key.md). For the pause/resume storage additions, see [ADR-0007](adr/0007-pause-resume-design.md).

---

## DataKey Enum

```rust
pub enum DataKey {
    Schedule(Address),          // persistent – one entry per active fixed-rate stream
    VariableSchedule(Address),  // persistent – one entry per active variable-rate stream
    MinDeposit,                 // instance   – global admin configuration
    Admin,                      // instance   – contract admin address
    FeeBps,                     // instance   – protocol fee in basis points (0–500)
    Treasury,                   // instance   – protocol fee recipient address
}
```

The allowlist is stored in instance storage under a separate singleton key (`AllowedTokens`) as a `Vec<Address>`. It does not appear in `DataKey` because it is managed through its own dedicated storage helpers (`add_allowed_token`, `remove_allowed_token`, `get_allowed_tokens`).

### Full key inventory

| Key | Rust variant | Storage tier | Value type | Cardinality | TTL |
|---|---|---|---|---|---|
| `Schedule(recipient)` | `DataKey::Schedule(Address)` | Persistent | `VestingSchedule` | one per active fixed-rate stream | ~1 year, bumped on access |
| `VariableSchedule(recipient)` | `DataKey::VariableSchedule(Address)` | Persistent | `VariableRateSchedule` | one per active variable-rate stream | ~1 year, bumped on access |
| `MinDeposit` | `DataKey::MinDeposit` | Instance | `i128` (default: 100) | singleton | instance TTL |
| `Admin` | `DataKey::Admin` | Instance | `Address` | singleton | instance TTL |
| `FeeBps` | `DataKey::FeeBps` | Instance | `u32` (0–500) | singleton | instance TTL |
| `Treasury` | `DataKey::Treasury` | Instance | `Address` | singleton | instance TTL |
| `AllowedTokens` | *(internal singleton)* | Instance | `Vec<Address>` | singleton | instance TTL |

### Why `Schedule` and `VariableSchedule` use persistent storage (not instance)

Soroban offers three storage tiers: **temporary**, **instance**, and **persistent**.

- **Temporary** storage expires after a short window (minutes to hours). A vesting schedule lasting months cannot use temporary storage.
- **Instance** storage shares a single TTL with the contract instance itself. Accessing *any* entry in instance storage bumps the TTL for *all* instance entries. Storing per-recipient data there would mean a claim by any one recipient silently refreshes every other recipient's TTL — a hidden coupling that makes TTL reasoning unreliable. It also means that a contract with zero on-chain activity for its maximum window would evict *all* schedules at once.
- **Persistent** storage gives each entry its own independent TTL. One dormant stream expiring cannot affect others. Reads and writes to a specific recipient's schedule only affect that entry's TTL.

Therefore, each `Schedule(Address)` and `VariableSchedule(Address)` key is stored in **persistent** storage. See [ADR-0001](adr/0001-per-recipient-storage-key.md) for the full rationale.

### Why admin configuration uses instance storage

`MinDeposit`, `Admin`, `FeeBps`, `Treasury`, and `AllowedTokens` are shared contract configuration values with no per-recipient isolation requirement. They are accessed on every `create_vesting_stream` call (which also bumps the contract instance TTL), and their expiry is either harmlessly handled by a hardcoded fallback (`DEFAULT_MIN_DEPOSIT = 100`, `FeeBps = 0`) or guarded by a `NotInitialized` check. Instance storage is the correct tier for infrequently-changed contract configuration.

---

## VestingSchedule Layout

The serialised value stored under each `Schedule(Address)` key is a `VestingSchedule`:

```rust
pub struct VestingSchedule {
    pub token: Address,                    // 32 bytes — SAC token contract ID
    pub sponsor: Address,                  // 32 bytes — original stream funder
    pub rate_per_ledger: i128,             // 16 bytes — tokens released per ledger
    pub start_ledger: u32,                 //  4 bytes — stream creation ledger
    pub cliff_ledger: u32,                 //  4 bytes — first claimable ledger
    pub end_ledger: u32,                   //  4 bytes — last accrual ledger (shifted by pause/resume)
    pub last_claimed_ledger: u32,          //  4 bytes — high-water mark for accrual
    pub total_claimed: i128,               // 16 bytes — running total transferred to recipient
    pub metadata: Option<String>,          //  variable — optional label (max 256 UTF-8 bytes)
    pub paused_at_ledger: Option<u32>,     //  5 bytes — None = running, Some(n) = paused since ledger n
    pub accumulated_pause_ledgers: u32,    //  4 bytes — total ledgers spent paused (audit trail)
    pub version: u32,                      //  4 bytes — monotonic mutation counter (1 = current schema)
}
```

XDR overhead (envelope, type tags, field name maps) adds roughly 100–200 bytes. Total on-chain size per entry is approximately **300–350 bytes**.

### Field-by-field notes

#### `token` and `sponsor` (Address, 32 bytes each)

Both are populated once at stream creation and are never mutated. `sponsor` is required by `drain_expired_stream` and `emergency_drain` to return unclaimed tokens to the original funder without requiring the sponsor to supply their address at drain time.

#### `rate_per_ledger` (i128, 16 bytes)

Tokens released per ledger once the cliff has passed. For variable-rate streams this field is not used; see `VariableRateSchedule` below.

#### `start_ledger`, `cliff_ledger`, `end_ledger` (u32, 4 bytes each)

`start_ledger` is set to `env.ledger().sequence()` at creation and is never changed.

`cliff_ledger = start_ledger + cliff_duration` at creation. After a pause/resume cycle, `cliff_ledger` is shifted forward by the pause duration (see `paused_at_ledger` below).

`end_ledger = start_ledger + total_duration` at creation. After each resume, `end_ledger` is shifted forward by the pause duration, preserving the recipient's total vesting entitlement.

#### `last_claimed_ledger` (u32, 4 bytes)

Initialised to `start_ledger`. Updated to `min(current_ledger, end_ledger)` on every successful claim. The accrual formula uses `last_claimed_ledger` as the lower bound: `claimable = (active_end − last_claimed_ledger) × rate_per_ledger`. This field is never decremented.

#### `total_claimed` (i128, 16 bytes)

Running total of all tokens ever transferred to the recipient via `claim_vested`. Initialised to `0` at stream creation. Incremented on every successful claim by exactly the amount transferred. Used by:

- `drain_expired_stream` and `emergency_drain` to compute `remaining = total_deposit − total_claimed`.
- `get_stats` for UI display without requiring off-chain event indexing.
- The dust collection path: at `end_ledger`, the final claim pays `total_deposit − total_claimed` rather than `rate × elapsed` to capture any sub-1-token integer remainder (see [Dust Collection](#dust-collection) below).

Default value: `0` (XDR integer default). Pre-existing entries that lack this field decode with `total_claimed = 0`, which is the correct starting value; `migrate_schedule` need not backfill it.

#### `metadata` (Option\<String\>, variable)

Optional free-form label attached at creation (max 256 UTF-8 bytes). Empty strings are normalised to `None` at creation time. The field is immutable after creation and is returned verbatim by `get_schedule`. Schedules written before this field was introduced decode with `metadata = None` (XDR default for a missing `Option<T>`).

⚠️  Metadata is publicly visible on-chain. Do **not** store sensitive or personally-identifiable information here.

#### `paused_at_ledger` (Option\<u32\>, 5 bytes)

`None` while the stream is running. Set to `Some(env.ledger().sequence())` by `pause_stream` and cleared back to `None` by `resume_stream`.

**This field is the canonical pause signal.** All functions that compute claimable amounts check `paused_at_ledger.is_some()` before doing any arithmetic and return `0` / `NothingToClaim` immediately if the stream is paused. No tokens accrue while a stream is paused.

XDR encoding: `None` is encoded as a 4-byte zero discriminant (1 byte tag + 0 body = 5 bytes on-wire with the discriminant). `Some(n)` is encoded as a 4-byte non-zero discriminant + 4-byte `u32` = effectively 5 bytes XDR-packed. Schedules written before this field was introduced decode with `paused_at_ledger = None`, which correctly represents a running (unpaused) stream.

See [ADR-0007](adr/0007-pause-resume-design.md) for the full pause/resume design rationale.

#### `accumulated_pause_ledgers` (u32, 4 bytes)

Running total of all ledgers the stream has spent paused across potentially multiple pause/resume cycles. Initialised to `0`. Updated by `resume_stream` as:

```
accumulated_pause_ledgers += current_ledger − paused_at_ledger
```

This field does **not** participate in the accrual formula. It is informational: off-chain indexers can read it to reconstruct total pause time without replaying all `StreamPaused`/`StreamResumed` events.

Default value: `0` (XDR integer default). Pre-existing entries decode with `accumulated_pause_ledgers = 0`, which is correct.

#### `version` (u32, 4 bytes)

Monotonically increasing mutation counter providing an on-chain audit trail. Initialised to `1` at stream creation. Incremented atomically before every state-changing operation (claim, cancel, transfer recipient, etc.) via `schedule.increment_version()`. Overflow to `u32::MAX` returns `VestingError::VersionOverflow` rather than wrapping.

The field is placed **last** in the struct. XDR encodes struct fields in declaration order, so entries written before this field was introduced (which omit it) decode with an implicit default of `0`, allowing `migrate_schedule` to recognise and upgrade legacy entries in-place.

| Value | Meaning |
|---|---|
| `0` | Legacy entry written before versioning was introduced (pre-Issue #318). Upgradeable via `migrate_schedule`. |
| `1` | Created under the current schema. Initial value set at `create_vesting_stream`. |
| `2+` | Each successful mutating operation increments by 1. |
| `u32::MAX` | Overflow sentinel — next mutation returns `VersionOverflow`. |

---

## Dust Collection

"Dust" refers to the sub-1-token integer remainder that can arise from the accrual formula `rate × elapsed_ledgers` when the deposit is not evenly divisible by the stream duration. This remainder is not stored as a separate field; it is computed and paid out at claim time using `total_claimed`.

At or past `end_ledger`, `claim_vested` switches from the normal formula to:

```
claimable = total_deposit − total_claimed
```

where `total_deposit = rate_per_ledger × (end_ledger − start_ledger)`. This ensures the recipient always receives the full deposited amount with no tokens permanently stranded in the contract vault.

The final claim at `end_ledger` deletes the `Schedule` entry from persistent storage, freeing the storage rent.

---

## VariableRateSchedule Layout

The serialised value stored under each `VariableSchedule(Address)` key is a `VariableRateSchedule`:

```rust
pub struct VariableRateSchedule {
    pub token: Address,               // 32 bytes — SAC token contract ID
    pub sponsor: Address,             // 32 bytes — original stream funder
    pub total_deposited: i128,        // 16 bytes — full deposit at creation
    pub start_ledger: u32,            //  4 bytes — stream creation ledger
    pub cliff_ledger: u32,            //  4 bytes — first claimable ledger
    pub end_ledger: u32,              //  4 bytes — last accrual ledger
    pub last_claimed_ledger: u32,     //  4 bytes — high-water mark for accrual
    pub segments: Vec<RateSegment>,   //  variable — up to 10 rate segments
    pub claimed_amount: i128,         // 16 bytes — running total transferred
    pub total_claimed: i128,          // 16 bytes — alias for claimed_amount (audit)
    pub paused_at_ledger: Option<u32>, // 5 bytes — pause state
}

pub struct RateSegment {
    pub end_ledger: u32,   // 4 bytes — ledger at which this segment ends
    pub rate: i128,        // 16 bytes — tokens per ledger in this segment
}
```

Maximum 10 segments per stream (`MAX_SEGMENTS = 10`). At the maximum, `segments` contributes roughly `10 × (4 + 16 + overhead) ≈ 300` additional bytes. Total on-chain size per variable-rate entry is approximately **450–550 bytes**.

Accrual for variable-rate streams walks the segment list from `last_claimed_ledger` to `min(current_ledger, end_ledger)`, accumulating `rate × ledgers_in_segment` for each segment that overlaps the window. Dust collection at `end_ledger` uses the same `total_deposited − claimed_amount` formula as fixed-rate streams.

---

## Storage Layout Diagram

```
Contract Persistent Storage
───────────────────────────────────────────────────────────────────────────────
  Key                              │  Value                         │  TTL
─────────────────────────────────  ┼────────────────────────────────┼──────────
  DataKey::Schedule(alice)         │  VestingSchedule { ... }       │  ~1 year*
  DataKey::Schedule(bob)           │  VestingSchedule { ... }       │  ~1 year*
  DataKey::Schedule(carol)         │  VestingSchedule { ... }       │  ~0 (dormant)
  DataKey::VariableSchedule(dave)  │  VariableRateSchedule { ... }  │  ~1 year*
  ...                              │  ...                           │  ...
───────────────────────────────────────────────────────────────────────────────

Contract Instance Storage
───────────────────────────────────────────────────────────────────────────────
  Key                │  Value                         │  TTL
───────────────────  ┼────────────────────────────────┼──────────────────────
  DataKey::MinDeposit │  i128 (default: 100)           │  instance TTL
  DataKey::Admin      │  Address                       │  instance TTL
  DataKey::FeeBps     │  u32  (default: 0)             │  instance TTL
  DataKey::Treasury   │  Address                       │  instance TTL
  AllowedTokens       │  Vec<Address> (default: empty) │  instance TTL
───────────────────────────────────────────────────────────────────────────────

* TTL is refreshed to ~1 year on every mutating access.
  Dormant entries archive at TTL = 0 but are transparently restored
  by Stellar RPC on the next simulated transaction (Protocol 23+).
```

Each `Schedule` and `VariableSchedule` entry is fully independent. Creating, claiming, cancelling, or draining one stream does not affect the TTL or data of any other stream.

---

## Token Allowlist

The contract supports an optional token allowlist gated by an admin:

- When the `AllowedTokens` list is **empty**, the contract operates in **permissive mode**: any SAC-compatible token is accepted by `create_vesting_stream`.
- When the list is **non-empty**, only tokens whose address appears in the list are accepted. Streams created with any other token return `VestingError::TokenNotAllowed`.

### Storage key

The allowlist is stored in instance storage as a `Vec<Address>` under a dedicated singleton key managed by `storage::add_allowed_token`, `storage::remove_allowed_token`, and `storage::get_allowed_tokens`. Adding or removing the last token automatically reverts to permissive mode (empty list).

### TTL

The allowlist shares the instance storage TTL. Every `create_vesting_stream` call bumps instance storage, so the allowlist TTL is refreshed on every stream creation. Admin calls (`add_allowed_token`, `remove_allowed_token`) also bump instance TTL. No separate keeper is needed.

### Auth

Both `add_allowed_token` and `remove_allowed_token` require `admin.require_auth()`. The admin must be the address configured during `initialize`. The `get_allowed_tokens` view is permissionless.

---

## TTL Bump Strategy

All reads and writes go through `src/storage.rs`, which applies a consistent bump policy using two constants:

```rust
const PERSISTENT_LEDGER_THRESHOLD: u32 = 3_000_000;  // ~1 year minus ~2 weeks (renewal threshold)
const PERSISTENT_BUMP_AMOUNT: u32      = 3_110_400;  // ~1 year at 5 s/ledger (maximum TTL window)
```

The `extend_ttl(key, threshold, bump_amount)` call is a **conditional extension**: if the entry's current TTL is already above `threshold`, the call is a no-op and incurs no extra fee. If the TTL has fallen below the threshold, it is extended to `bump_amount`.

### When bumps occur

| Function | Code path | Bump triggered? | Reason |
|---|---|---|---|
| `create_vesting_stream` | `storage::set_schedule` (write) | **Yes** | New entry must survive the full stream duration |
| `claim_vested` | `storage::get_schedule` → `set_schedule` | **Yes** | Mutating path bumps on both read and write |
| `cancel_stream` | `storage::get_schedule` → `remove_schedule` | **Yes on read**, then entry deleted | Entry is removed so final bump is irrelevant |
| `pause_stream` | `storage::get_schedule` → `set_schedule` | **Yes** | Pausing a stream keeps it alive |
| `resume_stream` | `storage::get_schedule` → `set_schedule` | **Yes** | Resuming extends the TTL for the new end_ledger |
| `transfer_recipient` | `storage::get_schedule` → `remove_schedule` + `set_schedule` | **Yes** | Old entry removed, new entry created at new key |
| `drain_expired_stream` | `storage::get_schedule` → `remove_schedule` | **Yes on read**, then entry deleted | Same as cancel |
| `emergency_drain` | `storage::get_schedule` → `remove_schedule` | **Yes on read**, then entry deleted | Same as cancel |
| `get_schedule` (view) | `storage::get_schedule` (read) | **Yes** | Public view calls the bumping path |
| `claimable_amount` (view) | `storage::get_schedule_readonly` | **Yes** | Bumps TTL on read (unified path) |
| `is_cliff_passed` (view) | `storage::get_schedule_readonly` | **Yes** | Same as above |
| `get_status` (view) | `storage::get_schedule_readonly` | **Yes** | Same as above |
| `get_stats` (view) | `storage::get_schedule_readonly` | **Yes** | Same as above |
| `has_schedule` (existence check) | `storage::has_schedule` | **No** | Existence check only; entry not read |
| `remove_schedule` (delete) | `storage::remove_schedule` | **No** | Entry is being deleted |
| `add_allowed_token` | instance set | **Yes (instance)** | Bumps instance TTL |
| `remove_allowed_token` | instance set | **Yes (instance)** | Bumps instance TTL |

### Ledger and time equivalences

At ~5 seconds per ledger (approximate Stellar mainnet average):

| Ledgers | Approximate wall time |
|---|---|
| 3,000,000 | ~347 days (renewal threshold) |
| 3,110,400 | ~360 days (~1 year, bump target) |
| 3,153,600 | ~365 days (drain delay after end_ledger) |

---

## Risk Scenario: TTL Expiry on an Active Stream

**Scenario**: A vesting stream is created for a recipient. The recipient does not interact with the contract for more than ~1 year. No other address calls any view or mutating function on this stream either.

**What happens**:

1. After 3,110,400 ledgers (~1 year) without any interaction, the `Schedule(recipient)` entry's TTL reaches 0. The Stellar network **archives** (not deletes) the entry.
2. An archived persistent entry is not permanently lost. On the next transaction that accesses it, Stellar RPC's simulation phase detects the archived entry and includes a **restoration preamble** in the simulated transaction response (Protocol 23+). The client submits this preamble alongside the actual call, and the network restores the entry before executing the contract invocation.
3. The contract itself behaves correctly after restoration — the `VestingSchedule` data is intact and the claim, cancel, or view call proceeds normally.

**What could go wrong**:

- If a client submits a raw transaction without first simulating it (bypassing the restoration preamble), the contract will receive a missing-key read as `None`. The contract will return `VestingError::ScheduleNotFound (1)`.
- The recipient experiences a degraded UX: their wallet or dApp will show the stream as "not found" until the simulation-based restoration path is used.
- Restoration incurs a one-time **rent fee** (~0.02–0.05 XLM) paid by the submitter of the restoration transaction.

**Mitigation**:

- Always simulate transactions via `stellar transaction simulate` before submission. The Soroban RPC automatically includes restoration footprints in the response.
- For very long-duration streams (> 1 year of anticipated inactivity), a keeper can call the public `get_schedule` view periodically to bump the TTL without any recipient action.
- A paused stream that is never resumed will eventually archive if neither party interacts with it. Sponsors should resume or interact with paused streams at least once per year.

---

## Storage Cost Estimation

> All figures are approximations based on mainnet fee parameters as of mid-2025 and an XLM price of ~$0.10. Actual costs vary with network congestion and XLM price. Always simulate transactions via `stellar transaction simulate` for exact fees before submission.

### Write fee (create / update)

Soroban charges a **rent fee** proportional to entry size and TTL extension length:

```
rent_fee ≈ entry_size_bytes × ttl_ledgers_extended × fee_rate_per_byte_ledger
```

For a ~320-byte entry extended by 3,110,400 ledgers (~1 year):

| Parameter | Value |
|---|---|
| Entry size | ~320 bytes (including new fields) |
| TTL extension | 3,110,400 ledgers |
| Fee rate (approximate) | ~4,000 stroops / (byte · ledger) × 10⁻⁹ |
| **Estimated rent fee** | **~400,000–600,000 stroops (~0.04–0.06 XLM)** |

Add ~100,000–200,000 stroops for CPU and I/O resource fees. Total `create_vesting_stream` transaction cost: roughly **0.05–0.08 XLM** per stream.

### Bump on claim

The conditional TTL bump (`extend_ttl`) only charges rent if the TTL has actually dropped below the 3,000,000-ledger threshold. If the stream was accessed within the last ~347 days, the bump is a no-op and no rent is charged.

A typical `claim_vested` call costs approximately **0.01–0.03 XLM** in resource fees.

### Cost summary per stream

| Event | Estimated cost |
|---|---|
| Stream creation | ~0.05–0.08 XLM |
| Monthly claim (12×/year) | ~0.01–0.03 XLM per claim |
| TTL renewal when below threshold | ~0.04–0.06 XLM per renewal |
| Storage restoration after archival | ~0.02–0.05 XLM (one-time) |
| Stream cancellation / drain | ~0.01–0.03 XLM |
| Pause or resume | ~0.01–0.02 XLM |

---

## Storage Size Limits

| Limit | Value | Source |
|---|---|---|
| Max `CONTRACT_DATA` entry size | 64 KB | Soroban protocol limit |
| `VestingSchedule` actual size | ~320 bytes | XDR serialisation estimate (all fields) |
| `VariableRateSchedule` actual size (max segments) | ~550 bytes | XDR serialisation estimate |
| Max TTL extension | up to `max_entry_ttl` (~1 year) | Network parameter |
| Min TTL on creation/restore | ~4,096 ledgers (~5.7 hours) | Network parameter |
| Max concurrent streams | Unbounded | No per-contract cap on persistent entries |
| Max segments per variable-rate stream | 10 | `MAX_SEGMENTS` constant in `contract.rs` |
| Max metadata length | 256 bytes (UTF-8) | Enforced by `create_vesting_stream` |

Each stream is an independent ledger entry. One stream expiring, archiving, or being removed does not affect any other stream.

---

## Migration Notes for Existing Deployments

### Schema version 0 → 1 (`version` field)

Schedules created before Issue #318 shipped do not have a `version` field. When such an entry is read from storage, XDR's default-for-missing-field rule sets `version = 0`. The contract recognises this and the admin can call `migrate_schedule(admin, recipient)` to upgrade the entry in-place to `version = 1`.

`migrate_schedule` is idempotent: calling it on a schedule with `version >= 1` is a no-op that returns `Ok(())`.

**Recommended upgrade procedure**: After deploying a build that includes `version`, call `migrate_schedule` for each active recipient. This can be batched by an off-chain script that reads all known recipients from event history and submits upgrade transactions.

### `total_claimed` field

Pre-existing entries decode with `total_claimed = 0` (XDR integer default). Because `total_claimed` is initialised to `0` at creation anyway, this is always correct — no backfilling is needed. Entries will accumulate an accurate `total_claimed` naturally as claims occur after the upgrade.

### `metadata` field

Pre-existing entries decode with `metadata = None` (XDR `Option` default). This is the correct value for streams created without a metadata label. No migration is needed.

### `paused_at_ledger` and `accumulated_pause_ledgers` fields

Pre-existing entries decode with `paused_at_ledger = None` (stream is running) and `accumulated_pause_ledgers = 0` (no prior pauses). Both are correct defaults. No migration is needed.

### `VariableSchedule` key

Variable-rate stream support is a new feature; no existing deployments have entries under `DataKey::VariableSchedule`. No migration is needed.

### Admin / fee configuration keys (`Admin`, `FeeBps`, `Treasury`)

These are written by `initialize`. A deployment that has not yet called `initialize` will return `None` from `get_admin` and `0` from `get_fee_bps`. The contract guards stream creation behind a `NotInitialized` check so unialized deployments cannot create streams. After calling `initialize`, all three keys are populated atomically.

### Allowlist (`AllowedTokens`)

The allowlist starts empty on any deployment. An empty list means permissive mode (all tokens accepted), which is the backward-compatible default. No migration is needed for existing deployments.

---

## References

- [ADR-0001 — Per-Recipient Storage Key](adr/0001-per-recipient-storage-key.md)
- [ADR-0005 — TTL and Persistent Storage Strategy](adr/0005-ttl-persistent-storage-strategy.md)
- [ADR-0006 — Checked Arithmetic Strategy](adr/0006-checked-arithmetic-strategy.md)
- [ADR-0007 — Pause/Resume Design](adr/0007-pause-resume-design.md)
- [Soroban State Archival](https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage/state-archival)
- [Choosing the Right Storage Type](https://developers.stellar.org/docs/build/guides/storage/choosing-the-right-storage)
- [Stellar Lab — Network Limits (live fee parameters)](https://lab.stellar.org/network-limits)
- Contract source: `src/storage.rs`, `src/types.rs`
