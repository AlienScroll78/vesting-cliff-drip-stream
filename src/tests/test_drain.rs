#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address,
};

use crate::{
    contract::{VestingDrips, VestingDripsClient, DRAIN_DELAY_LEDGERS},
    error::VestingError,
    tests::setup_env,
};

use super::super::tests::token_helper::{create_token, mint_to};

/// Advances the ledger by `n` ledgers with a high max_entry_ttl to prevent
/// persistent storage expiry during long-running drain tests.
fn advance_ledger_high_ttl(env: &soroban_sdk::Env, n: u32) {
    let current = env.ledger().sequence();
    env.ledger().set(LedgerInfo {
        timestamp: 0,
        protocol_version: 22,
        sequence_number: current + n,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 1000,
        max_entry_ttl: u32::MAX,
    });
}

/// Creates a basic stream for drain testing.
/// rate=10, cliff_duration=50, total_duration=200 → deposit=2000
fn setup_drain_stream(
    env: &soroban_sdk::Env,
) -> (
    soroban_sdk::Address, // contract_id
    VestingDripsClient,
    soroban_sdk::Address, // sponsor
    soroban_sdk::Address, // recipient
    soroban_sdk::Address, // token_id
) {
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(env, &contract_id);

    let sponsor = Address::generate(env);
    let recipient = Address::generate(env);
    let (token_id, _) = create_token(env, &sponsor);
    mint_to(env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    (contract_id, client, sponsor, recipient, token_id)
}

#[test]
fn test_drain_before_end_ledger_fails() {
    let env = setup_env();
    let (_, client, _, recipient, _) = setup_drain_stream(&env);

    let caller = Address::generate(&env);
    // Stream end_ledger = 300; we're at ledger 100+50=150, still before end.
    advance_ledger_high_ttl(&env, 50);

    let err = client.drain_expired_stream(&caller, &recipient).unwrap_err();
    assert_eq!(err, VestingError::StreamNotExpired.into());
}

#[test]
fn test_drain_after_end_but_before_delay_fails() {
    let env = setup_env();
    let (_, client, _, recipient, _) = setup_drain_stream(&env);

    let caller = Address::generate(&env);
    // Advance past end_ledger (100 + 200 = 300) by 10 ledgers → ledger 310
    // But not yet past the drain delay (300 + 6_307_200).
    advance_ledger_high_ttl(&env, 210);

    let err = client.drain_expired_stream(&caller, &recipient).unwrap_err();
    assert_eq!(err, VestingError::DrainDelayNotExpired.into());
}

#[test]
fn test_drain_after_full_delay_succeeds() {
    let env = setup_env();
    let (_, client, sponsor, recipient, token_id) = setup_drain_stream(&env);

    let caller = Address::generate(&env);
    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);

    // end_ledger = 300.  drain_available_at = 300 + 6_307_200 = 6_307_500.
    // current = 100 → advance 6_307_401 to reach ledger 6_307_501.
    advance_ledger_high_ttl(&env, DRAIN_DELAY_LEDGERS + 201);

    client.drain_expired_stream(&caller, &recipient).unwrap();

    // All unclaimed tokens should go to sponsor.
    assert_eq!(token_client.balance(&sponsor), 2_000);
    assert_eq!(token_client.balance(&recipient), 0);
    assert!(client.get_schedule(&recipient).is_none());
}

#[test]
fn test_drain_partial_claim_then_drain() {
    let env = setup_env();
    let (_, client, sponsor, recipient, token_id) = setup_drain_stream(&env);

    let caller = Address::generate(&env);
    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);

    // Recipient claims at cliff (ledger 150 → claimed 500).
    advance_ledger_high_ttl(&env, 50);
    client.claim_vested(&recipient).unwrap();

    // Advance past drain threshold.
    advance_ledger_high_ttl(&env, DRAIN_DELAY_LEDGERS + 151);

    client.drain_expired_stream(&caller, &recipient).unwrap();

    // last_claimed_ledger after first claim = 150
    // remaining = (300 - 150) × 10 = 1500
    assert_eq!(token_client.balance(&recipient), 500);
    assert_eq!(token_client.balance(&sponsor), 1_500);
    assert!(client.get_schedule(&recipient).is_none());
}

#[test]
fn test_drain_nonexistent_stream_fails() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let caller = Address::generate(&env);
    let recipient = Address::generate(&env);

    let err = client.drain_expired_stream(&caller, &recipient).unwrap_err();
    assert_eq!(err, VestingError::ScheduleNotFound.into());
}

#[test]
fn test_drain_callable_by_anyone() {
    let env = setup_env();
    let (_, client, sponsor, recipient, token_id) = setup_drain_stream(&env);

    // A random third party (not sponsor, not recipient) can call drain.
    let random_caller = Address::generate(&env);
    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);

    advance_ledger_high_ttl(&env, DRAIN_DELAY_LEDGERS + 201);
    client.drain_expired_stream(&random_caller, &recipient).unwrap();

    // Tokens go to original sponsor, not the caller.
    assert_eq!(token_client.balance(&sponsor), 2_000);
    assert_eq!(token_client.balance(&random_caller), 0);
}

#[test]
fn test_drain_exact_boundary_still_fails() {
    let env = setup_env();
    let (_, client, _, recipient, _) = setup_drain_stream(&env);

    let caller = Address::generate(&env);
    // Advance to exactly drain_available_at - 1.
    // end_ledger = 300. drain_available_at = 300 + 6_307_200 = 6_307_500.
    // current = 100 → advance 6_307_399 to reach ledger 6_307_499 (one before).
    advance_ledger_high_ttl(&env, DRAIN_DELAY_LEDGERS + 199);

    let err = client.drain_expired_stream(&caller, &recipient).unwrap_err();
    assert_eq!(err, VestingError::DrainDelayNotExpired.into());
}
