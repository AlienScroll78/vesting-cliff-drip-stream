//! Tests for the sponsor == recipient guard (feature: prevent-self-stream).
//!
//! A sponsor creating a stream to themselves is almost certainly a mistake:
//!   - The sponsor's balance is drained but they are also the recipient.
//!   - `cancel_stream` would pay both the earned and refund portions to the
//!     same address, which is confusing and hard to reason about.
//!
//! `create_vesting_stream` now rejects this case with `InvalidRecipient`
//! (error code 10).
//!
//! # Note on the Soroban test client
//! In testutils mode, the generated `VestingDripsClient` exposes two variants:
//!   - `method(...)` → panics on contract error, returns the success type.
//!   - `try_method(...)` → `Result<Result<T, ConversionError>, Result<E, InvokeError>>`
//!
//! For `Result<(), VestingError>`, a contract error surfaces as
//! `Err(Ok(VestingError))`. Error-path tests use `try_*` to avoid panicking.

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::setup_env,
};

use super::token_helper::{create_token, mint_to};

/// `create_vesting_stream` must reject calls where `sponsor == recipient`.
#[test]
fn test_create_stream_sponsor_equals_recipient_fails() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let alice = Address::generate(&env);
    let (token_id, _) = create_token(&env, &alice);

    // Error path — use try_ variant so the test process does not panic.
    let result = client.try_create_vesting_stream(&alice, &alice, &token_id, &10, &50, &200);
    // Outer Err(Ok(e)) carries the VestingError returned by the contract.
    let err = result.unwrap_err().unwrap();

    assert_eq!(
        err,
        VestingError::InvalidRecipient,
        "sponsor == recipient must return InvalidRecipient (code 10)"
    );
}

/// The `InvalidRecipient` error code is pinned to 10.
#[test]
fn test_invalid_recipient_error_code_is_10() {
    assert_eq!(VestingError::InvalidRecipient as u32, 10);
}

/// Normal flow (sponsor ≠ recipient) must be unaffected by the new check.
#[test]
fn test_create_stream_distinct_sponsor_and_recipient_succeeds() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    // Must succeed — plain method panics on error.
    client.create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200);

    assert!(
        client.get_schedule(&recipient).is_some(),
        "schedule must exist after successful creation"
    );
}
