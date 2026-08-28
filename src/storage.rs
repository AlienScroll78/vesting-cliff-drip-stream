use soroban_sdk::{Address, Env, Vec};

use crate::types::{DataKey, MilestoneSchedule, VariableRateSchedule, VestingSchedule};

/// Threshold to trigger TTL auto-renewal (within 3,000,000 ledgers of max).
pub const PERSISTENT_LEDGER_THRESHOLD: u32 = 3_000_000;
/// Soroban maximum TTL window (~1 year / 3,110,400 ledgers).
pub const PERSISTENT_BUMP_AMOUNT: u32 = 3_110_400;

/// Default minimum total deposit (in token base units).
pub const DEFAULT_MIN_DEPOSIT: i128 = 100;

// ── TTL management ────────────────────────────────────────────────────────────

/// Bumps the persistent storage key for `recipient` and contract instance storage
/// to the maximum allowed window.
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

// ── Fixed-rate schedule ───────────────────────────────────────────────────────

/// Returns the vesting schedule for `recipient`, or `None` if absent.
///
/// Bumps the entry's TTL via [`ensure_ttl`].
pub fn get_schedule(env: &Env, recipient: &Address) -> Option<VestingSchedule> {
    let key = DataKey::Schedule(recipient.clone());
    let schedule = env
        .storage()
        .persistent()
        .get::<DataKey, VestingSchedule>(&key)?;
    ensure_ttl(env, recipient);
    Some(schedule)
}

/// Returns the vesting schedule for `recipient` (read-only TTL bump).
pub fn get_schedule_readonly(env: &Env, recipient: &Address) -> Option<VestingSchedule> {
    let key = DataKey::Schedule(recipient.clone());
    let schedule = env
        .storage()
        .persistent()
        .get::<DataKey, VestingSchedule>(&key)?;
    ensure_ttl(env, recipient);
    Some(schedule)
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
    ensure_ttl(env, recipient);
}

/// Removes the fixed-rate schedule for `recipient`.
pub fn remove_schedule(env: &Env, recipient: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Schedule(recipient.clone()));
}

// ── Variable-rate schedule ────────────────────────────────────────────────────

/// Returns the variable-rate schedule for `recipient`, or `None` if absent.
pub fn get_variable_schedule(env: &Env, recipient: &Address) -> Option<VariableRateSchedule> {
    let key = DataKey::VariableSchedule(recipient.clone());
    let schedule = env
        .storage()
        .persistent()
        .get::<DataKey, VariableRateSchedule>(&key)?;
    env.storage()
        .instance()
        .extend_ttl(PERSISTENT_LEDGER_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
    Some(schedule)
}

/// Returns the variable-rate schedule for `recipient` (read-only).
pub fn get_variable_schedule_readonly(env: &Env, recipient: &Address) -> Option<VariableRateSchedule> {
    let key = DataKey::VariableSchedule(recipient.clone());
    env.storage()
        .persistent()
        .get::<DataKey, VariableRateSchedule>(&key)
}

/// Returns `true` if a variable-rate schedule exists for `recipient`.
pub fn has_variable_schedule(env: &Env, recipient: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::VariableSchedule(recipient.clone()))
}

/// Persists a variable-rate schedule for `recipient`.
pub fn set_variable_schedule(env: &Env, recipient: &Address, schedule: &VariableRateSchedule) {
    let key = DataKey::VariableSchedule(recipient.clone());
    env.storage().persistent().set(&key, schedule);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_LEDGER_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

/// Removes the variable-rate schedule for `recipient`.
pub fn remove_variable_schedule(env: &Env, recipient: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::VariableSchedule(recipient.clone()));
}

// ── Milestone schedule ────────────────────────────────────────────────────────

/// Returns the milestone schedule for `recipient`, or `None` if absent.
pub fn get_milestone_schedule(env: &Env, recipient: &Address) -> Option<MilestoneSchedule> {
    let key = DataKey::MilestoneSchedule(recipient.clone());
    let schedule = env
        .storage()
        .persistent()
        .get::<DataKey, MilestoneSchedule>(&key)?;
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_LEDGER_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
    Some(schedule)
}

/// Returns `true` if a milestone schedule exists for `recipient`.
pub fn has_milestone_schedule(env: &Env, recipient: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::MilestoneSchedule(recipient.clone()))
}

/// Persists a milestone schedule for `recipient`.
pub fn set_milestone_schedule(env: &Env, recipient: &Address, schedule: &MilestoneSchedule) {
    let key = DataKey::MilestoneSchedule(recipient.clone());
    env.storage().persistent().set(&key, schedule);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_LEDGER_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

/// Removes the milestone schedule for `recipient`.
pub fn remove_milestone_schedule(env: &Env, recipient: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::MilestoneSchedule(recipient.clone()));
}

// ── Admin ─────────────────────────────────────────────────────────────────────

/// Returns the configured admin address, if set.
pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Admin)
}

/// Stores a new admin address in instance storage.
pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

// ── Initialized flag ──────────────────────────────────────────────────────────

/// Returns `true` if the contract has been initialized.
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

// ── Fee / Treasury ────────────────────────────────────────────────────────────

/// Returns the configured fee basis points (default 0).
pub fn get_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<DataKey, u32>(&DataKey::FeeBps)
        .unwrap_or(0)
}

/// Stores fee basis points in instance storage.
pub fn set_fee_bps(env: &Env, fee_bps: u32) {
    env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
}

/// Returns the configured treasury address, if set.
pub fn get_treasury(env: &Env) -> Option<Address> {
    env.storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Treasury)
}

/// Stores the treasury address in instance storage.
pub fn set_treasury(env: &Env, treasury: &Address) {
    env.storage().instance().set(&DataKey::Treasury, treasury);
}

/// Returns the configured fee basis points and optional treasury address.
pub fn get_fee(env: &Env) -> (u32, Option<Address>) {
    let fee_bps = get_fee_bps(env);
    let treasury = get_treasury(env);
    (fee_bps, treasury)
}

/// Sets fee basis points and treasury address in instance storage.
pub fn set_fee(env: &Env, fee_bps: u32, treasury: &Address) {
    set_fee_bps(env, fee_bps);
    set_treasury(env, treasury);
}

// ── Min deposit ───────────────────────────────────────────────────────────────

/// Returns the configured minimum deposit threshold.
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

// ── Allowlist ─────────────────────────────────────────────────────────────────

/// Returns the current allowlist as a `Vec<Address>`.
///
/// An empty `Vec` means permissive mode (all tokens accepted).
pub fn get_allowed_tokens(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get::<DataKey, Vec<Address>>(&DataKey::AllowedTokens)
        .unwrap_or_else(|| Vec::new(env))
}

/// Adds `token` to the allowlist (no-op if already present).
pub fn add_allowed_token(env: &Env, token: &Address) {
    let mut list = get_allowed_tokens(env);
    // Avoid duplicates
    for i in 0..list.len() {
        if list.get(i).unwrap() == *token {
            return;
        }
    }
    list.push_back(token.clone());
    env.storage()
        .instance()
        .set(&DataKey::AllowedTokens, &list);
}

/// Removes `token` from the allowlist (no-op if not present).
pub fn remove_allowed_token(env: &Env, token: &Address) {
    let list = get_allowed_tokens(env);
    let mut new_list: Vec<Address> = Vec::new(env);
    for i in 0..list.len() {
        let t = list.get(i).unwrap();
        if t != *token {
            new_list.push_back(t);
        }
    }
    env.storage()
        .instance()
        .set(&DataKey::AllowedTokens, &new_list);
}

/// Returns `true` if `token` is allowed.
///
/// When the allowlist is empty, all tokens are allowed (permissive mode).
pub fn is_token_allowed(env: &Env, token: &Address) -> bool {
    let list = get_allowed_tokens(env);
    if list.is_empty() {
        return true;
    }
    for i in 0..list.len() {
        if list.get(i).unwrap() == *token {
            return true;
        }
    }
    false
}
