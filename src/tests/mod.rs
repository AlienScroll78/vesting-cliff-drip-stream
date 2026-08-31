#![cfg(test)]

pub mod token_helper;

mod test_cancel;
mod test_claim;
mod test_create;
mod test_edge_cases;
mod test_events;
mod test_allowlist;
mod test_properties;
mod test_versioning;
mod test_views;
mod test_dust;
mod test_variable_rate;
mod test_initialize;

pub use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env,
};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    types::VestingSchedule,
};
use token_helper::{create_token, mint_to};

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

/// Registers the VestingDrips contract and returns `(contract_id, client)`.
pub fn register_contract<'a>(env: &'a Env) -> (Address, VestingDripsClient<'a>) {
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(env, &contract_id);
    // Auto-initialize with zero fee and a dummy treasury so all stream tests work.
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    client.initialize(&admin, &0u32, &treasury);
    (contract_id, client)
}

/// Registers the VestingDrips contract **without** calling `initialize`.
///
/// Use this only in tests that specifically test `initialize` behaviour.
pub fn register_contract_raw(env: &Env) -> (Address, VestingDripsClient) {
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(env, &contract_id);
    (contract_id, client)
}

/// Generates a sponsor and recipient address.
pub fn generate_addresses(env: &Env) -> (Address, Address) {
    let sponsor = Address::generate(env);
    let recipient = Address::generate(env);
    (sponsor, recipient)
}

/// Creates a token and mints `amount` to `sponsor`.
///
/// Returns `(token_id, token_client)`.
pub fn setup_token<'a>(
    env: &'a Env,
    sponsor: &Address,
    amount: i128,
) -> (Address, soroban_sdk::token::TokenClient<'a>) {
    let (token_id, token_client) = create_token(env, sponsor);
    mint_to(env, &token_id, sponsor, amount);
    (token_id, token_client)
}

/// Creates a vesting stream with the given parameters.
///
/// Mints exactly `rate * total_duration` tokens to the sponsor first.
/// Returns `(token_id, token_client)`.
pub fn create_vesting_stream<'a>(
    env: &'a Env,
    client: &VestingDripsClient<'a>,
    sponsor: &Address,
    recipient: &Address,
    rate: i128,
    cliff_duration: u32,
    total_duration: u32,
) -> (Address, soroban_sdk::token::TokenClient<'a>) {
    let deposit = rate * total_duration as i128;
    let (token_id, token_client) = setup_token(env, sponsor, deposit);
    client
        .create_vesting_stream(sponsor, recipient, &token_id, &rate, &cliff_duration, &total_duration);
    (token_id, token_client)
}

/// Advances the ledger to the cliff height specified in `schedule`.
pub fn advance_to_cliff(env: &Env, schedule: &VestingSchedule) {
    let current = env.ledger().sequence();
    if current < schedule.cliff_ledger {
        advance_ledger(env, schedule.cliff_ledger - current);
    }
}

/// Advances the ledger to the end height specified in `schedule`.
pub fn advance_to_end(env: &Env, schedule: &VestingSchedule) {
    let current = env.ledger().sequence();
    if current < schedule.end_ledger {
        advance_ledger(env, schedule.end_ledger - current);
    }
}

/// Asserts that `claimable_amount` for `recipient` equals `expected`.
pub fn assert_claimable(
    env: &Env,
    client: &VestingDripsClient,
    recipient: &Address,
    expected: i128,
) {
    let actual = client.claimable_amount(recipient);
    assert_eq!(
        actual, expected,
        "claimable_amount for {recipient:?}: expected {expected}, got {actual}"
    );
}
