use soroban_sdk::{contracttype, Address, Env};

use crate::types::{DataKey, VestingSchedule};

// ── TTL configuration ─────────────────────────────────────────────────────────

/// Minimum remaining TTL (in ledgers) before a persistent entry is bumped.
/// ~30 days at ~5 s/ledger: 6 * 60 * 24 * 30 = 259_200.
pub const PERSISTENT_LEDGER_THRESHOLD: u32 = 259_200;

/// Target TTL (in ledgers) after a bump is applied.
/// ~60 days at ~5 s/ledger: 6 * 60 * 24 * 60 = 518_400.
pub const PERSISTENT_BUMP_AMOUNT: u32 = 518_400;

// ── Config type ───────────────────────────────────────────────────────────────

/// Read-only view of the compiled-in contract configuration.
///
/// Returned by `VestingDrips::get_config` so off-chain tooling can inspect
/// TTL parameters without reading the source.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractConfig {
    /// Minimum remaining TTL (ledgers) before a persistent entry is bumped.
    pub persistent_ledger_threshold: u32,
    /// Target TTL (ledgers) set on each bump.
    pub persistent_bump_amount: u32,
}

/// Returns the compiled-in contract configuration.
pub fn get_config() -> ContractConfig {
    ContractConfig {
        persistent_ledger_threshold: PERSISTENT_LEDGER_THRESHOLD,
        persistent_bump_amount: PERSISTENT_BUMP_AMOUNT,
    }
}

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
