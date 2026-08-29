use soroban_sdk::{Address, Env, Map, Vec};

use crate::types::{DataKey, VariableRateSchedule, VestingSchedule};

/// Threshold to trigger TTL auto-renewal (within 3,000,000 ledgers of max).
pub const PERSISTENT_LEDGER_THRESHOLD: u32 = 3_000_000;
/// Soroban maximum TTL window (~1 year / 3,110,400 ledgers).
pub const PERSISTENT_BUMP_AMOUNT: u32 = 3_110_400;

/// 1-year safety buffer added beyond `end_ledger` when computing proactive TTL (Issue #585).
///
/// Equivalent to ~1 year at ~5 s/ledger: 6 * 60 * 24 * 365 = 3_153_600 ledgers.
/// We cap at `PERSISTENT_BUMP_AMOUNT` (Soroban maximum) if the computed value exceeds it.
pub const TTL_BUFFER_LEDGERS: u32 = 6_307_200;

/// Default minimum total deposit (in token base units).
pub const DEFAULT_MIN_DEPOSIT: i128 = 100;

/// Centralized TTL management function.
///
/// Bumps the persistent storage key for `recipient` as well as contract instance storage
/// to the maximum allowed window (`PERSISTENT_BUMP_AMOUNT`).
pub fn ensure_ttl(env: &Env, recipient: &Address) {
    let key = DataKey::Schedule(recipient.clone());
    if env.storage().persistent().has(&key) {
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_LEDGER_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
    }
    env.storage()
        .instance()
        .extend_ttl(PERSISTENT_LEDGER_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

/// Computes the proactive TTL for a stream based on its `end_ledger` (Issue #585).
///
/// For streams longer than ~60 days (the passive bump threshold), the standard
/// `ensure_ttl` may not be sufficient if the stream has no activity for an
/// extended period. This function returns a TTL sufficient to cover the stream
/// from the current ledger to `end_ledger + TTL_BUFFER_LEDGERS`, capped at
/// `PERSISTENT_BUMP_AMOUNT`.
///
/// # Arguments
/// * `env`       – Soroban environment (used to read the current ledger sequence).
/// * `end_ledger` – The stream's end ledger.
///
/// Returns the TTL in ledgers to use for `extend_ttl`.
pub fn compute_stream_ttl(env: &Env, end_ledger: u32) -> u32 {
    let current = env.ledger().sequence();
    // Total ledgers remaining until end + 1-year buffer.
    let target_ttl = end_ledger
        .saturating_add(TTL_BUFFER_LEDGERS)
        .saturating_sub(current);
    // Cap at Soroban's maximum persistent storage TTL.
    target_ttl.min(PERSISTENT_BUMP_AMOUNT)
}

/// Extends TTL for a schedule key based on the stream's own duration (Issue #585).
///
/// On `create_vesting_stream`, sets TTL = `total_duration + TTL_BUFFER_LEDGERS` (capped at max).
/// On `claim_vested`, re-extends to `end_ledger + TTL_BUFFER_LEDGERS` (capped at max).
///
/// Falls back to `ensure_ttl` behaviour if the computed TTL would be ≤ the threshold.
pub fn ensure_ttl_for_stream(env: &Env, recipient: &Address, schedule: &VestingSchedule) {
    let key = DataKey::Schedule(recipient.clone());
    if env.storage().persistent().has(&key) {
        let ttl = compute_stream_ttl(env, schedule.end_ledger);
        // Use the larger of the proactive TTL and the standard threshold.
        let bump = ttl.max(PERSISTENT_BUMP_AMOUNT);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_LEDGER_THRESHOLD,
            bump,
        );
    }
    env.storage()
        .instance()
        .extend_ttl(PERSISTENT_LEDGER_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

// ── Read ─────────────────────────────────────────────────────────────────────

/// Returns the vesting schedule for `recipient`, or `None` if absent.
///
/// Bumps the entry's TTL via [`ensure_ttl`].
pub fn get_schedule(env: &Env, recipient: &Address) -> Option<VestingSchedule> {
    let key = DataKey::Schedule(recipient.clone());
    let schedule = env
        .storage()
        .persistent()
        .get::<DataKey, VestingSchedule>(&key)?;
    ensure_ttl_for_stream(env, recipient, &schedule);
    Some(schedule)
}

/// Returns the vesting schedule for `recipient` and bumps TTL via [`ensure_ttl_for_stream`].
pub fn get_schedule_readonly(env: &Env, recipient: &Address) -> Option<VestingSchedule> {
    let key = DataKey::Schedule(recipient.clone());
    let schedule = env
        .storage()
        .persistent()
        .get::<DataKey, VestingSchedule>(&key)?;
    ensure_ttl_for_stream(env, recipient, &schedule);
    Some(schedule)
}

/// Returns `true` if a fixed-rate schedule exists for `recipient`.
pub fn has_schedule(env: &Env, recipient: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Schedule(recipient.clone()))
}

/// Persists `schedule` for `recipient` and bumps TTL proactively based on stream duration.
///
/// Uses `ensure_ttl_for_stream` to set TTL = `end_ledger + TTL_BUFFER_LEDGERS` (capped at max),
/// ensuring the entry survives the full stream lifetime without relying solely on passive
/// bump-on-access (Issue #585).
pub fn set_schedule(env: &Env, recipient: &Address, schedule: &VestingSchedule) {
    let key = DataKey::Schedule(recipient.clone());
    env.storage().persistent().set(&key, schedule);
    ensure_ttl_for_stream(env, recipient, schedule);
}

/// Removes the fixed-rate schedule for `recipient`.
pub fn remove_schedule(env: &Env, recipient: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Schedule(recipient.clone()));
}

/// Returns the configured admin address, if set.
pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Admin)
}

/// Stores a new admin address in instance storage.
pub fn set_admin(env: &Env, admin: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::Admin, admin);
}

/// Stores a new minimum deposit value in instance storage.
pub fn set_min_deposit(env: &Env, min_deposit: i128) {
    env.storage()
        .instance()
        .set(&DataKey::MinDeposit, &min_deposit);
}

/// Returns the configured fee basis points (default 0) and treasury address (if set).
pub fn get_fee(env: &Env) -> (u32, Option<Address>) {
    let fee_bps = env
        .storage()
        .instance()
        .get::<DataKey, u32>(&DataKey::FeeBps)
        .unwrap_or(0);
    let treasury = env
        .storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Treasury);
    (fee_bps, treasury)
}

/// Sets configured fee basis points and treasury address in instance storage.
pub fn set_fee(env: &Env, fee_bps: u32, treasury: &Address) {
    env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
    env.storage().instance().set(&DataKey::Treasury, treasury);
}
