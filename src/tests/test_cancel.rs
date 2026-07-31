#![cfg(test)]

use soroban_sdk::{Address, Env};

use crate::{
    contract::VestingDripsClient,
    error::VestingError,
    tests::{advance_ledger, create_vesting_stream, generate_addresses, register_contract, setup_env},
};

fn make_stream(env: &Env, client: &VestingDripsClient) -> (Address, Address, Address) {
    let (sponsor, recipient) = generate_addresses(env);
    let (token_id, _) = create_vesting_stream(env, client, &sponsor, &recipient, 10, 50, 200);
    (sponsor, recipient, token_id)
}

fn token_client<'a>(env: &'a Env, token_id: &Address) -> soroban_sdk::token::TokenClient<'a> {
    soroban_sdk::token::TokenClient::new(env, token_id)
}

#[test]
fn test_cancel_before_cliff_full_refund() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient, token_id) = make_stream(&env, &client);
    let tc = token_client(&env, &token_id);

    advance_ledger(&env, 20);
    client.cancel_stream(&sponsor, &recipient);

    assert_eq!(tc.balance(&sponsor), 2_000);
    assert_eq!(tc.balance(&recipient), 0);
    assert!(client.get_schedule(&recipient).is_none());
}

#[test]
fn test_cancel_after_cliff_splits_tokens() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient, token_id) = make_stream(&env, &client);
    let tc = token_client(&env, &token_id);

    advance_ledger(&env, 100);
    client.cancel_stream(&sponsor, &recipient);

    assert_eq!(tc.balance(&recipient), 1_000);
    assert_eq!(tc.balance(&sponsor), 1_000);
    assert!(client.get_schedule(&recipient).is_none());
}

#[test]
fn test_cancel_nonexistent_stream_fails() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    let err = client.try_cancel_stream(&sponsor, &recipient).unwrap_err().unwrap();
    assert_eq!(err, VestingError::ScheduleNotFound);
}

#[test]
fn test_cancel_one_ledger_before_cliff_full_refund() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient, token_id) = make_stream(&env, &client);
    let tc = token_client(&env, &token_id);

    advance_ledger(&env, 49);
    client.cancel_stream(&sponsor, &recipient);

    assert_eq!(tc.balance(&sponsor), 2_000);
    assert_eq!(tc.balance(&recipient), 0);
    assert!(client.get_schedule(&recipient).is_none());
}

#[test]
fn test_cancel_exactly_at_cliff_splits_tokens() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient, token_id) = make_stream(&env, &client);
    let tc = token_client(&env, &token_id);

    advance_ledger(&env, 50);
    client.cancel_stream(&sponsor, &recipient);

    assert_eq!(tc.balance(&recipient), 500);
    assert_eq!(tc.balance(&sponsor), 1_500);
    assert!(client.get_schedule(&recipient).is_none());
}

#[test]
fn test_cancel_one_ledger_after_cliff_splits_tokens() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient, token_id) = make_stream(&env, &client);
    let tc = token_client(&env, &token_id);

    advance_ledger(&env, 51);
    client.cancel_stream(&sponsor, &recipient);

    assert_eq!(tc.balance(&recipient), 510);
    assert_eq!(tc.balance(&sponsor), 1_490);
    assert!(client.get_schedule(&recipient).is_none());
}

