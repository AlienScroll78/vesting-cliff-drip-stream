#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    storage::DEFAULT_MIN_DEPOSIT,
    tests::setup_env,
};

use super::super::tests::token_helper::{create_token, mint_to};

#[test]
fn test_deposit_below_default_minimum_fails() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // rate=1, total=50 → deposit=50, below DEFAULT_MIN_DEPOSIT=100
    mint_to(&env, &token_id, &sponsor, 50);

    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &1, &10, &50)
        .unwrap_err();

    assert_eq!(err, VestingError::DepositBelowMinimum.into());
}

#[test]
fn test_deposit_at_minimum_succeeds() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // rate=1, total=100 → deposit=100, exactly at DEFAULT_MIN_DEPOSIT
    mint_to(&env, &token_id, &sponsor, 100);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &1, &10, &100)
        .unwrap();

    assert!(client.get_schedule(&recipient).is_some());
}

#[test]
fn test_deposit_above_minimum_succeeds() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    assert!(client.get_schedule(&recipient).is_some());
}

#[test]
fn test_get_min_deposit_returns_default() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    assert_eq!(client.get_min_deposit(), DEFAULT_MIN_DEPOSIT);
}

#[test]
fn test_set_min_deposit_updates_threshold() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    // Set minimum to 500
    client.set_min_deposit(&admin, &500).unwrap();
    assert_eq!(client.get_min_deposit(), 500);
}

#[test]
fn test_custom_minimum_deposit_enforced() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // Raise minimum to 500.
    client.set_min_deposit(&admin, &500).unwrap();

    // rate=10, total=40 → deposit=400, below new min of 500
    mint_to(&env, &token_id, &sponsor, 400);

    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &10, &40)
        .unwrap_err();

    assert_eq!(err, VestingError::DepositBelowMinimum.into());
}

#[test]
fn test_stream_above_custom_minimum_succeeds() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // Set minimum to 500.
    client.set_min_deposit(&admin, &500).unwrap();

    // rate=10, total=60 → deposit=600, above new min
    mint_to(&env, &token_id, &sponsor, 600);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &10, &60)
        .unwrap();

    assert!(client.get_schedule(&recipient).is_some());
}
