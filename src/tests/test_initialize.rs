//! Tests for the `initialize` entry point (issue #325).
//!
//! Verifies that the contract must be initialized before use, that
//! initialization can only happen once, and that fee_bps and treasury
//! are validated and stored correctly.

#![cfg(test)]

use soroban_sdk::testutils::Address as _;

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{generate_addresses, setup_env, setup_token},
};

fn make_raw_client(env: &soroban_sdk::Env) -> VestingDripsClient {
    let contract_id = env.register(VestingDrips, ());
    VestingDripsClient::new(env, &contract_id)
}

// ── One-shot initialization ───────────────────────────────────────────────────

/// `initialize` succeeds on first call and accepts valid fee_bps.
#[test]
fn test_initialize_succeeds() {
    let env = setup_env();
    let client = make_raw_client(&env);

    let admin = soroban_sdk::Address::generate(&env);
    let treasury = soroban_sdk::Address::generate(&env);

    client.initialize(&admin, &100u32, &treasury);
    // No error = success
}

/// `initialize` rejects fee_bps > 500.
#[test]
fn test_initialize_rejects_fee_bps_over_500() {
    let env = setup_env();
    let client = make_raw_client(&env);

    let admin = soroban_sdk::Address::generate(&env);
    let treasury = soroban_sdk::Address::generate(&env);

    let err = client
        .try_initialize(&admin, &501u32, &treasury)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::InvalidRate);
}

/// `initialize` with exactly 500 bps succeeds.
#[test]
fn test_initialize_accepts_max_fee_bps() {
    let env = setup_env();
    let client = make_raw_client(&env);

    let admin = soroban_sdk::Address::generate(&env);
    let treasury = soroban_sdk::Address::generate(&env);

    client.initialize(&admin, &500u32, &treasury);
    // No error = success
}

/// `initialize` with zero fee_bps succeeds.
#[test]
fn test_initialize_accepts_zero_fee_bps() {
    let env = setup_env();
    let client = make_raw_client(&env);

    let admin = soroban_sdk::Address::generate(&env);
    let treasury = soroban_sdk::Address::generate(&env);

    client.initialize(&admin, &0u32, &treasury);
}

/// Second call to `initialize` returns `AlreadyInitialized` (code 13).
#[test]
fn test_initialize_twice_fails_with_already_initialized() {
    let env = setup_env();
    let client = make_raw_client(&env);

    let admin = soroban_sdk::Address::generate(&env);
    let attacker = soroban_sdk::Address::generate(&env);
    let treasury = soroban_sdk::Address::generate(&env);

    client.initialize(&admin, &0u32, &treasury);

    let err = client
        .try_initialize(&attacker, &0u32, &treasury)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::AlreadyInitialized);
}

// ── NotInitialized guard on create_vesting_stream ────────────────────────────

/// `create_vesting_stream` fails with `NotInitialized` before `initialize` is called.
#[test]
fn test_create_stream_fails_if_not_initialized() {
    let env = setup_env();
    let client = make_raw_client(&env);

    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = setup_token(&env, &sponsor, 10_000);

    let err = client
        .try_create_vesting_stream(&sponsor, &recipient, &token_id, &10, &10, &100)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::NotInitialized);
}

/// `create_vesting_stream` succeeds after `initialize` is called.
#[test]
fn test_create_stream_succeeds_after_initialize() {
    let env = setup_env();
    let client = make_raw_client(&env);

    let admin = soroban_sdk::Address::generate(&env);
    let treasury = soroban_sdk::Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury);

    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = setup_token(&env, &sponsor, 10_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &10, &100)
        .unwrap();
}

/// `create_variable_rate_stream` also fails with `NotInitialized` before init.
#[test]
fn test_create_variable_stream_fails_if_not_initialized() {
    let env = setup_env();
    let client = make_raw_client(&env);

    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = setup_token(&env, &sponsor, 10_000);

    let segments = soroban_sdk::vec![&env, (200u32, 10i128)];
    let err = client
        .try_create_variable_rate_stream(&sponsor, &recipient, &token_id, &10u32, &segments)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::NotInitialized);
}

// ── Error code values ─────────────────────────────────────────────────────────

/// Verify that `AlreadyInitialized` has code 13 and `NotInitialized` has code 18.
#[test]
fn test_error_codes() {
    assert_eq!(VestingError::AlreadyInitialized as u32, 13);
    assert_eq!(VestingError::NotInitialized as u32, 18);
}
