#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::VestingDripsClient,
    error::VestingError,
    tests::{
        advance_ledger, create_vesting_stream, generate_addresses, register_contract, setup_env,
        setup_token,
    },
};

#[test]
fn test_create_stream_success() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, token_client) = create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.rate_per_ledger, 10);
    assert_eq!(schedule.start_ledger, 100);
    assert_eq!(schedule.cliff_ledger, 150);
    assert_eq!(schedule.end_ledger, 300);
    assert_eq!(schedule.last_claimed_ledger, 100);
    assert_eq!(schedule.metadata, None);

    assert_eq!(token_client.balance(&sponsor), 0);
    assert_eq!(token_client.balance(&_contract_id), 2_000);
}

#[test]
fn test_create_stream_zero_rate_fails() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    let err = client
        .try_create_vesting_stream(&sponsor, &recipient, &Address::generate(&env), &0, &50, &200)
        .unwrap_err();

    assert_eq!(err, VestingError::InvalidRate);
}

#[test]
fn test_create_stream_invalid_duration_fails() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let token = Address::generate(&env);

    let err = client
        .try_create_vesting_stream(&sponsor, &recipient, &token, &10, &200, &200)
        .unwrap_err();
    assert_eq!(err, Ok(VestingError::InvalidDuration));

    let err2 = client
        .try_create_vesting_stream(&sponsor, &recipient, &token, &10, &300, &200)
        .unwrap_err();
    assert_eq!(err2, Ok(VestingError::InvalidDuration));
}

#[test]
fn test_create_duplicate_stream_fails() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = setup_token(&env, &sponsor, 10_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None)
        .unwrap();

    let err = client
        .try_create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap_err();

    assert_eq!(err, VestingError::ScheduleAlreadyExists);
}

#[test]
fn test_two_recipients_claim_independently() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, alice) = generate_addresses(&env);
    let bob = Address::generate(&env);
    let (token_id, token_client) = setup_token(&env, &sponsor, 4_000);

    client
        .create_vesting_stream(&sponsor, &alice, &token_id, &10, &50, &200, &None)
        .unwrap();
    client
        .create_vesting_stream(&sponsor, &bob, &token_id, &20, &30, &100, &None)
        .unwrap();

    advance_ledger(&env, 60);

    let alice_claimed = client.claim_vested(&alice);
    assert_eq!(alice_claimed, 600);

    let bob_sched = client.get_schedule(&bob).unwrap();
    assert_eq!(bob_sched.last_claimed_ledger, 100);
    assert_eq!(token_client.balance(&bob), 0);
}

#[test]
fn test_cancel_one_recipient_other_unaffected() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, alice) = generate_addresses(&env);
    let bob = Address::generate(&env);
    let (token_id, token_client) = setup_token(&env, &sponsor, 2_500);

    client
        .create_vesting_stream(&sponsor, &alice, &token_id, &10, &50, &200, &None)
        .unwrap();
    client
        .create_vesting_stream(&sponsor, &bob, &token_id, &5, &20, &100, &None)
        .unwrap();

    client.cancel_stream(&sponsor, &alice);

    assert!(client.get_schedule(&alice).is_none());

    let bob_sched = client.get_schedule(&bob).unwrap();
    assert_eq!(bob_sched.rate_per_ledger, 5);
    assert_eq!(bob_sched.last_claimed_ledger, 100);

    advance_ledger(&env, 20);
    let bob_claimed = client.claim_vested(&bob);
    assert_eq!(bob_claimed, 100);
    assert_eq!(token_client.balance(&bob), 100);
}

#[test]
fn test_storage_keys_are_per_recipient() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, alice) = generate_addresses(&env);
    let bob = Address::generate(&env);
    let (token_id, _) = setup_token(&env, &sponsor, 10_000);

    client
        .create_vesting_stream(&sponsor, &alice, &token_id, &7, &40, &150, &None)
        .unwrap();
    client
        .create_vesting_stream(&sponsor, &bob, &token_id, &13, &60, &200, &None)
        .unwrap();

    let alice_sched = client.get_schedule(&alice).unwrap();
    let bob_sched = client.get_schedule(&bob).unwrap();

    assert_eq!(alice_sched.rate_per_ledger, 7);
    assert_eq!(alice_sched.cliff_ledger, 140);
    assert_eq!(alice_sched.end_ledger, 250);

    assert_eq!(bob_sched.rate_per_ledger, 13);
    assert_eq!(bob_sched.cliff_ledger, 160);
    assert_eq!(bob_sched.end_ledger, 300);
}

// ── Metadata tests ────────────────────────────────────────────────────────────

/// A valid metadata string is stored and returned by get_schedule unchanged.
#[test]
fn test_create_with_metadata_stored_and_returned() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    let label = String::from_str(&env, "grant:engineering-q1-2026");
    client
        .create_vesting_stream(
            &sponsor,
            &recipient,
            &token_id,
            &10,
            &50,
            &200,
            &Some(label.clone()),
        )
        .unwrap();

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.metadata, Some(label));
}

/// None metadata is stored as None and returned as None.
#[test]
fn test_create_with_none_metadata_stored_as_none() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None)
        .unwrap();

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.metadata, None);
}

/// An empty string is normalised to None at creation time.
#[test]
fn test_create_empty_string_metadata_normalised_to_none() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    let empty = String::from_str(&env, "");
    client
        .create_vesting_stream(
            &sponsor,
            &recipient,
            &token_id,
            &10,
            &50,
            &200,
            &Some(empty),
        )
        .unwrap();

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.metadata, None);
}

/// Exactly 256-byte metadata is accepted (boundary inclusive).
#[test]
fn test_create_metadata_exactly_256_bytes_accepted() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    // Build a 256-byte ASCII string (each char is 1 byte in UTF-8).
    let s: std::string::String = "a".repeat(256);
    let label = String::from_str(&env, &s);

    client
        .create_vesting_stream(
            &sponsor,
            &recipient,
            &token_id,
            &10,
            &50,
            &200,
            &Some(label.clone()),
        )
        .unwrap();

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.metadata, Some(label));
}

/// A metadata string of 257 bytes is rejected with MetadataTooLong (error 20).
#[test]
fn test_create_metadata_257_bytes_rejected() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    let s: std::string::String = "a".repeat(257);
    let too_long = String::from_str(&env, &s);

    let err = client
        .create_vesting_stream(
            &sponsor,
            &recipient,
            &token_id,
            &10,
            &50,
            &200,
            &Some(too_long),
        )
        .unwrap_err();

    assert_eq!(err, VestingError::MetadataTooLong.into());
}

/// Metadata is immutable: no update function exists, and the stored value
/// is unchanged after a claim or other state-mutating operation.
#[test]
fn test_metadata_immutable_after_creation() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    let label = String::from_str(&env, "immutable-label");
    client
        .create_vesting_stream(
            &sponsor,
            &recipient,
            &token_id,
            &10,
            &50,
            &200,
            &Some(label.clone()),
        )
        .unwrap();

    // Advance past cliff and claim — schedule is mutated (last_claimed_ledger etc.)
    advance_ledger(&env, 60);
    client.claim_vested(&recipient).unwrap();

    // Metadata must be unchanged after the claim.
    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.metadata, Some(label));
}
