#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{advance_ledger, setup_env},
};

use super::super::tests::token_helper::{create_token, mint_to};

fn setup_stream(
    rate: i128,
    cliff_duration: u32,
    total_duration: u32,
) -> (
    soroban_sdk::Env,
    Address,          // contract_id
    VestingDripsClient<'static>,
    Address,          // sponsor
    Address,          // recipient
    Address,          // token_id
) {
    // Work-around: clone env for 'static lifetime in test context
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    let deposit = rate * total_duration as i128;
    mint_to(&env, &token_id, &sponsor, deposit);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &cliff_duration, &total_duration)
        .unwrap();

    (env, contract_id, client, sponsor, recipient, token_id)
}

#[test]
fn test_claim_before_cliff_fails() {
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

    // Try to claim at ledger 120 (cliff is 150)
    advance_ledger(&env, 20);

    let err = client.claim_vested(&recipient).unwrap_err();
    assert_eq!(err, VestingError::CliffNotReached.into());
}

#[test]
fn test_first_claim_at_cliff_includes_all_accrued() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    // rate=10, cliff=50, total=200 → deposit = 2000
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Jump exactly to the cliff (ledger 150).
    advance_ledger(&env, 50);

    let claimed = client.claim_vested(&recipient).unwrap();
    // 50 ledgers accrued since start × 10 = 500
    assert_eq!(claimed, 500);
    assert_eq!(token_client.balance(&recipient), 500);
}

#[test]
fn test_partial_claim_mid_stream() {
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

    // First claim at cliff+50 (ledger 200)
    advance_ledger(&env, 100);
    let claimed1 = client.claim_vested(&recipient).unwrap();
    assert_eq!(claimed1, 1_000); // 100 ledgers × 10

    // Second claim at ledger 250
    advance_ledger(&env, 50);
    let claimed2 = client.claim_vested(&recipient).unwrap();
    assert_eq!(claimed2, 500); // 50 ledgers × 10

    assert_eq!(token_client.balance(&recipient), 1_500);
}

#[test]
fn test_claim_past_end_caps_at_end_ledger() {
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

    // Jump way past the end ledger (300)
    advance_ledger(&env, 500);

    let claimed = client.claim_vested(&recipient).unwrap();
    assert_eq!(claimed, 2_000); // entire deposit, capped at end_ledger
    assert_eq!(token_client.balance(&recipient), 2_000);

    // Schedule should be removed after full claim.
    assert!(client.get_schedule(&recipient).is_none());
}

#[test]
fn test_double_claim_same_ledger_returns_nothing_to_claim() {
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

    advance_ledger(&env, 100);
    client.claim_vested(&recipient).unwrap();

    // Claiming again at the same ledger should return NothingToClaim.
    let err = client.claim_vested(&recipient).unwrap_err();
    assert_eq!(err, VestingError::NothingToClaim.into());
}

#[test]
fn test_claim_nonexistent_schedule_fails() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let random = Address::generate(&env);

    let err = client.claim_vested(&random).unwrap_err();
    assert_eq!(err, VestingError::ScheduleNotFound.into());
}

// ── end_ledger boundary tests ─────────────────────────────────────────────────

#[test]
fn test_claimable_amount_at_end_ledger() {
    // rate=10, cliff=50, total=200 → deposit=2000, end_ledger=300
    let (env, _contract_id, client, _sponsor, recipient, _token_id) =
        setup_stream(10, 50, 200);

    // Advance exactly to end_ledger (start=100, end=300 → +200 ledgers)
    advance_ledger(&env, 200);

    // Full deposit should be claimable
    assert_eq!(client.claimable_amount(&recipient), 2_000);
}

#[test]
fn test_claimable_amount_after_end_ledger_caps_at_remaining() {
    // rate=10, cliff=50, total=200 → deposit=2000
    let (env, _contract_id, client, _sponsor, recipient, _token_id) =
        setup_stream(10, 50, 200);

    // Claim halfway through (at ledger 200 = start+100)
    advance_ledger(&env, 100);
    client.claim_vested(&recipient).unwrap(); // claims 1000

    // Advance well past end_ledger
    advance_ledger(&env, 500);

    // Only the remaining 1000 tokens should be claimable (capped at end_ledger)
    assert_eq!(client.claimable_amount(&recipient), 1_000);
}

#[test]
fn test_claim_after_all_tokens_claimed_returns_nothing_to_claim() {
    let (env, _contract_id, client, _sponsor, recipient, _token_id) =
        setup_stream(10, 50, 200);

    // Advance past end and claim everything
    advance_ledger(&env, 300);
    client.claim_vested(&recipient).unwrap();

    // Schedule is removed; a second attempt should return ScheduleNotFound
    let err = client.claim_vested(&recipient).unwrap_err();
    assert_eq!(err, VestingError::ScheduleNotFound.into());
}
