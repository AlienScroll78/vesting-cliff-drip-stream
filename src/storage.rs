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
