use soroban_sdk::{Address, Env, Vec};

use crate::types::{DataKey, MilestoneSchedule, VariableRateSchedule, VestingSchedule};

/// Threshold to trigger TTL auto-renewal (within 3,000,000 ledgers of max).
pub const PERSISTENT_LEDGER_THRESHOLD: u32 = 3_000_000;
/// Soroban maximum TTL window (~1 year / 3,110,400 ledgers).
pub const PERSISTENT_BUMP_AMOUNT: u32 = 3_110_400;

/// 1-year safety buffer added beyond `end_ledger` when computing proactive TTL.
pub const TTL_BUFFER_LEDGERS: u32 = 6_307_200;

/// Default minimum total deposit (in token base units).
pub const DEFAULT_MIN_DEPOSIT: i128 = 100;

/// Default maximum cliff ratio: 50% of total duration (in basis points).
pub const DEFAULT_MAX_CLIFF_RATIO_BPS: u32 = 5_000;

/// Default minimum rate per ledger.
pub const DEFAULT_MIN_RATE: i128 = 1;

// ── TTL helpers ───────────────────────────────────────────────────────────────

pub fn bump_persistent<K: soroban_sdk::TryIntoVal<Env, soroban_sdk::Val> + soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &K) {
    if env.storage().persistent().has(key) {
        env.storage().persistent().extend_ttl(
            key,
            PERSISTENT_LEDGER_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
    }
}

pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(PERSISTENT_LEDGER_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

/// Computes the proactive TTL for a stream based on its `end_ledger`.
pub fn compute_stream_ttl(env: &Env, end_ledger: u32) -> u32 {
    let current = env.ledger().sequence();
    let target_ttl = end_ledger
        .saturating_add(TTL_BUFFER_LEDGERS)
        .saturating_sub(current);
    target_ttl.min(PERSISTENT_BUMP_AMOUNT)
}

/// Extends TTL for a schedule key based on the stream's own duration.
pub fn ensure_ttl_for_stream(env: &Env, recipient: &Address, schedule: &VestingSchedule) {
    let key = DataKey::Schedule(recipient.clone());
    if env.storage().persistent().has(&key) {
        let ttl = compute_stream_ttl(env, schedule.end_ledger);
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

// ── Fixed-rate schedule ───────────────────────────────────────────────────────

pub fn get_schedule(env: &Env, recipient: &Address) -> Option<VestingSchedule> {
    let key = DataKey::Schedule(recipient.clone());
    let schedule = env
        .storage()
        .persistent()
        .get::<DataKey, VestingSchedule>(&key)?;
    ensure_ttl_for_stream(env, recipient, &schedule);
    Some(schedule)
}

pub fn get_schedule_readonly(env: &Env, recipient: &Address) -> Option<VestingSchedule> {
    let key = DataKey::Schedule(recipient.clone());
    let schedule = env
        .storage()
        .persistent()
        .get::<DataKey, VestingSchedule>(&key)?;
    ensure_ttl_for_stream(env, recipient, &schedule);
    Some(schedule)
}

pub fn has_schedule(env: &Env, recipient: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Schedule(recipient.clone()))
}

pub fn set_schedule(env: &Env, recipient: &Address, schedule: &VestingSchedule) {
    let key = DataKey::Schedule(recipient.clone());
    env.storage().persistent().set(&key, schedule);
    ensure_ttl_for_stream(env, recipient, schedule);
}

pub fn remove_schedule(env: &Env, recipient: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Schedule(recipient.clone()));
}

// ── Variable-rate schedule ────────────────────────────────────────────────────

pub fn get_variable_schedule(env: &Env, recipient: &Address) -> Option<VariableRateSchedule> {
    let key = DataKey::VariableSchedule(recipient.clone());
    let schedule = env
        .storage()
        .persistent()
        .get::<DataKey, VariableRateSchedule>(&key)?;
    bump_persistent(env, &key);
    bump_instance(env);
    Some(schedule)
}

pub fn get_variable_schedule_readonly(env: &Env, recipient: &Address) -> Option<VariableRateSchedule> {
    let key = DataKey::VariableSchedule(recipient.clone());
    let schedule = env
        .storage()
        .persistent()
        .get::<DataKey, VariableRateSchedule>(&key)?;
    bump_persistent(env, &key);
    bump_instance(env);
    Some(schedule)
}

pub fn has_variable_schedule(env: &Env, recipient: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::VariableSchedule(recipient.clone()))
}

pub fn set_variable_schedule(env: &Env, recipient: &Address, schedule: &VariableRateSchedule) {
    let key = DataKey::VariableSchedule(recipient.clone());
    env.storage().persistent().set(&key, schedule);
    bump_persistent(env, &key);
    bump_instance(env);
}

pub fn remove_variable_schedule(env: &Env, recipient: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::VariableSchedule(recipient.clone()));
}

// ── Milestone schedule ────────────────────────────────────────────────────────

pub fn get_milestone_schedule(env: &Env, recipient: &Address) -> Option<MilestoneSchedule> {
    let key = DataKey::MilestoneSchedule(recipient.clone());
    let schedule = env
        .storage()
        .persistent()
        .get::<DataKey, MilestoneSchedule>(&key)?;
    bump_persistent(env, &key);
    bump_instance(env);
    Some(schedule)
}

pub fn has_milestone_schedule(env: &Env, recipient: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::MilestoneSchedule(recipient.clone()))
}

pub fn set_milestone_schedule(env: &Env, recipient: &Address, schedule: &MilestoneSchedule) {
    let key = DataKey::MilestoneSchedule(recipient.clone());
    env.storage().persistent().set(&key, schedule);
    bump_persistent(env, &key);
    bump_instance(env);
}

pub fn remove_milestone_schedule(env: &Env, recipient: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::MilestoneSchedule(recipient.clone()));
}

// ── Instance-level config ─────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
}

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<DataKey, u32>(&DataKey::FeeBps)
        .unwrap_or(0)
}

pub fn set_fee_bps(env: &Env, fee_bps: u32) {
    env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
}

pub fn get_treasury(env: &Env) -> Option<Address> {
    env.storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Treasury)
}

pub fn set_treasury(env: &Env, treasury: &Address) {
    env.storage().instance().set(&DataKey::Treasury, treasury);
}

/// Returns `(fee_bps, treasury)` for protocol fee collection.
pub fn get_fee(env: &Env) -> (u32, Option<Address>) {
    let fee_bps = get_fee_bps(env);
    let treasury = get_treasury(env);
    (fee_bps, treasury)
}

/// Sets both fee_bps and treasury atomically.
pub fn set_fee(env: &Env, fee_bps: u32, treasury: &Address) {
    set_fee_bps(env, fee_bps);
    set_treasury(env, treasury);
}

pub fn get_min_deposit(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<DataKey, i128>(&DataKey::MinDeposit)
        .unwrap_or(DEFAULT_MIN_DEPOSIT)
}

pub fn set_min_deposit(env: &Env, min_deposit: i128) {
    env.storage()
        .instance()
        .set(&DataKey::MinDeposit, &min_deposit);
}

/// Returns the configured max cliff ratio in basis points.
pub fn get_max_cliff_ratio(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<DataKey, u32>(&DataKey::ConfigMaxCliffRatio)
        .unwrap_or(DEFAULT_MAX_CLIFF_RATIO_BPS)
}

/// Stores the max cliff ratio in basis points in instance storage.
pub fn set_max_cliff_ratio(env: &Env, bps: u32) {
    env.storage()
        .instance()
        .set(&DataKey::ConfigMaxCliffRatio, &bps);
}

/// Returns the configured minimum rate per ledger.
pub fn get_min_rate(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<DataKey, i128>(&DataKey::ConfigMinRate)
        .unwrap_or(DEFAULT_MIN_RATE)
}

/// Stores the minimum rate per ledger in instance storage.
pub fn set_min_rate(env: &Env, min_rate: i128) {
    env.storage()
        .instance()
        .set(&DataKey::ConfigMinRate, &min_rate);
}

// ── Token allowlist ───────────────────────────────────────────────────────────

pub fn get_allowed_tokens(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get::<DataKey, Vec<Address>>(&DataKey::AllowedTokens)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_allowed_token(env: &Env, token: &Address) {
    let mut list = get_allowed_tokens(env);
    if !list.contains(token) {
        list.push_back(token.clone());
        env.storage().instance().set(&DataKey::AllowedTokens, &list);
    }
}

pub fn remove_allowed_token(env: &Env, token: &Address) {
    let old = get_allowed_tokens(env);
    let mut new_list: Vec<Address> = Vec::new(env);
    for addr in old.iter() {
        if addr != *token {
            new_list.push_back(addr);
        }
    }
    env.storage().instance().set(&DataKey::AllowedTokens, &new_list);
}

/// Returns `true` if `token` is in the allowlist, or if the allowlist is empty (permissive mode).
pub fn is_token_allowed(env: &Env, token: &Address) -> bool {
    let list = get_allowed_tokens(env);
    if list.is_empty() {
        return true;
    }
    list.contains(token)
}

// ── Recipient allowlist ───────────────────────────────────────────────────────

/// Returns `true` if the recipient allowlist feature is enabled.
pub fn is_allowlist_enabled(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::AllowlistEnabled)
        .unwrap_or(false)
}

/// Sets whether the recipient allowlist enforcement is enabled.
pub fn set_allowlist_enabled(env: &Env, enabled: bool) {
    env.storage()
        .instance()
        .set(&DataKey::AllowlistEnabled, &enabled);
}

/// Returns `true` if `recipient` is on the recipient allowlist.
///
/// When the allowlist is disabled, all recipients are allowed.
pub fn is_recipient_allowed(env: &Env, recipient: &Address) -> bool {
    if !is_allowlist_enabled(env) {
        return true;
    }
    env.storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::RecipientAllowlist(recipient.clone()))
        .unwrap_or(false)
}

/// Sets the allowlist status for a recipient.
pub fn set_recipient_allowlist(env: &Env, recipient: &Address, allowed: bool) {
    env.storage()
        .instance()
        .set(&DataKey::RecipientAllowlist(recipient.clone()), &allowed);
}

// ── Sponsor stream index ──────────────────────────────────────────────────────

pub fn get_sponsor_streams(env: &Env, sponsor: &Address) -> Vec<Address> {
    let key = DataKey::SponsorStreams(sponsor.clone());
    let list = env
        .storage()
        .persistent()
        .get::<DataKey, Vec<Address>>(&key)
        .unwrap_or_else(|| Vec::new(env));
    bump_persistent(env, &key);
    list
}

pub fn add_sponsor_stream(env: &Env, sponsor: &Address, recipient: &Address) {
    let key = DataKey::SponsorStreams(sponsor.clone());
    let mut list = env
        .storage()
        .persistent()
        .get::<DataKey, Vec<Address>>(&key)
        .unwrap_or_else(|| Vec::new(env));
    if !list.contains(recipient) {
        list.push_back(recipient.clone());
        env.storage().persistent().set(&key, &list);
        bump_persistent(env, &key);
    }
}

pub fn remove_sponsor_stream(env: &Env, sponsor: &Address, recipient: &Address) {
    let key = DataKey::SponsorStreams(sponsor.clone());
    let old = env
        .storage()
        .persistent()
        .get::<DataKey, Vec<Address>>(&key)
        .unwrap_or_else(|| Vec::new(env));
    let mut new_list: Vec<Address> = Vec::new(env);
    for addr in old.iter() {
        if addr != *recipient {
            new_list.push_back(addr);
        }
    }
    env.storage().persistent().set(&key, &new_list);
    bump_persistent(env, &key);
}

// ── Reentrancy lock ───────────────────────────────────────────────────────────

pub fn is_locked(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Lock)
}

pub fn acquire_lock(env: &Env) {
    env.storage().instance().set(&DataKey::Lock, &true);
}

pub fn release_lock(env: &Env) {
    env.storage().instance().remove(&DataKey::Lock);
}
