//! Tests for multi-token vesting streams (issue #587).
//!
//! Covers:
//! - Stream creation (success, validation errors, duplicate detection)
//! - Partial claims mid-stream
//! - Full claim (past end_ledger, schedule removal)
//! - Cancellation before and after the cliff
//! - Two-recipient independence

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, vec, Address, Vec};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{advance_ledger, setup_env},
    types::TokenAllocation,
};

use super::super::tests::token_helper::{create_token, mint_to};

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Builds a standard two-token multi-stream and returns all handles.
///
/// * token_a: rate = 10
/// * token_b: rate = 5
/// * cliff_duration = 50, total_duration = 200
/// * deposit_a = 10 × 200 = 2 000; deposit_b = 5 × 200 = 1 000
fn setup_two_token_stream(
) -> (
    soroban_sdk::Env,
    Address, // contract_id
    VestingDripsClient<'static>,
    Address, // sponsor
    Address, // recipient
    Address, // token_a
    Address, // token_b
) {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_a, _) = create_token(&env, &sponsor);
    let (token_b, _) = create_token(&env, &sponsor);

    // Mint full deposits.
    mint_to(&env, &token_a, &sponsor, 2_000);
    mint_to(&env, &token_b, &sponsor, 1_000);

    let allocations: Vec<TokenAllocation> = vec![
        &env,
        TokenAllocation { token: token_a.clone(), rate_per_ledger: 10 },
        TokenAllocation { token: token_b.clone(), rate_per_ledger: 5 },
    ];

    client
        .create_multi_token_stream(&sponsor, &recipient, &allocations, &50, &200)
        .unwrap();

    (env, contract_id, client, sponsor, recipient, token_a, token_b)
}

// ── Creation tests ────────────────────────────────────────────────────────────

#[test]
fn test_create_multi_token_stream_success() {
    let (env, contract_id, client, _sponsor, recipient, token_a, token_b) =
        setup_two_token_stream();

    // Schedule stored under token_a key.
    let schedule = client.get_multi_schedule(&recipient, &token_a).unwrap();
    assert_eq!(schedule.start_ledger, 100);
    assert_eq!(schedule.cliff_ledger, 150); // 100 + 50
    assert_eq!(schedule.end_ledger, 300);   // 100 + 200
    assert_eq!(schedule.last_claimed_ledger, 100);
    assert_eq!(schedule.allocations.len(), 2);

    // Same schedule is accessible under token_b key.
    let sched_b = client.get_multi_schedule(&recipient, &token_b).unwrap();
    assert_eq!(sched_b.cliff_ledger, 150);

    // Contract holds both deposits.
    use soroban_sdk::token::TokenClient;
    let tc_a = TokenClient::new(&env, &token_a);
    let tc_b = TokenClient::new(&env, &token_b);
    assert_eq!(tc_a.balance(&contract_id), 2_000);
    assert_eq!(tc_b.balance(&contract_id), 1_000);
}

#[test]
fn test_create_multi_token_stream_invalid_rate_fails() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_a, _) = create_token(&env, &sponsor);
    let (token_b, _) = create_token(&env, &sponsor);

    let allocations: Vec<TokenAllocation> = vec![
        &env,
        TokenAllocation { token: token_a.clone(), rate_per_ledger: 10 },
        TokenAllocation { token: token_b.clone(), rate_per_ledger: 0 }, // invalid
    ];

    let err = client
        .create_multi_token_stream(&sponsor, &recipient, &allocations, &50, &200)
        .unwrap_err();

    assert_eq!(err, VestingError::InvalidRate.into());
}

#[test]
fn test_create_multi_token_stream_invalid_duration_fails() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_a, _) = create_token(&env, &sponsor);

    let allocations: Vec<TokenAllocation> = vec![
        &env,
        TokenAllocation { token: token_a.clone(), rate_per_ledger: 10 },
    ];

    // cliff == total → InvalidDuration
    let err = client
        .create_multi_token_stream(&sponsor, &recipient, &allocations, &200, &200)
        .unwrap_err();
    assert_eq!(err, VestingError::InvalidDuration.into());
}

#[test]
fn test_create_multi_token_stream_duplicate_fails() {
    let (env, _contract_id, client, sponsor, recipient, token_a, token_b) =
        setup_two_token_stream();

    // Mint a second batch so the transfer would succeed if not for the guard.
    mint_to(&env, &token_a, &sponsor, 2_000);
    mint_to(&env, &token_b, &sponsor, 1_000);

    let allocations: Vec<TokenAllocation> = vec![
        &env,
        TokenAllocation { token: token_a.clone(), rate_per_ledger: 10 },
        TokenAllocation { token: token_b.clone(), rate_per_ledger: 5 },
    ];

    let err = client
        .create_multi_token_stream(&sponsor, &recipient, &allocations, &50, &200)
        .unwrap_err();

    assert_eq!(err, VestingError::ScheduleAlreadyExists.into());
}

// ── Claim tests ───────────────────────────────────────────────────────────────

#[test]
fn test_claim_multi_token_before_cliff_fails() {
    let (env, _contract_id, client, _sponsor, recipient, token_a, _token_b) =
        setup_two_token_stream();

    // Advance to ledger 130 (cliff is 150 → not reached).
    advance_ledger(&env, 30);

    let err = client
        .claim_multi_token_vested(&recipient, &token_a)
        .unwrap_err();
    assert_eq!(err, VestingError::CliffNotReached.into());
}

#[test]
fn test_claim_multi_token_at_cliff_includes_all_accrued() {
    let (env, _contract_id, client, _sponsor, recipient, token_a, token_b) =
        setup_two_token_stream();

    // Jump exactly to cliff (50 ledgers → ledger 150).
    advance_ledger(&env, 50);

    // Claim returns total tokens across both allocations.
    // token_a: 50 × 10 = 500; token_b: 50 × 5 = 250 → total = 750
    let total = client
        .claim_multi_token_vested(&recipient, &token_a)
        .unwrap();
    assert_eq!(total, 750);

    use soroban_sdk::token::TokenClient;
    let env_ref = &env;
    let tc_a = TokenClient::new(env_ref, &token_a);
    let tc_b = TokenClient::new(env_ref, &token_b);
    assert_eq!(tc_a.balance(&recipient), 500);
    assert_eq!(tc_b.balance(&recipient), 250);
}

#[test]
fn test_partial_claim_mid_stream() {
    let (env, _contract_id, client, _sponsor, recipient, token_a, token_b) =
        setup_two_token_stream();

    // First claim at ledger 200 (100 ledgers from start).
    advance_ledger(&env, 100);
    let total1 = client
        .claim_multi_token_vested(&recipient, &token_a)
        .unwrap();
    // token_a: 100 × 10 = 1000; token_b: 100 × 5 = 500 → total = 1500
    assert_eq!(total1, 1_500);

    // Second claim 50 ledgers later (ledger 250).
    advance_ledger(&env, 50);
    let total2 = client
        .claim_multi_token_vested(&recipient, &token_a)
        .unwrap();
    // token_a: 50 × 10 = 500; token_b: 50 × 5 = 250 → total = 750
    assert_eq!(total2, 750);

    use soroban_sdk::token::TokenClient;
    let tc_a = TokenClient::new(&env, &token_a);
    let tc_b = TokenClient::new(&env, &token_b);
    assert_eq!(tc_a.balance(&recipient), 1_500);
    assert_eq!(tc_b.balance(&recipient), 750);
}

#[test]
fn test_double_claim_same_ledger_returns_nothing_to_claim() {
    let (env, _contract_id, client, _sponsor, recipient, token_a, _token_b) =
        setup_two_token_stream();

    advance_ledger(&env, 100);
    client.claim_multi_token_vested(&recipient, &token_a).unwrap();

    let err = client
        .claim_multi_token_vested(&recipient, &token_a)
        .unwrap_err();
    assert_eq!(err, VestingError::NothingToClaim.into());
}

#[test]
fn test_full_claim_past_end_ledger() {
    let (env, _contract_id, client, _sponsor, recipient, token_a, token_b) =
        setup_two_token_stream();

    // Jump well past end_ledger (300).
    advance_ledger(&env, 500);

    let total = client
        .claim_multi_token_vested(&recipient, &token_a)
        .unwrap();
    // token_a: 200 × 10 = 2000; token_b: 200 × 5 = 1000 → total = 3000
    assert_eq!(total, 3_000);

    use soroban_sdk::token::TokenClient;
    let tc_a = TokenClient::new(&env, &token_a);
    let tc_b = TokenClient::new(&env, &token_b);
    assert_eq!(tc_a.balance(&recipient), 2_000);
    assert_eq!(tc_b.balance(&recipient), 1_000);

    // Both schedule entries should be removed.
    assert!(client.get_multi_schedule(&recipient, &token_a).is_none());
    assert!(client.get_multi_schedule(&recipient, &token_b).is_none());
}

#[test]
fn test_claim_nonexistent_multi_schedule_fails() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let recipient = Address::generate(&env);
    let sponsor = Address::generate(&env);
    let (token_a, _) = create_token(&env, &sponsor);

    let err = client
        .claim_multi_token_vested(&recipient, &token_a)
        .unwrap_err();
    assert_eq!(err, VestingError::ScheduleNotFound.into());
}

// ── Cancel tests ──────────────────────────────────────────────────────────────

#[test]
fn test_cancel_multi_token_before_cliff_full_refund() {
    let (env, _contract_id, client, sponsor, recipient, token_a, token_b) =
        setup_two_token_stream();

    // Cancel at ledger 120 (cliff = 150 → not reached).
    advance_ledger(&env, 20);
    client
        .cancel_multi_token_stream(&sponsor, &recipient, &token_a)
        .unwrap();

    use soroban_sdk::token::TokenClient;
    let tc_a = TokenClient::new(&env, &token_a);
    let tc_b = TokenClient::new(&env, &token_b);

    // Full deposits refunded to sponsor.
    assert_eq!(tc_a.balance(&sponsor), 2_000);
    assert_eq!(tc_b.balance(&sponsor), 1_000);

    // Recipient gets nothing.
    assert_eq!(tc_a.balance(&recipient), 0);
    assert_eq!(tc_b.balance(&recipient), 0);

    // Schedules removed.
    assert!(client.get_multi_schedule(&recipient, &token_a).is_none());
    assert!(client.get_multi_schedule(&recipient, &token_b).is_none());
}

#[test]
fn test_cancel_multi_token_after_cliff_splits_tokens() {
    let (env, _contract_id, client, sponsor, recipient, token_a, token_b) =
        setup_two_token_stream();

    // Cancel at ledger 200 (100 ledgers past start; cliff passed at 150).
    advance_ledger(&env, 100);
    client
        .cancel_multi_token_stream(&sponsor, &recipient, &token_a)
        .unwrap();

    use soroban_sdk::token::TokenClient;
    let tc_a = TokenClient::new(&env, &token_a);
    let tc_b = TokenClient::new(&env, &token_b);

    // Recipient earned 100 ledgers × rate each.
    assert_eq!(tc_a.balance(&recipient), 1_000); // 100 × 10
    assert_eq!(tc_b.balance(&recipient), 500);   // 100 × 5

    // Sponsor refunded remaining 100 ledgers × rate each.
    assert_eq!(tc_a.balance(&sponsor), 1_000); // 100 × 10
    assert_eq!(tc_b.balance(&sponsor), 500);   // 100 × 5

    // Schedules removed.
    assert!(client.get_multi_schedule(&recipient, &token_a).is_none());
    assert!(client.get_multi_schedule(&recipient, &token_b).is_none());
}

#[test]
fn test_cancel_nonexistent_multi_stream_fails() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_a, _) = create_token(&env, &sponsor);

    let err = client
        .cancel_multi_token_stream(&sponsor, &recipient, &token_a)
        .unwrap_err();
    assert_eq!(err, VestingError::ScheduleNotFound.into());
}

#[test]
fn test_cancel_exactly_at_cliff_boundary() {
    let (env, _contract_id, client, sponsor, recipient, token_a, token_b) =
        setup_two_token_stream();

    // Advance exactly to cliff_ledger (50 → ledger 150).
    advance_ledger(&env, 50);
    client
        .cancel_multi_token_stream(&sponsor, &recipient, &token_a)
        .unwrap();

    use soroban_sdk::token::TokenClient;
    let tc_a = TokenClient::new(&env, &token_a);
    let tc_b = TokenClient::new(&env, &token_b);

    // Recipient earned 50 ledgers × rate.
    assert_eq!(tc_a.balance(&recipient), 500); // 50 × 10
    assert_eq!(tc_b.balance(&recipient), 250); // 50 × 5

    // Sponsor refunded 150 remaining ledgers × rate.
    assert_eq!(tc_a.balance(&sponsor), 1_500); // 150 × 10
    assert_eq!(tc_b.balance(&sponsor), 750);   // 150 × 5
}

// ── Independence tests ────────────────────────────────────────────────────────

/// Two recipients can have separate multi-token streams; claiming one does not
/// affect the other.
#[test]
fn test_two_recipients_multi_streams_are_independent() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (token_a, _) = create_token(&env, &sponsor);
    let (token_b, _) = create_token(&env, &sponsor);

    // alice: rate_a=10, rate_b=5; bob: rate_a=20, rate_b=8
    // Alice deposit: 10×200 + 5×200 = 3000
    // Bob   deposit: 20×100 + 8×100 = 2800
    mint_to(&env, &token_a, &sponsor, 10 * 200 + 20 * 100);
    mint_to(&env, &token_b, &sponsor, 5 * 200 + 8 * 100);

    let alice_allocs: Vec<TokenAllocation> = vec![
        &env,
        TokenAllocation { token: token_a.clone(), rate_per_ledger: 10 },
        TokenAllocation { token: token_b.clone(), rate_per_ledger: 5 },
    ];
    let bob_allocs: Vec<TokenAllocation> = vec![
        &env,
        TokenAllocation { token: token_a.clone(), rate_per_ledger: 20 },
        TokenAllocation { token: token_b.clone(), rate_per_ledger: 8 },
    ];

    // cliff=50, total=200 for alice; cliff=30, total=100 for bob
    client
        .create_multi_token_stream(&sponsor, &alice, &alice_allocs, &50, &200)
        .unwrap();
    client
        .create_multi_token_stream(&sponsor, &bob, &bob_allocs, &30, &100)
        .unwrap();

    // Advance past both cliffs (alice_cliff=150, bob_cliff=130).
    advance_ledger(&env, 60); // ledger 160

    // Alice claims.
    let alice_total = client
        .claim_multi_token_vested(&alice, &token_a)
        .unwrap();
    // token_a: 60 × 10 = 600; token_b: 60 × 5 = 300 → 900
    assert_eq!(alice_total, 900);

    // Bob's schedule is untouched.
    let bob_sched = client.get_multi_schedule(&bob, &token_a).unwrap();
    assert_eq!(bob_sched.last_claimed_ledger, 100); // unchanged start_ledger

    use soroban_sdk::token::TokenClient;
    assert_eq!(TokenClient::new(&env, &token_a).balance(&bob), 0);
}
