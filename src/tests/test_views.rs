#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::VestingDripsClient,
    tests::{advance_ledger, create_vesting_stream, generate_addresses, register_contract, setup_env},
    types::StreamStatus,
};

#[test]
fn test_claimable_amount_before_cliff_is_zero() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    advance_ledger(&env, 30);
    assert_eq!(client.claimable_amount(&recipient), 0);
}

#[test]
fn test_claimable_amount_after_cliff() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    advance_ledger(&env, 75);
    assert_eq!(client.claimable_amount(&recipient), 750);
}

#[test]
fn test_is_cliff_passed() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    assert!(!client.is_cliff_passed(&recipient));
    advance_ledger(&env, 50);
    assert!(client.is_cliff_passed(&recipient));
}

#[test]
fn test_get_schedule_returns_none_after_completion() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    advance_ledger(&env, 300);
    client.claim_vested(&recipient);

    assert!(client.get_schedule(&recipient).is_none());
}

#[test]
fn test_get_status_pre_cliff() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    assert_eq!(client.get_status(&recipient), Some(StreamStatus::PreCliff));
}

#[test]
fn test_get_status_active() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    advance_ledger(&env, 100);
    assert_eq!(client.get_status(&recipient), Some(StreamStatus::Active));
}

#[test]
fn test_get_status_completed() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    advance_ledger(&env, 200);
    assert_eq!(client.get_status(&recipient), Some(StreamStatus::Completed));
}

#[test]
fn test_get_status_none_when_no_schedule() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let recipient = Address::generate(&env);

    assert_eq!(client.get_status(&recipient), None);
}

