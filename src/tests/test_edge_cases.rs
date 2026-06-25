#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{calculate_total_deposit, VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{advance_ledger, setup_env},
};

use super::super::tests::token_helper::{create_token, mint_to};

/// Ensures the stream still works with a very small cliff of 1 ledger.
#[test]
fn test_minimal_cliff_one_ledger() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 100);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &1, &10)
        .unwrap();

    // Cliff is at ledger 101; advance just 1.
    advance_ledger(&env, 1);
    let claimed = client.claim_vested(&recipient).unwrap();
    assert_eq!(claimed, 10); // 1 ledger × 10
    assert_eq!(token_client.balance(&recipient), 10);
}

/// Multiple recipients can have independent simultaneous streams.
#[test]
fn test_multiple_independent_streams() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 5_000);

    // A: rate=10, cliff=50, total=200 → deposit=2000
    client
        .create_vesting_stream(&sponsor, &recipient_a, &token_id, &10, &50, &200)
        .unwrap();
    // B: rate=15, cliff=20, total=200 → deposit=3000
    client
        .create_vesting_stream(&sponsor, &recipient_b, &token_id, &15, &20, &200)
        .unwrap();

    // Advance to ledger 170 (70 past start; B cliff at 120 passed, A cliff at 150 passed)
    advance_ledger(&env, 70);

    let claimed_a = client.claim_vested(&recipient_a).unwrap();
    let claimed_b = client.claim_vested(&recipient_b).unwrap();

    assert_eq!(claimed_a, 700);   // 70 × 10
    assert_eq!(claimed_b, 1_050); // 70 × 15
    assert_eq!(token_client.balance(&recipient_a), 700);
    assert_eq!(token_client.balance(&recipient_b), 1_050);
}

/// Claiming exactly at `end_ledger` clears the schedule.
#[test]
fn test_claim_exactly_at_end_removes_schedule() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &10, &100)
        .unwrap();

    advance_ledger(&env, 100); // exactly end_ledger
    client.claim_vested(&recipient).unwrap();

    assert!(client.get_schedule(&recipient).is_none());
}

/// Verifies incremental claims sum to the total deposit.
#[test]
fn test_incremental_claims_sum_to_total() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    // rate=5, cliff=20, total=100 → deposit=500
    mint_to(&env, &token_id, &sponsor, 500);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &5, &20, &100)
        .unwrap();

    // Claim in three separate windows: cliff, mid, end
    advance_ledger(&env, 20);
    client.claim_vested(&recipient).unwrap();
    advance_ledger(&env, 40);
    client.claim_vested(&recipient).unwrap();
    advance_ledger(&env, 40);
    client.claim_vested(&recipient).unwrap();

    assert_eq!(token_client.balance(&recipient), 500);
}

/// Confirms the exact overflow boundary for `rate * total_duration`.
#[test]
fn test_total_deposit_boundary_allows_max_valid_rate() {
    let total_duration = 2_u32;
    let max_valid_rate = i128::MAX / total_duration as i128;

    let total_deposit = calculate_total_deposit(max_valid_rate, total_duration).unwrap();

    assert_eq!(total_deposit, i128::MAX - 1);
}

/// The first value above the safe boundary must return `DepositOverflow`.
#[test]
fn test_total_deposit_boundary_rejects_max_plus_one() {
    let total_duration = 2_u32;
    let max_valid_rate = i128::MAX / total_duration as i128;

    let err = calculate_total_deposit(max_valid_rate + 1, total_duration).unwrap_err();

    assert_eq!(err, VestingError::DepositOverflow);
}
