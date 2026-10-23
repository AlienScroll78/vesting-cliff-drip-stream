# ADR-0012: Multi-Stream Storage Layout

- **Status**: Proposed
- **Date**: 2026-10-19

## Context

ADR-0001 established the single-stream-per-recipient storage model: `DataKey::Schedule(Address)` maps a recipient address to one `VestingSchedule`. ADR-0005 added passive TTL bumping on every read/write so that active streams never silently expire.

As the contract evolves, two requirements emerge that the single-stream model cannot satisfy:

1. **Lifecycle streams.** A contributor may finish one vesting grant, then receive a second grant for a new role or a refreshed retention plan. With a single key per recipient, the second grant cannot be created until the first schedule is explicitly removed, even after `end_ledger` has passed and the stream is functionally dead but not yet drained.
2. **Concurrent streams.** A sponsor may want to run two parallel grants for the same recipient with different tokens, rates, or cliff durations (e.g., a base salary stream and a bonus stream vesting on different schedules). The current model forbids this with `ScheduleAlreadyExists` (code 6).

Both requirements point toward a multi-stream storage layout. The open question is _how streams are identified and keyed_.

### Constraints

- Soroban persistent storage charges per ledger entry (read, write, and TTL). Each additional key per recipient adds storage cost but is independent of the entry's size.
- XDR forward-compatibility is a hard requirement (see ADR-0006 and ADR-0007): any new key scheme must not break decoding of legacy single-stream entries written before the change.
- The contract has no off-chain indexer dependency for correctness; any identifier scheme must allow the contract alone to resolve which stream a caller means.
- The Stellar address type is a fixed 32-byte value; there is no cheap way to hash or compress it further.

## Decision

Adopt a **per-recipient stream ID counter** with a composite key. The decision is expressed as `DataKey::Stream(recipient, stream_id)`; the current storage implementation refers to the same composite schedule key as `DataKey::ScheduleById` and the next-ID counter as `DataKey::NextStreamId`:

```rust
pub enum DataKey {
    // Legacy single-stream key (ADR-0001). Decoded by old code as the only variant.
    Schedule(Address),

    // New multi-stream key: one entry per (recipient, stream_id) pair.
    ScheduleById(Address, u32),

    // Per-recipient counter storing the next stream ID to assign.
    NextStreamId(Address),
}
```

`stream_id` is a monotonically increasing `u32` assigned per recipient. The counter is stored under `DataKey::NextStreamId(recipient)` and incremented atomically on each new stream creation. If a legacy schedule exists, ID 0 remains reserved for it and new IDs begin at 1; otherwise IDs begin at 0.

**Why per-recipient, not global:** A global counter would produce stream IDs that are unique across all recipients but dense only in the aggregate. Per-recipient counters are simpler to reason about: stream IDs for a given recipient are 0, 1, 2, … and the contract can cheaply enumerate a recipient's streams by iterating from 0 to the counter. A global counter would require a secondary index from `stream_id → recipient` to enumerate, adding storage and complexity. Per-recipient also keeps the counter value small (typically single digits), which is cheaper to store and compare.

**`DataKey::Stream(recipient, stream_id)` was chosen over alternatives** because:

- It is a direct composite of the two values needed to identify a stream: the owner and the ordinal within that owner.
- Lookup is O(1): given a `(recipient, stream_id)`, the contract fetches exactly one ledger entry.
- Enumeration of a recipient's streams is a bounded loop from 0 to `NextStreamId(recipient)`, with no secondary index.
- The key encodes ownership implicitly; there is no risk of a global ID being used to address another recipient's stream by accident.

### Legacy single-stream compatibility

Legacy entries written under `DataKey::Schedule(Address)` are preserved and still readable. The contract treats the legacy key as an implicit `stream_id = 0` entry:

- The legacy key remains readable for existing deployments; the stream enumeration and lookup paths recognize `DataKey::Schedule(recipient)` alongside the new `DataKey::ScheduleById(recipient, stream_id)` key.
- When a legacy schedule exists, it is treated as stream ID 0 and new streams start at ID 1, avoiding collisions with pre-existing data. Without a legacy entry, allocation starts at ID 0.
- Migration is not required for compatibility. Existing entries can remain under `DataKey::Schedule(recipient)` until an operation writes them using the new key scheme.

### Alternatives considered

#### Alternative A: Global stream ID counter

A single global counter incremented for every stream across all recipients. Streams keyed by `DataKey::Stream(u32)` alone.

**Why rejected:**
- Enumerating a single recipient's streams requires a secondary index (`DataKey::RecipientStreams(Address) → Vec<u32>`), which is a second ledger entry per recipient and a maintenance burden (append-on-create, remove-on-drain).
- The global counter grows without bound and becomes a write-contention point: every `create_vesting_stream` transaction must read-and-write the same instance key, which serializes stream creation globally on Soroban.
- A `u32` global ID conveys no ownership information; a caller who passes the wrong ID silently addresses another recipient's stream, a class of bug that the per-recipient scheme prevents by construction.

#### Alternative B: UUID-based stream IDs

Generate a 128-bit UUID per stream and key by `DataKey::Stream(BytesN<16>)`.

**Why rejected:**
- UUIDs require an off-chain registry to map a human-readable identifier to the UUID; the contract cannot enumerate a recipient's streams without a secondary index (same problem as the global counter, plus larger keys).
- Soroban `BytesN<16>` keys are larger and cost more to read/write than a `u32` stream ID.
- UUIDs solve a uniqueness problem that the per-recipient counter already solves: within a recipient, IDs are dense and unique; across recipients, the `(recipient, stream_id)` tuple is globally unique.
- No randomness source is needed for the per-recipient scheme; UUID generation either requires an on-chain RNG (not available in pure Soroban) or a deterministic derivation (which is just a counter in disguise).

#### Alternative C: Hash-based ID

Derive `stream_id = hash(sponsor, recipient, token, start_ledger)` and key by the hash.

**Why rejected:**
- Hash collisions are unlikely but not impossible; the per-recipient counter has zero collision risk by construction.
- A hash-based ID is opaque: given an ID, the contract cannot recover the recipient without a reverse index. This re-introduces the secondary-index problem.
- Two streams with identical creation parameters (same sponsor, recipient, token, and start ledger — possible if two transactions land in the same ledger) would collide. The per-recipient counter handles this trivially by assigning the next integer.
- Soroban `Env::compute_hash_sha256` is available, but using it for ID generation adds CPU cost that a simple counter avoids.

## Consequences

### Storage cost

Each active stream is one persistent ledger entry under `DataKey::ScheduleById(recipient, stream_id)`. The per-recipient next-ID counter is an additional small entry. Compared to the legacy single-stream model, a recipient with N concurrent streams uses N+1 entries instead of 1. At Soroban's current fee schedule this is linear and predictable; the dominant cost is the schedule entry itself (~200 bytes), not the counter (~8 bytes).

### TTL implications

`ensure_ttl` (ADR-0005) is extended to bump the stream entry and the recipient's counter entry on access. A recipient's counter must remain available while streams are active so IDs are not reused. Draining or cancelling a stream removes its schedule entry; counter cleanup is an implementation detail and must not cause an ID collision if reused.

### Enumeration

Off-chain indexers can enumerate a recipient's streams by reading `NextStreamId(recipient)` and iterating `ScheduleById(recipient, 0..next_id)`. Missing entries (drained or cancelled streams) are skipped. This is a read-only operation and does not require a secondary index.

### Migration

Legacy `DataKey::Schedule(Address)` entries continue to work without migration. They are treated as `stream_id = 0`; new streams start at ID 1 for recipients with legacy data. This is a non-breaking change: no upgrade transaction is required for existing streams, and legacy lookups remain supported.

### Error handling

`ScheduleAlreadyExists` (code 6) is reinterpreted: it now fires only when a specific `(recipient, stream_id)` already has an active entry. A recipient can hold multiple streams simultaneously under different IDs. The legacy single-stream path retains the old behaviour (one active stream per recipient) for backward compatibility.

### Future work

- A `list_streams(recipient) -> Vec<u32>` view can be added to return active stream IDs without requiring off-chain enumeration.
- The `stream_id` space is per-recipient. ID 0 is the legacy stream when a legacy entry exists; otherwise it is available to the first new stream.
- If a recipient accumulates many historical drained streams, the counter grows monotonically but never wraps; a future ADR could address counter compaction if it ever becomes a concern.
