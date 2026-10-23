//! # Schema Migration Tests  (Issue #736)
//!
//! Verifies that the `migrate_schedule` function correctly upgrades
//! `VestingSchedule` records stored at an older schema version.
//!
//! ## Test Strategy
//! Each test:
//! 1. Creates a schedule via the normal `create_vesting_stream` path
//!    (which writes V2 / `CURRENT_SCHEMA_VERSION`).
//! 2. Backdates `schema_version` to simulate an old on-chain record.
//! 3. Writes the backdated record directly to storage inside a contract
//!    context (simulating what was stored before V2).
//! 4. Reads it back via `get_schedule` (which calls `migrate_schedule`).
//! 5. Asserts that the migrated record has the expected field values.

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    storage,
    tests::{advance_ledger, setup_env, token_helper::{create_token, mint_to}},
    types::{CURRENT_SCHEMA_VERSION},
};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn make_client(env: &Env) -> (Address, VestingDripsClient) {
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    client.initialize(&admin, &0u32, &treasury);
    (contract_id, client)
}

fn setup_stream(
    env: &Env,
    client: &VestingDripsClient,
) -> (Address, Address, Address) {
    let sponsor = Address::generate(env);
    let recipient = Address::generate(env);
    let (token_id, _) = create_token(env, &sponsor);
    mint_to(env, &token_id, &sponsor, 5_000);
    client.create_vesting_stream(
        &sponsor,
        &recipient,
        &token_id,
        &10,
        &50,
        &200,
        &None,
    );
    (sponsor, recipient, token_id)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// A freshly created schedule carries `schema_version == CURRENT_SCHEMA_VERSION`.
#[test]
fn test_new_schedule_has_current_schema_version() {
    let env = setup_env();
    let (_, client) = make_client(&env);
    let (_, recipient, _) = setup_stream(&env, &client);

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(
        schedule.schema_version, CURRENT_SCHEMA_VERSION,
        "new schedule must have schema_version == CURRENT_SCHEMA_VERSION"
    );
}

/// A V1 schedule (schema_version == 0, simulating pre-V2 storage) is
/// transparently migrated to V2 on the first `get_schedule` call.
#[test]
fn test_v1_schedule_migrates_to_current_on_read() {
    let env = setup_env();
    let (contract_id, client) = make_client(&env);
    let (_, recipient, _) = setup_stream(&env, &client);

    // Backdating: set schema_version to 0 to simulate a V1 on-chain record.
    env.as_contract(&contract_id, || {
        let mut sched = storage::get_schedule(&env, &recipient).unwrap();
        sched.schema_version = 0; // V1 sentinel
        storage::set_schedule(&env, &recipient, &sched);
    });

    // Reading back must trigger migration transparently.
    let migrated = client.get_schedule(&recipient).unwrap();
    assert_eq!(
        migrated.schema_version, CURRENT_SCHEMA_VERSION,
        "V1 record must be upgraded to CURRENT_SCHEMA_VERSION on read"
    );
}

/// After migration the functional fields (rate, cliff, end, etc.) are unchanged.
#[test]
fn test_migration_preserves_all_existing_fields() {
    let env = setup_env();
    let (contract_id, client) = make_client(&env);
    let (sponsor, recipient, token_id) = setup_stream(&env, &client);

    // Capture the original record before backdating.
    let original = client.get_schedule(&recipient).unwrap();

    // Backdate to V1.
    env.as_contract(&contract_id, || {
        let mut sched = storage::get_schedule(&env, &recipient).unwrap();
        sched.schema_version = 0;
        storage::set_schedule(&env, &recipient, &sched);
    });

    let migrated = client.get_schedule(&recipient).unwrap();

    // All functional fields must be preserved.
    assert_eq!(migrated.token, original.token);
    assert_eq!(migrated.sponsor, original.sponsor);
    assert_eq!(migrated.rate_per_ledger, original.rate_per_ledger);
    assert_eq!(migrated.start_ledger, original.start_ledger);
    assert_eq!(migrated.cliff_ledger, original.cliff_ledger);
    assert_eq!(migrated.end_ledger, original.end_ledger);
    assert_eq!(migrated.last_claimed_ledger, original.last_claimed_ledger);
    assert_eq!(migrated.total_claimed, original.total_claimed);
    assert_eq!(migrated.claimed_amount, original.claimed_amount);
    assert_eq!(migrated.paused_at_ledger, original.paused_at_ledger);
    assert_eq!(
        migrated.accumulated_pause_ledgers,
        original.accumulated_pause_ledgers
    );
    assert_eq!(migrated.version, original.version);
    // schema_version must now equal the current version.
    assert_eq!(migrated.schema_version, CURRENT_SCHEMA_VERSION);
}

/// A schedule already at `CURRENT_SCHEMA_VERSION` is not re-written (no-op path).
#[test]
fn test_current_schema_version_is_noop() {
    let env = setup_env();
    let (contract_id, client) = make_client(&env);
    let (_, recipient, _) = setup_stream(&env, &client);

    // Confirm it starts at current version.
    let before = client.get_schedule(&recipient).unwrap();
    assert_eq!(before.schema_version, CURRENT_SCHEMA_VERSION);

    // A second read should remain at CURRENT_SCHEMA_VERSION without any mutation.
    let after = client.get_schedule(&recipient).unwrap();
    assert_eq!(after.schema_version, CURRENT_SCHEMA_VERSION);
    assert_eq!(after.version, before.version, "version counter must not change on noop migration");
}

/// After migration, claiming still works correctly — the contract
/// doesn't malfunction because of the upgraded record.
#[test]
fn test_claim_works_after_migration() {
    let env = setup_env();
    let (contract_id, client) = make_client(&env);
    let (_, recipient, _) = setup_stream(&env, &client);

    // Backdate to V1 to trigger migration on next read.
    env.as_contract(&contract_id, || {
        let mut sched = storage::get_schedule(&env, &recipient).unwrap();
        sched.schema_version = 0;
        storage::set_schedule(&env, &recipient, &sched);
    });

    // Advance past cliff.
    advance_ledger(&env, 60);

    // Claim should succeed after migration.
    let claimed = client.claim_vested(&recipient);
    assert!(claimed > 0, "should claim non-zero tokens after migration");

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.schema_version, CURRENT_SCHEMA_VERSION);
    assert!(schedule.total_claimed > 0);
}

/// Explicit V1 records (`schema_version == 1`) are also migrated correctly.
#[test]
fn test_explicit_v1_migrates_to_current() {
    let env = setup_env();
    let (contract_id, client) = make_client(&env);
    let (_, recipient, _) = setup_stream(&env, &client);

    // Set schema_version to explicit 1 (legacy V1).
    env.as_contract(&contract_id, || {
        let mut sched = storage::get_schedule(&env, &recipient).unwrap();
        sched.schema_version = 1;
        storage::set_schedule(&env, &recipient, &sched);
    });

    let migrated = client.get_schedule(&recipient).unwrap();
    assert_eq!(
        migrated.schema_version, CURRENT_SCHEMA_VERSION,
        "explicit V1 must be upgraded to CURRENT_SCHEMA_VERSION"
    );
}
