#![cfg(test)]

use soroban_sdk::testutils::Address as _;
use soroban_sdk::Address;

use crate::{
    error::VestingError,
    tests::{generate_addresses, register_contract, setup_env},
};

/// Passing a random (non-SAC) address as token should return InvalidToken.
#[test]
fn test_invalid_token_returns_error() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    // Generate a random address that is NOT a SAC token contract.
    let fake_token = Address::generate(&env);

    let err = client
        .try_create_vesting_stream(&sponsor, &recipient, &fake_token, &10, &50, &200, &None)
        .unwrap_err();

    // The contract should return Ok(Err(VestingError::InvalidToken)) - contract error
    assert_eq!(err.unwrap_err(), VestingError::InvalidToken);
}

/// A valid SAC token should NOT trigger InvalidToken.
#[test]
fn test_valid_sac_token_does_not_fail() {
    use crate::tests::setup_token;
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    let deposit = 10i128 * 200i128;
    let (token_id, _token_client) = setup_token(&env, &sponsor, deposit);

    // This should succeed (no InvalidToken error).
    client.create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None);

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.rate_per_ledger, 10);
}
