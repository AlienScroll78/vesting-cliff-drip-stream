use soroban_sdk::{Address, Env};

use crate::types::{DataKey, VestingSchedule};

/// Number of ledgers to extend TTL on persistent storage entries.
/// ~30 days at ~5s per ledger (6 * 60 * 24 * 30 = 259_200).
const PERSISTENT_LEDGER_THRESHOLD: u32 = 259_200;
const PERSISTENT_BUMP_AMOUNT: u32 = 518_400; // ~60 days

// ── Read ─────────────────────────────────────────────────────────────────────

/// Returns the vesting schedule for `recipient`, or `None` if absent.
pub fn get_schedule(env: &Env, recipient: &Address) -> Option<VestingSchedule> {
    let key = DataKey::Schedule(recipient.clone());
    if let Some(schedule) = env
        .storage()
        .persistent()
        .get::<DataKey, VestingSchedule>(&key)
    {
        // Bump TTL each time it is read so active streams don't expire.
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_LEDGER_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
        Some(schedule)
    } else {
        None
    }
}

/// Returns `true` if a schedule already exists for `recipient`.
pub fn has_schedule(env: &Env, recipient: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Schedule(recipient.clone()))
}

// ── Write ─────────────────────────────────────────────────────────────────────

/// Persists `schedule` for `recipient` and bumps its TTL.
pub fn set_schedule(env: &Env, recipient: &Address, schedule: &VestingSchedule) {
    let key = DataKey::Schedule(recipient.clone());
    env.storage().persistent().set(&key, schedule);
    env.storage().persistent().extend_ttl(
        &key,
        PERSISTENT_LEDGER_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
}

/// Removes the schedule for `recipient` (called after full stream exhaustion
/// or cancellation).
pub fn remove_schedule(env: &Env, recipient: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Schedule(recipient.clone()));
}
