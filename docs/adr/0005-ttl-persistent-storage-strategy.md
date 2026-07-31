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

Extend TTL **passively on every read and write** via a centralized `ensure_ttl` guard in `storage.rs`. The threshold and bump constants are:

```rust
pub const PERSISTENT_LEDGER_THRESHOLD: u32 = 259_200;   // ~30 days threshold
pub const PERSISTENT_BUMP_AMOUNT: u32      = 3_110_400; // ~1 year (Soroban maximum)
```

`ensure_ttl` is called in `get_schedule`, `get_schedule_readonly`, and `set_schedule`. This means any transaction or view query that touches a stream — claim, cancel, pause, resume, transfer, or read-only view call — resets the persistent storage entry and instance storage TTL to the maximum ~1 year window.

## Consequences

- No external keeper is required for normal operation.
- Each storage access auto-renews storage TTL to the maximum Soroban window (3,110,400 ledgers).
- Active streams are fully protected against accidental storage expiry.
- The constants are defined in one place (`storage.rs`) and can be adjusted without touching business logic.
