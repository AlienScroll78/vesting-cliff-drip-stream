# ADR-0009: Multi-Stream Storage Layout

- **Status**: Accepted
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

Adopt a **per-recipient stream ID counter** with a composite key:

```rust
pub enum DataKey {
    // Legacy single-stream key (ADR-0001). Decoded by old code as the only variant.
    Schedule(Address),

    // New multi-stream key: one entry per (recipient, stream_id) pair.
    Stream(Address, u32),

    // Per-recipient counter storing the next stream ID to assign.
    StreamCounter(Address),
}
```

`stream_id` is a monotonically increasing `u32` assigned per recipient. The counter is stored under `DataKey::StreamCounter(recipient)` and incremented atomically on each new stream creation.

**Why per-recipient, not global:** A global counter would produce stream IDs that are unique across all recipients but dense only in the aggregate. Per-recipient counters are simpler to reason about: stream IDs for a given recipient are 0, 1, 2, … and the contract can cheaply enumerate a recipient's streams by iterating from 0 to the counter. A global counter would require a secondary index from `stream_id → recipient` to enumerate, adding storage and complexity. Per-recipient also keeps the counter value small (typically single digits), which is cheaper to store and compare.

**`DataKey::Stream(recipient, stream_id)` was chosen over alternatives** because:

- It is a direct composite of the two values needed to identify a stream: the owner and the ordinal within that owner.
- Lookup is O(1): given a `(recipient, stream_id)`, the contract fetches exactly one ledger entry.
- Enumeration of a recipient's streams is a bounded loop from 0 to `StreamCounter(recipient)`, with no secondary index.
- The key encodes ownership implicitly; there is no risk of a global ID being used to address another recipient's stream by accident.

### Legacy single-stream compatibility

Legacy entries written under `DataKey::Schedule(Address)` are preserved and still readable. The contract treats the legacy key as an implicit `stream_id = 0` entry:

- `get_schedule(recipient)` checks `DataKey::Stream(recipient, 0)` first, then falls back to the legacy `DataKey::Schedule(recipient)` if the new key is absent.
- New streams always use `DataKey::Stream(recipient, stream_id)` with `stream_id` starting at 1, so `stream_id = 0` is reserved for the legacy single-stream entry. This avoids any collision with migrated or pre-existing data.
- A migration path (`migrate_schedule`) lifts a legacy entry into the new key scheme if desired, but this is optional; legacy entries continue to function under the old key without migration.

### Alternatives considered

#### Alternative A: Global stream ID counter

A single `DataKey::NextStreamId` instance counter incremented for every stream across all recipients. Streams keyed by `DataKey::Stream(u32)` alone.

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

Each active stream is one persistent ledger entry under `DataKey::Stream(recipient, stream_id)`. The per-recipient counter is an additional small entry. Compared to the legacy single-stream model, a recipient with N concurrent streams uses N+1 entries instead of 1. At Soroban's current fee schedule this is linear and predictable; the dominant cost is the schedule entry itself (~200 bytes), not the counter (~8 bytes).

### TTL implications

`ensure_ttl` (ADR-0005) is extended to bump both the stream entry and the recipient's counter entry on every access. A recipient's counter never expires while any of their streams is active. Draining or cancelling the last stream removes the counter entry, keeping storage clean.

### Enumeration

Off-chain indexers can enumerate a recipient's streams by reading `StreamCounter(recipient)` and iterating `Stream(recipient, 0..counter)`. Missing entries (drained or cancelled streams) are skipped. This is a read-only operation and does not require a secondary index.

### Migration

Legacy `DataKey::Schedule(Address)` entries continue to work without migration. The contract resolves them as `stream_id = 0`. New streams use `stream_id ≥ 1`. This is a non-breaking change: no upgrade transaction is required for existing streams, and `get_schedule` continues to return the legacy entry for recipients who have not been migrated.

### Error handling

`ScheduleAlreadyExists` (code 6) is reinterpreted: it now fires only when a specific `(recipient, stream_id)` already has an active entry. A recipient can hold multiple streams simultaneously under different IDs. The legacy single-stream path retains the old behaviour (one active stream per recipient) for backward compatibility.

### Future work

- A `list_streams(recipient) -> Vec<u32>` view can be added to return active stream IDs without requiring off-chain enumeration.
- The `stream_id` space is per-recipient and starts at 1, leaving room for a future `stream_id = 0` special case (e.g., a "default" stream) if needed.
- If a recipient accumulates many historical drained streams, the counter grows monotonically but never wraps; a future ADR could address counter compaction if it ever becomes a concern.
