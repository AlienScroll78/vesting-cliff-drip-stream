//! Tests for cliff ratio guard (closes #4).
//!
//! `MAX_CLIFF_RATIO = 80` means:
//! - `cliff_duration <= total_duration * 80 / 100` → accepted
//! - `cliff_duration > total_duration * 80 / 100` → rejected with `InvalidCliffRatio`

#![cfg(test)]

use crate::{
    error::VestingError,
    tests::{generate_addresses, register_contract, setup_env, setup_token},
    types::{MAX_CLIFF_RATIO, RATE_DECIMALS},
};

/// MAX_CLIFF_RATIO constant is 80.
#[test]
fn test_max_cliff_ratio_value() {
    assert_eq!(MAX_CLIFF_RATIO, 80);
}

/// Cliff at exactly 80% is accepted (boundary inclusive).
///
/// total=100, cliff=80 → 80/100 = 80% = MAX_CLIFF_RATIO → accepted
#[test]
fn test_cliff_at_exactly_80_percent_accepted() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let rate = RATE_DECIMALS; // 1 token/ledger
    let (token_id, _) = setup_token(&env, &sponsor, 100);

    // cliff=80, total=100 → 80% ≤ 80% → OK
    client.create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &80, &100);
    assert!(client.get_schedule(&recipient).is_some());
}

/// Cliff at 79% is accepted.
///
/// total=100, cliff=79 → 79% < 80% → accepted
#[test]
fn test_cliff_at_79_percent_accepted() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let rate = RATE_DECIMALS;
    let (token_id, _) = setup_token(&env, &sponsor, 100);

    // cliff=79, total=100 → 79% < 80% → OK
    client.create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &79, &100);
    assert!(client.get_schedule(&recipient).is_some());
}

/// Cliff at 81% is rejected with InvalidCliffRatio.
///
/// total=100, cliff=81 → 81% > 80% → InvalidCliffRatio
#[test]
fn test_cliff_at_81_percent_rejected() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let rate = RATE_DECIMALS;
    let (token_id, _) = setup_token(&env, &sponsor, 100);

    // cliff=81, total=100 → 81% > 80% → InvalidCliffRatio
    let err = client
        .try_create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &81, &100)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::InvalidCliffRatio);
}

/// Cliff at 99% is rejected.
#[test]
fn test_cliff_at_99_percent_rejected() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let rate = RATE_DECIMALS;
    let (token_id, _) = setup_token(&env, &sponsor, 100);

    let err = client
        .try_create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &99, &100)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::InvalidCliffRatio);
}

/// Cliff exactly equal to total is rejected by InvalidDuration first (before ratio check).
#[test]
fn test_cliff_equal_to_total_rejected_by_invalid_duration() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let rate = RATE_DECIMALS;
    let (token_id, _) = setup_token(&env, &sponsor, 100);

    let err = client
        .try_create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &100, &100)
        .unwrap_err()
        .unwrap();
    // InvalidDuration is checked before InvalidCliffRatio
    assert_eq!(err, VestingError::InvalidDuration);
}

/// Boundary: total=200, cliff=160 → 80% → accepted.
#[test]
fn test_cliff_boundary_200_total() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let rate = RATE_DECIMALS;
    let (token_id, _) = setup_token(&env, &sponsor, 200);

    // 160/200 = 80% → accepted
    client.create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &160, &200);
    assert!(client.get_schedule(&recipient).is_some());
}

/// Boundary: total=200, cliff=161 → 80.5% → rejected.
#[test]
fn test_cliff_just_over_boundary_200_total() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let rate = RATE_DECIMALS;
    let (token_id, _) = setup_token(&env, &sponsor, 200);

    // 161/200 = 80.5% → rejected
    let err = client
        .try_create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &161, &200)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::InvalidCliffRatio);
}

/// InvalidCliffRatio has error code 12.
#[test]
fn test_invalid_cliff_ratio_error_code() {
    assert_eq!(VestingError::InvalidCliffRatio as u32, 12);
}
