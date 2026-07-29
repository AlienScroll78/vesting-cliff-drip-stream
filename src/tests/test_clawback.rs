#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, String};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{advance_ledger, setup_env},
};

use super::super::tests::token_helper::{create_token, mint_to};

#[test]
fn test_clawback_before_cliff_returns_all_tokens() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    // register_stellar_asset_contract_v2 creates a SAC; mock_all_auths makes
    // the clawback probe call succeed, so the clawback path is available.
    let (token_id, token_client) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Clawback before cliff — should recover all 2000 tokens.
    advance_ledger(&env, 20);
    let reason = String::from_str(&env, "employee termination for cause");
    client.clawback_stream(&sponsor, &recipient, &reason).unwrap();

    // All tokens returned to sponsor.
    assert_eq!(token_client.balance(&sponsor), 2_000);
    assert_eq!(token_client.balance(&recipient), 0);
    // Schedule must be removed.
    assert!(client.get_schedule(&recipient).is_none());
}

#[test]
fn test_clawback_after_partial_claim_returns_remaining() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    // rate=10, cliff=50, total=200 → deposit=2000
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Recipient claims at cliff (ledger 150): earns 50 × 10 = 500.
    advance_ledger(&env, 50);
    client.claim_vested(&recipient).unwrap();

    // Advance 50 more ledgers then clawback.
    // last_claimed_ledger = 150, end_ledger = 300
    // remaining = (300 - 150) × 10 = 1500
    advance_ledger(&env, 50);
    let reason = String::from_str(&env, "regulatory freeze");
    client.clawback_stream(&sponsor, &recipient, &reason).unwrap();

    assert_eq!(token_client.balance(&sponsor), 1_500);
    assert_eq!(token_client.balance(&recipient), 500); // already claimed
    assert!(client.get_schedule(&recipient).is_none());
}

#[test]
fn test_clawback_nonexistent_stream_fails() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);

    let reason = String::from_str(&env, "no stream here");
    let err = client.clawback_stream(&sponsor, &recipient, &reason).unwrap_err();
    assert_eq!(err, VestingError::ScheduleNotFound.into());
}

#[test]
fn test_clawback_removes_schedule() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    assert!(client.get_schedule(&recipient).is_some());

    let reason = String::from_str(&env, "compliance audit triggered clawback");
    client.clawback_stream(&sponsor, &recipient, &reason).unwrap();

    // Schedule must be removed after clawback.
    assert!(client.get_schedule(&recipient).is_none());
}

#[test]
fn test_clawback_at_end_returns_zero_remaining() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Claim everything first.
    advance_ledger(&env, 200);
    client.claim_vested(&recipient).unwrap();
    // Schedule is removed after full claim — ScheduleNotFound expected.
    let reason = String::from_str(&env, "post-claim clawback attempt");
    let err = client.clawback_stream(&sponsor, &recipient, &reason).unwrap_err();
    assert_eq!(err, VestingError::ScheduleNotFound.into());
}
