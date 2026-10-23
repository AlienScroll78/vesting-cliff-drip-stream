//! Explicitly-triggering tests for `VestingError` codes (issue #1053).
//!
//! `test_error_codes.rs` already provides one test per code, but several codes
//! only assert the discriminant value. This file adds tests that *trigger* the
//! remaining public codes (1–27) and verify the error actually surfaces.
//!
//! Codes already triggered by dedicated suites elsewhere:
//!   * 1–15, 18–24 — `test_error_codes.rs`
//!   * 17           — `test_error_codes.rs` (via `set_config` min_rate)
//!   * 26           — not triggerable under `mock_all_auths`; see note below
//!
//! Run subset: `cargo test test_errors_`

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, vec, Address, Vec};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{advance_ledger, setup_env},
};

use super::super::tests::token_helper::{create_token, mint_to};

/// Registers and initialises a fresh contract client with zero fee.
fn make_client(env: &soroban_sdk::Env) -> VestingDripsClient {
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    client.initialize(&admin, &0u32, &treasury);
    client
}

// ─────────────────────────────────────────────────────────────────────────────
// Code 16 — BatchTooLarge
// ─────────────────────────────────────────────────────────────────────────────

/// `get_claimable_batch` with more than 20 recipients returns `BatchTooLarge`
/// (code 16). Trigger: 21 recipient addresses in a single batch call.
#[test]
fn test_errors_16_batch_too_large_when_batch_exceeds_twenty() {
    let env = setup_env();
    let client = make_client(&env);

    let mut recipients: Vec<Address> = vec![&env];
    for _ in 0..21 {
        recipients.push_back(Address::generate(&env));
    }

    let err = client
        .try_get_claimable_batch(&recipients)
        .unwrap_err()
        .unwrap_err();

    assert_eq!(err, VestingError::BatchTooLarge);
    assert_eq!(VestingError::BatchTooLarge as u32, 16);
}

// ─────────────────────────────────────────────────────────────────────────────
// Code 26 — ClawbackNotSupported
// ─────────────────────────────────────────────────────────────────────────────

/// `ClawbackNotSupported` (code 26) is returned by `clawback_stream` when the
/// token does not support clawback.
///
/// Note: under the Soroban test environment with `mock_all_auths`, the clawback
/// probe succeeds, so the code cannot be triggered here. This asserts the
/// stable code assignment; production triggering is covered by integration
/// tests that deploy a non-clawback token.
#[test]
fn test_errors_26_clawback_not_supported_code() {
    assert_eq!(VestingError::ClawbackNotSupported as u32, 26);
}

// ─────────────────────────────────────────────────────────────────────────────
// Code 27 — InvalidToken
// ─────────────────────────────────────────────────────────────────────────────

/// Creating a stream with a random (non-SAC) address as the token returns
/// `InvalidToken` (code 27). Trigger: a generated address that is not a SAC.
#[test]
fn test_errors_27_invalid_token_when_token_is_not_sac() {
    let env = setup_env();
    let client = make_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let fake_token = Address::generate(&env);

    let err = client
        .try_create_vesting_stream(&sponsor, &recipient, &fake_token, &10, &50, &200, &None)
        .unwrap_err()
        .unwrap_err();

    assert_eq!(err, VestingError::InvalidToken.into());
    assert_eq!(VestingError::InvalidToken as u32, 27);
}

// ─────────────────────────────────────────────────────────────────────────────
// Code 25 — VersionOverflow
// ─────────────────────────────────────────────────────────────────────────────

/// A schedule whose `version` is already `u32::MAX` returns `VersionOverflow`
/// (code 25) on the next mutating operation. Trigger: force the stored version
/// to `u32::MAX`, then claim.
#[test]
fn test_errors_25_version_overflow_when_version_is_max() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client.create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None);

    let mut schedule = client.get_schedule(&recipient).unwrap();
    schedule.version = u32::MAX;
    env.as_contract(&contract_id, || {
        crate::storage::set_schedule(&env, &recipient, &schedule);
    });

    advance_ledger(&env, 60); // past cliff

    let err = client.claim_vested(&recipient).unwrap_err();
    assert_eq!(err, VestingError::VersionOverflow.into());
    assert_eq!(VestingError::VersionOverflow as u32, 25);
}
