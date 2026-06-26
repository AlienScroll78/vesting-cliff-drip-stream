#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{advance_ledger, setup_env},
};

use super::super::tests::token_helper::{create_token, mint_to};

#[test]
fn test_create_stream_success() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);

    // Mint enough to cover rate(10) * duration(200) = 2000
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.rate_per_ledger, 10);
    assert_eq!(schedule.start_ledger, 100);
    assert_eq!(schedule.cliff_ledger, 150); // 100 + 50
    assert_eq!(schedule.end_ledger, 300);   // 100 + 200
    assert_eq!(schedule.last_claimed_ledger, 100);

    // Sponsor's balance should be drained.
    assert_eq!(token_client.balance(&sponsor), 0);
    // Contract holds the deposit.
    assert_eq!(token_client.balance(&contract_id), 2_000);
}

#[test]
fn test_create_stream_zero_rate_fails() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &0, &50, &200)
        .unwrap_err();

    assert_eq!(err, VestingError::InvalidRate.into());
}

#[test]
fn test_create_stream_invalid_duration_fails() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // cliff == total should fail
    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &200, &200)
        .unwrap_err();
    assert_eq!(err, VestingError::InvalidDuration.into());

    // cliff > total should also fail
    let err2 = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &300, &200)
        .unwrap_err();
    assert_eq!(err2, VestingError::InvalidDuration.into());
}

#[test]
fn test_create_duplicate_stream_fails() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 10_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap_err();

    assert_eq!(err, VestingError::ScheduleAlreadyExists.into());
}

// ── Issue #104: Multi-recipient independence ──────────────────────────────────

/// Two separate streams are keyed by distinct storage entries; claiming one
/// must not affect the other's claimable balance or schedule state.
#[test]
fn test_two_recipients_claim_independently() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    // alice: rate=10, cliff=50, total=200 → 2000
    // bob:   rate=20, cliff=30, total=100 → 2000
    mint_to(&env, &token_id, &sponsor, 4_000);

    client
        .create_vesting_stream(&sponsor, &alice, &token_id, &10, &50, &200)
        .unwrap();
    client
        .create_vesting_stream(&sponsor, &bob, &token_id, &20, &30, &100)
        .unwrap();

    // Advance past both cliffs (cliff_ledger for alice=150, bob=130).
    advance_ledger(&env, 60); // ledger 160

    // Only alice claims.
    let alice_claimed = client.claim_vested(&alice).unwrap();
    assert_eq!(alice_claimed, 600); // 60 × 10

    // Bob's schedule is untouched: last_claimed_ledger still at start (100).
    let bob_sched = client.get_schedule(&bob).unwrap();
    assert_eq!(bob_sched.last_claimed_ledger, 100);
    assert_eq!(token_client.balance(&bob), 0);
}

/// Cancelling one stream does not remove or modify the other.
#[test]
fn test_cancel_one_recipient_other_unaffected() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    // alice: rate=10, total=200 → 2000; bob: rate=5, total=100 → 500
    mint_to(&env, &token_id, &sponsor, 2_500);

    client
        .create_vesting_stream(&sponsor, &alice, &token_id, &10, &50, &200)
        .unwrap();
    client
        .create_vesting_stream(&sponsor, &bob, &token_id, &5, &20, &100)
        .unwrap();

    // Cancel alice before her cliff (ledger still 100).
    client.cancel_stream(&sponsor, &alice).unwrap();

    // Alice's schedule is gone.
    assert!(client.get_schedule(&alice).is_none());

    // Bob's schedule survives and is unmodified.
    let bob_sched = client.get_schedule(&bob).unwrap();
    assert_eq!(bob_sched.rate_per_ledger, 5);
    assert_eq!(bob_sched.last_claimed_ledger, 100);

    // Bob can still claim after his cliff (ledger 120 → advance 20).
    advance_ledger(&env, 20);
    let bob_claimed = client.claim_vested(&bob).unwrap();
    assert_eq!(bob_claimed, 100); // 20 × 5
    assert_eq!(token_client.balance(&bob), 100);
}

/// Storage keys are per-recipient: each recipient's schedule stores its own
/// distinct parameters with no cross-contamination.
#[test]
fn test_storage_keys_are_per_recipient() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 10_000);

    // Different rates, cliffs, durations.
    client
        .create_vesting_stream(&sponsor, &alice, &token_id, &7, &40, &150)
        .unwrap();
    client
        .create_vesting_stream(&sponsor, &bob, &token_id, &13, &60, &200)
        .unwrap();

    let alice_sched = client.get_schedule(&alice).unwrap();
    let bob_sched = client.get_schedule(&bob).unwrap();

    assert_eq!(alice_sched.rate_per_ledger, 7);
    assert_eq!(alice_sched.cliff_ledger, 140); // 100 + 40
    assert_eq!(alice_sched.end_ledger, 250);   // 100 + 150

    assert_eq!(bob_sched.rate_per_ledger, 13);
    assert_eq!(bob_sched.cliff_ledger, 160);   // 100 + 60
    assert_eq!(bob_sched.end_ledger, 300);     // 100 + 200
}
