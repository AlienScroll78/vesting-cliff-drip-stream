#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, String};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{
        advance_ledger, create_vesting_stream, generate_addresses, register_contract,
        register_contract_raw, setup_env, setup_token,
    },
    types::RATE_DECIMALS,
};
use crate::tests::token_helper::{create_token, mint_to};

#[test]
fn test_create_stream_success() {
    let env = setup_env();
    let (contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    // rate=10 tokens/ledger: helper scales by RATE_DECIMALS
    let (token_id, token_client) =
        create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    let schedule = client.get_schedule(&recipient).unwrap();
    // stored rate is 10 * RATE_DECIMALS
    assert_eq!(schedule.rate_per_ledger, 10 * RATE_DECIMALS);
    assert_eq!(schedule.start_ledger, 100);
    assert_eq!(schedule.cliff_ledger, 150);
    assert_eq!(schedule.end_ledger, 300);
    assert_eq!(schedule.last_claimed_ledger, 100);
    assert_eq!(schedule.metadata, None);

    assert_eq!(token_client.balance(&sponsor), 0);
    assert_eq!(token_client.balance(&contract_id), 2_000);
}

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
fn test_create_stream_invalid_duration_fails() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let token = Address::generate(&env);
    let rate = 10 * RATE_DECIMALS;

    // cliff == total → invalid
    let err = client
        .try_create_vesting_stream(&sponsor, &recipient, &token, &10, &200, &200, &None)
        .unwrap_err();
    assert_eq!(err, Ok(VestingError::InvalidDuration));

    // cliff > total → invalid
    let err2 = client
        .try_create_vesting_stream(&sponsor, &recipient, &token, &10, &300, &200, &None)
        .unwrap_err();
    assert_eq!(err2, Ok(VestingError::InvalidDuration));
}

#[test]
fn test_create_duplicate_stream_fails() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let rate = 10 * RATE_DECIMALS;
    // deposit = 10 * 200 = 2000
    let (token_id, _) = setup_token(&env, &sponsor, 10_000);

    client.create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &50, &200);

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
    client.create_vesting_stream(&sponsor, &alice, &token_id, &rate_alice, &50, &200);
    client.create_vesting_stream(&sponsor, &bob, &token_id, &rate_bob, &30, &100);

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
    client.create_vesting_stream(&sponsor, &alice, &token_id, &rate_alice, &40, &150);
    client.create_vesting_stream(&sponsor, &bob, &token_id, &rate_bob, &60, &200);

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

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    let label = String::from_str(&env, "grant:engineering-q1-2026");
    let rate = 10 * RATE_DECIMALS;
    client.create_vesting_stream_with_meta(
        &sponsor,
        &recipient,
        &token_id,
        &rate,
        &50,
        &200,
        &Some(label.clone()),
    );

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.metadata, Some(label));
}

/// None metadata is stored as None and returned as None.
#[test]
fn test_create_with_none_metadata_stored_as_none() {
    let env = setup_env();
    let (_, client) = register_contract(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    let rate = 10 * RATE_DECIMALS;
    client.create_vesting_stream_with_meta(
        &sponsor,
        &recipient,
        &token_id,
        &rate,
        &50,
        &200,
        &None,
    );

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.metadata, None);
}

/// A metadata string of 257 bytes is rejected with MetadataTooLong.
#[test]
fn test_create_metadata_257_bytes_rejected() {
    let env = setup_env();
    let (_, client) = register_contract(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    let s: std::string::String = "a".repeat(257);
    let too_long = String::from_str(&env, &s);
    let rate = 10 * RATE_DECIMALS;

    let err = client
        .try_create_vesting_stream_with_meta(
            &sponsor,
            &recipient,
            &token_id,
            &rate,
            &50,
            &200,
            &Some(too_long),
        )
        .unwrap_err();

    assert_eq!(err, Ok(VestingError::MetadataTooLong));
}

