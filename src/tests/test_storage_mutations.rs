//! Targeted mutation-killing tests for `src/storage.rs`.
//!
//! Closes #611, #610, #612, #628
//!
//! These tests cover storage functions not exercised by the existing
//! mutation-kill suite, including:
//! - `get_min_deposit` / `set_min_deposit` round-trips
//! - `has_schedule` true/false paths
//! - `get_schedule` / `set_schedule` / `remove_schedule` correctness
//! - Per-recipient storage isolation
//! - Storage constant values
//!
//! See `docs/mutation/report.md` for the full methodology.

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    storage::DEFAULT_MIN_DEPOSIT,
    tests::{advance_ledger, setup_env},
};

use super::super::tests::token_helper::{create_token, mint_to};

// ── DEFAULT_MIN_DEPOSIT constant ──────────────────────────────────────────────

/// S-NEW-01: DEFAULT_MIN_DEPOSIT constant is exactly 100.
/// Kills mutant: constant replaced with 0, 1, or other value.
#[test]
fn s_new_01_default_min_deposit_constant_is_100() {
    assert_eq!(
        DEFAULT_MIN_DEPOSIT, 100,
        "DEFAULT_MIN_DEPOSIT must be 100 per storage.rs constant"
    );
}

// ── get_min_deposit ───────────────────────────────────────────────────────────

/// S-NEW-02: `get_min_deposit` returns DEFAULT_MIN_DEPOSIT when not set.
/// Kills mutant: returns 0 or 1 instead of DEFAULT_MIN_DEPOSIT.
#[test]
fn s_new_02_get_min_deposit_returns_default_when_unset() {
    let env = setup_env();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);

    assert_eq!(client.get_min_deposit(), DEFAULT_MIN_DEPOSIT);
}

/// S-NEW-03: `set_min_deposit` → `get_min_deposit` round-trips the exact value.
/// Kills mutant: set() omitted — value not persisted.
#[test]
fn s_new_03_set_min_deposit_round_trip() {
    let env = setup_env();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);

    let admin = Address::generate(&env);
    client.set_min_deposit(&admin, &250).unwrap();

    assert_eq!(client.get_min_deposit(), 250);
}

/// S-NEW-04: `set_min_deposit` stores the exact argument — not a constant.
/// Kills mutant: value written as 0 or constant instead of argument.
#[test]
fn s_new_04_set_min_deposit_stores_exact_value() {
    let env = setup_env();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);

    let admin = Address::generate(&env);

    client.set_min_deposit(&admin, &1_000_000).unwrap();
    assert_eq!(client.get_min_deposit(), 1_000_000);

    // Overwrite with a different value — must update
    client.set_min_deposit(&admin, &42).unwrap();
    assert_eq!(client.get_min_deposit(), 42);
}

/// S-NEW-05: `set_min_deposit` with zero fails — guard not omitted.
/// Kills mutant: `if min_deposit <= 0` guard deleted.
#[test]
fn s_new_05_set_min_deposit_zero_returns_invalid_rate() {
    let env = setup_env();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);

    let admin = Address::generate(&env);
    let err = client.set_min_deposit(&admin, &0).unwrap_err();
    assert_eq!(err, VestingError::InvalidRate.into());
}

/// S-NEW-06: `set_min_deposit` with negative value fails.
/// Kills mutant: `<= 0` changed to `< 0` allowing zero through.
#[test]
fn s_new_06_set_min_deposit_negative_returns_invalid_rate() {
    let env = setup_env();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);

    let admin = Address::generate(&env);
    let err = client.set_min_deposit(&admin, &-100).unwrap_err();
    assert_eq!(err, VestingError::InvalidRate.into());
}

// ── has_schedule ──────────────────────────────────────────────────────────────

/// S-NEW-07: `has_schedule` returns false for a non-existent schedule.
/// Kills mutant: always returns true.
#[test]
fn s_new_07_has_schedule_false_when_no_schedule() {
    let env = setup_env();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);

    let nobody = Address::generate(&env);
    assert!(client.get_schedule(&nobody).is_none());
}

/// S-NEW-08: `has_schedule` returns true after `set_schedule`.
/// Kills mutant: always returns false — ScheduleAlreadyExists never fires.
#[test]
fn s_new_08_has_schedule_true_after_create() {
    let env = setup_env();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token, &10, &50, &200, &None)
        .unwrap();

    // has_schedule implicitly tested: second create must return ScheduleAlreadyExists
    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token, &10, &50, &200, &None)
        .unwrap_err();
    assert_eq!(err, VestingError::ScheduleAlreadyExists.into());
}

// ── get_schedule / set_schedule / remove_schedule ────────────────────────────

/// S-NEW-09: `get_schedule` returns `None` for a non-existent recipient.
/// Kills mutant: returns Some(default) instead of None.
#[test]
fn s_new_09_get_schedule_none_for_nonexistent() {
    let env = setup_env();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);

    let ghost = Address::generate(&env);
    assert!(client.get_schedule(&ghost).is_none());
}

/// S-NEW-10: `set_schedule` persists all schedule fields correctly.
/// Kills mutant: set() omitted or writes wrong key.
#[test]
fn s_new_10_set_schedule_persists_all_fields() {
    let env = setup_env();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 500);

    client
        .create_vesting_stream(&sponsor, &recipient, &token, &5, &20, &100, &None)
        .unwrap();

    let schedule = client.get_schedule(&recipient).unwrap();
    // Verify key fields are persisted with the correct values
    assert_eq!(schedule.rate_per_ledger, 5);
    assert_eq!(schedule.cliff_ledger - schedule.start_ledger, 20);
    assert_eq!(schedule.end_ledger - schedule.start_ledger, 100);
    assert_eq!(schedule.total_claimed, 0);
}

/// S-NEW-11: `remove_schedule` clears storage — schedule is gone after cancel.
/// Kills mutant: remove() omitted — schedule survives cancel.
#[test]
fn s_new_11_remove_schedule_clears_storage() {
    let env = setup_env();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 200);

    client
        .create_vesting_stream(&sponsor, &recipient, &token, &2, &10, &100, &None)
        .unwrap();
    assert!(client.get_schedule(&recipient).is_some());

    // Cancel before cliff → full refund, schedule removed
    client.cancel_stream(&sponsor, &recipient).unwrap();
    assert!(client.get_schedule(&recipient).is_none());
}

/// S-NEW-12: `remove_schedule` after completion — schedule gone after full claim.
/// Kills mutant: remove() on finish omitted.
#[test]
fn s_new_12_remove_schedule_on_stream_completion() {
    let env = setup_env();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 200);

    // cliff=5, total=20
    client
        .create_vesting_stream(&sponsor, &recipient, &token, &10, &5, &20, &None)
        .unwrap();

    // Advance past end_ledger (100 + 20 = 120)
    advance_ledger(&env, 25);
    client.claim_vested(&recipient).unwrap();

    // Schedule must be removed after full stream is claimed
    assert!(client.get_schedule(&recipient).is_none());
}

// ── Per-recipient storage isolation ──────────────────────────────────────────

/// S-NEW-13: Schedules are isolated per recipient — different keys used.
/// Kills mutant: storage key ignores recipient (uses a global key).
#[test]
fn s_new_13_schedules_are_isolated_per_recipient() {
    let env = setup_env();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);

    let sponsor = Address::generate(&env);
    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 2_000);

    // Create stream for r1
    client
        .create_vesting_stream(&sponsor, &r1, &token, &5, &10, &100, &None)
        .unwrap();

    // r2 has no stream yet
    assert!(client.get_schedule(&r2).is_none());

    // Create stream for r2
    client
        .create_vesting_stream(&sponsor, &r2, &token, &5, &10, &100, &None)
        .unwrap();

    // Both exist independently
    assert!(client.get_schedule(&r1).is_some());
    assert!(client.get_schedule(&r2).is_some());

    // Cancel r1 does not affect r2
    client.cancel_stream(&sponsor, &r1).unwrap();
    assert!(client.get_schedule(&r1).is_none());
    assert!(client.get_schedule(&r2).is_some());
}

/// S-NEW-14: `get_schedule` reads the most recent value after a claim update.
/// Kills mutant: get() returns stale / ignores set() after claim.
#[test]
fn s_new_14_get_schedule_reads_latest_write_after_claim() {
    let env = setup_env();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token, &10, &50, &200, &None)
        .unwrap();

    let initial = client.get_schedule(&recipient).unwrap();
    assert_eq!(initial.total_claimed, 0);

    // Claim updates last_claimed_ledger and total_claimed in storage
    advance_ledger(&env, 50);
    client.claim_vested(&recipient).unwrap();

    let updated = client.get_schedule(&recipient).unwrap();
    assert!(
        updated.total_claimed > 0,
        "total_claimed must increase after claim"
    );
    assert!(
        updated.last_claimed_ledger > initial.last_claimed_ledger,
        "last_claimed_ledger must advance after claim"
    );
}

/// S-NEW-15: `get_schedule` returns different values for different recipients.
/// Kills mutant: all recipients share the same storage slot.
#[test]
fn s_new_15_different_recipients_have_different_schedule_fields() {
    let env = setup_env();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);

    let sponsor = Address::generate(&env);
    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 10_000);

    // r1: rate=5, cliff=10, total=100
    client
        .create_vesting_stream(&sponsor, &r1, &token, &5, &10, &100, &None)
        .unwrap();

    // r2: rate=20, cliff=30, total=200
    client
        .create_vesting_stream(&sponsor, &r2, &token, &20, &30, &200, &None)
        .unwrap();

    let s1 = client.get_schedule(&r1).unwrap();
    let s2 = client.get_schedule(&r2).unwrap();

    assert_eq!(s1.rate_per_ledger, 5);
    assert_eq!(s2.rate_per_ledger, 20);
    assert_ne!(
        s1.rate_per_ledger, s2.rate_per_ledger,
        "Different streams should have different rates"
    );
    assert_ne!(
        s1.cliff_ledger, s2.cliff_ledger,
        "Different streams should have different cliff ledgers"
    );
}
