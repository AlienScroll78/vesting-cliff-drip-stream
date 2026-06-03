#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{advance_ledger, setup_env},
};

use super::super::tests::token_helper::{create_token, mint_to};

#[test]
fn test_create_stream_success() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);

    // Mint enough to cover rate(10) * duration(200) = 2000
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.rate_per_ledger, 10);
    assert_eq!(schedule.start_ledger, 100);
    assert_eq!(schedule.cliff_ledger, 150); // 100 + 50
    assert_eq!(schedule.end_ledger, 300);   // 100 + 200
    assert_eq!(schedule.last_claimed_ledger, 100);

    // Sponsor's balance should be drained.
    assert_eq!(token_client.balance(&sponsor), 0);
    // Contract holds the deposit.
    assert_eq!(token_client.balance(&contract_id), 2_000);
}

#[test]
fn test_create_stream_zero_rate_fails() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &0, &50, &200)
        .unwrap_err();

    assert_eq!(err, VestingError::InvalidRate.into());
}

#[test]
fn test_create_stream_invalid_duration_fails() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // cliff == total should fail
    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &200, &200)
        .unwrap_err();
    assert_eq!(err, VestingError::InvalidDuration.into());

    // cliff > total should also fail
    let err2 = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &300, &200)
        .unwrap_err();
    assert_eq!(err2, VestingError::InvalidDuration.into());
}

#[test]
fn test_create_duplicate_stream_fails() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 10_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap_err();

    assert_eq!(err, VestingError::ScheduleAlreadyExists.into());
}
