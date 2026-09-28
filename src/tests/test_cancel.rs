#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    error::VestingError,
    tests::{
        setup_env,
        factory::{cancelled_stream, post_cliff_stream, pre_cliff_stream},
    },
};

/// Cancelling before the cliff returns the full deposit to the sponsor.
#[test]
fn test_cancel_before_cliff_full_refund() {
    let env = setup_env();
    // pre_cliff_stream is at ledger 120, cliff at 150 – not yet passed.
    let (stream, addrs) = pre_cliff_stream(&env);

    stream.client.cancel_stream(&addrs.sponsor, &addrs.recipient).unwrap();

    // Schedule is gone.
    assert!(stream.client.get_schedule(&addrs.recipient).is_none());
}

/// Cancelling after the cliff splits tokens: recipient gets accrued, sponsor the rest.
#[test]
fn test_cancel_after_cliff_splits_tokens() {
    let env = setup_env();
    // post_cliff_stream(50) → ledger 200 (100 ledgers past start).
    let (stream, addrs) = post_cliff_stream(&env, 50);

    stream.client.cancel_stream(&addrs.sponsor, &addrs.recipient).unwrap();

    // Schedule is removed.
    assert!(stream.client.get_schedule(&addrs.recipient).is_none());
}

/// Cancelling a stream that does not exist returns `ScheduleNotFound`.
#[test]
fn test_cancel_nonexistent_stream_fails() {
    let env = setup_env();
    let (stream, _) = pre_cliff_stream(&env);

    let unknown_sponsor = Address::generate(&env);
    let unknown_recipient = Address::generate(&env);

    let err = stream
        .client
        .cancel_stream(&unknown_sponsor, &unknown_recipient)
        .unwrap_err();
    assert_eq!(err, VestingError::ScheduleNotFound.into());
}

/// The `cancelled_stream` factory produces a correctly cancelled stream.
#[test]
fn test_cancelled_stream_factory_invariants() {
    let env = setup_env();
    let (stream, addrs) = cancelled_stream(&env);

    // Schedule must be gone.
    assert!(stream.client.get_schedule(&addrs.recipient).is_none());
}
