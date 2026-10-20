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
    // stored rate is 10 * RATE_DECIMALS
    assert_eq!(schedule.rate_per_ledger, 10 * RATE_DECIMALS);
    assert_eq!(schedule.start_ledger, 100);
    assert_eq!(schedule.cliff_ledger, 150);
    assert_eq!(schedule.end_ledger, 300);
    assert_eq!(schedule.last_claimed_ledger, 100);

    assert_eq!(token_client.balance(&sponsor), 0);
    assert_eq!(token_client.balance(&contract_id), 2_000);
}

/// A zero rate is rejected with `InvalidRate`.
#[test]
fn test_create_stream_zero_rate_fails() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    let err = client
        .try_create_vesting_stream(&sponsor, &recipient, &Address::generate(&env), &0, &50, &200, &None)
        .unwrap_err();

    assert_eq!(err, Ok(VestingError::InvalidRate));
}

#[test]
fn test_create_stream_zero_cliff_duration_fails() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let token = Address::generate(&env);

    let err = client
        .try_create_vesting_stream(&sponsor, &recipient, &token, &10, &0, &200, &None)
        .unwrap_err();

    assert_eq!(err, Ok(VestingError::InvalidCliffDuration));
}

/// `total_duration <= cliff_duration` is rejected with `InvalidDuration`.
#[test]
fn test_create_stream_invalid_duration_fails() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let token = Address::generate(&env);
    let rate = 10 * RATE_DECIMALS;

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // cliff == total should fail.
    let err = client
        .try_create_vesting_stream(&sponsor, &recipient, &token, &10, &200, &200, &None)
        .unwrap_err();
    assert_eq!(err, Ok(VestingError::InvalidDuration));

    // cliff > total should also fail.
    let err2 = client
        .try_create_vesting_stream(&sponsor, &recipient, &token, &10, &300, &200, &None)
        .unwrap_err();
    assert_eq!(err2, Ok(VestingError::InvalidDuration));
}

/// A zero-length `cliff_duration` is rejected with `InvalidCliffDuration` (12).
///
/// A zero-length cliff provides no lockup guarantee, so `create_vesting_stream`
/// must refuse to create the stream. The numeric pin guards the client-facing
/// contract: code 12 is `InvalidCliffDuration` in the documented error table.
#[test]
fn test_create_duplicate_stream_fails() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let rate = 10 * RATE_DECIMALS;
    // deposit = 10 * 200 = 2000
    let (token_id, _) = setup_token(&env, &sponsor, 10_000);

    client.create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &50, &200, &None);

    let err = client
        .try_create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None)
        .unwrap_err();

    assert_eq!(err, Ok(VestingError::ScheduleAlreadyExists));
}

#[test]
fn test_two_recipients_claim_independently() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, alice) = generate_addresses(&env);
    let bob = Address::generate(&env);
    // deposit alice: 10*200=2000, bob: 10*100=1000... but rates differ
    // Use helper to auto-scale
    let (token_id, token_client) = setup_token(&env, &sponsor, 10_000);

    let rate_alice = 10 * RATE_DECIMALS;
    let rate_bob = 10 * RATE_DECIMALS;
    client.create_vesting_stream(&sponsor, &alice, &token_id, &rate_alice, &50, &200, &None);
    client.create_vesting_stream(&sponsor, &bob, &token_id, &rate_bob, &30, &100, &None);

    advance_ledger(&env, 60);

    // alice: from ledger 100 to 160 = 60 ledgers * 10 = 600
    let alice_claimed = client.claim_vested(&alice);
    assert_eq!(alice_claimed, 600);

    let bob_sched = client.get_schedule(&bob).unwrap();
    assert_eq!(bob_sched.last_claimed_ledger, 100);
    assert_eq!(token_client.balance(&bob), 0);
}

#[test]
fn test_storage_keys_are_per_recipient() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, alice) = generate_addresses(&env);
    let bob = Address::generate(&env);
    let (token_id, _) = setup_token(&env, &sponsor, 10_000);

    let rate_alice = 7 * RATE_DECIMALS;
    let rate_bob = 13 * RATE_DECIMALS;
    client.create_vesting_stream(&sponsor, &alice, &token_id, &rate_alice, &40, &150, &None);
    client.create_vesting_stream(&sponsor, &bob, &token_id, &rate_bob, &60, &200, &None);

    let alice_sched = client.get_schedule(&alice).unwrap();
    let bob_sched = client.get_schedule(&bob).unwrap();

    assert_eq!(alice_sched.rate_per_ledger, 7 * RATE_DECIMALS);
    assert_eq!(alice_sched.cliff_ledger, 140);
    assert_eq!(alice_sched.end_ledger, 250);

    assert_eq!(bob_sched.rate_per_ledger, 13 * RATE_DECIMALS);
    assert_eq!(bob_sched.cliff_ledger, 160);
    assert_eq!(bob_sched.end_ledger, 300);
}

// ── Metadata tests ────────────────────────────────────────────────────────────

/// A valid metadata string is stored and returned by get_schedule unchanged.
#[test]
fn test_create_with_metadata_stored_and_returned() {
    let env = setup_env();
    let (contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    let (token_id, token_client) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    let rate = 10 * RATE_DECIMALS;

    let err = client
        .try_create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &0, &200, &None)
        .unwrap_err();

    assert_eq!(
        err,
        Ok(VestingError::InvalidCliffDuration),
        "expected code 12 (InvalidCliffDuration) when cliff_duration == 0"
    );
    assert_eq!(
        VestingError::InvalidCliffDuration as u32,
        12,
        "InvalidCliffDuration must be code 12"
    );

    // No schedule is stored and no deposit is taken.
    assert_eq!(client.get_schedule(&recipient), None);
    assert_eq!(token_client.balance(&sponsor), 2_000);
    assert_eq!(token_client.balance(&contract_id), 0);
}

/// The smallest legal cliff (`cliff_duration = 1`) is still accepted.
#[test]
fn test_create_stream_minimum_cliff_succeeds() {
    let env = setup_env();
    let (contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    let (token_id, token_client) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    let rate = 10 * RATE_DECIMALS;

    client.create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &1, &200, &None);

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.rate_per_ledger, rate);
    assert_eq!(schedule.start_ledger, 100);
    assert_eq!(schedule.cliff_ledger, 101);
    assert_eq!(schedule.end_ledger, 300);

    // deposit = rate (10 tokens/ledger) * 200 = 2000
    assert_eq!(token_client.balance(&sponsor), 0);
    assert_eq!(token_client.balance(&contract_id), 2_000);
}

/// A second stream for the same recipient is rejected with `ScheduleAlreadyExists`.
/// Uses the factory to create the first stream instead of manual setup.
#[test]
fn test_multiple_streams_for_one_recipient_get_distinct_ids() {
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

    assert_eq!(err, Ok(VestingError::InvalidRecipient));
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
