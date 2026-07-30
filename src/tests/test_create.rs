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

    assert_eq!(err, Ok(VestingError::InvalidRate));
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
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200);

    let err = client
        .try_create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap_err();

    assert_eq!(err, Ok(VestingError::ScheduleAlreadyExists));
}

#[test]
fn test_two_recipients_claim_independently() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, alice) = generate_addresses(&env);
    let bob = Address::generate(&env);
    let (token_id, token_client) = setup_token(&env, &sponsor, 4_000);

    client
        .create_vesting_stream(&sponsor, &alice, &token_id, &10, &50, &200);
    client
        .create_vesting_stream(&sponsor, &bob, &token_id, &20, &30, &100);

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
        .create_vesting_stream(&sponsor, &alice, &token_id, &10, &50, &200);
    client
        .create_vesting_stream(&sponsor, &bob, &token_id, &5, &20, &100);

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
        .create_vesting_stream(&sponsor, &alice, &token_id, &7, &40, &150);
    client
        .create_vesting_stream(&sponsor, &bob, &token_id, &13, &60, &200);

    let alice_sched = client.get_schedule(&alice).unwrap();
    let bob_sched = client.get_schedule(&bob).unwrap();

    assert_eq!(alice_sched.rate_per_ledger, 7);
    assert_eq!(alice_sched.cliff_ledger, 140);
    assert_eq!(alice_sched.end_ledger, 250);

    assert_eq!(bob_sched.rate_per_ledger, 13);
    assert_eq!(bob_sched.cliff_ledger, 160);
    assert_eq!(bob_sched.end_ledger, 300);
}
