//! Tests for schedule versioning (issue: version field) and self-stream guard
//! (issue: sponsor == recipient returns InvalidRecipient).
//!
//! Feature 1 – Version field & migration
//!   • New streams are created with `version = 1`.
//!   • `migrate_schedule` upgrades a manually-injected `version = 0` entry to
//!     `version = 1`.
//!   • Calling `migrate_schedule` on an already-versioned schedule is a no-op.
//!   • `migrate_schedule` returns `ScheduleNotFound` for unknown recipients.
//!
//! Feature 2 – Sponsor == recipient guard
//!   • `create_vesting_stream` returns `InvalidRecipient` (code 10) when
//!     `sponsor == recipient`.
//!   • Normal flow (sponsor ≠ recipient) is unaffected.
//!
//! # Note on the Soroban test client
//! The generated `VestingDripsClient` in testutils mode exposes two flavours
//! of each method:
//!
//!   - `method(...)` → panics on contract error, returns the inner success type `T`.
//!   - `try_method(...)` → returns `Result<Result<T, ConversionError>, Result<E, InvokeError>>`
//!
//! For `Result<(), VestingError>` contracts:
//!   - Outer `Err(Ok(e))` → `e: VestingError` (contract returned an error).
//!   - Outer `Ok(Ok(()))` → contract succeeded.
//!
//! Error-path tests use `try_*` so the test process does not panic.

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    storage,
    tests::setup_env,
    types::VestingSchedule,
};

use super::token_helper::{create_token, mint_to};

// ─────────────────────────────────────────────────────────────────────────────
// Feature 1 – Version field
// ─────────────────────────────────────────────────────────────────────────────

/// New schedules are created with `version = 1`.
#[test]
fn test_new_schedule_has_version_1() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    // Success path: plain method panics on error, returns ().
    client.create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200);

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.version, 1, "new schedule must have version = 1");
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature 1 – Migration: version 0 → 1
// ─────────────────────────────────────────────────────────────────────────────

/// Helper that writes a legacy (`version = 0`) schedule directly into storage,
/// simulating a pre-versioning on-chain entry.
fn inject_legacy_schedule(
    env: &soroban_sdk::Env,
    recipient: &Address,
    token: &Address,
) {
    let schedule = VestingSchedule {
        version: 0,
        token: token.clone(),
        rate_per_ledger: 10,
        start_ledger: 100,
        cliff_ledger: 150,
        end_ledger: 300,
        last_claimed_ledger: 100,
    };
    storage::set_schedule(env, recipient, &schedule);
}

/// `migrate_schedule` upgrades a `version = 0` entry to `version = 1`.
#[test]
fn test_migrate_schedule_version_0_to_1() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let admin = env.current_contract_address();
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _) = create_token(&env, &token_admin);

    // Inject a legacy schedule (version 0) bypassing the public API.
    inject_legacy_schedule(&env, &recipient, &token_id);

    // Sanity-check: starts at version 0.
    let before = client.get_schedule(&recipient).unwrap();
    assert_eq!(before.version, 0);

    // Run migration (success path — plain method panics on error).
    client.migrate_schedule(&admin, &recipient);

    // Should now be version 1.
    let after = client.get_schedule(&recipient).unwrap();
    assert_eq!(after.version, 1, "migrate_schedule must set version = 1");

    // All other fields must be preserved.
    assert_eq!(after.rate_per_ledger, before.rate_per_ledger);
    assert_eq!(after.start_ledger, before.start_ledger);
    assert_eq!(after.cliff_ledger, before.cliff_ledger);
    assert_eq!(after.end_ledger, before.end_ledger);
    assert_eq!(after.last_claimed_ledger, before.last_claimed_ledger);
}

/// `migrate_schedule` is idempotent: calling it on a `version = 1` schedule
/// must succeed and leave version unchanged.
#[test]
fn test_migrate_schedule_already_versioned_is_noop() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let admin = env.current_contract_address();
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client.create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200);

    // Already version 1.
    assert_eq!(client.get_schedule(&recipient).unwrap().version, 1);

    // Calling migrate a second time must not error (panics on error).
    client.migrate_schedule(&admin, &recipient);

    // Version stays 1.
    assert_eq!(client.get_schedule(&recipient).unwrap().version, 1);
}

/// `migrate_schedule` returns `ScheduleNotFound` for an unknown recipient.
///
/// Uses `try_migrate_schedule` which returns:
///   `Result<Result<(), ConversionError>, Result<VestingError, InvokeError>>`
/// The contract error is the `Err(Ok(VestingError))` arm.
#[test]
fn test_migrate_schedule_not_found_returns_error() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let admin = env.current_contract_address();
    let unknown = Address::generate(&env);

    // Error path: use try_ variant.
    let result = client.try_migrate_schedule(&admin, &unknown);
    // Outer Err(Ok(e)) carries the contract error.
    let err = result.unwrap_err().unwrap();
    assert_eq!(err, VestingError::ScheduleNotFound);
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature 2 – Sponsor == recipient guard
// ─────────────────────────────────────────────────────────────────────────────

/// `create_vesting_stream` must reject a call where `sponsor == recipient`.
///
/// Uses `try_create_vesting_stream` which returns:
///   `Result<Result<(), ConversionError>, Result<VestingError, InvokeError>>`
#[test]
fn test_create_stream_sponsor_equals_recipient_fails() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let alice = Address::generate(&env);
    let (token_id, _) = create_token(&env, &alice);

    // Error path: use try_ variant.
    let result = client.try_create_vesting_stream(&alice, &alice, &token_id, &10, &50, &200);
    let err = result.unwrap_err().unwrap();

    assert_eq!(
        err,
        VestingError::InvalidRecipient,
        "sponsor == recipient must return InvalidRecipient (code 10)"
    );
}

/// The error code for `InvalidRecipient` is exactly 10.
#[test]
fn test_invalid_recipient_error_code_is_10() {
    assert_eq!(VestingError::InvalidRecipient as u32, 10);
}

/// Normal flow (sponsor ≠ recipient) is not affected by the guard.
#[test]
fn test_create_stream_distinct_sponsor_and_recipient_succeeds() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    // Must not error — plain method panics on error.
    client.create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200);

    assert!(client.get_schedule(&recipient).is_some());
}
