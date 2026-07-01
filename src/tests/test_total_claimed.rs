//! Tests for the `total_claimed` field on [`VestingSchedule`].
//!
//! Verifies that:
//! - The field is initialised to `0` on stream creation.
//! - It is incremented correctly after a single claim.
//! - It accumulates correctly across multiple sequential claims.
//! - `get_schedule` returns the updated value after each claim.
//! - `get_stats` reflects the same value.

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    tests::{advance_ledger, setup_env},
};

use super::super::tests::token_helper::{create_token, mint_to};

// ── Initialisation ────────────────────────────────────────────────────────────

/// `total_claimed` must be `0` immediately after stream creation.
#[test]
fn test_total_claimed_init_zero() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    // rate=10, cliff=50, total=200 → deposit=2000
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(
        schedule.total_claimed, 0,
        "total_claimed must be 0 immediately after create"
    );
}

// ── Single claim ──────────────────────────────────────────────────────────────

/// After the first claim `total_claimed` equals the amount returned by `claim_vested`.
#[test]
fn test_total_claimed_after_single_claim() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    // rate=10, cliff=50, total=200; start=100 → cliff_ledger=150
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Advance 60 ledgers past start (ledger 160, past cliff 150).
    advance_ledger(&env, 60);
    let claimed = client.claim_vested(&recipient).unwrap();
    assert_eq!(claimed, 600); // 60 ledgers × 10

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(
        schedule.total_claimed, 600,
        "total_claimed must equal the amount returned by claim_vested"
    );
}

// ── Multi-claim accumulation ──────────────────────────────────────────────────

/// `total_claimed` accumulates correctly across multiple sequential claims.
#[test]
fn test_total_claimed_accumulates_across_multiple_claims() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    // rate=10, cliff=50, total=200; start=100 → end_ledger=300
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // ── Claim 1: at cliff (ledger 150) — 50 ledgers accrued ──────────────────
    advance_ledger(&env, 50);
    let c1 = client.claim_vested(&recipient).unwrap();
    assert_eq!(c1, 500);

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.total_claimed, 500, "after claim 1");

    // ── Claim 2: 30 more ledgers (ledger 180) ────────────────────────────────
    advance_ledger(&env, 30);
    let c2 = client.claim_vested(&recipient).unwrap();
    assert_eq!(c2, 300);

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.total_claimed, 800, "after claim 2 (500 + 300)");

    // ── Claim 3: 70 more ledgers (ledger 250) ────────────────────────────────
    advance_ledger(&env, 70);
    let c3 = client.claim_vested(&recipient).unwrap();
    assert_eq!(c3, 700);

    let schedule = client.get_schedule(&recipient).unwrap();
    assert_eq!(schedule.total_claimed, 1_500, "after claim 3 (800 + 700)");
}

/// `total_claimed` reaches the full deposit when the stream is fully consumed.
#[test]
fn test_total_claimed_equals_deposit_after_full_claim() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    // rate=10, cliff=50, total=100 → deposit=1000; end_ledger=200
    mint_to(&env, &token_id, &sponsor, 1_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &100)
        .unwrap();

    // Claim once past the cliff.
    advance_ledger(&env, 60); // ledger 160
    let c1 = client.claim_vested(&recipient).unwrap();
    assert_eq!(c1, 600);

    // Claim again past end_ledger (stream finishes, schedule removed).
    advance_ledger(&env, 50); // ledger 210, past end_ledger 200
    // At this point get_schedule still exists until the final claim commits.
    let c2 = client.claim_vested(&recipient).unwrap();
    assert_eq!(c2, 400); // remaining 40 ledgers × 10

    // Stream is finished — schedule is removed.
    // total_claimed is no longer readable via get_schedule, but the sum must be
    // exactly the deposit.
    assert_eq!(c1 + c2, 1_000, "total claimed must equal full deposit");
    assert!(
        client.get_schedule(&recipient).is_none(),
        "schedule removed after full claim"
    );
}

// ── get_stats consistency ─────────────────────────────────────────────────────

/// `get_stats().total_claimed` reflects the same value as `get_schedule().total_claimed`.
#[test]
fn test_total_claimed_consistent_in_get_stats() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    // rate=5, cliff=20, total=100 → deposit=500
    mint_to(&env, &token_id, &sponsor, 500);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &5, &20, &100)
        .unwrap();

    // Before any claim: both should be 0.
    let stats = client.get_stats(&recipient).unwrap();
    assert_eq!(stats.total_claimed, 0);

    // After a claim: stats.total_claimed must match schedule.total_claimed.
    advance_ledger(&env, 30); // past cliff (120+20=120 → ledger 130)
    let claimed = client.claim_vested(&recipient).unwrap();

    let stats = client.get_stats(&recipient).unwrap();
    let schedule = client.get_schedule(&recipient).unwrap();

    assert_eq!(stats.total_claimed, claimed);
    assert_eq!(stats.total_claimed, schedule.total_claimed);
    // Consistency: deposited == claimed + remaining
    assert_eq!(
        stats.total_deposited,
        stats.total_claimed + stats.remaining,
        "total_deposited must equal total_claimed + remaining"
    );
}
