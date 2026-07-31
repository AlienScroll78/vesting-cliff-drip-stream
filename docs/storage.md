# Persistent Storage Design

This document covers the contract's on-chain storage layout, TTL management strategy, cost estimates, size constraints, and risk scenarios for active streams. For the formal architectural decision behind the TTL strategy, see [ADR-0005](adr/0005-ttl-persistent-storage-strategy.md) and [ADR-0001](adr/0001-per-recipient-storage-key.md).

---

## DataKey Enum

```rust
pub enum DataKey {
    Schedule(Address),   // persistent – one entry per active stream
    MinDeposit,          // instance   – global admin configuration
}
```

There are two variants with different storage tiers and TTL rules:

| Variant | Storage tier | Key | Value type | Cardinality | TTL |
|---|---|---|---|---|---|
| `Schedule(Address)` | Persistent | recipient `Address` | `VestingSchedule` struct | one per active stream | ~60 days, bumped on access |
| `MinDeposit` | Instance | singleton | `i128` | one per contract | tied to instance TTL |

### Why `Schedule` uses persistent storage (not instance)

Soroban offers three storage tiers: **temporary**, **instance**, and **persistent**.

- **Temporary** storage is the cheapest but expires after a short window (minutes to hours). A vesting schedule lasting months cannot use temporary storage.
- **Instance** storage shares a single TTL with the contract instance itself. Accessing *any* entry in instance storage bumps the TTL for *all* instance entries. Storing per-recipient data there would mean a claim by any one recipient silently refreshes every other recipient's TTL — a hidden coupling that makes TTL reasoning unreliable. It also means that a contract with zero on-chain activity for 60 days would evict *all* schedules at once.
- **Persistent** storage gives each entry its own independent TTL. One dormant stream expiring cannot affect others. Reads and writes to a specific recipient's schedule only affect that entry's TTL.

Therefore, each `Schedule(Address)` key is stored in **persistent** storage. This is the correct tier for long-lived, independently managed data. See [ADR-0001](adr/0001-per-recipient-storage-key.md) for the full rationale.

### Why `MinDeposit` uses instance storage

`MinDeposit` is a single global configuration value shared across all streams. It has no per-recipient isolation requirement, is accessed on every `create_vesting_stream` call (which also bumps the contract instance TTL), and its expiry is harmlessly handled by `get_min_deposit` falling back to the hardcoded `DEFAULT_MIN_DEPOSIT = 100`. Instance storage is the correct tier for infrequently-changed contract configuration.

---

## VestingSchedule Layout

The serialised value stored under each `Schedule(Address)` key is a `VestingSchedule`:

```rust
pub struct VestingSchedule {
    pub version: u32,              // 4 bytes  — schema version (1 = current)
    pub token: Address,            // 32 bytes — SAC token contract ID
    pub sponsor: Address,          // 32 bytes — original stream funder
    pub rate_per_ledger: i128,     // 16 bytes — tokens released per ledger
    pub start_ledger: u32,         // 4 bytes  — stream creation ledger
    pub cliff_ledger: u32,         // 4 bytes  — first claimable ledger
    pub end_ledger: u32,           // 4 bytes  — last accrual ledger
    pub last_claimed_ledger: u32,  // 4 bytes  — high-water mark for claims
    pub total_claimed: i128,       // 16 bytes — running total transferred to recipient
}
```

XDR overhead (envelope, type tags, field name maps) adds roughly 100–150 bytes. Total on-chain size per entry is approximately **220–270 bytes**.

The `sponsor` field is required because `drain_expired_stream` and `emergency_drain` must return unclaimed tokens to the original funder without requiring the sponsor to supply their address at drain time (the sponsor may have lost access or be unavailable). It is populated once on stream creation and never mutated.

The `version` field guards against future deserialization mismatches. Schedules created before this field was introduced carry an implicit `version = 0` (XDR default for a missing `u32`); current code writes `version = 1`. The `migrate_schedule` admin function upgrades old entries in-place.

The Soroban ledger entry size limit is **64 KB** per `CONTRACT_DATA` entry. A single `VestingSchedule` uses well under 1% of that limit.

---

## Storage Layout Diagram

```
Contract Persistent Storage
───────────────────────────────────────────────────────────────────────────
  Key                         │  Value                    │  TTL
──────────────────────────────┼───────────────────────────┼───────────────
  DataKey::Schedule(alice)    │  VestingSchedule { ... }  │  ~60 days*
  DataKey::Schedule(bob)      │  VestingSchedule { ... }  │  ~60 days*
  DataKey::Schedule(carol)    │  VestingSchedule { ... }  │  ~0 days (dormant)
  ...                         │  ...                      │  ...
───────────────────────────────────────────────────────────────────────────

Contract Instance Storage
───────────────────────────────────────────────────────────────────────────
  Key                         │  Value                    │  TTL
──────────────────────────────┼───────────────────────────┼───────────────
  DataKey::MinDeposit         │  i128 (default: 100)      │  instance TTL
───────────────────────────────────────────────────────────────────────────

* TTL is refreshed to ~60 days on every mutating access.
  Dormant entries archive at TTL = 0 but are transparently restored
  by Stellar RPC on the next simulated transaction (Protocol 23+).
```

Each `Schedule` entry is fully independent. Creating, claiming, cancelling, or draining one stream does not affect the TTL or data of any other stream.

---

## TTL Bump Strategy

All reads and writes go through `src/storage.rs`, which applies a consistent bump policy using two constants:

```rust
const PERSISTENT_LEDGER_THRESHOLD: u32 = 259_200;  // ~30 days at 5 s/ledger
const PERSISTENT_BUMP_AMOUNT: u32      = 518_400;  // ~60 days at 5 s/ledger
```

The `extend_ttl(key, threshold, bump_amount)` call is a **conditional extension**: if the entry's current TTL is already above `threshold` (30 days), the call is a no-op and incurs no extra fee. If the TTL has fallen below 30 days, it is extended to `bump_amount` (60 days from the current ledger).

### When bumps occur

| Function | Code path | Bump triggered? | Reason |
|---|---|---|---|
| `create_vesting_stream` | `storage::set_schedule` (write) | **Yes** | New entry must survive the full stream |
| `claim_vested` | `storage::get_schedule` (read) → `set_schedule` (write) | **Yes** | Mutating path; TTL bumped on both read and write |
| `cancel_stream` | `storage::get_schedule` (read) → `remove_schedule` | **Yes on read**, then entry deleted | Entry is removed so final bump is irrelevant |
| `drain_expired_stream` | `storage::get_schedule` (read) → `remove_schedule` | **Yes on read**, then entry deleted | Same as cancel |
| `emergency_drain` | `storage::get_schedule` (read) → `remove_schedule` | **Yes on read**, then entry deleted | Same as cancel |
| `get_schedule` (view) | `storage::get_schedule` (read) | **Yes** | `get_schedule` public view calls the bump path |
| `claimable_amount` (view) | `storage::get_schedule_readonly` | **No** | Read-only view skips the bump to reduce instruction cost |
| `is_cliff_passed` (view) | `storage::get_schedule_readonly` | **No** | Same as above |
| `get_status` (view) | `storage::get_schedule_readonly` | **No** | Same as above |
| `get_stats` (view) | `storage::get_schedule_readonly` | **No** | Same as above |
| `has_schedule` (existence check) | `storage::has_schedule` | **No** | Existence check only; entry not read |
| `remove_schedule` (delete) | `storage::remove_schedule` | **No** | Entry is being deleted |

The split between `get_schedule` (bumping) and `get_schedule_readonly` (non-bumping) is a deliberate performance optimisation. View functions like `claimable_amount` are called on every UI refresh — far more often than mutating entry points. Routing them through the non-bumping path eliminates one `extend_ttl` host call per invocation without any correctness impact, since a read-only call does not need to guarantee the entry survives for another 60 days.

### Ledger and time equivalences

At ~5 seconds per ledger (approximate Stellar mainnet average):

| Ledgers | Approximate wall time |
|---|---|
| 259,200 | 30 days (threshold) |
| 518,400 | 60 days (bump target) |
| 3,153,600 | 1 year (drain delay) |

---

## Risk Scenario: TTL Expiry on an Active Stream

**Scenario**: A vesting stream is created for a recipient. The recipient does not interact with the contract for more than 60 days. No other address calls any view or mutating function on this stream either.

**What happens**:

1. After 518,400 ledgers (~60 days) without any interaction, the `Schedule(recipient)` entry's TTL reaches 0. The Stellar network **archives** (not deletes) the entry.
2. An archived persistent entry is not permanently lost. On the next transaction that accesses it, Stellar RPC's simulation phase detects the archived entry and includes a **restoration preamble** in the simulated transaction response (Protocol 23+). The client submits this preamble alongside the actual call, and the network restores the entry before executing the contract invocation.
3. The contract itself behaves correctly after restoration — the `VestingSchedule` data is intact and the claim, cancel, or view call proceeds normally.

**What could go wrong**:

- If a client submits a raw transaction without first simulating it (bypassing the restoration preamble), the contract will receive a missing-key read as `None` from `storage::get_schedule_readonly`, or a `None` from `storage::get_schedule`. The contract will return `VestingError::ScheduleNotFound (1)`.
- The recipient experiences a degraded UX: their wallet or dApp will show the stream as "not found" until the simulation-based restoration path is used.
- Restoration incurs a one-time **rent fee** (~0.02–0.05 XLM) paid by the submitter of the restoration transaction.

**Mitigation**:

- Always simulate transactions via `stellar transaction simulate` before submission. The Soroban RPC automatically includes restoration footprints in the response.
- For very long-duration streams (> 60 days of anticipated inactivity), a keeper can call the public `get_schedule` view periodically to bump the TTL without any recipient action.
- Recipients of long-term streams should claim or check-in at least once every 60 days under normal operation.

**Note**: In the contract test suite, `test_expired_ttl_reaches_zero_and_cancelled_stream_returns_schedule_not_found` in `src/tests/test_edge_cases.rs` verifies the TTL decay observable state and confirms that `ScheduleNotFound` is produced by explicit removal, not by expiry (since the SDK restores persistent entries transparently).

---

## Storage Cost Estimation

> All figures are approximations based on mainnet fee parameters as of mid-2025 and an XLM price of ~$0.10. Actual costs vary with network congestion and XLM price. Always simulate transactions via `stellar transaction simulate` for exact fees before submission.

### Write fee (create / update)

Soroban charges a **rent fee** proportional to entry size and TTL extension length:

```
rent_fee ≈ entry_size_bytes × ttl_ledgers_extended × fee_rate_per_byte_ledger
```

For a ~250-byte entry extended by 518,400 ledgers (~60 days):

| Parameter | Value |
|---|---|
| Entry size | ~250 bytes |
| TTL extension | 518,400 ledgers |
| Fee rate (approximate) | ~4,000 stroops / (byte · ledger) × 10⁻⁹ |
| **Estimated rent fee** | **~500,000 stroops (~0.05 XLM ≈ $0.005)** |

Add ~100,000–200,000 stroops for CPU and I/O resource fees. Total `create_vesting_stream` transaction cost: roughly **0.05–0.08 XLM** per stream.

### Read fee (claim / view)

The conditional TTL bump (`extend_ttl`) only charges rent if the TTL has actually dropped below the 30-day threshold. If the stream was accessed within the last 30 days, the bump is a no-op and no rent is charged.

A typical `claim_vested` call (read + conditional bump + write the updated `last_claimed_ledger`) costs approximately **0.01–0.03 XLM** in resource fees.

### Rent per stream per year

If a stream is claimed monthly (12 interactions/year, each renewing the 60-day TTL):

```
12 × ~0.05 XLM ≈ 0.60 XLM/year per stream
```

If the entry archives and must be restored once:

- Additional restoration fee: ~0.02–0.05 XLM (one-time)

### Cost summary per stream

| Event | Estimated cost |
|---|---|
| Stream creation | ~0.05–0.08 XLM |
| Monthly claim (12×/year) | ~0.01–0.03 XLM per claim |
| TTL renewal when below threshold | ~0.05 XLM per renewal |
| Storage restoration after archival | ~0.02–0.05 XLM (one-time) |
| Stream cancellation / drain | ~0.01–0.03 XLM |

---

## Storage Size Limits

| Limit | Value | Source |
|---|---|---|
| Max `CONTRACT_DATA` entry size | 64 KB | Soroban protocol limit |
| `VestingSchedule` actual size | ~250 bytes | XDR serialisation estimate |
| Max TTL extension | up to `max_entry_ttl` (~1 year) | Network parameter |
| Min TTL on creation/restore | ~4,096 ledgers (~5.7 hours) | Network parameter |
| Max concurrent streams | Unbounded | No per-contract cap on persistent entries |

Each stream is an independent ledger entry. One stream expiring, archiving, or being removed does not affect any other stream.

---

## References

- [ADR-0001 — Per-Recipient Storage Key](adr/0001-per-recipient-storage-key.md)
- [ADR-0005 — TTL and Persistent Storage Strategy](adr/0005-ttl-persistent-storage-strategy.md)
- [ADR-0006 — Checked Arithmetic Strategy](adr/0006-checked-arithmetic-strategy.md)
- [Soroban State Archival](https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage/state-archival)
- [Choosing the Right Storage Type](https://developers.stellar.org/docs/build/guides/storage/choosing-the-right-storage)
- [Stellar Lab — Network Limits (live fee parameters)](https://lab.stellar.org/network-limits)
- Contract source: `src/storage.rs`, `src/types.rs`
