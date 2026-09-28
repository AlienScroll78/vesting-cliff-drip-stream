#![cfg(test)]

use crate::{
    error::VestingError,
    tests::{
        advance_ledger, setup_env,
        factory::{
            at_cliff_stream, expired_stream, post_cliff_stream, pre_cliff_stream,
        },
    },
};

/// Claiming before the cliff returns `CliffNotReached`.
#[test]
fn test_claim_before_cliff_fails() {
    let env = setup_env();
    let (stream, addrs) = pre_cliff_stream(&env);

    let err = stream.client.claim_vested(&addrs.recipient).unwrap_err();
    assert_eq!(err, VestingError::CliffNotReached.into());
}

/// First claim exactly at the cliff releases all accrued tokens since start.
#[test]
fn test_first_claim_at_cliff_includes_all_accrued() {
    let env = setup_env();
    let (stream, addrs) = at_cliff_stream(&env);

    let claimed = stream.client.claim_vested(&addrs.recipient).unwrap();
    // 50 ledgers × rate 10 = 500
    assert_eq!(claimed, 500);
}

/// Two sequential claims at different ledgers return the correct incremental amounts.
#[test]
fn test_partial_claim_mid_stream() {
    let env = setup_env();
    // Start 100 ledgers past cliff (ledger 200).
    let (stream, addrs) = post_cliff_stream(&env, 50);

    // First claim: 100 ledgers since start × 10 = 1 000.
    let claimed1 = stream.client.claim_vested(&addrs.recipient).unwrap();
    assert_eq!(claimed1, 1_000);

    // Second claim: advance another 50 ledgers.
    advance_ledger(&env, 50);
    let claimed2 = stream.client.claim_vested(&addrs.recipient).unwrap();
    assert_eq!(claimed2, 500);
}

/// Claiming way past the end ledger pays out the entire remaining deposit.
#[test]
fn test_claim_past_end_caps_at_end_ledger() {
    let env = setup_env();
    let (stream, addrs) = expired_stream(&env);

    let claimed = stream.client.claim_vested(&addrs.recipient).unwrap();
    // Full deposit = 2 000
    assert_eq!(claimed, 2_000);

    // Schedule should be removed after the full claim.
    assert!(stream.client.get_schedule(&addrs.recipient).is_none());
}

/// Calling `claim_vested` twice at the same ledger returns `NothingToClaim`.
#[test]
fn test_double_claim_same_ledger_returns_nothing_to_claim() {
    let env = setup_env();
    let (stream, addrs) = post_cliff_stream(&env, 50);

    stream.client.claim_vested(&addrs.recipient).unwrap();

    // Claiming again at the same ledger must fail.
    let err = stream.client.claim_vested(&addrs.recipient).unwrap_err();
    assert_eq!(err, VestingError::NothingToClaim.into());
}

/// Claiming for a non-existent recipient returns `ScheduleNotFound`.
#[test]
fn test_claim_nonexistent_schedule_fails() {
    use soroban_sdk::testutils::Address as _;
    let env = setup_env();
    let (stream, _) = pre_cliff_stream(&env);

    let random = soroban_sdk::Address::generate(&env);
    let err = stream.client.claim_vested(&random).unwrap_err();
    assert_eq!(err, VestingError::ScheduleNotFound.into());
}
