use soroban_sdk::{Address, Env, Vec};

use crate::types::{DataKey, MilestoneSchedule, VariableRateSchedule, VestingSchedule};

/// Threshold to trigger TTL auto-renewal (within 3,000,000 ledgers of max).
pub const PERSISTENT_LEDGER_THRESHOLD: u32 = 3_000_000;
/// Soroban maximum TTL window (~1 year / 3,110,400 ledgers).
pub const PERSISTENT_BUMP_AMOUNT: u32 = 3_110_400;

/// 1-year safety buffer added beyond `end_ledger` when computing proactive TTL (Issue #585).
///
/// Equivalent to ~1 year at ~5 s/ledger: 6 * 60 * 24 * 365 = 3_153_600 ledgers.
/// We cap at `PERSISTENT_BUMP_AMOUNT` (Soroban maximum) if the computed value exceeds it.
pub const TTL_BUFFER_LEDGERS: u32 = 3_153_600;

/// Default minimum total deposit (in token base units).
pub const DEFAULT_MIN_DEPOSIT: i128 = 100;

/// Default maximum cliff ratio: 50% of total duration (in basis points).
pub const DEFAULT_MAX_CLIFF_RATIO_BPS: u32 = 5_000;

/// Default minimum rate per ledger.
pub const DEFAULT_MIN_RATE: i128 = 1;

// ── TTL helpers ───────────────────────────────────────────────────────────────

/// Extends the TTL of a single persistent storage entry to the Soroban maximum.
///
/// This is the *passive* bump strategy: it is a no-op when the key is absent,
/// so callers do not need to check for existence first. It renews to a fixed
/// window rather than to any value derived from the entry's contents, which is
/// why [`ensure_ttl_for_stream`] exists for fixed-rate schedules.
///
/// # Arguments
/// * `env` – Soroban environment.
/// * `key` – Any key convertible to and from a storage `Val`.
///
/// # Notes
/// Skipped entirely when the key does not exist, because `extend_ttl` on a
/// missing entry is an error rather than a no-op.
pub fn bump_persistent<K: soroban_sdk::TryIntoVal<Env, soroban_sdk::Val> + soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &K) {
    if env.storage().persistent().has(key) {
        env.storage().persistent().extend_ttl(
            key,
            PERSISTENT_LEDGER_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
    }
}

/// Extends the instance-storage TTL to the Soroban maximum.
///
/// Instance storage backs the contract's configuration (admin, fee, limits).
/// It is shared by every stream, so it is renewed on any entry point rather
/// than per stream, and is never a no-op — unlike [`bump_persistent`], the
/// instance always exists once the contract has been initialized.
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
    ensure_ttl_for_stream_id(env, recipient, 0, schedule);
}

pub fn ensure_ttl_for_stream_id(
    env: &Env,
    recipient: &Address,
    stream_id: u32,
    schedule: &VestingSchedule,
) {
    let key = DataKey::ScheduleById(recipient.clone(), stream_id);
    if env.storage().persistent().has(&key) {
        let ttl = compute_stream_ttl(env, schedule.end_ledger);
        if ttl > PERSISTENT_LEDGER_THRESHOLD {
            env.storage().persistent().extend_ttl(
                &key,
                PERSISTENT_LEDGER_THRESHOLD,
                ttl,
            );
        }
    }
    env.storage()
        .instance()
        .extend_ttl(PERSISTENT_LEDGER_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

// ── Fixed-rate schedule ───────────────────────────────────────────────────────

/// Returns the fixed-rate [`VestingSchedule`] for `recipient`, extending TTL.
///
/// # Arguments
/// * `env` – Soroban environment.
/// * `recipient` – The stream's recipient; one schedule exists per recipient.
///
/// # Returns
/// `Some(schedule)` when a fixed-rate stream exists, otherwise `None`.
///
/// # Notes
/// This is **not** a read-only accessor: it renews the entry's TTL via
/// [`ensure_ttl_for_stream`] and the instance TTL as a side effect. Naming a
/// getter `get_*` while writing storage is the existing convention in this
/// module; see [`get_schedule_readonly`] for a note on why that name is
/// currently misleading.
pub fn get_schedule(env: &Env, recipient: &Address) -> Option<VestingSchedule> {
    let key = DataKey::Schedule(recipient.clone());
    let mut schedule = env
        .storage()
        .persistent()
        .get::<DataKey, VestingSchedule>(&key)?;
    // Apply forward-compatible schema migration before returning.
    // This is a no-op when the record is already at CURRENT_SCHEMA_VERSION.
    crate::migration::migrate_schedule(env, recipient, &mut schedule);
    ensure_ttl_for_stream(env, recipient, &schedule);
    Some(schedule)
}

/// Returns the vesting schedule for `recipient` without modifying TTL.
pub fn get_schedule_readonly(env: &Env, recipient: &Address) -> Option<VestingSchedule> {
    let key = DataKey::Schedule(recipient.clone());
    env.storage()
        .persistent()
        .get::<DataKey, VestingSchedule>(&key)
}

/// Reports whether a fixed-rate schedule exists for `recipient`.
///
/// Unlike [`get_schedule`] this does not renew any TTL, so it is the correct
/// choice for existence checks that should not extend a stream's lifetime —
/// notably `create_vesting_stream`'s duplicate-stream guard.
pub fn has_schedule(env: &Env, recipient: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::ScheduleById(recipient.clone(), 0))
        || env
            .storage()
            .persistent()
            .has(&DataKey::Schedule(recipient.clone()))
}

pub fn set_schedule(env: &Env, recipient: &Address, schedule: &VestingSchedule) {
    set_schedule_by_id(env, recipient, 0, schedule);
}

pub fn set_schedule_by_id(
    env: &Env,
    recipient: &Address,
    stream_id: u32,
    schedule: &VestingSchedule,
) {
    let key = DataKey::ScheduleById(recipient.clone(), stream_id);
    env.storage().persistent().set(&key, schedule);
    if stream_id == 0 {
        env.storage()
            .persistent()
            .remove(&DataKey::Schedule(recipient.clone()));
    }
    if let Some(next_id) = stream_id.checked_add(1) {
        let next_key = DataKey::NextStreamId(recipient.clone());
        let stored_next = env.storage().persistent().get::<DataKey, u32>(&next_key).unwrap_or(0);
        if stored_next < next_id {
            env.storage().persistent().set(&next_key, &next_id);
        }
    }
    ensure_ttl_for_stream_id(env, recipient, stream_id, schedule);
}

/// Deletes the fixed-rate schedule for `recipient`.
///
/// # Notes
/// Used by every terminal path — cancel, clawback, drain, and the auto-removal
/// that follows a fully-consumed stream. Because all of them converge on
/// removal, a removed schedule is observable only as `StreamStatus::NotFound`.
/// See `docs/flows.md` for why `Cancelled` and `Drained` are not separately
/// observable states.
pub fn remove_schedule(env: &Env, recipient: &Address) {
    remove_schedule_by_id(env, recipient, 0);
}

pub fn remove_schedule_by_id(env: &Env, recipient: &Address, stream_id: u32) {
    env.storage()
        .persistent()
        .remove(&DataKey::ScheduleById(recipient.clone(), stream_id));
    if stream_id == 0 {
        env.storage()
            .persistent()
            .remove(&DataKey::Schedule(recipient.clone()));
    }
}

pub fn next_stream_id(env: &Env, recipient: &Address) -> Result<u32, crate::error::VestingError> {
    let key = DataKey::NextStreamId(recipient.clone());
    let next_id = env.storage().persistent().get::<DataKey, u32>(&key).unwrap_or_else(|| {
        if env
            .storage()
            .persistent()
            .has(&DataKey::Schedule(recipient.clone()))
        {
            1
        } else {
            0
        }
    });
    let following_id = next_id
        .checked_add(1)
        .ok_or(crate::error::VestingError::DepositOverflow)?;
    env.storage().persistent().set(&key, &following_id);
    env.storage().persistent().extend_ttl(
        &key,
        PERSISTENT_LEDGER_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
    Ok(next_id)
}

pub fn get_stream_ids(env: &Env, recipient: &Address) -> Vec<u32> {
    let mut ids = Vec::new(env);
    let next_id = env
        .storage()
        .persistent()
        .get::<DataKey, u32>(&DataKey::NextStreamId(recipient.clone()))
        .unwrap_or(0);
    for stream_id in 0..next_id {
        if env
            .storage()
            .persistent()
            .has(&DataKey::ScheduleById(recipient.clone(), stream_id))
            || (stream_id == 0
                    && env.storage().persistent().has(&DataKey::Schedule(recipient.clone())))
        {
            ids.push_back(stream_id);
        }
    }
    if next_id == 0
        && (env
            .storage()
            .persistent()
            .has(&DataKey::ScheduleById(recipient.clone(), 0))
            || env.storage().persistent().has(&DataKey::Schedule(recipient.clone())))
    {
        ids.push_back(0);
    }
    ids
}

// ── Variable-rate schedule ────────────────────────────────────────────────────

/// Returns the variable-rate schedule for `recipient`, extending TTL.
///
/// # Arguments
/// * `env` – Soroban environment.
/// * `recipient` – The stream's recipient.
///
/// # Returns
/// `Some(schedule)` when a variable-rate stream exists, otherwise `None`.
///
/// # Notes
/// Renews both the entry and the instance TTL via [`bump_persistent`] and
/// [`bump_instance`]. Variable-rate streams do not use
/// [`ensure_ttl_for_stream`], so their TTL is a flat window rather than one
/// derived from `end_ledger`.
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

/// Returns the variable-rate schedule for `recipient` without renewing its TTL.
///
/// # Arguments
/// * `env` – Soroban environment.
/// * `recipient` – The stream's recipient.
///
/// # Returns
/// `Some(schedule)` when a variable-rate stream exists, otherwise `None`.
///
/// # Warning
/// This is currently **byte-for-byte identical to
/// [`get_variable_schedule`]** and therefore also extends TTL. The two are
/// intended to diverge: this variant exists for view functions, which must not
/// mutate state because a read that writes cannot be simulated cheaply and can
/// surprise callers relying on read-only RPC behaviour. Tracked for correction
/// in #856.
pub fn get_variable_schedule_readonly(env: &Env, recipient: &Address) -> Option<VariableRateSchedule> {
    let key = DataKey::VariableSchedule(recipient.clone());
    env.storage()
        .persistent()
        .get::<DataKey, VariableRateSchedule>(&key)
}

/// Reports whether a variable-rate schedule exists for `recipient`.
///
/// Does not renew any TTL.
pub fn has_variable_schedule(env: &Env, recipient: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::VariableSchedule(recipient.clone()))
}

/// Persists a variable-rate schedule and renews its TTL.
///
/// # Arguments
/// * `env` – Soroban environment.
/// * `recipient` – The stream's recipient.
/// * `schedule` – The schedule to store.
pub fn set_variable_schedule(env: &Env, recipient: &Address, schedule: &VariableRateSchedule) {
    let key = DataKey::VariableSchedule(recipient.clone());
    env.storage().persistent().set(&key, schedule);
    bump_persistent(env, &key);
    bump_instance(env);
}

/// Deletes the variable-rate schedule for `recipient`.
///
/// # Notes
/// Does not renew the instance TTL, unlike its read/write counterparts.
pub fn remove_variable_schedule(env: &Env, recipient: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::VariableSchedule(recipient.clone()));
}

// ── Milestone schedule ────────────────────────────────────────────────────────

/// Returns the milestone schedule for `recipient`, extending TTL.
///
/// # Arguments
/// * `env` – Soroban environment.
/// * `recipient` – The stream's recipient.
///
/// # Returns
/// `Some(schedule)` when a milestone stream exists, otherwise `None`.
///
/// # Notes
/// Uses the flat [`bump_persistent`] strategy rather than
/// [`ensure_ttl_for_stream`]; milestone streams are not bounded by a single
/// `end_ledger` in the same way fixed-rate streams are.
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

/// Reports whether a milestone schedule exists for `recipient`.
///
/// Does not renew any TTL.
pub fn has_milestone_schedule(env: &Env, recipient: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::MilestoneSchedule(recipient.clone()))
}

/// Persists a milestone schedule and renews its TTL.
///
/// # Arguments
/// * `env` – Soroban environment.
/// * `recipient` – The stream's recipient.
/// * `schedule` – The schedule to store.
pub fn set_milestone_schedule(env: &Env, recipient: &Address, schedule: &MilestoneSchedule) {
    let key = DataKey::MilestoneSchedule(recipient.clone());
    env.storage().persistent().set(&key, schedule);
    bump_persistent(env, &key);
    bump_instance(env);
}

/// Deletes the milestone schedule for `recipient`.
pub fn remove_milestone_schedule(env: &Env, recipient: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::MilestoneSchedule(recipient.clone()));
}

// ── Instance-level config ─────────────────────────────────────────────────────

/// Reports whether the contract has been initialized.
///
/// # Notes
/// Read by `create_vesting_stream`, which rejects with `NotInitialized` before
/// the contract has been set up. Unset is distinct from `false`: there is no
/// stored `false`, only "never initialized".
pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}

/// Marks the contract as initialized.
///
/// Called once by `initialize`, which is itself guarded against a second call.
pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
}

/// Returns the administrator address, if one has been set.
///
/// # Returns
/// `Some(admin)` after `initialize` or `set_admin`, otherwise `None`.
///
/// # Notes
/// Callers compare the `admin` argument against this value rather than relying
/// on `require_auth` alone — see #856, which records that `set_min_deposit` and
/// `add_allowed_token` currently omit that comparison.
pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Admin)
}

/// Stores the administrator address, overwriting any previous value.
pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

/// Returns the protocol fee configuration.
///
/// Intended return value is `(fee_bps, treasury)`.
///
/// # Returns
/// Currently a `Vec<Address>` read from `DataKey::AllowedTokens`, defaulting to
/// an empty vector when unset — **not** the declared tuple. The fee and treasury
/// are never read back.
///
/// # Warning
/// This does not compile against the current `DataKey` enum and does not
/// behave as its signature advertises. It is left unchanged here rather than
/// silently rewritten, because correcting it changes observable behaviour and
/// belongs with the compile fix in #856. There is no `get_treasury` accessor
/// anywhere in the crate.
pub fn get_fee(env: &Env) -> (u32, Option<Address>) {
    let fee_bps = env
        .storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Treasury);
    (fee_bps, treasury)
}

#[allow(dead_code)]
pub fn get_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<DataKey, u32>(&DataKey::FeeBps)
        .unwrap_or(0)
}

#[allow(dead_code)]
pub fn set_fee_bps(env: &Env, fee_bps: u32) {
    env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
}

#[allow(dead_code)]
pub fn get_treasury(env: &Env) -> Option<Address> {
    env.storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Treasury)
}

#[allow(dead_code)]
pub fn set_treasury(env: &Env, treasury: &Address) {
    env.storage().instance().set(&DataKey::Treasury, treasury);
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

#[allow(dead_code)]
pub fn is_token_allowed(env: &Env, token: &Address) -> bool {
    let tokens = get_allowed_tokens(env);
    if tokens.is_empty() {
        return true;
    }
    tokens.contains(token)
}

pub fn get_allowed_tokens(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get::<DataKey, Vec<Address>>(&DataKey::AllowedTokens)
        .unwrap_or_else(|| Vec::new(env))
}

/// Stores the protocol fee (in basis points) and its treasury address.
///
/// # Arguments
/// * `env` – Soroban environment.
/// * `fee_bps` – Fee in basis points; bounded by `MAX_FEE_BPS` at the call site.
/// * `treasury` – Destination for collected fees.
pub fn set_fee(env: &Env, fee_bps: u32, treasury: &Address) {
    env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
    env.storage().instance().set(&DataKey::Treasury, treasury);
}

/// Default maximum cliff ratio: 50% of total duration (in basis points).
pub const DEFAULT_MAX_CLIFF_RATIO_BPS: u32 = 5_000;

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
