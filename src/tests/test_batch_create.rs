#![cfg(test)]

use soroban_sdk::{testutils::Address as _, vec, Address, Env, Vec};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::setup_env,
};

use super::super::tests::token_helper::{create_token, mint_to};

// ── Helper ────────────────────────────────────────────────────────────────────

/// Build a Vec<(Address, Address, i128, u32, u32)> entry.
fn entry(
    recipient: &Address,
    token: &Address,
    rate: i128,
    cliff: u32,
    total: u32,
) -> (Address, Address, i128, u32, u32) {
    (recipient.clone(), token.clone(), rate, cliff, total)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[test]
fn test_batch_create_single_recipient_succeeds() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);

    // rate=10, cliff=50, total=200 → deposit = 2_000
    mint_to(&env, &token_id, &sponsor, 2_000);

    let recipients: Vec<(Address, Address, i128, u32, u32)> =
        vec![&env, entry(&recipient, &token_id, 10, 50, 200)];

    client
        .batch_create_vesting_streams(&sponsor, &recipients)
        .unwrap();

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.rate_per_ledger, 10);
    assert_eq!(schedule.start_ledger, 100);
    assert_eq!(schedule.cliff_ledger, 150);
    assert_eq!(schedule.end_ledger, 300);
    assert_eq!(schedule.last_claimed_ledger, 100);

    // Full deposit taken from sponsor, held by contract.
    assert_eq!(token_client.balance(&sponsor), 0);
    assert_eq!(token_client.balance(&contract_id), 2_000);
}

#[test]
fn test_batch_create_multiple_recipients_succeeds() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let r3 = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);

    // r1: rate=10, total=200 → 2_000
    // r2: rate=5,  total=100 →   500
    // r3: rate=20, total=50  → 1_000
    // aggregate = 3_500
    mint_to(&env, &token_id, &sponsor, 3_500);

    let recipients: Vec<(Address, Address, i128, u32, u32)> = vec![
        &env,
        entry(&r1, &token_id, 10, 50, 200),
        entry(&r2, &token_id, 5, 20, 100),
        entry(&r3, &token_id, 20, 10, 50),
    ];

    client
        .batch_create_vesting_streams(&sponsor, &recipients)
        .unwrap();

    // All three schedules must exist.
    assert!(client.get_schedule(&r1).is_some());
    assert!(client.get_schedule(&r2).is_some());
    assert!(client.get_schedule(&r3).is_some());

    // Contract holds the full aggregate deposit.
    assert_eq!(token_client.balance(&contract_id), 3_500);
    assert_eq!(token_client.balance(&sponsor), 0);
}

#[test]
fn test_batch_create_rejects_duplicate_recipient() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 10_000);

    // Create a stream for the recipient first.
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // A batch that includes the same recipient should fail.
    let recipients: Vec<(Address, Address, i128, u32, u32)> =
        vec![&env, entry(&recipient, &token_id, 10, 50, 200)];

    let err = client
        .batch_create_vesting_streams(&sponsor, &recipients)
        .unwrap_err();

    assert_eq!(err, VestingError::ScheduleAlreadyExists.into());
}

#[test]
fn test_batch_create_rejects_invalid_rate() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 10_000);

    // r2 has rate=0, which is invalid.
    let recipients: Vec<(Address, Address, i128, u32, u32)> = vec![
        &env,
        entry(&r1, &token_id, 10, 50, 200),
        entry(&r2, &token_id, 0, 50, 200),
    ];

    let err = client
        .batch_create_vesting_streams(&sponsor, &recipients)
        .unwrap_err();

    assert_eq!(err, VestingError::InvalidRate.into());

    // Neither schedule should have been persisted (atomicity).
    assert!(client.get_schedule(&r1).is_none());
    assert!(client.get_schedule(&r2).is_none());
}

#[test]
fn test_batch_create_rejects_invalid_duration() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 10_000);

    // cliff_duration == total_duration → invalid.
    let recipients: Vec<(Address, Address, i128, u32, u32)> =
        vec![&env, entry(&recipient, &token_id, 10, 200, 200)];

    let err = client
        .batch_create_vesting_streams(&sponsor, &recipients)
        .unwrap_err();

    assert_eq!(err, VestingError::InvalidDuration.into());
}

#[test]
fn test_batch_create_enforces_max_batch_size() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000_000);

    // Build 51 entries — one over the limit.
    let mut recipients: Vec<(Address, Address, i128, u32, u32)> = Vec::new(&env);
    for _ in 0..51 {
        let r = Address::generate(&env);
        recipients.push_back(entry(&r, &token_id, 10, 50, 200));
    }

    let err = client
        .batch_create_vesting_streams(&sponsor, &recipients)
        .unwrap_err();

    assert_eq!(err, VestingError::BatchSizeExceeded.into());
}

#[test]
fn test_batch_create_exactly_max_batch_size_succeeds() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);

    // 50 × (rate=1, total=1) = 50 total deposit.
    mint_to(&env, &token_id, &sponsor, 50);

    let mut recipients: Vec<(Address, Address, i128, u32, u32)> = Vec::new(&env);
    let mut addrs: soroban_sdk::Vec<Address> = soroban_sdk::Vec::new(&env);
    for _ in 0..50 {
        let r = Address::generate(&env);
        addrs.push_back(r.clone());
        recipients.push_back(entry(&r, &token_id, 1, 0, 1));
    }

    client
        .batch_create_vesting_streams(&sponsor, &recipients)
        .unwrap();

    // All 50 schedules exist.
    for r in addrs.iter() {
        assert!(client.get_schedule(&r).is_some());
    }
    assert_eq!(token_client.balance(&contract_id), 50);
}
