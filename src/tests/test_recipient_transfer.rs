#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    error::VestingError,
    tests::{advance_ledger, create_vesting_stream, generate_addresses, register_contract, setup_env},
};

#[test]
fn test_transfer_recipient_success() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, current_recipient) = generate_addresses(&env);
    let new_recipient = Address::generate(&env);

    let (token_id, _) = create_vesting_stream(&env, &client, &sponsor, &current_recipient, 10, 50, 200);

    // Current recipient transfers stream to new recipient
    client.transfer_recipient(&current_recipient, &new_recipient);

    // Old key deleted, new key created with same schedule properties
    assert!(client.get_schedule(&current_recipient).is_none());

    let sched = client.get_schedule(&new_recipient).unwrap();
    assert_eq!(sched.sponsor, sponsor);
    assert_eq!(sched.token, token_id);

    // New recipient can claim vested tokens after cliff
    advance_ledger(&env, 100);
    let claimed = client.claim_vested(&new_recipient);
    assert_eq!(claimed, 1_000);
}

#[test]
fn test_transfer_recipient_same_address_fails() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    let err = client
        .try_transfer_recipient(&recipient, &recipient)
        .unwrap_err();
    assert_eq!(err, Ok(VestingError::InvalidRecipient));
}

#[test]
fn test_transfer_recipient_to_sponsor_fails() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    let err = client
        .try_transfer_recipient(&recipient, &sponsor)
        .unwrap_err();
    assert_eq!(err, Ok(VestingError::InvalidRecipient));
}

#[test]
fn test_transfer_recipient_existing_stream_fails() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, alice) = generate_addresses(&env);
    let bob = Address::generate(&env);

    create_vesting_stream(&env, &client, &sponsor, &alice, 10, 50, 200);
    create_vesting_stream(&env, &client, &sponsor, &bob, 5, 20, 100);

    let err = client.try_transfer_recipient(&alice, &bob).unwrap_err();
    assert_eq!(err, Ok(VestingError::ScheduleAlreadyExists));
}
