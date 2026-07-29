use soroban_sdk::{Address, Env};

use crate::types::{DataKey, VestingSchedule};

/// Number of ledgers to extend TTL on persistent storage entries.
/// ~30 days at ~5s per ledger (6 * 60 * 24 * 30 = 259_200).
const PERSISTENT_LEDGER_THRESHOLD: u32 = 259_200;
const PERSISTENT_BUMP_AMOUNT: u32 = 518_400; // ~60 days

/// Default minimum total deposit (in token base units).
pub const DEFAULT_MIN_DEPOSIT: i128 = 100;

// ── Read ─────────────────────────────────────────────────────────────────────

/// Returns the vesting schedule for `recipient`, or `None` if absent.
///
/// Bumps the entry's TTL, since a schedule fetched on this path is about to
/// be mutated (claim/cancel/drain) and must not expire mid-stream. Read-only
/// views should call [`get_schedule_readonly`] instead to skip the extra
/// storage-write instructions.
pub fn get_schedule(env: &Env, recipient: &Address) -> Option<VestingSchedule> {
    let key = DataKey::Schedule(recipient.clone());
    let schedule = env
        .storage()
        .persistent()
        .get::<DataKey, VestingSchedule>(&key)?;
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_LEDGER_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
    Some(schedule)
}

/// Returns the vesting schedule for `recipient` without bumping its TTL.
///
/// For pure read-only views (`claimable_amount`, `get_status`, ...) that are
/// called far more often than the contract's mutating entry points and gain
/// nothing from refreshing the entry's expiry on every call.
pub fn get_schedule_readonly(env: &Env, recipient: &Address) -> Option<VestingSchedule> {
    env.storage()
        .persistent()
        .get::<DataKey, VestingSchedule>(&DataKey::Schedule(recipient.clone()))
}

/// Returns `true` if a schedule already exists for `recipient`.
pub fn has_schedule(env: &Env, recipient: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Schedule(recipient.clone()))
}

/// Returns the configured minimum deposit, falling back to `DEFAULT_MIN_DEPOSIT`.
pub fn get_min_deposit(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<DataKey, i128>(&DataKey::MinDeposit)
        .unwrap_or(DEFAULT_MIN_DEPOSIT)
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

/// Stores a new minimum deposit value in instance storage.
/// Callable by an admin to configure the threshold.
pub fn set_min_deposit(env: &Env, min_deposit: i128) {
    env.storage()
        .instance()
        .set(&DataKey::MinDeposit, &min_deposit);
}
