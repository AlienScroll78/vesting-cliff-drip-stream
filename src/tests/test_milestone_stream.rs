//! Tests for the milestone-based vesting stream (issue #310).

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, vec, Address, Vec};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{advance_ledger, setup_env, token_helper::{create_token, mint_to}},
};

// ── Validation ────────────────────────────────────────────────────────────────

#[test]
fn test_create_milestone_stream_empty_milestones_rejected() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 10_000);

    let empty: Vec<(u32, u32)> = Vec::new(&env);
    let err = client
        .try_create_milestone_stream(&sponsor, &recipient, &token_id, &empty, &500, &10_000)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::InvalidMilestones);
}

#[test]
fn test_create_milestone_stream_bps_not_10000_rejected() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 10_000);

    let milestones: Vec<(u32, u32)> = vec![&env, (200u32, 5000u32), (300u32, 4000u32)];
    let err = client
        .try_create_milestone_stream(&sponsor, &recipient, &token_id, &milestones, &400, &10_000)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::InvalidMilestones);
}

#[test]
fn test_create_milestone_stream_non_ascending_ledgers_rejected() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 10_000);

    let milestones: Vec<(u32, u32)> = vec![&env, (300u32, 5000u32), (200u32, 5000u32)];
    let err = client
        .try_create_milestone_stream(&sponsor, &recipient, &token_id, &milestones, &400, &10_000)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::InvalidMilestones);
}

#[test]
fn test_create_milestone_stream_duplicate_ledger_rejected() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 10_000);

    let milestones: Vec<(u32, u32)> = vec![&env, (200u32, 5000u32), (200u32, 5000u32)];
    let err = client
        .try_create_milestone_stream(&sponsor, &recipient, &token_id, &milestones, &200, &10_000)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::InvalidMilestones);
}

#[test]
fn test_create_milestone_stream_same_recipient_twice_rejected() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 20_000);

    let milestones: Vec<(u32, u32)> = vec![&env, (200u32, 5000u32), (300u32, 5000u32)];
    client.create_milestone_stream(&sponsor, &recipient, &token_id, &milestones, &300, &10_000);

    let err = client
        .try_create_milestone_stream(&sponsor, &recipient, &token_id, &milestones, &300, &10_000)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::ScheduleAlreadyExists);
}

#[test]
fn test_create_milestone_stream_sponsor_equals_recipient_rejected() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 10_000);

    let milestones: Vec<(u32, u32)> = vec![&env, (200u32, 10000u32)];
    let err = client
        .try_create_milestone_stream(&sponsor, &sponsor, &token_id, &milestones, &200, &10_000)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::InvalidRecipient);
}

// ── Happy path ────────────────────────────────────────────────────────────────

#[test]
fn test_create_milestone_stream_single_milestone_success() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 10_000);

    let milestones: Vec<(u32, u32)> = vec![&env, (200u32, 10000u32)];
    client.create_milestone_stream(&sponsor, &recipient, &token_id, &milestones, &200, &10_000);
}

#[test]
fn test_create_milestone_stream_four_equal_milestones() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 10_000);

    let milestones: Vec<(u32, u32)> = vec![
        &env,
        (200u32, 2500u32),
        (300u32, 2500u32),
        (400u32, 2500u32),
        (500u32, 2500u32),
    ];
    client.create_milestone_stream(&sponsor, &recipient, &token_id, &milestones, &500, &10_000);
}

// ── Claim milestones ──────────────────────────────────────────────────────────

#[test]
fn test_claim_milestone_nothing_before_first_milestone() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 10_000);

    let milestones: Vec<(u32, u32)> = vec![&env, (200u32, 10000u32)];
    client.create_milestone_stream(&sponsor, &recipient, &token_id, &milestones, &200, &10_000);

    let err = client.try_claim_milestone(&recipient).unwrap_err().unwrap();
    assert_eq!(err, VestingError::NothingToClaim);
}

#[test]
fn test_claim_milestone_single_100pct_milestone() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 10_000);

    let milestones: Vec<(u32, u32)> = vec![&env, (200u32, 10000u32)];
    client.create_milestone_stream(&sponsor, &recipient, &token_id, &milestones, &200, &10_000);

    advance_ledger(&env, 100); // seq = 200
    let claimed = client.claim_milestone(&recipient);

    assert_eq!(claimed, 10_000);
    assert_eq!(token_client.balance(&recipient), 10_000);
}

#[test]
fn test_claim_milestone_partial_two_of_four_milestones() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 10_000);

    let milestones: Vec<(u32, u32)> = vec![
        &env,
        (200u32, 2500u32),
        (300u32, 2500u32),
        (400u32, 2500u32),
        (500u32, 2500u32),
    ];
    client.create_milestone_stream(&sponsor, &recipient, &token_id, &milestones, &500, &10_000);

    advance_ledger(&env, 200); // seq = 300
    let claimed = client.claim_milestone(&recipient);

    assert_eq!(claimed, 5_000);
    assert_eq!(token_client.balance(&recipient), 5_000);
}

#[test]
fn test_claim_milestone_accumulates_all_four() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 10_000);

    let milestones: Vec<(u32, u32)> = vec![
        &env,
        (200u32, 2500u32),
        (300u32, 2500u32),
        (400u32, 2500u32),
        (500u32, 2500u32),
    ];
    client.create_milestone_stream(&sponsor, &recipient, &token_id, &milestones, &500, &10_000);

    advance_ledger(&env, 400); // seq = 500
    let claimed = client.claim_milestone(&recipient);

    assert_eq!(claimed, 10_000);
    assert_eq!(token_client.balance(&recipient), 10_000);
}

#[test]
fn test_claim_milestone_incremental_claims() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 10_000);

    let milestones: Vec<(u32, u32)> = vec![
        &env,
        (200u32, 5000u32),
        (400u32, 5000u32),
    ];
    client.create_milestone_stream(&sponsor, &recipient, &token_id, &milestones, &400, &10_000);

    advance_ledger(&env, 100); // seq = 200
    let first = client.claim_milestone(&recipient);
    assert_eq!(first, 5_000);
    assert_eq!(token_client.balance(&recipient), 5_000);

    advance_ledger(&env, 200); // seq = 400
    let second = client.claim_milestone(&recipient);
    assert_eq!(second, 5_000);
    assert_eq!(token_client.balance(&recipient), 10_000);

    // Schedule is removed after full claim
    let err = client.try_claim_milestone(&recipient).unwrap_err().unwrap();
    assert_eq!(err, VestingError::ScheduleNotFound);
}
