# ADR-0005: TTL and Persistent Storage Strategy

- **Status**: Accepted
- **Date**: 2026-06-26

## Context

Soroban persistent storage entries expire after a configurable TTL (time-to-live measured in ledgers). An expired entry is indistinguishable from one that never existed; the contract would treat an expired stream as `ScheduleNotFound`. For a vesting contract with streams lasting months or years, silent expiry would be a critical loss-of-funds bug.

Three mitigation strategies exist:

1. **Off-chain keeper** – an external bot calls a dedicated `bump_ttl` function periodically.
2. **Passive bump on access** – every read and write extends the TTL automatically.
3. **Max TTL on creation** – set TTL to the protocol maximum at creation and never touch it again.

An off-chain keeper introduces an operational dependency: if the bot fails, streams expire. Setting max TTL at creation cannot account for streams that are accessed infrequently near the end of a very long vesting period.

## Decision

Extend TTL **passively on every read and write** in `storage.rs`. The threshold and bump constants are:

```rust
const PERSISTENT_LEDGER_THRESHOLD: u32 = 259_200; // ~30 days at 5 s/ledger
const PERSISTENT_BUMP_AMOUNT: u32      = 518_400; // ~60 days
```

`extend_ttl` is called in `get_schedule` (after a successful read) and `set_schedule` (after every write). This means any transaction that touches a stream — claim, cancel, or a read-only view call — resets the window to ~60 days.

A stream that has no on-chain activity for 60 days may expire. This is an acceptable trade-off for streams with active participants; a future upgrade could add an explicit `bump` entry-point for truly dormant streams.

## Consequences

- No external keeper is required for normal operation.
- Each storage access incurs one additional `extend_ttl` call (~small fixed fee).
- A stream with zero on-chain interaction for >60 days will expire. Recipients of long-term streams should claim or check-in at least once every 60 days, or a keeper should be run.
- The constants are defined in one place (`storage.rs`) and can be adjusted without touching business logic.
