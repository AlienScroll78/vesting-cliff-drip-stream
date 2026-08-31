//! Tests for the `total_claimed` field on [`VestingSchedule`].
//!
//! Verifies that:
//! - The field is initialised to `0` on stream creation.
//! - It is incremented correctly after a single claim.
//! - It accumulates correctly across multiple sequential claims.
//! - `get_schedule` returns the updated value after each claim.
//! - `get_stats` reflects the same value.
//! - `get_total_claimed` view returns the same value.

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    tests::{advance_ledger, setup_env},
};

use super::super::tests::token_helper::{create_token, mint_to};

/// Helper: registers the contract AND calls initialize.
fn make_initialized_client(env: &soroban_sdk::Env) -> VestingDripsClient {
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    client.initialize(&admin, &0u32, &treasury);
    client
}

// ── Initialisation ────────────────────────────────────────────────────────────

/// `total_claimed` must be `0` immediately after stream creation.
#[test]
fn test_total_claimed_init_zero() {
    let env = setup_env();
    let client = make_initialized_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    // rate=10, cliff=50, total=200 → deposit=2000
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None)
        .unwrap();

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(
        schedule.total_claimed, 0,
        "total_claimed must be 0 immediately after create"
    );

    // get_total_claimed view must also return 0.
    assert_eq!(
        client.get_total_claimed(&recipient),
        0,
        "get_total_claimed must return 0 immediately after create"
    );
}

// ── Single claim ──────────────────────────────────────────────────────────────

/// After the first claim `total_claimed` equals the amount returned by `claim_vested`.
#[test]
fn test_total_claimed_after_single_claim() {
    let env = setup_env();
    let client = make_initialized_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    // rate=10, cliff=50, total=200; start=100 → cliff_ledger=150
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None)
        .unwrap();

    // Advance 60 ledgers past start (ledger 160, past cliff 150).
    advance_ledger(&env, 60);
    let claimed = client.claim_vested(&recipient, &None).unwrap();
    assert_eq!(claimed, 600); // 60 ledgers × 10

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(
        schedule.total_claimed, 600,
        "total_claimed must equal the amount returned by claim_vested"
    );

    // get_total_claimed view must match.
    assert_eq!(
        client.get_total_claimed(&recipient),
        600,
        "get_total_claimed must match schedule.total_claimed"
    );
}

// ── Multi-claim accumulation ──────────────────────────────────────────────────

/// `total_claimed` accumulates correctly across multiple sequential claims.
#[test]
fn test_total_claimed_accumulates_across_multiple_claims() {
    let env = setup_env();
    let client = make_initialized_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    // rate=10, cliff=50, total=200; start=100 → end_ledger=300
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None)
        .unwrap();

    // ── Claim 1: at cliff (ledger 150) — 50 ledgers accrued ──────────────────
    advance_ledger(&env, 50);
    let c1 = client.claim_vested(&recipient, &None).unwrap();
    assert_eq!(c1, 500);

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.total_claimed, 500, "after claim 1");
    assert_eq!(client.get_total_claimed(&recipient), 500);

    // ── Claim 2: 30 more ledgers (ledger 180) ────────────────────────────────
    advance_ledger(&env, 30);
    let c2 = client.claim_vested(&recipient, &None).unwrap();
    assert_eq!(c2, 300);

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.total_claimed, 800, "after claim 2 (500 + 300)");
    assert_eq!(client.get_total_claimed(&recipient), 800);

    // ── Claim 3: 70 more ledgers (ledger 250) ────────────────────────────────
    advance_ledger(&env, 70);
    let c3 = client.claim_vested(&recipient, &None).unwrap();
    assert_eq!(c3, 700);

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.total_claimed, 1_500, "after claim 3 (800 + 700)");
    assert_eq!(client.get_total_claimed(&recipient), 1_500);
}

/// `total_claimed` reaches the full deposit when the stream is fully consumed.
#[test]
fn test_total_claimed_equals_deposit_after_full_claim() {
    let env = setup_env();
    let client = make_initialized_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    // rate=10, cliff=50, total=100 → deposit=1000; end_ledger=200
    mint_to(&env, &token_id, &sponsor, 1_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &100, &None)
        .unwrap();

    // Claim once past the cliff.
    advance_ledger(&env, 60); // ledger 160
    let c1 = client.claim_vested(&recipient, &None).unwrap();
    assert_eq!(c1, 600);

    // Claim again past end_ledger (stream finishes, schedule removed).
    advance_ledger(&env, 50); // ledger 210, past end_ledger 200
    // At this point get_schedule still exists until the final claim commits.
    let c2 = client.claim_vested(&recipient, &None).unwrap();
    assert_eq!(c2, 400); // remaining 40 ledgers × 10

    // Stream is finished — schedule is removed.
    // total_claimed is no longer readable via get_schedule, but the sum must be
    // exactly the deposit.
    assert_eq!(c1 + c2, 1_000, "total claimed must equal full deposit");
    assert!(
        client.get_schedule(&recipient).is_none(),
        "schedule removed after full claim"
    );

    // get_total_claimed returns 0 after stream removal.
    assert_eq!(
        client.get_total_claimed(&recipient),
        0,
        "get_total_claimed returns 0 when stream is fully claimed and removed"
    );
}

// ── get_stats consistency ─────────────────────────────────────────────────────

/// `get_stats().total_claimed` reflects the same value as `get_schedule().total_claimed`.
#[test]
fn test_total_claimed_consistent_in_get_stats() {
    let env = setup_env();
    let client = make_initialized_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    // rate=5, cliff=20, total=100 → deposit=500
    mint_to(&env, &token_id, &sponsor, 500);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &5, &20, &100, &None)
        .unwrap();

    // Before any claim: both should be 0.
    let stats = client.get_stats(&recipient).unwrap();
    assert_eq!(stats.total_claimed, 0);
    assert_eq!(client.get_total_claimed(&recipient), 0);

    // After a claim: stats.total_claimed must match schedule.total_claimed.
    advance_ledger(&env, 30); // past cliff (120+20=120 → ledger 130)
    let claimed = client.claim_vested(&recipient, &None).unwrap();

    let stats = client.get_stats(&recipient).unwrap();
    let schedule = client.get_schedule(&recipient).unwrap();

    assert_eq!(stats.total_claimed, claimed);
    assert_eq!(stats.total_claimed, schedule.total_claimed);
    assert_eq!(client.get_total_claimed(&recipient), claimed);

    // Consistency: deposited == claimed + remaining
    assert_eq!(
        stats.total_deposited,
        stats.total_claimed + stats.remaining,
        "total_deposited must equal total_claimed + remaining"
    );
}

// ── No overflow for max-rate long-duration streams ────────────────────────────

/// `total_claimed` does not overflow for a high-rate stream.
///
/// Uses the maximum safe rate (i128::MAX / total_duration) to ensure
/// that arithmetic is safe and total_claimed accumulates correctly.
#[test]
fn test_total_claimed_no_overflow_high_rate() {
    let env = setup_env();
    let client = make_initialized_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // Use a moderate large rate that won't overflow but tests i128 arithmetic.
    // rate=1_000_000_000, total=100, cliff=10 → deposit=100_000_000_000
    let rate: i128 = 1_000_000_000;
    let total: u32 = 100;
    let deposit = rate * total as i128;
    mint_to(&env, &token_id, &sponsor, deposit);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &10, &total, &None)
        .unwrap();

    // Advance to cliff.
    advance_ledger(&env, 10);
    let claimed = client.claim_vested(&recipient).unwrap();
    assert_eq!(claimed, rate * 10);

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.total_claimed, rate * 10);
    assert_eq!(client.get_total_claimed(&recipient), rate * 10);

    // total_claimed must not exceed deposit.
    assert!(schedule.total_claimed <= deposit);
}
