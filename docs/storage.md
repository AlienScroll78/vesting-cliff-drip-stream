# Persistent Storage Design

This document covers the contract's on-chain storage layout, TTL management strategy, cost estimates, and size constraints.

---

## DataKey Enum

```rust
pub enum DataKey {
    Schedule(Address),
}
```

There is exactly one variant:

| Variant | Key type | Value type | Cardinality |
|---|---|---|---|
| `Schedule(Address)` | recipient `Address` | `VestingSchedule` struct | one entry per active stream |

Each recipient gets its own independent `CONTRACT_DATA` ledger entry keyed by `DataKey::Schedule(recipient)`. There is no shared or instance-level storage in this contract.

---

## VestingSchedule Layout

The serialised value stored under each `Schedule` key is a `VestingSchedule`:

```rust
pub struct VestingSchedule {
    pub token: Address,            // 32-byte contract ID
    pub rate_per_ledger: i128,     // 16 bytes
    pub start_ledger: u32,         // 4 bytes
    pub cliff_ledger: u32,         // 4 bytes
    pub end_ledger: u32,           // 4 bytes
    pub last_claimed_ledger: u32,  // 4 bytes
}
```

XDR overhead (envelope, type tags, map keys) adds roughly 100–150 bytes. Total on-chain size per entry is approximately **200–250 bytes**.

The Soroban ledger entry size limit is **64 KB** per `CONTRACT_DATA` entry, so a single `VestingSchedule` uses well under 1% of that limit.

---

## TTL Bump Strategy

All reads and writes go through `src/storage.rs`, which applies a consistent bump policy:

```rust
const PERSISTENT_LEDGER_THRESHOLD: u32 = 259_200;  // ~30 days at 5 s/ledger
const PERSISTENT_BUMP_AMOUNT: u32     = 518_400;   // ~60 days at 5 s/ledger
```

The `extend_ttl(key, threshold, bump_to)` call is a **conditional extension**: if the entry's current TTL is already above `threshold` (30 days), the call is a no-op and incurs no extra fee. If the TTL has fallen below 30 days, it is extended to `bump_to` (60 days from now).

### When bumps occur

| Operation | Bump triggered? |
|---|---|
| `get_schedule` (read) | Yes — on every successful read |
| `set_schedule` (write) | Yes — after every write |
| `has_schedule` (existence check) | No — existence check only |
| `remove_schedule` (delete) | No — entry is deleted |

The result is that any stream touched by `create_vesting_stream`, `claim_vested`, `cancel_stream`, or any view function that calls `get_schedule` will have its TTL refreshed to 60 days from that ledger.

### Expiry and archival

Persistent entries that reach TTL 0 are **archived** (not deleted). An archived entry can be automatically restored when a transaction that accesses it is simulated via Stellar RPC — the simulation detects the archived entry and includes a restoration preamble in the response (Protocol 23+). Normal rent fees apply on restoration.

The minimum TTL granted on restoration is ~4 096 ledgers (~5.7 hours). If a stream goes untouched for more than 60 days it will archive, but will be transparently restored on the next interaction.

---

## Cost Estimates

> All figures are approximations based on mainnet fee parameters as of mid-2025 and an XLM price of ~$0.10. Actual costs vary with network congestion and XLM price. Always simulate transactions via `stellar transaction simulate` for exact fees before submission.

### Write fee (create / update)

Soroban charges a **rent fee** proportional to entry size and TTL extension length. The formula is roughly:

```
rent_fee ≈ (entry_size_bytes × ttl_ledgers_extended) × fee_rate_per_byte_ledger
```

For a ~250-byte entry extended by 518 400 ledgers (60 days):

| Parameter | Value |
|---|---|
| Entry size | ~250 bytes |
| TTL extension | 518 400 ledgers |
| Fee rate (approximate) | ~4 000 stroops / (byte · ledger) × 10⁻⁹ |
| **Estimated rent fee** | **~500 000 stroops (~0.05 XLM, ~$0.005)** |

Add ~100 000–200 000 stroops for CPU and I/O resource fees, giving a total `create_vesting_stream` transaction cost of roughly **0.05–0.08 XLM** per stream.

### Read fee (claim / view)

Reads that trigger the conditional TTL bump only pay if the TTL has actually dropped below the threshold. If the stream was accessed within the last 30 days, the bump is a no-op and no rent is charged.

A typical `claim_vested` call (read + write the updated `last_claimed_ledger`) costs approximately **0.01–0.03 XLM** in resource fees.

### Rent per stream per year

If a stream is claimed monthly (12 bumps/year, each renewing 60-day TTL):

```
12 × 0.05 XLM ≈ 0.60 XLM/year per stream
```

For an infrequently touched stream that archives and must be restored, add a one-time **restoration fee** of ~0.02–0.05 XLM.

---

## Storage Size Limits

| Limit | Value | Source |
|---|---|---|
| Max `CONTRACT_DATA` entry size | 64 KB | Soroban protocol limit |
| `VestingSchedule` actual size | ~250 bytes | XDR serialisation estimate |
| Max TTL extension | ~`max_ttl()` ledgers (~1 year) | Network parameter |
| Min TTL on creation/restore | ~4 096 ledgers (~5.7 hours) | Network parameter |

There is no per-contract cap on the number of `Persistent` entries, so the contract can support an unbounded number of concurrent streams. Each stream is an independent ledger entry; one stream expiring or being archived does not affect others.

---

## References

- [Soroban State Archival](https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage/state-archival)
- [Choosing the Right Storage Type](https://developers.stellar.org/docs/build/guides/storage/choosing-the-right-storage)
- [Stellar Lab — Network Limits (live fee parameters)](https://lab.stellar.org/network-limits)
- Contract source: `src/storage.rs`, `src/types.rs`
