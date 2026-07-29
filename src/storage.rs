use soroban_sdk::{Address, Env, Map, Vec};

use crate::types::{DataKey, VestingSchedule};

/// Number of ledgers to extend TTL on persistent storage entries.
/// ~30 days at ~5s per ledger (6 * 60 * 24 * 30 = 259_200).
const PERSISTENT_LEDGER_THRESHOLD: u32 = 259_200;
const PERSISTENT_BUMP_AMOUNT: u32 = 518_400; // ~60 days

// ── Schedule: Read ────────────────────────────────────────────────────────────

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

// ── Schedule: Write ───────────────────────────────────────────────────────────

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

// ── Allowlist: Read ───────────────────────────────────────────────────────────

/// Returns the current allowlist map from instance storage.
///
/// An absent key is equivalent to an empty map (permissive mode).
fn get_allowlist_map(env: &Env) -> Map<Address, bool> {
    env.storage()
        .instance()
        .get::<DataKey, Map<Address, bool>>(&DataKey::Allowlist)
        .unwrap_or_else(|| Map::new(env))
}

/// Returns `true` if `token` is allowed.
///
/// When the allowlist is empty the contract operates in *permissive mode*
/// and all tokens are accepted (backward-compatible default).
pub fn is_token_allowed(env: &Env, token: &Address) -> bool {
    let map = get_allowlist_map(env);
    // Bump instance TTL on every read to prevent archival.
    env.storage()
        .instance()
        .extend_ttl(PERSISTENT_LEDGER_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
    if map.is_empty() {
        // Permissive mode — empty list means allow all.
        return true;
    }
    map.get(token.clone()).unwrap_or(false)
}

/// Returns all currently allowed token addresses as a `Vec`.
pub fn get_allowed_tokens(env: &Env) -> Vec<Address> {
    let map = get_allowlist_map(env);
    // Collect keys where the value is `true`.
    let mut result: Vec<Address> = Vec::new(env);
    for (addr, allowed) in map.iter() {
        if allowed {
            result.push_back(addr);
        }
    }
    result
}

// ── Allowlist: Write ──────────────────────────────────────────────────────────

/// Adds `token` to the allowlist.
pub fn add_allowed_token(env: &Env, token: &Address) {
    let mut map = get_allowlist_map(env);
    map.set(token.clone(), true);
    env.storage()
        .instance()
        .set(&DataKey::Allowlist, &map);
    env.storage()
        .instance()
        .extend_ttl(PERSISTENT_LEDGER_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

/// Removes `token` from the allowlist.
///
/// If `token` was not present this is a no-op.
pub fn remove_allowed_token(env: &Env, token: &Address) {
    let mut map = get_allowlist_map(env);
    map.remove(token.clone());
    env.storage()
        .instance()
        .set(&DataKey::Allowlist, &map);
    env.storage()
        .instance()
        .extend_ttl(PERSISTENT_LEDGER_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}
