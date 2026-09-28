#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{setup_env, factory::{pre_cliff_stream, StreamBuilder}},
};

use super::token_helper::{create_token, mint_to};

/// Verifies a freshly-created stream has all schedule fields correctly set.
#[test]
fn test_create_stream_success() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);

    // rate(10) × duration(200) = 2000
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

/// A zero rate is rejected with `InvalidRate`.
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

/// `total_duration <= cliff_duration` is rejected with `InvalidDuration`.
#[test]
fn test_create_stream_invalid_duration_fails() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // cliff == total should fail.
    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &200, &200)
        .unwrap_err();
    assert_eq!(err, VestingError::InvalidDuration.into());

    // cliff > total should also fail.
    let err2 = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &300, &200)
        .unwrap_err();
    assert_eq!(err2, VestingError::InvalidDuration.into());
}

/// A second stream for the same recipient is rejected with `ScheduleAlreadyExists`.
/// Uses the factory to create the first stream instead of manual setup.
#[test]
fn test_create_duplicate_stream_fails() {
    let env = setup_env();
    // Use the factory to build the first stream.
    let (stream, addrs) = pre_cliff_stream(&env);

    // Attempt a second stream for the same recipient – must fail.
    let (token_id2, _) = create_token(&env, &addrs.sponsor);
    mint_to(&env, &token_id2, &addrs.sponsor, 2_000);

    let err = stream
        .client
        .create_vesting_stream(
            &addrs.sponsor,
            &addrs.recipient,
            &token_id2,
            &10,
            &50,
            &200,
        )
        .unwrap_err();

    assert_eq!(err, VestingError::ScheduleAlreadyExists.into());
}

/// The builder pattern produces a stream with the overridden parameters.
#[test]
fn test_create_stream_custom_params_via_builder() {
    let env = setup_env();
    let (stream, addrs) = StreamBuilder::default()
        .rate(5)
        .cliff_duration(30)
        .total_duration(120)
        .build(&env);

    let schedule = stream.client.get_schedule(&addrs.recipient).unwrap();
    assert_eq!(schedule.rate_per_ledger, 5);
    assert_eq!(schedule.cliff_ledger, 130);  // 100 + 30
    assert_eq!(schedule.end_ledger,   220);  // 100 + 120
}
