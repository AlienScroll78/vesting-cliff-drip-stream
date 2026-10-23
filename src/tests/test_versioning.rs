#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{advance_ledger, setup_env, token_helper::{create_token, mint_to}},
};

// ── Issue #318: Schedule versioning ──────────────────────────────────────────

/// Helper: register and initialize a fresh contract.
fn make_client(env: &Env) -> (soroban_sdk::Address, VestingDripsClient) {
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    client.initialize(&admin, &0u32, &treasury);
    (contract_id, client)
}

/// A freshly created schedule starts at version 1.
#[test]
fn test_version_starts_at_one() {
    let env = setup_env();
    let (_, client) = make_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None);

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.version, 1, "version must start at 1 on creation");
}

/// Claiming increments the version counter.
#[test]
fn test_version_increments_on_claim() {
    let env = setup_env();
    let (_, client) = make_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None);

    // Advance past cliff.
    advance_ledger(&env, 60);
    client.claim_vested(&recipient, &None);

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.version, 2, "version must be 2 after one claim");
}

/// Multiple claims each increment version.
#[test]
fn test_version_increments_on_each_claim() {
    let env = setup_env();
    let (_, client) = make_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None);

    advance_ledger(&env, 60); // past cliff
    client.claim_vested(&recipient, &None); // version → 2

    advance_ledger(&env, 20);
    client.claim_vested(&recipient, &None); // version → 3

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.version, 3, "version must be 3 after two claims");
}

/// Version overflows to u32::MAX returns VersionOverflow error.
#[test]
fn test_version_overflow_returns_error() {
    let env = setup_env();
    let (contract_id, client) = make_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None);

    // Manually set version to u32::MAX to trigger overflow on next operation.
    let mut schedule = client.get_schedule(&recipient).unwrap();
    schedule.version = u32::MAX;
    // Write the schedule back via storage inside contract context.
    env.as_contract(&contract_id, || {
        crate::storage::set_schedule(&env, &recipient, &schedule);
    });

    // Attempting to claim should now return VersionOverflow.
    advance_ledger(&env, 60); // past cliff
    let err = client.try_claim_vested(&recipient, &None).unwrap_err().unwrap();
    assert_eq!(
        err,
        VestingError::VersionOverflow,
        "must return VersionOverflow when version is u32::MAX"
    );
}

/// Pausing a stream increments the version counter.
#[test]
fn test_version_increments_on_pause() {
    let env = setup_env();
    let (_, client) = make_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client.create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None);

    let before = client.get_schedule(&recipient).unwrap().version;
    client.pause_stream(&sponsor, &recipient);
    let after = client.get_schedule(&recipient).unwrap().version;

    assert_eq!(after, before + 1, "version must increment by 1 after pause");
}

/// Resuming a paused stream increments the version counter.
#[test]
fn test_version_increments_on_resume() {
    let env = setup_env();
    let (_, client) = make_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client.create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None);

    client.pause_stream(&sponsor, &recipient); // version → 2
    advance_ledger(&env, 10);
    client.resume_stream(&sponsor, &recipient); // version → 3

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.version, 3, "version must be 3 after pause+resume");
}

/// get_stream_version returns the same value as schedule.version.
#[test]
fn test_get_stream_version_view() {
    let env = setup_env();
    let (_, client) = make_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client.create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None);

    assert_eq!(client.get_stream_version(&recipient), 1, "initial version is 1");

    advance_ledger(&env, 60);
    client.claim_vested(&recipient, &None);

    assert_eq!(client.get_stream_version(&recipient), 2, "version is 2 after first claim");
}

/// get_stream_version returns 0 for a non-existent schedule.
#[test]
fn test_get_stream_version_not_found_returns_zero() {
    let env = setup_env();
    let (_, client) = make_client(&env);

    let nobody = Address::generate(&env);
    assert_eq!(
        client.get_stream_version(&nobody),
        0,
        "get_stream_version must return 0 when no schedule exists"
    );
}

/// Pause then overflow — version at u32::MAX before pause returns VersionOverflow.
#[test]
fn test_version_overflow_on_pause() {
    let env = setup_env();
    let (contract_id, client) = make_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client.create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None);

    // Manually set version to u32::MAX.
    let mut schedule = client.get_schedule(&recipient).unwrap();
    schedule.version = u32::MAX;
    env.as_contract(&contract_id, || {
        crate::storage::set_schedule(&env, &recipient, &schedule);
    });

    let err = client.try_pause_stream(&sponsor, &recipient).unwrap_err().unwrap();
    assert_eq!(
        err,
        VestingError::VersionOverflow,
        "must return VersionOverflow when version is u32::MAX"
    );
}
