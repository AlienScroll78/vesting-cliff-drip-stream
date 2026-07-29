#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{advance_ledger, setup_env},
};

use super::super::tests::token_helper::{create_token, mint_to};

#[test]
fn test_cancel_before_cliff_full_refund() {
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

    // Cancel before cliff at ledger 120
    advance_ledger(&env, 20);
    client.cancel_stream(&sponsor, &recipient).unwrap();

    // Full 2000 should be returned to sponsor.
    assert_eq!(token_client.balance(&sponsor), 2_000);
    assert_eq!(token_client.balance(&recipient), 0);
    assert!(client.get_schedule(&recipient).is_none());
}

#[test]
fn test_cancel_after_cliff_splits_tokens() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    // rate=10, cliff=50, total=200 → deposit=2000
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Cancel at ledger 200 (100 ledgers past start, cliff passed at 150)
    advance_ledger(&env, 100);
    client.cancel_stream(&sponsor, &recipient).unwrap();

    // Recipient earned: 100 ledgers × 10 = 1000
    assert_eq!(token_client.balance(&recipient), 1_000);
    // Sponsor refunded: 100 remaining ledgers × 10 = 1000
    assert_eq!(token_client.balance(&sponsor), 1_000);
    assert!(client.get_schedule(&recipient).is_none());
}

#[test]
fn test_cancel_nonexistent_stream_fails() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);

    let err = client.cancel_stream(&sponsor, &recipient).unwrap_err();
    assert_eq!(err, VestingError::ScheduleNotFound.into());
}

// ── Issue #99: cancel_stream at exact cliff_ledger boundary ──────────────────

/// Cancel at cliff_ledger - 1: cliff has NOT been reached.
/// Expected: full deposit refunded to sponsor, recipient receives nothing.
#[test]
fn test_cancel_one_ledger_before_cliff_full_refund() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    // rate=10, cliff=50, total=200 → deposit=2000; cliff_ledger=150
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Advance to ledger 149 (cliff_ledger - 1).
    advance_ledger(&env, 49);
    client.cancel_stream(&sponsor, &recipient).unwrap();

    // Full refund to sponsor; recipient gets nothing.
    assert_eq!(token_client.balance(&sponsor), 2_000);
    assert_eq!(token_client.balance(&recipient), 0);
    assert!(client.get_schedule(&recipient).is_none());
}

/// Cancel at cliff_ledger exactly: cliff IS reached (current >= cliff_ledger).
/// Expected: recipient earns tokens for all cliff_duration ledgers;
/// sponsor receives the remainder.
#[test]
fn test_cancel_exactly_at_cliff_splits_tokens() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    // rate=10, cliff=50, total=200 → deposit=2000; cliff_ledger=150
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Advance exactly to cliff_ledger (50 ledgers → ledger 150).
    advance_ledger(&env, 50);
    client.cancel_stream(&sponsor, &recipient).unwrap();

    // Recipient earns 50 ledgers × 10 = 500.
    assert_eq!(token_client.balance(&recipient), 500);
    // Sponsor refunded remaining 150 ledgers × 10 = 1500.
    assert_eq!(token_client.balance(&sponsor), 1_500);
    assert!(client.get_schedule(&recipient).is_none());
}

/// Cancel at cliff_ledger + 1: one ledger past the cliff.
/// Expected: recipient earns cliff_duration + 1 ledgers; sponsor gets the rest.
#[test]
fn test_cancel_one_ledger_after_cliff_splits_tokens() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    // rate=10, cliff=50, total=200 → deposit=2000; cliff_ledger=150
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Advance to cliff_ledger + 1 (51 ledgers → ledger 151).
    advance_ledger(&env, 51);
    client.cancel_stream(&sponsor, &recipient).unwrap();

    // Recipient earns 51 ledgers × 10 = 510.
    assert_eq!(token_client.balance(&recipient), 510);
    // Sponsor refunded 149 ledgers × 10 = 1490.
    assert_eq!(token_client.balance(&sponsor), 1_490);
    assert!(client.get_schedule(&recipient).is_none());
}
