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

// ── Issue #103: Regression tests for known edge cases ────────────────────────

/// Guard: cliff_duration = total_duration - 1 (minimum gap of 1 ledger).
/// Only 1 ledger of tokens should accrue post-cliff.
#[test]
fn test_regression_cliff_equals_total_minus_one() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    // rate=10, cliff=99, total=100 → deposit=1000; only 1 post-cliff ledger
    mint_to(&env, &token_id, &sponsor, 1_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &99, &100)
        .unwrap();

    // Jump exactly to end_ledger (100 ledgers).
    advance_ledger(&env, 100);
    let claimed = client.claim_vested(&recipient).unwrap();
    // 100 ledgers total × 10 = 1000
    assert_eq!(claimed, 1_000);
    assert_eq!(token_client.balance(&recipient), 1_000);
    // Stream should be fully consumed.
    assert!(client.get_schedule(&recipient).is_none());
}

/// Guard: rate = 1 (minimum valid rate) produces correct accrual.
/// Prevents a regression where small rates were rounded to zero.
#[test]
fn test_regression_rate_of_one() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 100); // rate=1, total=100

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &1, &10, &100)
        .unwrap();

    advance_ledger(&env, 10); // exactly at cliff
    let claimed = client.claim_vested(&recipient).unwrap();
    assert_eq!(claimed, 10); // 10 ledgers × 1
    assert_eq!(token_client.balance(&recipient), 10);
}

/// Guard: claim immediately after end_ledger returns only the remaining tokens,
/// not an inflated amount due to unbounded ledger arithmetic.
#[test]
fn test_regression_claim_well_past_end_caps_correctly() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    // rate=10, cliff=10, total=50 → deposit=500
    mint_to(&env, &token_id, &sponsor, 500);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &10, &50)
        .unwrap();

    // Advance 10_000 ledgers past the end.
    advance_ledger(&env, 10_000);
    let claimed = client.claim_vested(&recipient).unwrap();
    // Must be exactly the deposit, not 10_000 × 10.
    assert_eq!(claimed, 500);
    assert_eq!(token_client.balance(&recipient), 500);
}

/// Guard: claimable_amount view returns 0 before cliff and correct value after.
/// Prevents a regression where the view leaked pre-cliff accrual.
#[test]
fn test_regression_claimable_amount_zero_before_cliff() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &100)
        .unwrap();

    // Before cliff: view must be 0.
    advance_ledger(&env, 30);
    assert_eq!(client.claimable_amount(&recipient), 0);

    // After cliff: view must reflect accrued ledgers.
    advance_ledger(&env, 20); // now at ledger 150 = cliff
    assert_eq!(client.claimable_amount(&recipient), 500); // 50 × 10
}

/// Guard: is_cliff_passed returns false before and true at/after the cliff.
/// Prevents off-by-one regression in the boundary check (>= vs >).
#[test]
fn test_regression_is_cliff_passed_boundary() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 500);

    // cliff_duration=50 → cliff_ledger=150
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &5, &50, &100)
        .unwrap();

    advance_ledger(&env, 49); // ledger 149 — one before cliff
    assert!(!client.is_cliff_passed(&recipient));

    advance_ledger(&env, 1); // ledger 150 — exactly cliff
    assert!(client.is_cliff_passed(&recipient));
}

/// Guard: negative rate is rejected.
/// Ensures the rate validation covers both zero and negative values.
#[test]
fn test_regression_negative_rate_rejected() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    use crate::error::VestingError;
    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &-1, &50, &100)
        .unwrap_err();
    assert_eq!(err, VestingError::InvalidRate.into());
}
