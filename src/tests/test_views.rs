#![cfg(test)]

use crate::{
    tests::{
        advance_ledger, setup_env,
        factory::{at_cliff_stream, fully_claimed_stream, post_cliff_stream, pre_cliff_stream},
    },
};

/// `claimable_amount` returns 0 before the cliff.
#[test]
fn test_claimable_amount_before_cliff_is_zero() {
    let env = setup_env();
    let (stream, addrs) = pre_cliff_stream(&env);

    assert_eq!(stream.client.claimable_amount(&addrs.recipient), 0);
}

/// `claimable_amount` reflects accrual correctly after the cliff.
#[test]
fn test_claimable_amount_after_cliff() {
    let env = setup_env();
    // post_cliff_stream(25) → ledger 175 (75 ledgers past start × 10 = 750).
    let (stream, addrs) = post_cliff_stream(&env, 25);

    assert_eq!(stream.client.claimable_amount(&addrs.recipient), 750);
}

/// `is_cliff_passed` transitions from false to true as the ledger advances.
#[test]
fn test_is_cliff_passed() {
    let env = setup_env();
    // pre_cliff_stream lands at ledger 120 – cliff not passed.
    let (stream, addrs) = pre_cliff_stream(&env);
    assert!(!stream.client.is_cliff_passed(&addrs.recipient));

    // Advance to exactly the cliff (30 more ledgers to reach 150).
    advance_ledger(&env, 30);
    assert!(stream.client.is_cliff_passed(&addrs.recipient));
}

/// `get_schedule` returns `None` once the stream has been fully claimed.
#[test]
fn test_get_schedule_returns_none_after_completion() {
    let env = setup_env();
    let (stream, addrs) = fully_claimed_stream(&env);

    assert!(stream.client.get_schedule(&addrs.recipient).is_none());
}

/// `claimable_amount` returns the full deposit when the stream has expired.
#[test]
fn test_claimable_amount_at_cliff_equals_accrued_since_start() {
    let env = setup_env();
    let (stream, addrs) = at_cliff_stream(&env);

    // 50 ledgers × 10 = 500
    assert_eq!(stream.client.claimable_amount(&addrs.recipient), 500);
}
