#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
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

    let err = client.try_claim_vested(&recipient, &None).unwrap_err().unwrap();
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

    // At cliff: 50 ledgers * 10 tokens/ledger = 500
    let claimed = client.claim_vested(&recipient, &None);
    assert_eq!(claimed, 500);
    assert_eq!(token_client.balance(&recipient), 500);
}

#[test]
fn test_claim_without_stream_id_claims_all_tokens() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor_a, recipient) = generate_addresses(&env);
    let sponsor_b = Address::generate(&env);
    let (token_a, _) = create_vesting_stream(&env, &client, &sponsor_a, &recipient, 10, 50, 200);
    let (token_b, _) = create_vesting_stream(&env, &client, &sponsor_b, &recipient, 20, 50, 200);
    let token_client_a = soroban_sdk::token::TokenClient::new(&env, &token_a);
    let token_client_b = soroban_sdk::token::TokenClient::new(&env, &token_b);

    advance_ledger(&env, 75);
    let claimed = client.claim_vested(&recipient, &None);

    assert_eq!(claimed, 2_250);
    assert_eq!(token_client_a.balance(&recipient), 750);
    assert_eq!(token_client_b.balance(&recipient), 1_500);
    assert_eq!(client.get_stream_ids(&recipient).len(), 2);
}

#[test]
fn test_partial_claim_exact_amount() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, token_client) =
        create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    // Jump to cliff + 50 ledgers (1000 tokens accrued)
    advance_ledger(&env, 100);

    // `Some(0)` claims only stream 0.
    let claimed = client.claim_vested(&recipient, &Some(0)).unwrap();
    assert_eq!(claimed, 1_000);
    assert_eq!(token_client.balance(&recipient), 1_000);

    assert_eq!(client.claimable_amount(&recipient), 0);
}

#[test]
fn test_partial_claim_mid_stream() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);
    advance_ledger(&env, 100);
    // 100 ledgers * 10 = 1000
    let claimed1 = client.claim_vested(&recipient, &None);
    assert_eq!(claimed1, 1_000);

    advance_ledger(&env, 50);
    // 50 more ledgers * 10 = 500
    let claimed2 = client.claim_vested(&recipient, &None);
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

    // Full deposit: 200 ledgers * 10 = 2000
    let claimed = client.claim_vested(&recipient, &None);
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
    client.claim_vested(&recipient, &None);

    let err = client.try_claim_vested(&recipient, &None).unwrap_err();
    assert_eq!(err, Ok(VestingError::NothingToClaim));
}

#[test]
fn test_claim_nonexistent_schedule_fails() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let random = Address::generate(&env);

    let err = client.try_claim_vested(&random, &None).unwrap_err().unwrap();
    assert_eq!(err, VestingError::ScheduleNotFound);
}

#[test]
fn test_claimable_amount_at_end_ledger() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    advance_ledger(&env, 200);

    // 200 ledgers * 10 = 2000
    assert_eq!(client.claimable_amount(&recipient), 2_000);
}

#[test]
fn test_claimable_amount_after_end_ledger_caps_at_remaining() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    advance_ledger(&env, 100);
    client.claim_vested(&recipient, &None);

    advance_ledger(&env, 500);

    // remaining = 2000 - 1000 = 1000
    assert_eq!(client.claimable_amount(&recipient), 1_000);
}

#[test]
fn test_claim_after_all_tokens_claimed_returns_schedule_not_found() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    advance_ledger(&env, 300);
    client.claim_vested(&recipient, &None);

    // Schedule was removed after full claim
    let err = client.try_claim_vested(&recipient, &None).unwrap_err();
    assert_eq!(err, Ok(VestingError::ScheduleNotFound));
}
