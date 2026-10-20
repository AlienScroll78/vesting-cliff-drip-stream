# ADR-0009: Reject Multi-Token Streams for Same Recipient

| Field    | Value                          |
|----------|--------------------------------|
| Status   | Accepted                       |
| Date     | 2026-09-29                     |
| Issue    | [#799](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/799) |
| Related  | [ADR-0001](0001-per-recipient-storage-key.md), [ADR-0008](0008-multi-token-storage.md) |

## Context

The contract uses the recipient's `Address` as the sole storage key for `VestingSchedule` (see ADR-0001). This means the storage slot `DataKey::Schedule(recipient)` is unique per recipient — it cannot hold two concurrent schedules.

A natural question arose: should the contract permit a second concurrent stream for the same recipient if it uses a **different token**? For example:
- Sponsor A creates a USDC stream to `RECIPIENT`.
- Sponsor B wants to create a second XLM stream to the same `RECIPIENT`.

Under the current storage layout, writing a second `VestingSchedule` to `DataKey::Schedule(recipient)` would silently overwrite the first, causing Sponsor A's stream to be lost.

Several alternatives were evaluated:

| Alternative | Problem |
|-------------|---------|
| Composite key `(recipient, token)` | Breaking change to storage layout; invalidates all existing streams |
| Composite key `(recipient, sponsor)` | Same breaking concern; allows unbounded stream accumulation per recipient |
| Linked-list of schedules per recipient | Significant complexity, higher storage costs, harder to reason about TTL |
| Reject with `ScheduleAlreadyExists` | Simple, safe, backward-compatible |

## Decision

**Enforce one active stream per recipient at any time.** Any call to `create_vesting_stream` for a recipient that already has an active `VestingSchedule` returns `ScheduleAlreadyExists` (error code 6), regardless of the token or sponsor involved.

Sponsors who need to replace a stream must first call `cancel_stream` on the existing one, then create the new stream.

Sponsors who need to send two different token streams to the same individual should ask the recipient to provide a second wallet address for the second stream.

This is a deliberate scope restriction, not a deficiency. The per-recipient key design in ADR-0001 is simple, gas-efficient, and auditable. Relaxing it requires a schema migration and is tracked as a future possibility in ADR-0008.

## Consequences

**Positive**

- O(1) storage read/write for all schedule operations — no key iteration required.
- No risk of accidental overwrite of an existing stream.
- Simple, auditable invariant: at most one active schedule per recipient address.
- No breaking change to existing deployments.

**Negative**

- A recipient cannot hold two concurrent vesting streams under one address.
- Sponsors cannot independently create overlapping streams to the same recipient without coordination.
- Workaround (second wallet) is operationally inconvenient for recipients who prefer a single address.

**Neutral**

- ADR-0008 proposes a future composite-key storage layout that would supersede this restriction if adopted. Until that migration is implemented and tested, this restriction remains in force.
- The `ScheduleAlreadyExists` error (code 6) already existed in v1.0.0; this ADR formalises the rationale rather than introducing a new behaviour.
