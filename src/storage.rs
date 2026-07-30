use soroban_sdk::{Address, Env};

use crate::types::{DataKey, VariableRateSchedule, VestingSchedule};

/// Number of ledgers to extend TTL on persistent storage entries.
/// ~30 days at ~5s per ledger (6 * 60 * 24 * 30 = 259_200).
const PERSISTENT_LEDGER_THRESHOLD: u32 = 259_200;
const PERSISTENT_BUMP_AMOUNT: u32 = 518_400; // ~60 days

/// Default minimum total deposit (in token base units).
pub const DEFAULT_MIN_DEPOSIT: i128 = 100;

// ── Fixed-rate schedule ───────────────────────────────────────────────────────

/// Returns the vesting schedule for `recipient`, bumping TTL.
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

/// Returns the vesting schedule for `recipient` without bumping TTL.
pub fn get_schedule_readonly(env: &Env, recipient: &Address) -> Option<VestingSchedule> {
    env.storage()
        .persistent()
        .get::<DataKey, VestingSchedule>(&DataKey::Schedule(recipient.clone()))
}

/// Returns `true` if a fixed-rate schedule exists for `recipient`.
pub fn has_schedule(env: &Env, recipient: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Schedule(recipient.clone()))
}

/// Persists `schedule` for `recipient` and bumps TTL.
pub fn set_schedule(env: &Env, recipient: &Address, schedule: &VestingSchedule) {
    let key = DataKey::Schedule(recipient.clone());
    env.storage().persistent().set(&key, schedule);
    env.storage().persistent().extend_ttl(
        &key,
        PERSISTENT_LEDGER_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
}

/// Removes the fixed-rate schedule for `recipient`.
pub fn remove_schedule(env: &Env, recipient: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Schedule(recipient.clone()));
}

// ── Variable-rate schedule ────────────────────────────────────────────────────

/// Returns the variable-rate schedule for `recipient`, bumping TTL.
pub fn get_variable_schedule(env: &Env, recipient: &Address) -> Option<VariableRateSchedule> {
    let key = DataKey::VariableSchedule(recipient.clone());
    let schedule = env
        .storage()
        .persistent()
        .get::<DataKey, VariableRateSchedule>(&key)?;
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_LEDGER_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
    Some(schedule)
}

/// Returns the variable-rate schedule for `recipient` without bumping TTL.
pub fn get_variable_schedule_readonly(
    env: &Env,
    recipient: &Address,
) -> Option<VariableRateSchedule> {
    env.storage()
        .persistent()
        .get::<DataKey, VariableRateSchedule>(&DataKey::VariableSchedule(recipient.clone()))
}

/// Returns `true` if a variable-rate schedule exists for `recipient`.
pub fn has_variable_schedule(env: &Env, recipient: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::VariableSchedule(recipient.clone()))
}

/// Persists a variable-rate schedule for `recipient` and bumps TTL.
pub fn set_variable_schedule(
    env: &Env,
    recipient: &Address,
    schedule: &VariableRateSchedule,
) {
    let key = DataKey::VariableSchedule(recipient.clone());
    env.storage().persistent().set(&key, schedule);
    env.storage().persistent().extend_ttl(
        &key,
        PERSISTENT_LEDGER_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
}

/// Removes the variable-rate schedule for `recipient`.
pub fn remove_variable_schedule(env: &Env, recipient: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::VariableSchedule(recipient.clone()));
}

// ── Instance-level configuration ─────────────────────────────────────────────

/// Returns the configured minimum deposit, falling back to `DEFAULT_MIN_DEPOSIT`.
pub fn get_min_deposit(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<DataKey, i128>(&DataKey::MinDeposit)
        .unwrap_or(DEFAULT_MIN_DEPOSIT)
}

/// Stores a new minimum deposit value in instance storage.
pub fn set_min_deposit(env: &Env, min_deposit: i128) {
    env.storage()
        .instance()
        .set(&DataKey::MinDeposit, &min_deposit);
}

/// Returns the stored admin address, or `None` if `initialize` has not been called.
pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Admin)
}

/// Stores the admin address in instance storage.
pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

/// Returns the fee in basis points (0–500). Defaults to 0 if not set.
pub fn get_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<DataKey, u32>(&DataKey::FeeBps)
        .unwrap_or(0)
}

/// Stores the fee basis points in instance storage.
pub fn set_fee_bps(env: &Env, fee_bps: u32) {
    env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
}

/// Returns the treasury address, or `None` if not set.
pub fn get_treasury(env: &Env) -> Option<Address> {
    env.storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Treasury)
}

/// Stores the treasury address in instance storage.
pub fn set_treasury(env: &Env, treasury: &Address) {
    env.storage().instance().set(&DataKey::Treasury, treasury);
}

/// Returns `true` if `initialize` has been called successfully.
pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::Initialized)
        .unwrap_or(false)
}

/// Marks the contract as initialized.
pub fn set_initialized(env: &Env) {
    env.storage()
        .instance()
        .set(&DataKey::Initialized, &true);
}
