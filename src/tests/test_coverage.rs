//! Contract edge-case tests supporting the line and branch coverage gate.

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, String};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{advance_ledger, register_contract, setup_env, setup_token},
    types::RATE_DECIMALS,
};
use super::token_helper::create_token;

/// Covers: DepositOverflow from rate.checked_mul(total_duration) overflow.
/// i128::MAX rate with any duration > 1 overflows the multiplication.
#[test]
fn test_create_deposit_overflow_from_rate_mul() {
    let env = setup_env();
    let (_, client) = register_contract(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    let err = client
        .try_create_vesting_stream(&sponsor, &recipient, &token_id, &i128::MAX, &10, &20, &None)
        .unwrap_err();
    assert_eq!(err, Ok(VestingError::DepositOverflow));
}

/// Covers: DepositOverflow from start_ledger.checked_add(cliff_duration) overflow.
#[test]
fn test_create_deposit_overflow_from_cliff_add() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &0, &treasury);
    client.set_config(
        &admin,
        &String::from_str(&env, "max_cliff_ratio"),
        &10_000i128,
    );

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    let err = client
        .try_create_vesting_stream(
            &sponsor,
            &recipient,
            &token_id,
            &(RATE_DECIMALS as i128),
            &(u32::MAX - 50),
            &u32::MAX,
            &None,
        )
        .unwrap_err();
    assert_eq!(err, Ok(VestingError::DepositOverflow));
}

/// Covers: DepositOverflow from start_ledger.checked_add(total_duration) overflow.
/// cliff=1, total=u32::MAX → cliff check passes but end_ledger addition overflows.
#[test]
fn test_create_deposit_overflow_from_total_add() {
    let env = setup_env();
    let (_, client) = register_contract(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // cliff_duration=1, total_duration=u32::MAX → total > cliff so InvalidDuration
    // won't fire; cliff_ledger = 101 (ok), end_ledger = 100 + u32::MAX overflows
    let err = client
        .try_create_vesting_stream(
            &sponsor,
            &recipient,
            &token_id,
            &(RATE_DECIMALS as i128),
            &1,
            &u32::MAX,
            &None,
        )
        .unwrap_err();
    assert_eq!(err, Ok(VestingError::DepositOverflow));
}

/// Covers: cancel_stream branch where sponsor_refund == 0 (stream already at end).
/// Cancel exactly at end_ledger: recipient earned everything, nothing left to refund.
#[test]
fn test_cancel_at_end_ledger_zero_sponsor_refund() {
    let env = setup_env();
    let (contract_id, client) = register_contract(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = setup_token(&env, &sponsor, 200);
    // rate=10, cliff=10, total=20 → deposit=200; end_ledger=120
    mint_to(&env, &token_id, &sponsor, 200);

    client
        .create_vesting_stream(
            &sponsor,
            &recipient,
            &token_id,
            &(10 * RATE_DECIMALS),
            &10,
            &20,
        );

    // Advance exactly to end_ledger (20 ledgers).
    advance_ledger(&env, 20);
    client.cancel_stream(&sponsor, &recipient);

    // All 200 tokens go to recipient; sponsor gets 0.
    assert_eq!(token_client.balance(&recipient), 200);
    assert_eq!(token_client.balance(&sponsor), 0);
    assert!(client.get_schedule(&recipient).is_none());
}

/// Covers: claimable_amount returns 0 when no schedule exists (None branch).
#[test]
fn test_claimable_amount_no_schedule_returns_zero() {
    let env = setup_env();
    let (_, client) = register_contract(&env);

    let nobody = Address::generate(&env);
    assert_eq!(client.claimable_amount(&nobody), 0);
}

/// Covers: is_cliff_passed returns false when no schedule exists (None branch).
#[test]
fn test_is_cliff_passed_no_schedule_returns_false() {
    let env = setup_env();
    let (_, client) = register_contract(&env);

    let nobody = Address::generate(&env);
    assert!(!client.is_cliff_passed(&nobody));
}
