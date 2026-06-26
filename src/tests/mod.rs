#![cfg(test)]

pub mod token_helper;

mod test_create;
mod test_claim;
mod test_cancel;
mod test_views;
mod test_edge_cases;
mod test_mutations;
mod test_snapshots; // issue #102

pub use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env,
};

// ── Shared test helpers ───────────────────────────────────────────────────────

/// Generates a fresh Soroban test environment with ledger sequence set to 100.
pub fn setup_env() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(LedgerInfo {
        timestamp: 0,
        protocol_version: 22,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 1000,
        max_entry_ttl: 3_110_400,
    });
    env
}

/// Advances the ledger by `n` ledgers.
pub fn advance_ledger(env: &Env, n: u32) {
    let current = env.ledger().sequence();
    env.ledger().set(LedgerInfo {
        timestamp: 0,
        protocol_version: 22,
        sequence_number: current + n,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 1000,
        max_entry_ttl: 3_110_400,
    });
}
