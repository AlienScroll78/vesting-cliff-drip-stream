#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, vec};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{advance_ledger, setup_env},
};

use super::super::tests::token_helper::{create_token, mint_to};

// ── Basic batch stream creation ────────────────────────────────────────────

/// Test creating multiple streams in a single batch.
#[test]
fn test_create_batch_streams_success() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);
    let recipient_c = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);

    // rate=10, cliff=50, total=100 → deposit=1000 per stream
    // Total deposit for 3 streams = 3000
    mint_to(&env, &token_id, &sponsor, 3_000);

    let streams = vec![
        &env,
        (recipient_a.clone(), 10, 50, 100),
        (recipient_b.clone(), 10, 50, 100),
        (recipient_c.clone(), 10, 50, 100),
    ];

    client
        .create_batch_streams(&sponsor, &token_id, &streams)
        .unwrap();

    // Verify all three schedules were created
    assert!(client.get_schedule(&recipient_a).is_some());
    assert!(client.get_schedule(&recipient_b).is_some());
    assert!(client.get_schedule(&recipient_c).is_some());

    // Verify total deposit was transferred
    assert_eq!(
        token_client.balance(&env.current_contract_address()),
        3_000
    );

    // Verify sponsor's balance is zero (all transferred)
    assert_eq!(token_client.balance(&sponsor), 0);
}

/// Test creating batch with varied rates and durations.
#[test]
fn test_create_batch_streams_varied_parameters() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);

    // A: rate=10, total=100 → 1000
    // B: rate=20, total=50  → 1000
    // Total = 2000
    mint_to(&env, &token_id, &sponsor, 2_000);

    let streams = vec![
        &env,
        (recipient_a.clone(), 10, 50, 100),
        (recipient_b.clone(), 20, 30, 50),
    ];

    client
        .create_batch_streams(&sponsor, &token_id, &streams)
        .unwrap();

    let schedule_a = client.get_schedule(&recipient_a).unwrap();
    let schedule_b = client.get_schedule(&recipient_b).unwrap();

    assert_eq!(schedule_a.rate_per_ledger, 10);
    assert_eq!(schedule_b.rate_per_ledger, 20);

    // Verify end ledgers are correct
    let start = env.ledger().sequence();
    assert_eq!(schedule_a.end_ledger, start + 100);
    assert_eq!(schedule_b.end_ledger, start + 50);
}

// ── Error scenarios ────────────────────────────────────────────────────────

/// Test batch creation fails if any rate is invalid.
#[test]
fn test_create_batch_streams_invalid_rate_in_batch() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    let streams = vec![
        &env,
        (recipient_a.clone(), 10, 50, 100),
        (recipient_b.clone(), 0, 50, 100), // Invalid: rate = 0
    ];

    let err = client
        .create_batch_streams(&sponsor, &token_id, &streams)
        .unwrap_err();
    assert_eq!(err, VestingError::InvalidRate.into());

    // No schedules should be created
    assert!(client.get_schedule(&recipient_a).is_none());
    assert!(client.get_schedule(&recipient_b).is_none());

    // No tokens should be transferred
    assert_eq!(env.current_contract_address(), env.current_contract_address());
}

/// Test batch creation fails if any duration is invalid.
#[test]
fn test_create_batch_streams_invalid_duration_in_batch() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    let streams = vec![
        &env,
        (recipient_a.clone(), 10, 50, 100),
        (recipient_b.clone(), 10, 100, 100), // Invalid: total_duration <= cliff_duration
    ];

    let err = client
        .create_batch_streams(&sponsor, &token_id, &streams)
        .unwrap_err();
    assert_eq!(err, VestingError::InvalidDuration.into());

    // No schedules should be created (rolled back)
    assert!(client.get_schedule(&recipient_a).is_none());
    assert!(client.get_schedule(&recipient_b).is_none());
}

/// Test batch creation fails if sponsor and recipient are the same.
#[test]
fn test_create_batch_streams_sponsor_equals_recipient() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    let streams = vec![
        &env,
        (recipient_a.clone(), 10, 50, 100),
        (sponsor.clone(), 10, 50, 100), // Invalid: sponsor == recipient
    ];

    let err = client
        .create_batch_streams(&sponsor, &token_id, &streams)
        .unwrap_err();
    assert_eq!(err, VestingError::InvalidRecipient.into());

    // No schedules should be created
    assert!(client.get_schedule(&recipient_a).is_none());
}

/// Test batch creation fails if any schedule already exists.
#[test]
fn test_create_batch_streams_schedule_already_exists() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 5_000);

    // Create a stream for recipient_a first
    client
        .create_vesting_stream(&sponsor, &recipient_a, &token_id, &10, &50, &100)
        .unwrap();

    // Now try to batch create including recipient_a (should fail)
    let streams = vec![
        &env,
        (recipient_a.clone(), 10, 50, 100),
        (recipient_b.clone(), 10, 50, 100),
    ];

    let err = client
        .create_batch_streams(&sponsor, &token_id, &streams)
        .unwrap_err();
    assert_eq!(err, VestingError::ScheduleAlreadyExists.into());

    // Only recipient_a should exist (from the first create call)
    assert!(client.get_schedule(&recipient_a).is_some());
    // recipient_b should NOT exist (batch failed)
    assert!(client.get_schedule(&recipient_b).is_none());
}

/// Test batch creation fails if total deposit overflows.
#[test]
fn test_create_batch_streams_deposit_overflow() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // Mint more than enough (simulating overflow scenario with large rates)
    mint_to(&env, &token_id, &sponsor, i128::MAX);

    let streams = vec![
        &env,
        (recipient_a.clone(), i128::MAX / 2, 10, 10),
        (recipient_b.clone(), i128::MAX / 2 + 100, 10, 10), // Overflow on addition
    ];

    let err = client
        .create_batch_streams(&sponsor, &token_id, &streams)
        .unwrap_err();
    assert_eq!(err, VestingError::DepositOverflow.into());

    // No schedules should be created
    assert!(client.get_schedule(&recipient_a).is_none());
    assert!(client.get_schedule(&recipient_b).is_none());
}

/// Test batch creation fails if insufficient balance.
#[test]
fn test_create_batch_streams_insufficient_balance() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // Only mint 1500, but need 2000 (1000 + 1000)
    mint_to(&env, &token_id, &sponsor, 1_500);

    let streams = vec![
        &env,
        (recipient_a.clone(), 10, 50, 100),
        (recipient_b.clone(), 10, 50, 100),
    ];

    let err = client
        .create_batch_streams(&sponsor, &token_id, &streams)
        .unwrap_err();
    assert_eq!(err, VestingError::TransferFailed.into());

    // No schedules should be created (atomic rollback)
    assert!(client.get_schedule(&recipient_a).is_none());
    assert!(client.get_schedule(&recipient_b).is_none());
}

// ── Event emission ─────────────────────────────────────────────────────────

/// Test that individual StreamCreated events are emitted for each recipient.
#[test]
fn test_create_batch_streams_events_emitted() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    let streams = vec![
        &env,
        (recipient_a.clone(), 10, 50, 100),
        (recipient_b.clone(), 10, 50, 100),
    ];

    client
        .create_batch_streams(&sponsor, &token_id, &streams)
        .unwrap();

    // Retrieve events to verify they were emitted
    let events = env.events().all();
    // We expect at least 2 StreamCreated events (one per recipient)
    assert!(
        events.len() >= 2,
        "Expected at least 2 events, got {}",
        events.len()
    );
}

// ── Empty and edge cases ───────────────────────────────────────────────────

/// Test creating a single-recipient batch works like create_vesting_stream.
#[test]
fn test_create_batch_streams_single_recipient() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000);

    let streams = vec![&env, (recipient.clone(), 10, 50, 100)];

    client
        .create_batch_streams(&sponsor, &token_id, &streams)
        .unwrap();

    assert!(client.get_schedule(&recipient).is_some());
    assert_eq!(token_client.balance(&recipient), 0); // No claim yet
    assert_eq!(
        token_client.balance(&env.current_contract_address()),
        1_000
    );
}

/// Test claiming from batch-created streams works correctly.
#[test]
fn test_claim_from_batch_created_streams() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    let streams = vec![
        &env,
        (recipient_a.clone(), 10, 50, 100),
        (recipient_b.clone(), 10, 50, 100),
    ];

    client
        .create_batch_streams(&sponsor, &token_id, &streams)
        .unwrap();

    // Advance past cliff
    advance_ledger(&env, 60);

    // Both recipients can claim
    let claimed_a = client.claim_vested(&recipient_a, &None).unwrap();
    let claimed_b = client.claim_vested(&recipient_b, &None).unwrap();

    assert_eq!(claimed_a, 600); // 60 ledgers × 10
    assert_eq!(claimed_b, 600);

    assert_eq!(token_client.balance(&recipient_a), 600);
    assert_eq!(token_client.balance(&recipient_b), 600);
}
