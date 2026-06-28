# ADR-0001: Per-Recipient Storage Key

- **Status**: Accepted
- **Date**: 2026-06-26

## Context

The contract must store one `VestingSchedule` per stream. Two structural options exist:

1. **Single-map entry** – one storage key holds a `Map<Address, VestingSchedule>`.
2. **Per-recipient key** – each recipient gets its own `DataKey::Schedule(Address)` entry.

Soroban charges CPU and memory fees per byte read from storage. A single map must deserialise the entire map even when accessing one entry; the cost grows linearly with the number of active streams. Soroban also enforces per-entry TTL, not per-map TTL, so a single map could expire all streams at once.

## Decision

Use `DataKey::Schedule(Address)` — a distinct persistent-storage entry per recipient, implemented in `src/types.rs` and `src/storage.rs`.

```rust
pub enum DataKey {
    Schedule(Address),
}
```

Each `get_schedule`, `set_schedule`, and `remove_schedule` call touches exactly one ledger entry, and TTL is bumped independently per recipient on every access.

## Consequences

- Read/write cost is O(1) per recipient regardless of total stream count.
- TTL expiry is isolated: one dormant stream expiring does not affect others.
- There is no built-in enumeration of all active streams; an off-chain indexer must track the `StreamCreated` event to reconstruct the full list.
