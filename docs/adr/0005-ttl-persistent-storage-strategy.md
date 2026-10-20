# ADR-0005: TTL and Persistent Storage Strategy

- **Status**: Revised
- **Date**: 2026-08-29 (updated from 2026-06-26)

## Context

Soroban persistent storage entries expire after a configurable TTL (time-to-live measured in ledgers). An expired entry is indistinguishable from one that never existed; the contract would treat an expired stream as `ScheduleNotFound`. For a vesting contract with streams lasting months or years, silent expiry would be a critical loss-of-funds bug.

Three mitigation strategies exist:

1. **Off-chain keeper** – an external bot calls a dedicated `bump_ttl` function periodically.
2. **Passive bump on access** – every read and write extends the TTL automatically.
3. **Max TTL on creation** – set TTL to the protocol maximum at creation and never touch it again.

An off-chain keeper introduces an operational dependency: if the bot fails, streams expire. Setting max TTL at creation cannot account for streams that are accessed infrequently near the end of a very long vesting period.

## Problem: Passive Bump Is Insufficient for Long-Duration Streams

The original strategy (ADR-0005 v1) relied on bump-on-access: every read and write extends TTL to the maximum ~1 year window. This works when streams have regular activity. However:

- A stream lasting > 60 days with **no activity** (no claims, no views) will have its persistent storage entry expire within the ~1 year window.
- Recipients who do not interact with the contract for extended periods (e.g., a 2-year vesting stream where the recipient only checks balances annually) could lose their schedule.
- The `PERSISTENT_BUMP_AMOUNT` (3,110,400 ledgers ≈ 1 year) is the Soroban maximum. It cannot be increased, so "bump to max" at creation only buys 1 year regardless of stream length.

## Decision (Revised — Issue #585)

**Proactive TTL on creation and claim**, combined with passive bump on all other access.

### New behaviour

1. **`create_vesting_stream`**: After storing the schedule, compute TTL as:
   ```
   TTL = (end_ledger - current_ledger) + TTL_BUFFER_LEDGERS
   TTL = min(TTL, PERSISTENT_BUMP_AMOUNT)  // cap at Soroban max
   ```
   where `TTL_BUFFER_LEDGERS = 6,307,200` ledgers (≈ 2 years).

2. **`claim_vested`**: After updating the schedule, re-extend TTL to:
   ```
   TTL = (end_ledger - current_ledger) + TTL_BUFFER_LEDGERS
   TTL = min(TTL, PERSISTENT_BUMP_AMOUNT)
   ```
   This ensures the TTL "slides" forward as the stream progresses.

3. **All other operations** (`get_schedule`, `get_schedule_readonly`, `set_schedule`, `pause_stream`, `resume_stream`, `cancel_stream`): continue using `ensure_ttl_for_stream`, which computes the proactive TTL and uses it in place of the flat `PERSISTENT_BUMP_AMOUNT`.

### New constants

```rust
pub const TTL_BUFFER_LEDGERS: u32 = 6_307_200; // ~2 years at 5 s/ledger
```

### New helper functions in `storage.rs`

```rust
/// Compute stream-duration-aware TTL.
pub fn compute_stream_ttl(env: &Env, end_ledger: u32) -> u32 {
    let current = env.ledger().sequence();
    let target = end_ledger.saturating_add(TTL_BUFFER_LEDGERS).saturating_sub(current);
    target.min(PERSISTENT_BUMP_AMOUNT)
}

/// extend_ttl using computed proactive TTL.
pub fn ensure_ttl_for_stream(env: &Env, recipient: &Address, schedule: &VestingSchedule) {
    let key = DataKey::Schedule(recipient.clone());
    if env.storage().persistent().has(&key) {
        let bump = compute_stream_ttl(env, schedule.end_ledger).max(PERSISTENT_BUMP_AMOUNT);
        env.storage().persistent().extend_ttl(&key, PERSISTENT_LEDGER_THRESHOLD, bump);
    }
    env.storage().instance().extend_ttl(PERSISTENT_LEDGER_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}
```

`ensure_ttl` (original, flat-TTL) is retained for backward compatibility on code paths that do not have access to a `VestingSchedule`.

## Consequences

- Streams up to Soroban's maximum TTL (~1 year) are automatically safe from the moment of creation, matching the original behaviour.
- Streams that would exceed 1 year are protected by the proactive TTL re-set on every `claim_vested` call. As long as the recipient claims at least once per year, the entry remains live.
- For completely inactive streams > 1 year, the off-chain keeper recommendation (below) still applies as a last-resort safeguard.
- The `compute_stream_ttl` function centralises the calculation and makes it testable in isolation.

## Residual Risk and Off-chain Safeguard

For streams with **no on-chain activity for > 1 year**, an off-chain monitor should call a read-only view (e.g., `get_schedule`) periodically to trigger the passive TTL bump. This is a belt-and-suspenders measure; the proactive TTL set at creation and claim covers the vast majority of real-world usage.

## `keeper_bump` — Permissionless TTL Refresh (Issue #727)

To give off-chain keepers an explicit, gas-efficient entry point for TTL maintenance, the contract exposes two permissionless functions:

### `keeper_bump(env, recipient: Address) -> Result<(), VestingError>`

Extends the persistent storage TTL of a **fixed-rate** schedule entry without modifying any schedule state. Any address may call this function; no authentication is required.

```rust
pub fn keeper_bump(env: Env, recipient: Address) -> Result<(), VestingError> {
    storage::get_schedule_readonly(&env, &recipient)
        .ok_or(VestingError::ScheduleNotFound)?;
    storage::bump_instance(&env);
    Ok(())
}
```

- Calls `get_schedule_readonly`, which internally calls `ensure_ttl_for_stream`, computing `TTL = end_ledger + TTL_BUFFER_LEDGERS` (capped at `PERSISTENT_BUMP_AMOUNT`).
- Bumps instance storage TTL in the same call.
- Returns `ScheduleNotFound` if no schedule exists (prevents spurious calls for expired/non-existent streams).

### `keeper_bump_variable(env, recipient: Address) -> Result<(), VestingError>`

Equivalent function for **variable-rate** (`create_variable_stream`) schedules.

### Keeper Strategy

Off-chain keepers should:

1. Enumerate all active streams (via `get_streams_for_sponsor` or an indexed event stream).
2. For each stream where `end_ledger > current_ledger + PERSISTENT_BUMP_AMOUNT`, call `keeper_bump` at least once per year.
3. Specifically target streams created with `total_duration > PERSISTENT_BUMP_AMOUNT` ledgers that have had no on-chain activity for ≥ 11 months.

The bump formula ensures the TTL is set to `max(PERSISTENT_BUMP_AMOUNT, end_ledger - current_ledger + TTL_BUFFER_LEDGERS)`. For a stream in its second year, a single `keeper_bump` call resets the full 1-year window.

### Why permissionless?

Making `keeper_bump` permissionless means anyone — the sponsor, the recipient, a third-party monitoring service, or a community bot — can maintain stream liveness. There is no risk to schedule state (the function is read-only w.r.t. schedule data); the only effect is extending TTL.

## Tests

`test_edge_cases.rs::test_ttl_bumped_on_read` verifies the bump-on-access behaviour. Additional tests should verify:

- TTL after `create_vesting_stream` reflects `end_ledger + TTL_BUFFER_LEDGERS` (capped).
- TTL after `claim_vested` is re-extended relative to the current ledger.
- `compute_stream_ttl` returns `PERSISTENT_BUMP_AMOUNT` when the stream has already expired.
- `keeper_bump` returns `ScheduleNotFound` for unknown recipients.
- `keeper_bump` succeeds without modifying schedule state for a valid stream.
