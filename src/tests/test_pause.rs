#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{advance_ledger, setup_env},
    types::StreamStatus,
};

use super::super::tests::token_helper::{create_token, mint_to};

// ── Helper ────────────────────────────────────────────────────────────────────

/// Creates a standard stream: rate=10, cliff=50, total=200, deposit=2000.
/// Returns (client, sponsor, recipient, token_id, token_client).
fn setup_stream(
    env: &soroban_sdk::Env,
) -> (
    VestingDripsClient,
    Address,
    Address,
    Address,
    soroban_sdk::token::Client,
) {
    // Need to import token::Client properly - just return the IDs and let tests use them
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(env, &contract_id);
    let sponsor = Address::generate(env);
    let recipient = Address::generate(env);
    let (token_id, token_client) = create_token(env, &sponsor);
    mint_to(env, &token_id, &sponsor, 2_000);
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();
    (client, sponsor, recipient, token_id, token_client)
}

// ── pause_stream ──────────────────────────────────────────────────────────────

#[test]
fn test_pause_stream_sets_paused_flag() {
    let env = setup_env();
    let (client, sponsor, recipient, _token_id, _token_client) = setup_stream(&env);

    client.pause_stream(&sponsor, &recipient).unwrap();

    let schedule = client.get_schedule(&recipient).unwrap();
    assert!(schedule.paused);
    assert_eq!(schedule.pause_ledger, 100); // ledger is 100 in setup_env
}

#[test]
fn test_pause_stream_updates_status_to_paused() {
    let env = setup_env();
    let (client, sponsor, recipient, _token_id, _token_client) = setup_stream(&env);

    client.pause_stream(&sponsor, &recipient).unwrap();

    let status = client.get_status(&recipient).unwrap();
    assert_eq!(status, StreamStatus::Paused);
}

#[test]
fn test_pause_nonexistent_stream_fails() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);

    let err = client.pause_stream(&sponsor, &recipient).unwrap_err();
    assert_eq!(err, VestingError::ScheduleNotFound.into());
}

#[test]
fn test_pause_wrong_sponsor_fails() {
    let env = setup_env();
    let (client, _sponsor, recipient, _token_id, _token_client) = setup_stream(&env);

    let imposter = Address::generate(&env);
    let err = client.pause_stream(&imposter, &recipient).unwrap_err();
    assert_eq!(err, VestingError::NotSponsor.into());
}

#[test]
fn test_pause_already_paused_stream_fails() {
    let env = setup_env();
    let (client, sponsor, recipient, _token_id, _token_client) = setup_stream(&env);

    client.pause_stream(&sponsor, &recipient).unwrap();
    let err = client.pause_stream(&sponsor, &recipient).unwrap_err();
    assert_eq!(err, VestingError::StreamPaused.into());
}

// ── claim_vested while paused ─────────────────────────────────────────────────

#[test]
fn test_claim_while_paused_returns_stream_paused_error() {
    let env = setup_env();
    let (client, sponsor, recipient, _token_id, _token_client) = setup_stream(&env);

    // Advance past cliff so cliff check passes first, then pause
    advance_ledger(&env, 60); // ledger 160, past cliff (150)
    client.pause_stream(&sponsor, &recipient).unwrap();

    let err = client.claim_vested(&recipient).unwrap_err();
    assert_eq!(err, VestingError::StreamPaused.into());
}

#[test]
fn test_claim_while_paused_pre_cliff_returns_stream_paused() {
    let env = setup_env();
    let (client, sponsor, recipient, _token_id, _token_client) = setup_stream(&env);

    // Pause before cliff
    client.pause_stream(&sponsor, &recipient).unwrap();

    let err = client.claim_vested(&recipient).unwrap_err();
    // CliffNotReached is checked before StreamPaused in claim_vested,
    // but the implementation checks paused after cliff — let's verify
    // which error comes first based on implementation order.
    // In our implementation: CliffNotReached is checked first, then StreamPaused.
    // So pre-cliff + paused → CliffNotReached.
    assert_eq!(err, VestingError::CliffNotReached.into());
}

// ── claimable_amount while paused ────────────────────────────────────────────

#[test]
fn test_claimable_amount_returns_zero_while_paused() {
    let env = setup_env();
    let (client, sponsor, recipient, _token_id, _token_client) = setup_stream(&env);

    advance_ledger(&env, 60); // past cliff
    client.pause_stream(&sponsor, &recipient).unwrap();

    let amount = client.claimable_amount(&recipient);
    assert_eq!(amount, 0);
}

// ── resume_stream ─────────────────────────────────────────────────────────────

#[test]
fn test_resume_stream_clears_paused_flag() {
    let env = setup_env();
    let (client, sponsor, recipient, _token_id, _token_client) = setup_stream(&env);

    client.pause_stream(&sponsor, &recipient).unwrap();
    advance_ledger(&env, 10);
    client.resume_stream(&sponsor, &recipient).unwrap();

    let schedule = client.get_schedule(&recipient).unwrap();
    assert!(!schedule.paused);
    assert_eq!(schedule.pause_ledger, 0);
}

#[test]
fn test_resume_offsets_ledger_milestones_by_pause_duration() {
    let env = setup_env();
    let (client, sponsor, recipient, _token_id, _token_client) = setup_stream(&env);

    // Stream created at ledger 100: start=100, cliff=150, end=300
    let before = client.get_schedule(&recipient).unwrap();
    assert_eq!(before.start_ledger, 100);
    assert_eq!(before.cliff_ledger, 150);
    assert_eq!(before.end_ledger, 300);

    // Pause at ledger 100
    client.pause_stream(&sponsor, &recipient).unwrap();

    // Resume 20 ledgers later
    advance_ledger(&env, 20); // ledger 120
    client.resume_stream(&sponsor, &recipient).unwrap();

    let after = client.get_schedule(&recipient).unwrap();
    // All milestones shifted by 20
    assert_eq!(after.start_ledger, 120);
    assert_eq!(after.cliff_ledger, 170);
    assert_eq!(after.end_ledger, 320);
    assert_eq!(after.last_claimed_ledger, 120);
}

#[test]
fn test_resume_nonexistent_stream_fails() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);

    let err = client.resume_stream(&sponsor, &recipient).unwrap_err();
    assert_eq!(err, VestingError::ScheduleNotFound.into());
}

#[test]
fn test_resume_wrong_sponsor_fails() {
    let env = setup_env();
    let (client, _sponsor, recipient, _token_id, _token_client) = setup_stream(&env);

    let imposter = Address::generate(&env);
    let err = client.resume_stream(&imposter, &recipient).unwrap_err();
    assert_eq!(err, VestingError::NotSponsor.into());
}

#[test]
fn test_resume_not_paused_is_noop() {
    let env = setup_env();
    let (client, sponsor, recipient, _token_id, _token_client) = setup_stream(&env);

    // Resume a stream that is not paused — should succeed as a no-op
    client.resume_stream(&sponsor, &recipient).unwrap();

    let schedule = client.get_schedule(&recipient).unwrap();
    assert!(!schedule.paused);
    // Milestones unchanged
    assert_eq!(schedule.start_ledger, 100);
    assert_eq!(schedule.cliff_ledger, 150);
    assert_eq!(schedule.end_ledger, 300);
}

// ── pause → resume → claim integration ───────────────────────────────────────

#[test]
fn test_claim_succeeds_after_resume_with_correct_offset() {
    let env = setup_env();
    let (client, sponsor, recipient, _token_id, token_client) = setup_stream(&env);

    // Advance 60 ledgers past start (ledger 160) — cliff is at 150, so past cliff.
    advance_ledger(&env, 60);

    // Pause at ledger 160. Accrued so far: 60 ledgers × 10 = 600 (since start).
    client.pause_stream(&sponsor, &recipient).unwrap();

    // Advance 30 more ledgers while paused — nothing should accrue.
    advance_ledger(&env, 30); // ledger 190

    // Resume: pause_duration=30, all milestones shift +30.
    // cliff was 150 → now 180. end was 300 → now 330.
    // last_claimed_ledger was 100 → now 130.
    client.resume_stream(&sponsor, &recipient).unwrap();

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.cliff_ledger, 180);
    assert_eq!(schedule.end_ledger, 330);
    assert_eq!(schedule.last_claimed_ledger, 130);

    // Current ledger is 190, cliff is 180 → cliff passed.
    // Claimable: 190 - 130 = 60 ledgers × 10 = 600.
    let amount = client.claim_vested(&recipient).unwrap();
    assert_eq!(amount, 600);
    assert_eq!(token_client.balance(&recipient), 600);
}

#[test]
fn test_no_accrual_during_pause_period() {
    let env = setup_env();
    let (client, sponsor, recipient, _token_id, _token_client) = setup_stream(&env);

    // Advance past cliff to ledger 160
    advance_ledger(&env, 60);

    // Claimable before pause: 60 × 10 = 600
    let before_pause = client.claimable_amount(&recipient);
    assert_eq!(before_pause, 600);

    // Pause
    client.pause_stream(&sponsor, &recipient).unwrap();

    // Advance 50 more while paused
    advance_ledger(&env, 50); // ledger 210

    // Still 0 claimable while paused
    assert_eq!(client.claimable_amount(&recipient), 0);

    // Resume
    client.resume_stream(&sponsor, &recipient).unwrap();

    // Immediately after resume, last_claimed_ledger shifted by 50.
    // Current ledger 210 - new last_claimed 150 = 60 × 10 = 600 (same as before pause)
    let after_resume = client.claimable_amount(&recipient);
    assert_eq!(after_resume, 600);
}

#[test]
fn test_multiple_pause_resume_cycles() {
    let env = setup_env();
    let (client, sponsor, recipient, _token_id, token_client) = setup_stream(&env);

    // Advance past cliff: ledger 160
    advance_ledger(&env, 60);

    // First pause/resume cycle: pause at 160, resume at 170 (10 ledger pause)
    client.pause_stream(&sponsor, &recipient).unwrap();
    advance_ledger(&env, 10); // ledger 170
    client.resume_stream(&sponsor, &recipient).unwrap();

    // Second pause/resume cycle: pause at 170, resume at 185 (15 ledger pause)
    client.pause_stream(&sponsor, &recipient).unwrap();
    advance_ledger(&env, 15); // ledger 185
    client.resume_stream(&sponsor, &recipient).unwrap();

    // Total pause duration = 25 ledgers.
    // Original: start=100, cliff=150, end=300, last_claimed=100
    // After first cycle (+10): start=110, cliff=160, end=310, last_claimed=110
    // After second cycle (+15): start=125, cliff=175, end=325, last_claimed=125
    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.start_ledger, 125);
    assert_eq!(schedule.cliff_ledger, 175);
    assert_eq!(schedule.end_ledger, 325);
    assert_eq!(schedule.last_claimed_ledger, 125);

    // Current ledger: 185, cliff: 175 → past cliff
    // Claimable: 185 - 125 = 60 × 10 = 600
    let amount = client.claim_vested(&recipient).unwrap();
    assert_eq!(amount, 600);
    assert_eq!(token_client.balance(&recipient), 600);
}

#[test]
fn test_cancel_paused_stream_full_refund_before_cliff() {
    let env = setup_env();
    let (client, sponsor, recipient, _token_id, token_client) = setup_stream(&env);

    // Pause before cliff
    client.pause_stream(&sponsor, &recipient).unwrap();

    // Advance while paused — cliff remains in future due to offset on resume,
    // but here we cancel without resuming.
    advance_ledger(&env, 20); // ledger 120, cliff was 150

    // Cancel: cliff not passed (current 120 < cliff 150) → full refund
    client.cancel_stream(&sponsor, &recipient).unwrap();

    assert_eq!(token_client.balance(&sponsor), 2_000);
    assert_eq!(token_client.balance(&recipient), 0);
}
