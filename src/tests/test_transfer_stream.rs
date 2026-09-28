//! Tests for stream transfer (closes #6).
//!
//! `transfer_stream(current_recipient, new_recipient)`:
//! - Requires auth from `current_recipient`
//! - Moves the schedule to `new_recipient` (identical fields)
//! - Deletes the old key
//! - Emits `StreamTransferred` event
//! - Rejects if `new_recipient` already has a stream

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Symbol, TryFromVal};
use soroban_sdk::testutils::Events as _;

use crate::{
    error::VestingError,
    tests::{
        advance_ledger, create_vesting_stream, generate_addresses, register_contract, setup_env,
        setup_token,
    },
    types::RATE_DECIMALS,
};

/// Basic transfer: old key removed, new key has identical schedule.
#[test]
fn test_transfer_stream_basic() {
    let env = setup_env();
    let (contract_id, client) = register_contract(&env);
    let (sponsor, old_recipient) = generate_addresses(&env);
    let new_recipient = Address::generate(&env);

    create_vesting_stream(&env, &client, &sponsor, &old_recipient, 10, 50, 200);

    // Snapshot original schedule fields
    let original = client.get_schedule(&old_recipient).unwrap();

    client.transfer_stream(&old_recipient, &new_recipient);

    // Old key must be gone
    assert!(
        client.get_schedule(&old_recipient).is_none(),
        "Old recipient key should be deleted"
    );

    // New key must have identical schedule
    let transferred = client.get_schedule(&new_recipient).unwrap();
    assert_eq!(transferred.token, original.token);
    assert_eq!(transferred.sponsor, original.sponsor);
    assert_eq!(transferred.rate_per_ledger, original.rate_per_ledger);
    assert_eq!(transferred.start_ledger, original.start_ledger);
    assert_eq!(transferred.cliff_ledger, original.cliff_ledger);
    assert_eq!(transferred.end_ledger, original.end_ledger);
    assert_eq!(transferred.last_claimed_ledger, original.last_claimed_ledger);
    assert_eq!(transferred.total_claimed, original.total_claimed);
    assert_eq!(transferred.metadata, original.metadata);
}

/// New recipient can claim after transfer.
#[test]
fn test_new_recipient_can_claim_after_transfer() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, old_recipient) = generate_addresses(&env);
    let new_recipient = Address::generate(&env);

    let (token_id, _) =
        create_vesting_stream(&env, &client, &sponsor, &old_recipient, 10, 50, 200);
    let tc = soroban_sdk::token::TokenClient::new(&env, &token_id);

    client.transfer_stream(&old_recipient, &new_recipient);

    // Advance past cliff and claim as new_recipient
    advance_ledger(&env, 60);
    let claimed = client.claim_vested(&new_recipient);
    assert_eq!(claimed, 600);
    assert_eq!(tc.balance(&new_recipient), 600);
}

/// Old recipient cannot claim after transfer.
#[test]
fn test_old_recipient_cannot_claim_after_transfer() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, old_recipient) = generate_addresses(&env);
    let new_recipient = Address::generate(&env);

    create_vesting_stream(&env, &client, &sponsor, &old_recipient, 10, 50, 200);
    client.transfer_stream(&old_recipient, &new_recipient);

    advance_ledger(&env, 60);

    let err = client
        .try_claim_vested(&old_recipient)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::ScheduleNotFound);
}

/// Transfer to same address is rejected.
#[test]
fn test_transfer_to_same_address_rejected() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    let err = client
        .try_transfer_stream(&recipient, &recipient)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::InvalidRecipient);
}

/// Transfer when current_recipient has no stream fails.
#[test]
fn test_transfer_no_schedule_fails() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let nobody = Address::generate(&env);
    let new_recipient = Address::generate(&env);

    let err = client
        .try_transfer_stream(&nobody, &new_recipient)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::ScheduleNotFound);
}

/// Transfer to an address that already has a stream fails.
#[test]
fn test_transfer_to_existing_recipient_fails() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, alice) = generate_addresses(&env);
    let bob = Address::generate(&env);

    let (token_id, _) = setup_token(&env, &sponsor, 4_000);
    let rate = 10 * RATE_DECIMALS;

    client.create_vesting_stream(&sponsor, &alice, &token_id, &rate, &50, &200);
    client.create_vesting_stream(&sponsor, &bob, &token_id, &rate, &50, &200);

    let err = client
        .try_transfer_stream(&alice, &bob)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::ScheduleAlreadyExists);
}

/// Transfer emits StreamTransferred event with correct topics.
#[test]
fn test_transfer_emits_event() {
    let env = setup_env();
    let (contract_id, client) = register_contract(&env);
    let (sponsor, old_recipient) = generate_addresses(&env);
    let new_recipient = Address::generate(&env);

    create_vesting_stream(&env, &client, &sponsor, &old_recipient, 10, 50, 200);
    client.transfer_stream(&old_recipient, &new_recipient);

    let all_events = env.events().all();
    let found = all_events.iter().any(|(contract, topics, _data)| {
        if contract != contract_id {
            return false;
        }
        if let Some(first_topic) = topics.get(0) {
            if let Ok(sym) = Symbol::try_from_val(&env, &first_topic) {
                return sym == Symbol::new(&env, "StreamTransferred");
            }
        }
        false
    });

    assert!(found, "StreamTransferred event not emitted");
}

/// Transfer mid-stream preserves last_claimed_ledger and total_claimed.
#[test]
fn test_transfer_preserves_claim_state() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, old_recipient) = generate_addresses(&env);
    let new_recipient = Address::generate(&env);

    let (token_id, _) =
        create_vesting_stream(&env, &client, &sponsor, &old_recipient, 10, 50, 200);

    // Claim 100 ledgers' worth as old_recipient
    advance_ledger(&env, 100);
    let claimed = client.claim_vested(&old_recipient);
    assert_eq!(claimed, 1_000);

    // Transfer
    client.transfer_stream(&old_recipient, &new_recipient);

    // New recipient's schedule should show the same last_claimed_ledger and total_claimed
    let schedule = client.get_schedule(&new_recipient).unwrap();
    assert_eq!(schedule.total_claimed, 1_000);
    // last_claimed_ledger is advanced to where we claimed
    assert_eq!(schedule.last_claimed_ledger, 200); // start=100, advanced 100 → 200

    // New recipient can only claim the remaining tokens
    advance_ledger(&env, 50);
    let claimed2 = client.claim_vested(&new_recipient);
    assert_eq!(claimed2, 500);
}
