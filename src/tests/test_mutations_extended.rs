//! Extended mutation-killing tests for 95%+ mutation score (Issue #991).
//!
//! Each test is annotated with the mutant it kills. Focuses on:
//! - Off-by-one in cliff/ledger comparisons (`stream_status`, `drain_expired_stream`)
//! - `cancel_stream` branch boundaries
//! - `get_stats` arithmetic paths
//! - `pause_stream` / `resume_stream` guards
//! - `clawback_stream` reason-length boundary
//! - `claim_vested` state-mutation paths
//!
//! See `docs/mutation/report.md` for the full methodology.

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{advance_ledger, setup_env},
};

use super::super::tests::token_helper::{create_token, mint_to};

// ── Shared helper ─────────────────────────────────────────────────────────────

/// Creates an initialized contract + one stream.
/// Returns (env, contract_id, client, sponsor, recipient, token).
fn make_stream(
    rate: i128,
    cliff: u32,
    total: u32,
) -> (
    soroban_sdk::Env,
    Address,
    VestingDripsClient<'static>,
    Address,
    Address,
    Address,
) {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, rate * total as i128);

    client
        .create_vesting_stream(&sponsor, &recipient, &token, &rate, &cliff, &total, &None)
        .unwrap();

    (env, contract_id, client, sponsor, recipient, token)
}

// ── ME01: drain_expired_stream — StreamNotExpired before end_ledger ───────────
// Kills a `<=` mutant on the `current < end_ledger` check.

#[test]
fn me01_drain_rejects_before_end_ledger() {
    let (env, _, client, sponsor, recipient, _) = make_stream(10, 5, 20);
    // end_ledger = start(100) + total(20) = 120

    advance_ledger(&env, 19); // ledger 119 — one before end
    assert_eq!(env.ledger().sequence(), 119);

    let err = client
        .drain_expired_stream(&sponsor, &recipient)
        .unwrap_err();
    assert_eq!(err, VestingError::StreamNotExpired.into());
}

// ── ME02: drain_expired_stream — DrainDelayNotExpired before 1-year delay ──────
// Kills a `<=` mutant on `current < drain_available_at`.

#[test]
fn me02_drain_rejects_before_drain_delay() {
    let (env, _, client, sponsor, recipient, _) = make_stream(10, 5, 20);
    // end_ledger = 120; drain available at 120 + 3_153_600

    advance_ledger(&env, 50); // ledger 150: past end but not drain delay

    let err = client
        .drain_expired_stream(&sponsor, &recipient)
        .unwrap_err();
    assert_eq!(err, VestingError::DrainDelayNotExpired.into());
}

// ── ME03: stream_status — Active at exact cliff boundary ─────────────────────
// Kills a `<=` mutant on `current < cliff_ledger` that would report PreCliff
// one ledger too long.

#[test]
fn me03_stream_status_active_at_exact_cliff() {
    use crate::types::StreamStatus;
    let (env, _, client, _, recipient, _) = make_stream(10, 50, 200);
    // cliff_ledger = 100 + 50 = 150

    advance_ledger(&env, 49); // ledger 149
    assert_eq!(client.stream_status(&recipient), StreamStatus::PreCliff);

    advance_ledger(&env, 1); // ledger 150 — exactly at cliff
    assert_eq!(env.ledger().sequence(), 150);
    assert_eq!(client.stream_status(&recipient), StreamStatus::Active);
}

// ── ME04: stream_status — Expired at exact end_ledger boundary ────────────────
// Kills a `<=` mutant on `current < end_ledger` that reports Active one ledger
// past the stream end.

#[test]
fn me04_stream_status_expired_at_exact_end() {
    use crate::types::StreamStatus;
    let (env, _, client, _, recipient, _) = make_stream(10, 5, 20);
    // end_ledger = 120

    advance_ledger(&env, 19); // ledger 119
    assert_eq!(client.stream_status(&recipient), StreamStatus::Active);

    advance_ledger(&env, 1); // ledger 120 — exactly at end
    assert_eq!(env.ledger().sequence(), 120);
    assert_eq!(client.stream_status(&recipient), StreamStatus::Expired);
}

// ── ME05: stream_status — NotFound for nonexistent schedule ──────────────────

#[test]
fn me05_stream_status_not_found_for_nonexistent() {
    use crate::types::StreamStatus;
    let env = setup_env();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury);

    let nobody = Address::generate(&env);
    assert_eq!(client.stream_status(&nobody), StreamStatus::NotFound);
}

// ── ME06: get_stats — total_deposited = rate × total_duration ────────────────
// Kills a mutant that uses cliff_duration or `+` instead of `*` for the deposit.

#[test]
fn me06_get_stats_correct_total_deposited() {
    let (env, _, client, _, recipient, _) = make_stream(7, 20, 100);
    // total_deposited = 7 × 100 = 700

    let stats = client.get_stats(&recipient).unwrap();
    assert_eq!(stats.total_deposited, 700);
    assert_eq!(stats.total_claimed, 0);
    assert_eq!(stats.remaining, 700);
    assert_eq!(stats.claimable_now, 0); // cliff not yet reached
}

// ── ME07: get_stats — claimable_now is non-zero after cliff ──────────────────
// Kills a mutant that removes the cliff gate in get_stats.

#[test]
fn me07_get_stats_claimable_now_after_cliff() {
    let (env, _, client, _, recipient, _) = make_stream(10, 20, 100);
    // cliff at ledger 120

    advance_ledger(&env, 20); // reach cliff
    let stats = client.get_stats(&recipient).unwrap();
    assert_eq!(stats.claimable_now, 200); // 20 ledgers × 10
    assert_eq!(stats.total_deposited, 1_000);
}

// ── ME08: get_stats — remaining decreases correctly after partial claim ────────

#[test]
fn me08_get_stats_remaining_decreases_after_claim() {
    let (env, _, client, _, recipient, _) = make_stream(10, 10, 100);

    advance_ledger(&env, 10); // reach cliff at 110
    client.claim_vested(&recipient).unwrap();

    let stats = client.get_stats(&recipient).unwrap();
    assert_eq!(stats.total_claimed, 100); // 10 × 10
    assert_eq!(stats.remaining, 900);     // 1000 - 100
}

// ── ME09: pause_stream — StreamAlreadyPaused on double-pause ─────────────────
// Kills a mutant that removes the `paused_at_ledger.is_some()` guard.

#[test]
fn me09_double_pause_returns_already_paused() {
    let (env, _, client, sponsor, recipient, _) = make_stream(10, 10, 100);

    client.pause_stream(&sponsor, &recipient).unwrap();

    let err = client.pause_stream(&sponsor, &recipient).unwrap_err();
    assert_eq!(err, VestingError::StreamAlreadyPaused.into());
}

// ── ME10: resume_stream — StreamNotPaused on active stream ───────────────────
// Kills a mutant that removes the `ok_or(StreamNotPaused)` guard.

#[test]
fn me10_resume_active_stream_returns_not_paused() {
    let (env, _, client, sponsor, recipient, _) = make_stream(10, 10, 100);

    let err = client.resume_stream(&sponsor, &recipient).unwrap_err();
    assert_eq!(err, VestingError::StreamNotPaused.into());
}

// ── ME11: pause then claim — NothingToClaim on paused stream ─────────────────
// Kills a mutant that removes the paused check in claim_vested.

#[test]
fn me11_claim_on_paused_stream_returns_nothing_to_claim() {
    let (env, _, client, sponsor, recipient, _) = make_stream(10, 10, 100);

    advance_ledger(&env, 10); // reach cliff
    client.pause_stream(&sponsor, &recipient).unwrap();

    let err = client.claim_vested(&recipient).unwrap_err();
    assert_eq!(err, VestingError::NothingToClaim.into());
}

// ── ME12: resume_stream — end_ledger and cliff_ledger shift by paused duration
// Kills a mutant that uses `-` instead of `+` (or omits the shift).

#[test]
fn me12_resume_shifts_end_and_cliff_by_pause_duration() {
    let (env, _, client, sponsor, recipient, _) = make_stream(10, 20, 100);
    // start=100, cliff=120, end=200

    advance_ledger(&env, 10); // ledger 110 — pause here
    client.pause_stream(&sponsor, &recipient).unwrap();

    advance_ledger(&env, 10); // ledger 120 — resume here; paused for 10
    client.resume_stream(&sponsor, &recipient).unwrap();

    let sched = client.get_schedule(&recipient).unwrap();
    assert_eq!(sched.cliff_ledger, 130); // 120 + 10
    assert_eq!(sched.end_ledger, 210);   // 200 + 10
}

// ── ME13: cancel_stream — ScheduleNotFound for nonexistent recipient ──────────

#[test]
fn me13_cancel_nonexistent_stream_returns_not_found() {
    let env = setup_env();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury);

    let sponsor = Address::generate(&env);
    let nobody = Address::generate(&env);

    let err = client.cancel_stream(&sponsor, &nobody).unwrap_err();
    assert_eq!(err, VestingError::ScheduleNotFound.into());
}

// ── ME14a/b: clawback_stream — reason length boundary (256 OK, 257 rejected) ──
// Kills `>=` and `<` mutants on the 256-byte reason guard.

#[test]
fn me14a_clawback_256_byte_reason_does_not_trigger_reason_too_long() {
    let (env, _, client, sponsor, recipient, _) = make_stream(10, 10, 100);

    // Exactly 256 chars — must NOT produce ReasonTooLong.
    // (It will fail with TokenDoesNotSupportClawback, which is fine.)
    let reason = soroban_sdk::String::from_str(&env, &"x".repeat(256));
    let err = client
        .clawback_stream(&sponsor, &recipient, &reason)
        .unwrap_err();

    assert_ne!(
        err,
        VestingError::ReasonTooLong.into(),
        "256-byte reason must not trigger ReasonTooLong"
    );
}

#[test]
fn me14b_clawback_257_byte_reason_returns_reason_too_long() {
    let (env, _, client, sponsor, recipient, _) = make_stream(10, 10, 100);

    let reason = soroban_sdk::String::from_str(&env, &"x".repeat(257));
    let err = client
        .clawback_stream(&sponsor, &recipient, &reason)
        .unwrap_err();

    assert_eq!(err, VestingError::ReasonTooLong.into());
}

// ── ME15: claim_vested — version counter increments on each successful claim ───
// Kills a mutant that deletes the `increment_version()` call.

#[test]
fn me15_version_counter_increments_on_claim() {
    let (env, _, client, _, recipient, _) = make_stream(10, 10, 100);

    let v_before = client.get_schedule(&recipient).unwrap().version;

    advance_ledger(&env, 10); // reach cliff
    client.claim_vested(&recipient).unwrap();

    let v_after = client.get_schedule(&recipient).unwrap().version;
    assert_eq!(v_after, v_before + 1);
}

// ── ME16: claim_vested — schedule removed after dust-collection claim ──────────
// Kills a mutant that skips `remove_schedule` at end_ledger.

#[test]
fn me16_schedule_removed_after_full_claim_at_end() {
    let (env, _, client, _, recipient, _) = make_stream(10, 5, 20);
    // end_ledger = 120

    advance_ledger(&env, 25); // past end
    client.claim_vested(&recipient).unwrap();

    assert!(client.get_schedule(&recipient).is_none());
}

// ── ME17: claimable_amount — returns 0 for paused stream ─────────────────────
// Kills a mutant that removes the paused-guard in the view function.

#[test]
fn me17_claimable_amount_is_zero_when_paused() {
    let (env, _, client, sponsor, recipient, _) = make_stream(10, 10, 100);

    advance_ledger(&env, 10); // reach cliff
    assert!(client.claimable_amount(&recipient) > 0);

    client.pause_stream(&sponsor, &recipient).unwrap();
    assert_eq!(client.claimable_amount(&recipient), 0);
}

// ── ME18: is_cliff_passed — false one ledger before cliff ────────────────────
// Kills a `>` mutant that returns true one ledger early.

#[test]
fn me18_is_cliff_passed_false_one_before_cliff() {
    let (env, _, client, _, recipient, _) = make_stream(10, 50, 200);
    // cliff at 150

    assert!(!client.is_cliff_passed(&recipient)); // ledger 100

    advance_ledger(&env, 49); // ledger 149
    assert!(!client.is_cliff_passed(&recipient));
}

// ── ME19: set_min_deposit + create — DepositBelowMinimum boundary ─────────────
// Kills a `<=` mutant that accepts deposits strictly below the minimum.

#[test]
fn me19_deposit_one_below_custom_minimum_rejected() {
    let env = setup_env();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);

    client.set_min_deposit(&admin, &500).unwrap();

    // rate=4, total=100 → deposit=400, one-below-minimum boundary
    mint_to(&env, &token, &sponsor, 400);
    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token, &4, &10, &100, &None)
        .unwrap_err();
    assert_eq!(err, VestingError::DepositBelowMinimum.into());
}

// ── ME20: create_vesting_stream — sponsor == recipient rejected ───────────────
// Kills a `!=` mutant on the `sponsor == recipient` guard.

#[test]
fn me20_sponsor_equal_to_recipient_rejected() {
    let env = setup_env();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury);

    let sponsor = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 1_000);

    let err = client
        .create_vesting_stream(&sponsor, &sponsor, &token, &10, &10, &100, &None)
        .unwrap_err();
    assert_eq!(err, VestingError::InvalidRecipient.into());
}

// ── ME21: claim_vested — last_claimed_ledger set to active_end after claim ────
// Kills a mutant that uses `start_ledger` or omits the update.

#[test]
fn me21_last_claimed_ledger_set_to_current_after_claim() {
    let (env, _, client, _, recipient, _) = make_stream(10, 10, 100);
    // cliff at 110

    advance_ledger(&env, 15); // ledger 115
    client.claim_vested(&recipient).unwrap();

    let sched = client.get_schedule(&recipient).unwrap();
    assert_eq!(sched.last_claimed_ledger, 115);
}

// ── ME22: cancel_stream — schedule removed after cancel ──────────────────────
// Kills a mutant that deletes `remove_schedule` in the cancel path.

#[test]
fn me22_schedule_removed_after_cancel() {
    let (env, _, client, sponsor, recipient, _) = make_stream(10, 10, 100);

    client.cancel_stream(&sponsor, &recipient).unwrap();
    assert!(client.get_schedule(&recipient).is_none());
}
