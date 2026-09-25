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
pub const TTL_BUFFER_LEDGERS: u32 = 6_307_200;

/// Default minimum total deposit (in token base units).
pub const DEFAULT_MIN_DEPOSIT: i128 = 100;

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

/// Reports whether a fixed-rate schedule exists for `recipient`.
///
/// Unlike [`get_schedule`] this does not renew any TTL, so it is the correct
/// choice for existence checks that should not extend a stream's lifetime —
/// notably `create_vesting_stream`'s duplicate-stream guard.
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

/// Deletes the fixed-rate schedule for `recipient`.
///
/// # Notes
/// Used by every terminal path — cancel, clawback, drain, and the auto-removal
/// that follows a fully-consumed stream. Because all of them converge on
/// removal, a removed schedule is observable only as `StreamStatus::NotFound`.
/// See `docs/flows.md` for why `Cancelled` and `Drained` are not separately
/// observable states.
pub fn remove_schedule(env: &Env, recipient: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Schedule(recipient.clone()));
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
    let schedule = env
        .storage()
        .persistent()
        .get::<DataKey, VariableRateSchedule>(&key)?;
    bump_persistent(env, &key);
    bump_instance(env);
    Some(schedule)
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
    env.storage()
        .instance()
        .has(&DataKey::Initialized)
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

/// Default minimum rate per ledger.
pub const DEFAULT_MIN_RATE: i128 = 1;

/// Returns the configured max cliff ratio in basis points.
/// Falls back to [`DEFAULT_MAX_CLIFF_RATIO_BPS`] if not set.
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
/// Falls back to [`DEFAULT_MIN_RATE`] if not set.
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

// ── Reentrancy lock ───────────────────────────────────────────────────────────

/// Returns `true` if the reentrancy lock is currently held.
///
/// The lock is a temporary instance-storage flag set before token transfers
/// and cleared immediately after, providing defence-in-depth against
/// cross-contract re-entrant calls (Issue #13).
pub fn is_locked(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Lock)
}

/// Acquires the reentrancy lock.
///
/// Must be called before any outbound token transfer. Pair with
/// `release_lock` after the transfer completes.
pub fn acquire_lock(env: &Env) {
    env.storage().instance().set(&DataKey::Lock, &true);
}

/// Releases the reentrancy lock.
///
/// Must be called after every outbound token transfer, even if the
/// transfer fails (the Soroban runtime reverts storage on panic, but
/// explicit release is clearer and handles `try_transfer` error paths).
pub fn release_lock(env: &Env) {
    env.storage().instance().remove(&DataKey::Lock);
}
