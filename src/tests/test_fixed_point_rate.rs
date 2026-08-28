//! Tests for fixed-point rate precision (closes #5).
//!
//! `RATE_DECIMALS = 10_000_000` allows sub-token precision:
//! - A rate of `5_000_000` (= 0.5 × RATE_DECIMALS) accrues 0.5 tokens/ledger.
//! - The claimable amount is `ledgers * rate / RATE_DECIMALS`.

#![cfg(test)]

use soroban_sdk::testutils::Address as _;

use crate::{
    contract::{calculate_total_deposit, VestingDrips, VestingDripsClient},
    tests::{advance_ledger, generate_addresses, register_contract, setup_env, setup_token},
    types::RATE_DECIMALS,
};

/// Integer rate (1 token/ledger): deposit = total_duration tokens.
#[test]
fn test_integer_rate_one_token_per_ledger() {
    // rate = 1 * RATE_DECIMALS, duration = 100 → deposit = 100
    let result = calculate_total_deposit(RATE_DECIMALS, 100).unwrap();
    assert_eq!(result, 100);
}

/// Fractional rate (0.5 tokens/ledger): deposit = total_duration / 2 tokens.
#[test]
fn test_fractional_rate_half_token_per_ledger() {
    // rate = 0.5 * RATE_DECIMALS = 5_000_000, duration = 200 → deposit = 100
    let result = calculate_total_deposit(RATE_DECIMALS / 2, 200).unwrap();
    assert_eq!(result, 100);
}

/// Rate of 0.1 tokens/ledger over 1000 ledgers → 100 tokens.
#[test]
fn test_fractional_rate_tenth_token_per_ledger() {
    let rate = RATE_DECIMALS / 10; // 1_000_000
    let result = calculate_total_deposit(rate, 1000).unwrap();
    assert_eq!(result, 100);
}

/// Stored rate is RATE_DECIMALS-scaled; contract correctly computes claimable.
#[test]
fn test_claim_with_scaled_rate() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    // 10 tokens/ledger, cliff=50, duration=200 → deposit=2000
    let rate = 10 * RATE_DECIMALS;
    let (token_id, _) = setup_token(&env, &sponsor, 2_000);
    client.create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &50, &200);

    // At cliff (50 ledgers): 50 * 10 = 500
    advance_ledger(&env, 50);
    let claimed = client.claim_vested(&recipient);
    assert_eq!(claimed, 500);
}

/// Sub-token rate: 0.5 tokens/ledger, 100 ledgers past cliff → 50 tokens.
#[test]
fn test_sub_token_rate_claim() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    // 0.5 tokens/ledger, cliff=0, total=200 → deposit=100
    // cliff_duration must be < 80% of total = 160. Use cliff=10.
    let rate = RATE_DECIMALS / 2; // 5_000_000
    let deposit = 200 * rate / RATE_DECIMALS; // 100
    let (token_id, _) = setup_token(&env, &sponsor, deposit);
    client.create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &10, &200);

    // At cliff (10 ledgers): 10 * 0.5 = 5 tokens
    advance_ledger(&env, 10);
    let claimed = client.claim_vested(&recipient);
    assert_eq!(claimed, 5);
}

/// RATE_DECIMALS constant equals 10_000_000.
#[test]
fn test_rate_decimals_value() {
    assert_eq!(RATE_DECIMALS, 10_000_000);
}

/// The schedule stores the raw scaled rate, not the token-per-ledger value.
#[test]
fn test_schedule_stores_scaled_rate() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    let rate = 7 * RATE_DECIMALS; // 7 tokens/ledger
    let (token_id, _) = setup_token(&env, &sponsor, 700);
    client.create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &10, &100);

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.rate_per_ledger, 7 * RATE_DECIMALS);
}
