#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::VestingDripsClient,
    error::VestingError,
    tests::{advance_ledger, create_vesting_stream, generate_addresses, register_contract, setup_env},
};

#[test]
fn test_claim_before_cliff_fails() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    advance_ledger(&env, 20);

    let err = client.try_claim_vested(&recipient).unwrap_err().unwrap();
    assert_eq!(err, VestingError::CliffNotReached);
}

#[test]
fn test_first_claim_at_cliff_includes_all_accrued() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);
    advance_ledger(&env, 50);

    let claimed = client.claim_vested(&recipient);
    assert_eq!(claimed, 500);
    assert_eq!(token_client.balance(&recipient), 500);
}

#[test]
fn test_partial_claim_mid_stream() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);
    advance_ledger(&env, 100);
    let claimed1 = client.claim_vested(&recipient);
    assert_eq!(claimed1, 1_000);

    advance_ledger(&env, 50);
    let claimed2 = client.claim_vested(&recipient);
    assert_eq!(claimed2, 500);

    assert_eq!(token_client.balance(&recipient), 1_500);
}

#[test]
fn test_claim_past_end_caps_at_end_ledger() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);
    advance_ledger(&env, 500);

    let claimed = client.claim_vested(&recipient);
    assert_eq!(claimed, 2_000);
    assert_eq!(token_client.balance(&recipient), 2_000);
    assert!(client.get_schedule(&recipient).is_none());
}

#[test]
fn test_double_claim_same_ledger_returns_nothing_to_claim() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    advance_ledger(&env, 100);
    client.claim_vested(&recipient);

    let err = client.try_claim_vested(&recipient).unwrap_err();
    assert_eq!(err, Ok(VestingError::NothingToClaim));
}

#[test]
fn test_claim_nonexistent_schedule_fails() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let random = Address::generate(&env);

    let err = client.try_claim_vested(&random).unwrap_err().unwrap();
    assert_eq!(err, VestingError::ScheduleNotFound);
}

#[test]
fn test_claimable_amount_at_end_ledger() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    advance_ledger(&env, 200);

    assert_eq!(client.claimable_amount(&recipient), 2_000);
}

#[test]
fn test_claimable_amount_after_end_ledger_caps_at_remaining() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    advance_ledger(&env, 100);
    client.claim_vested(&recipient);

    advance_ledger(&env, 500);

    assert_eq!(client.claimable_amount(&recipient), 1_000);
}

#[test]
fn test_claim_after_all_tokens_claimed_returns_nothing_to_claim() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    advance_ledger(&env, 300);
    client.claim_vested(&recipient);

    let err = client.try_claim_vested(&recipient).unwrap_err();
    assert_eq!(err, Ok(VestingError::ScheduleNotFound));
}

