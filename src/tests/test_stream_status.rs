//! Tests for the typed `stream_status()` view function (issue #311).

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    tests::{advance_ledger, setup_env, token_helper::{create_token, mint_to}},
    types::StreamStatus,
};

/// Helper: create a stream with cliff=50, total=200 ledgers from ledger 100.
fn create_stream(
    client: &VestingDripsClient,
    sponsor: &Address,
    recipient: &Address,
    token_id: &Address,
) {
    client.create_vesting_stream(sponsor, recipient, token_id, &10, &50, &200);
}

// ── NotFound ──────────────────────────────────────────────────────────────────

#[test]
fn test_stream_status_not_found_when_no_schedule() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let recipient = Address::generate(&env);
    assert_eq!(client.stream_status(&recipient), StreamStatus::NotFound);
}

// ── PreCliff ──────────────────────────────────────────────────────────────────

#[test]
fn test_stream_status_pre_cliff_immediately_after_creation() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 5_000);

    create_stream(&client, &sponsor, &recipient, &token_id);

    assert_eq!(client.stream_status(&recipient), StreamStatus::PreCliff);
}

#[test]
fn test_stream_status_pre_cliff_one_ledger_before_cliff() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 5_000);

    create_stream(&client, &sponsor, &recipient, &token_id);

    advance_ledger(&env, 49); // seq = 149, cliff_ledger = 150
    assert_eq!(client.stream_status(&recipient), StreamStatus::PreCliff);
}

// ── Active ────────────────────────────────────────────────────────────────────

#[test]
fn test_stream_status_active_exactly_at_cliff() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 5_000);

    create_stream(&client, &sponsor, &recipient, &token_id);

    advance_ledger(&env, 50); // seq = 150 == cliff_ledger
    assert_eq!(client.stream_status(&recipient), StreamStatus::Active);
}

#[test]
fn test_stream_status_active_mid_stream() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 5_000);

    create_stream(&client, &sponsor, &recipient, &token_id);

    advance_ledger(&env, 100); // seq = 200, cliff=150, end=300
    assert_eq!(client.stream_status(&recipient), StreamStatus::Active);
}

#[test]
fn test_stream_status_active_one_ledger_before_end() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 5_000);

    create_stream(&client, &sponsor, &recipient, &token_id);

    advance_ledger(&env, 199); // seq = 299, end_ledger = 300
    assert_eq!(client.stream_status(&recipient), StreamStatus::Active);
}

// ── Expired ───────────────────────────────────────────────────────────────────

#[test]
fn test_stream_status_expired_exactly_at_end_ledger() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 5_000);

    create_stream(&client, &sponsor, &recipient, &token_id);

    advance_ledger(&env, 200); // seq = 300 == end_ledger
    assert_eq!(client.stream_status(&recipient), StreamStatus::Expired);
}

#[test]
fn test_stream_status_expired_well_past_end() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 5_000);

    create_stream(&client, &sponsor, &recipient, &token_id);

    advance_ledger(&env, 500); // well past end_ledger=300, within TTL
    assert_eq!(client.stream_status(&recipient), StreamStatus::Expired);
}

// ── NotFound after removal ────────────────────────────────────────────────────

#[test]
fn test_stream_status_not_found_after_full_claim() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 5_000);

    create_stream(&client, &sponsor, &recipient, &token_id);

    advance_ledger(&env, 300);
    client.claim_vested(&recipient);

    assert_eq!(client.stream_status(&recipient), StreamStatus::NotFound);
}

#[test]
fn test_stream_status_not_found_after_cancel() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 5_000);

    create_stream(&client, &sponsor, &recipient, &token_id);
    client.cancel_stream(&sponsor, &recipient);

    assert_eq!(client.stream_status(&recipient), StreamStatus::NotFound);
}
