#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{advance_ledger, setup_env, token_helper::{create_token, mint_to}},
};

// ── Issue #318: Schedule versioning ──────────────────────────────────────────

/// A freshly created schedule starts at version 1.
#[test]
fn test_version_starts_at_one() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200);

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.version, 1, "version must start at 1 on creation");
}

/// Claiming increments the version counter.
#[test]
fn test_version_increments_on_claim() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200);

    // Advance past cliff.
    advance_ledger(&env, 60);
    client.claim_vested(&recipient);

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.version, 2, "version must be 2 after one claim");
}

/// Multiple claims each increment version.
#[test]
fn test_version_increments_on_each_claim() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200);

    advance_ledger(&env, 60); // past cliff
    client.claim_vested(&recipient); // version → 2

    advance_ledger(&env, 20);
    client.claim_vested(&recipient); // version → 3

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.version, 3, "version must be 3 after two claims");
}

/// Cancelling a stream also increments the version (visible in the schedule
/// that is removed; confirmed via the function not returning VersionOverflow).
#[test]
fn test_version_overflow_returns_error() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200);

    // Manually set version to u32::MAX to trigger overflow on next operation.
    let mut schedule = client.get_schedule(&recipient).unwrap();
    schedule.version = u32::MAX;
    // Write the schedule back via storage inside contract context.
    env.as_contract(&contract_id, || {
        crate::storage::set_schedule(&env, &recipient, &schedule);
    });

    // Attempting to claim should now return VersionOverflow.
    advance_ledger(&env, 60); // past cliff
    let err = client.try_claim_vested(&recipient).unwrap_err().unwrap();
    assert_eq!(
        err,
        VestingError::VersionOverflow,
        "must return VersionOverflow when version is u32::MAX"
    );
}
