//! Integration tests that explicitly trigger and verify every `VestingError`
//! code (1–10). Each test is named `test_error_{code}_{snake_name}`.
//!
//! These tests serve as a living contract between the on-chain error codes
//! and the client-side error handling: if a code changes, moves, or is
//! removed, the corresponding test will fail.
//!
//! Run with: `cargo test test_error_` to execute only these tests.

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{advance_ledger, setup_env},
};

use super::super::tests::token_helper::{create_token, mint_to};

// ─────────────────────────────────────────────────────────────────────────────
// Code 1 — ScheduleNotFound
// ─────────────────────────────────────────────────────────────────────────────

/// Calling `claim_vested` for an address that has no active stream returns
/// error code 1 (`ScheduleNotFound`).
#[test]
fn test_error_1_schedule_not_found() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    // No stream has been created for this recipient.
    let unknown = Address::generate(&env);

    let err = client.claim_vested(&unknown).unwrap_err();
    assert_eq!(
        err,
        VestingError::ScheduleNotFound.into(),
        "expected code 1 (ScheduleNotFound)"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Code 2 — CliffNotReached
// ─────────────────────────────────────────────────────────────────────────────

/// Calling `claim_vested` while the current ledger is still below
/// `cliff_ledger` returns error code 2 (`CliffNotReached`).
#[test]
fn test_error_2_cliff_not_reached() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // cliff_duration=50 → cliff_ledger = 150; stream starts at ledger 100.
    mint_to(&env, &token_id, &sponsor, 2_000);
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Advance to ledger 130 — still before the cliff at 150.
    advance_ledger(&env, 30);

    let err = client.claim_vested(&recipient).unwrap_err();
    assert_eq!(
        err,
        VestingError::CliffNotReached.into(),
        "expected code 2 (CliffNotReached)"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Code 3 — InvalidDuration
// ─────────────────────────────────────────────────────────────────────────────

/// Passing `total_duration == cliff_duration` returns code 3
/// (`InvalidDuration`).
#[test]
fn test_error_3_invalid_duration_equal() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // total_duration == cliff_duration — no post-cliff drip window.
    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &200, &200)
        .unwrap_err();

    assert_eq!(
        err,
        VestingError::InvalidDuration.into(),
        "expected code 3 (InvalidDuration) when cliff == total"
    );
}

/// Passing `total_duration < cliff_duration` also returns code 3.
#[test]
fn test_error_3_invalid_duration_cliff_exceeds_total() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // cliff_duration > total_duration — nonsensical stream.
    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &300, &200)
        .unwrap_err();

    assert_eq!(
        err,
        VestingError::InvalidDuration.into(),
        "expected code 3 (InvalidDuration) when cliff > total"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Code 4 — InvalidRate
// ─────────────────────────────────────────────────────────────────────────────

/// A zero rate returns code 4 (`InvalidRate`).
#[test]
fn test_error_4_invalid_rate_zero() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &0, &50, &200)
        .unwrap_err();

    assert_eq!(
        err,
        VestingError::InvalidRate.into(),
        "expected code 4 (InvalidRate) for rate = 0"
    );
}

/// A negative rate returns code 4 (`InvalidRate`).
#[test]
fn test_error_4_invalid_rate_negative() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &-1, &50, &200)
        .unwrap_err();

    assert_eq!(
        err,
        VestingError::InvalidRate.into(),
        "expected code 4 (InvalidRate) for rate = -1"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Code 5 — DepositOverflow
// ─────────────────────────────────────────────────────────────────────────────

/// `rate × total_duration > i128::MAX` returns code 5 (`DepositOverflow`).
#[test]
fn test_error_5_deposit_overflow() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // Exactly one unit above the safe upper bound: i128::MAX / 200 + 1.
    // This forces `rate * 200` to overflow i128.
    let overflow_rate: i128 = i128::MAX / 200 + 1;

    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &overflow_rate, &50, &200)
        .unwrap_err();

    assert_eq!(
        err,
        VestingError::DepositOverflow.into(),
        "expected code 5 (DepositOverflow)"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Code 6 — ScheduleAlreadyExists
// ─────────────────────────────────────────────────────────────────────────────

/// Creating a second stream for the same recipient returns code 6
/// (`ScheduleAlreadyExists`).
#[test]
fn test_error_6_schedule_already_exists() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    // Enough to fund two attempted streams.
    mint_to(&env, &token_id, &sponsor, 10_000);

    // First creation succeeds.
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Second creation for the same recipient must fail.
    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap_err();

    assert_eq!(
        err,
        VestingError::ScheduleAlreadyExists.into(),
        "expected code 6 (ScheduleAlreadyExists)"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Code 7 — NothingToClaim
// ─────────────────────────────────────────────────────────────────────────────

/// Claiming twice at the same ledger returns code 7 (`NothingToClaim`) on the
/// second attempt because no additional ledgers have elapsed.
#[test]
fn test_error_7_nothing_to_claim() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // rate=10, cliff=50, total=200 → cliff_ledger=150, end_ledger=300.
    mint_to(&env, &token_id, &sponsor, 2_000);
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Jump exactly to the cliff (ledger 100 + 50 = 150).
    advance_ledger(&env, 50);

    // First claim succeeds — accrued 50 ledgers × 10 = 500.
    client.claim_vested(&recipient).unwrap();

    // Second claim at the same ledger — nothing has accrued since the first claim.
    let err = client.claim_vested(&recipient).unwrap_err();
    assert_eq!(
        err,
        VestingError::NothingToClaim.into(),
        "expected code 7 (NothingToClaim)"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Code 8 — StreamNotExpired
// ─────────────────────────────────────────────────────────────────────────────

/// Calling `emergency_drain` before `end_ledger` returns code 8
/// (`StreamNotExpired`).
#[test]
fn test_error_8_stream_not_expired() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // rate=10, cliff=50, total=200 → end_ledger = 100 + 200 = 300.
    mint_to(&env, &token_id, &sponsor, 2_000);
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Advance to ledger 250 — the stream is active but not yet expired (end=300).
    advance_ledger(&env, 150);

    let err = client
        .emergency_drain(&sponsor, &recipient)
        .unwrap_err();

    assert_eq!(
        err,
        VestingError::StreamNotExpired.into(),
        "expected code 8 (StreamNotExpired)"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Code 9 — DrainDelayNotExpired
// ─────────────────────────────────────────────────────────────────────────────

/// Calling `emergency_drain` after `end_ledger` but before the ~1-year safety
/// delay elapses returns code 9 (`DrainDelayNotExpired`).
#[test]
fn test_error_9_drain_delay_not_expired() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // rate=10, cliff=50, total=200 → end_ledger=300.
    // drain_available = 300 + 3_153_600 = 3_153_900.
    mint_to(&env, &token_id, &sponsor, 2_000);
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Advance to ledger 301 — stream is expired but drain delay has not elapsed.
    advance_ledger(&env, 201);

    let err = client
        .emergency_drain(&sponsor, &recipient)
        .unwrap_err();

    assert_eq!(
        err,
        VestingError::DrainDelayNotExpired.into(),
        "expected code 9 (DrainDelayNotExpired)"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Code 10 — InvalidRecipient
// ─────────────────────────────────────────────────────────────────────────────

/// Creating a stream where the sponsor and recipient are the same address
/// returns code 10 (`InvalidRecipient`).
#[test]
fn test_error_10_invalid_recipient() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // sponsor == recipient: the vesting beneficiary is the same party as
    // the funder, which defeats the purpose of the lock.
    let err = client
        .create_vesting_stream(
            &sponsor,
            &sponsor, // same address as sponsor
            &token_id,
            &10,
            &50,
            &200,
        )
        .unwrap_err();

    assert_eq!(
        err,
        VestingError::InvalidRecipient.into(),
        "expected code 10 (InvalidRecipient) when sponsor == recipient"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exhaustiveness guard
// ─────────────────────────────────────────────────────────────────────────────

/// Compile-time exhaustiveness check. This `match` covers every `VestingError`
/// variant so that adding a new variant without adding a corresponding test
/// here will produce an `unreachable_patterns` or `non-exhaustive` compiler
/// error.
///
/// It is `#[allow(dead_code)]` because the function is never called — the
/// compile-time coverage guarantee is the sole purpose.
#[allow(dead_code)]
fn _exhaustive_variant_check(e: VestingError) -> u32 {
    match e {
        VestingError::ScheduleNotFound      => 1,  // test_error_1_schedule_not_found
        VestingError::CliffNotReached       => 2,  // test_error_2_cliff_not_reached
        VestingError::InvalidDuration       => 3,  // test_error_3_invalid_duration_*
        VestingError::InvalidRate           => 4,  // test_error_4_invalid_rate_*
        VestingError::DepositOverflow       => 5,  // test_error_5_deposit_overflow
        VestingError::ScheduleAlreadyExists => 6,  // test_error_6_schedule_already_exists
        VestingError::NothingToClaim        => 7,  // test_error_7_nothing_to_claim
        VestingError::StreamNotExpired      => 8,  // test_error_8_stream_not_expired
        VestingError::DrainDelayNotExpired  => 9,  // test_error_9_drain_delay_not_expired
        VestingError::InvalidRecipient      => 10, // test_error_10_invalid_recipient
    }
}
