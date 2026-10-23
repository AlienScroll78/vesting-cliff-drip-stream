#![cfg(test)]

//! Security-focused tests for authorization bypass, re-entrancy, and edge case parameters.
//!
//! ## Soroban Re-entrancy Architecture Note
//!
//! Soroban enforces strict re-entrancy prevention natively at the virtual machine / host level:
//! - Soroban environments do not allow recursive cross-contract invocations back into the caller contract frame.
//! - Any attempt by a callee (such as an external token contract) to call back into the invoking contract
//!   frame is rejected by the Soroban host runtime with a host error / panic.
//! - In addition to Soroban's native host VM protection, VestingDrips implements an explicit re-entrancy lock
//!   in instance storage (`DataKey::Lock`) during token transfers to guarantee defense-in-depth across upgrades.

use soroban_sdk::{
    testutils::Address as _,
    Address, Env,
};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{generate_addresses, register_contract_raw, setup_env, setup_token},
};

fn make_initialized_client(env: &Env) -> (Address, Address, VestingDripsClient) {
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    client.initialize(&admin, &0u32, &treasury);
    (admin, treasury, client)
}

/// Test: non-sponsor calling `cancel_stream` returns `Unauthorized` (code 21).
#[test]
fn test_non_sponsor_calling_cancel_stream_returns_unauthorized() {
    let env = setup_env();
    let (_admin, _treasury, client) = make_initialized_client(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let imposter = Address::generate(&env);

    let (token_id, _) = setup_token(&env, &sponsor, 10_000);
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None)
        .unwrap();

    // Imposter (unauthorized caller) attempts to cancel stream
    let err = client
        .try_cancel_stream(&imposter, &recipient, &0)
        .unwrap_err()
        .unwrap();

    assert_eq!(err, VestingError::Unauthorized);
    assert_eq!(VestingError::Unauthorized as u32, 21);
}

/// Test: non-admin calling `set_min_deposit` returns `Unauthorized` (code 21).
#[test]
fn test_non_admin_calling_set_min_deposit_returns_unauthorized() {
    let env = setup_env();
    let (_admin, _treasury, client) = make_initialized_client(&env);
    let attacker = Address::generate(&env);

    let err = client
        .try_set_min_deposit(&attacker, &5_000)
        .unwrap_err()
        .unwrap();

    assert_eq!(err, VestingError::Unauthorized);
    assert_eq!(VestingError::Unauthorized as u32, 21);
}

/// Test: non-admin calling `add_to_allowlist` (`add_allowed_token`) returns `Unauthorized` (code 21).
#[test]
fn test_non_admin_calling_add_to_allowlist_returns_unauthorized() {
    let env = setup_env();
    let (_admin, _treasury, client) = make_initialized_client(&env);
    let attacker = Address::generate(&env);
    let rogue_token = Address::generate(&env);

    let err = client
        .try_add_allowed_token(&attacker, &rogue_token)
        .unwrap_err()
        .unwrap();

    assert_eq!(err, VestingError::Unauthorized);
    assert_eq!(VestingError::Unauthorized as u32, 21);
}

/// Test: `create_vesting_stream` with sponsor == recipient returns `InvalidRecipient` (code 10).
#[test]
fn test_create_vesting_stream_with_sponsor_equals_recipient_returns_invalid_recipient() {
    let env = setup_env();
    let (_admin, _treasury, client) = make_initialized_client(&env);
    let self_sponsor = Address::generate(&env);
    let (token_id, _) = setup_token(&env, &self_sponsor, 10_000);

    let err = client
        .try_create_vesting_stream(
            &self_sponsor,
            &self_sponsor, // recipient == sponsor
            &token_id,
            &10,
            &50,
            &200,
            &None,
        )
        .unwrap_err()
        .unwrap();

    assert_eq!(err, VestingError::InvalidRecipient);
    assert_eq!(VestingError::InvalidRecipient as u32, 10);
}

/// Test: `cancel_stream` with sponsor == recipient returns `InvalidRecipient` (code 10).
#[test]
fn test_cancel_stream_with_sponsor_equals_recipient_returns_invalid_recipient() {
    let env = setup_env();
    let (_admin, _treasury, client) = make_initialized_client(&env);
    let self_party = Address::generate(&env);

    let err = client
        .try_cancel_stream(&self_party, &self_party, &0)
        .unwrap_err()
        .unwrap();

    assert_eq!(err, VestingError::InvalidRecipient);
    assert_eq!(VestingError::InvalidRecipient as u32, 10);
}

/// Test: calling entry-points before `initialize` returns `NotInitialized` (code 18).
#[test]
fn test_calling_entry_points_before_initialize_returns_not_initialized() {
    let env = setup_env();
    let (_contract_id, raw_client) = register_contract_raw(&env);

    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = setup_token(&env, &sponsor, 10_000);

    // Call create_vesting_stream before initialize
    let err = raw_client
        .try_create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None)
        .unwrap_err()
        .unwrap();

    assert_eq!(err, VestingError::NotInitialized);
    assert_eq!(VestingError::NotInitialized as u32, 18);
}

/// Test: calling `initialize` twice returns `AlreadyInitialized` (code 13).
#[test]
fn test_calling_initialize_twice_returns_already_initialized() {
    let env = setup_env();
    let (_contract_id, raw_client) = register_contract_raw(&env);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let attacker = Address::generate(&env);

    // First call succeeds
    raw_client.initialize(&admin, &0u32, &treasury);

    // Second call fails
    let err = raw_client
        .try_initialize(&attacker, &0u32, &treasury)
        .unwrap_err()
        .unwrap();

    assert_eq!(err, VestingError::AlreadyInitialized);
    assert_eq!(VestingError::AlreadyInitialized as u32, 13);
}
