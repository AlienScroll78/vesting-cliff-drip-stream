#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    tests::{
        advance_ledger, setup_env,
        factory::StreamBuilder,
        token_helper::{create_token, mint_to},
    },
};

/// A stream with a 1-ledger cliff unlocks instantly on the very next ledger.
#[test]
fn test_minimal_cliff_one_ledger() {
    let env = setup_env();
    let (stream, addrs) = StreamBuilder::default()
        .rate(10)
        .cliff_duration(1)
        .total_duration(10)
        .build(&env);

    // Cliff is start_ledger + 1; advance just 1.
    advance_ledger(&env, 1);
    let claimed = stream.client.claim_vested(&addrs.recipient).unwrap();
    assert_eq!(claimed, 10); // 1 ledger × 10
}

/// Multiple recipients can hold independent simultaneous streams on the same contract.
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

    // Advance to ledger 170 (70 past start; both cliffs passed).
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
    let (stream, addrs) = StreamBuilder::default()
        .rate(10)
        .cliff_duration(10)
        .total_duration(100)
        .build(&env);

    advance_ledger(&env, 100); // exactly end_ledger
    stream.client.claim_vested(&addrs.recipient).unwrap();

    assert!(stream.client.get_schedule(&addrs.recipient).is_none());
}

/// Incremental claims made across multiple windows should sum to the full deposit.
#[test]
fn test_incremental_claims_sum_to_total() {
    let env = setup_env();
    // rate=5, cliff=20, total=100 → deposit=500
    let (stream, addrs) = StreamBuilder::default()
        .rate(5)
        .cliff_duration(20)
        .total_duration(100)
        .build(&env);

    advance_ledger(&env, 20);
    stream.client.claim_vested(&addrs.recipient).unwrap();
    advance_ledger(&env, 40);
    stream.client.claim_vested(&addrs.recipient).unwrap();
    advance_ledger(&env, 40);
    stream.client.claim_vested(&addrs.recipient).unwrap();

    // All 500 tokens claimed in total.
    let token_client =
        soroban_sdk::token::TokenClient::new(&env, &stream.token);
    assert_eq!(token_client.balance(&addrs.recipient), 500);
}
