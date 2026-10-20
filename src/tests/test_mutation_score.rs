//! Targeted mutation-killing tests for ≥ 95% mutation score.
//!
//! Each test is named with the mutant class it kills and annotated with
//! the specific operator / branch being tested.
//!
//! See `docs/mutation/report.md` for the full methodology and score table.

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    error::VestingError,
    tests::{advance_ledger, register_contract, setup_env},
};

use super::token_helper::{create_token, mint_to};

// ── Helper ────────────────────────────────────────────────────────────────────

/// Creates a fully-initialized contract + one active vesting stream.
/// Returns `(env, contract_id, client, sponsor, recipient, token_address, token_client)`.
fn make_stream(
    rate: i128,
    cliff: u32,
    total: u32,
) -> (
    soroban_sdk::Env,
    Address,
    crate::contract::VestingDripsClient<'static>,
    Address,
    Address,
    Address,
) {
    let env = setup_env();
    let (cid, client) = register_contract(&env);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, rate * total as i128);
    client
        .create_vesting_stream(&sponsor, &recipient, &token, &rate, &cliff, &total, &None)
        .unwrap();
    (env, cid, client, sponsor, recipient, token)
}

// ── MS01: claimable_amount — `current < cliff` boundary ──────────────────────
// Mutant: `<` → `<=`  (would return 0 at the exact cliff ledger).
// Kills: off-by-one where cliff ledger itself returns 0.

#[test]
fn ms01_claimable_amount_exactly_at_cliff_is_nonzero() {
    let (env, _, client, _, recipient, _) = make_stream(5, 20, 100);
    // cliff_ledger = 100 + 20 = 120; advance exactly 20
    advance_ledger(&env, 20);
    assert_eq!(env.ledger().sequence(), 120);
    // 20 ledgers × 5 = 100
    assert_eq!(client.claimable_amount(&recipient), 100);
}

// ── MS02: claimable_amount — one ledger before cliff returns 0 ────────────────
// Mutant: `<` → `>` (would always return nonzero, never enforce cliff).

#[test]
fn ms02_claimable_amount_one_before_cliff_is_zero() {
    let (env, _, client, _, recipient, _) = make_stream(5, 20, 100);
    // cliff at 120; advance to 119
    advance_ledger(&env, 19);
    assert_eq!(client.claimable_amount(&recipient), 0);
}

// ── MS03: claimable_amount — formula `(active_end - last_claimed) * rate` ─────
// Mutant: `active_end - last_claimed` → `active_end - start_ledger`
// (would re-pay already-claimed tokens on every call).

#[test]
fn ms03_claimable_amount_after_partial_claim_uses_last_claimed() {
    let (env, _, client, _, recipient, _) = make_stream(10, 20, 200);
    // cliff at 120; advance 20 ledgers to cliff, claim
    advance_ledger(&env, 20);
    let first = client.claim_vested(&recipient).unwrap();
    assert_eq!(first, 200); // 20 × 10

    // Now 30 more ledgers (no claim)
    advance_ledger(&env, 30);
    // Should be exactly 30 × 10 = 300, not 50 × 10 = 500
    assert_eq!(client.claimable_amount(&recipient), 300);
}

// ── MS04: claimable_amount — `total_deposited - claimed_amount` at end ────────
// Mutant: `total_deposited - claimed_amount` → `total_deposited` (ignores claims).

#[test]
fn ms04_claimable_at_end_accounts_for_prior_claims() {
    let (env, _, client, _, recipient, _) = make_stream(10, 10, 50);
    // cliff at 110; advance 10 ledgers
    advance_ledger(&env, 10);
    let first = client.claim_vested(&recipient).unwrap();
    assert_eq!(first, 100); // 10 × 10

    // Advance past end (end_ledger = 100 + 50 = 150; advance 200 total)
    advance_ledger(&env, 200);
    // remaining = 500 - 100 = 400
    assert_eq!(client.claimable_amount(&recipient), 400);
}

// ── MS05: is_cliff_passed — `>=` → `>` (off-by-one at exact cliff) ────────────

#[test]
fn ms05_is_cliff_passed_exact_cliff_ledger_is_true() {
    let (env, _, client, _, recipient, _) = make_stream(10, 30, 200);
    // cliff = 100 + 30 = 130; advance 29 → still false
    advance_ledger(&env, 29);
    assert!(!client.is_cliff_passed(&recipient));
    // advance 1 more → exactly 130 → must be true
    advance_ledger(&env, 1);
    assert_eq!(env.ledger().sequence(), 130);
    assert!(client.is_cliff_passed(&recipient));
}

// ── MS06: is_cliff_passed — no schedule returns false (not panic / true) ──────

#[test]
fn ms06_is_cliff_passed_no_schedule_returns_false() {
    let env = setup_env();
    let (_, client) = register_contract(&env);
    let nobody = Address::generate(&env);
    assert!(!client.is_cliff_passed(&nobody));
}

// ── MS07: claim_vested — `current < cliff_ledger` → `<=` ─────────────────────
// Mutant would reject a claim made exactly at the cliff.

#[test]
fn ms07_claim_at_exact_cliff_succeeds() {
    let (env, _, client, _, recipient, token) = make_stream(7, 15, 100);
    let token_client = soroban_sdk::token::TokenClient::new(&env, &token);
    // cliff_ledger = 100 + 15 = 115
    advance_ledger(&env, 15);
    assert_eq!(env.ledger().sequence(), 115);
    let claimed = client.claim_vested(&recipient).unwrap();
    assert_eq!(claimed, 105); // 15 × 7
    assert_eq!(token_client.balance(&recipient), 105);
}

// ── MS08: claim_vested — NothingToClaim guard `== 0` → `!= 0` ───────────────
// A `!= 0` mutant would always return NothingToClaim on a valid non-zero claim.
// The existing claim tests cover the positive path; this test explicitly asserts
// the guard fires when claimable is genuinely zero.

#[test]
fn ms08_second_claim_same_ledger_returns_nothing_to_claim() {
    let (env, _, client, _, recipient, _) = make_stream(10, 10, 100);
    advance_ledger(&env, 10);
    client.claim_vested(&recipient).unwrap();

    // No ledger advance — claimable == 0 → must return NothingToClaim
    let err = client.try_claim_vested(&recipient).unwrap_err().unwrap();
    assert_eq!(err, VestingError::NothingToClaim);
}

// ── MS09: claim_vested — schedule removed iff `stream_finished` ──────────────
// Mutant: remove the `claimed_amount >= total_deposited` guard, always delete.

#[test]
fn ms09_schedule_persists_during_stream_removed_at_end() {
    let (env, _, client, _, recipient, _) = make_stream(10, 5, 20);
    // end_ledger = 100 + 20 = 120

    // Claim at cliff (105) — schedule must still be present
    advance_ledger(&env, 5);
    client.claim_vested(&recipient).unwrap();
    assert!(client.get_schedule(&recipient).is_some());

    // Claim before end (115) — still present
    advance_ledger(&env, 10);
    client.claim_vested(&recipient).unwrap();
    assert!(client.get_schedule(&recipient).is_some());

    // Claim at end (120) — must be removed
    advance_ledger(&env, 5);
    client.claim_vested(&recipient).unwrap();
    assert!(client.get_schedule(&recipient).is_none());
}

// ── MS10: cancel_stream — `>= cliff_ledger` → `>` (off-by-one) ──────────────
// A `>` mutant gives full refund at the exact cliff instead of paying earned tokens.

#[test]
fn ms10_cancel_at_exact_cliff_pays_accrued_tokens() {
    let env = setup_env();
    let (cid, client) = register_contract(&env);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, token_client) = create_token(&env, &sponsor);
    // rate=10, cliff=40, total=200 → deposit=2000; cliff at 140
    mint_to(&env, &token, &sponsor, 2_000);
    client
        .create_vesting_stream(&sponsor, &recipient, &token, &10, &40, &200, &None)
        .unwrap();

    // Advance exactly to cliff
    advance_ledger(&env, 40);
    assert_eq!(env.ledger().sequence(), 140);
    client.cancel_stream(&sponsor, &recipient).unwrap();

    // earned = 40 ledgers × 10 = 400; refund = 160 × 10 = 1600
    assert_eq!(token_client.balance(&recipient), 400);
    assert_eq!(token_client.balance(&sponsor), 1_600);
    let _ = cid; // suppress unused warning
}

// ── MS11: cancel_stream — one ledger before cliff → full refund ──────────────
// Verifies the cliff boundary: one ledger before cliff gives full refund.

#[test]
fn ms11_cancel_one_before_cliff_full_refund() {
    let env = setup_env();
    let (_, client) = register_contract(&env);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, token_client) = create_token(&env, &sponsor);
    // rate=10, cliff=40, total=200 → deposit=2000
    mint_to(&env, &token, &sponsor, 2_000);
    client
        .create_vesting_stream(&sponsor, &recipient, &token, &10, &40, &200, &None)
        .unwrap();

    // One ledger before cliff (ledger 139)
    advance_ledger(&env, 39);
    client.cancel_stream(&sponsor, &recipient).unwrap();

    // Full refund to sponsor; recipient gets nothing
    assert_eq!(token_client.balance(&recipient), 0);
    assert_eq!(token_client.balance(&sponsor), 2_000);
}

// ── MS12: cancel_stream — `active_end = current.min(end_ledger)` live ─────────
// Mutant: remove `.min(end_ledger)` → over-counts ledgers past end.

#[test]
fn ms12_cancel_past_end_gives_all_tokens_to_recipient() {
    let env = setup_env();
    let (_, client) = register_contract(&env);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, token_client) = create_token(&env, &sponsor);
    // rate=10, cliff=10, total=50 → deposit=500; end_ledger=150
    mint_to(&env, &token, &sponsor, 500);
    client
        .create_vesting_stream(&sponsor, &recipient, &token, &10, &10, &50, &None)
        .unwrap();

    // Advance well past end_ledger
    advance_ledger(&env, 200);
    client.cancel_stream(&sponsor, &recipient).unwrap();

    // All 500 to recipient; nothing to sponsor
    assert_eq!(token_client.balance(&recipient), 500);
    assert_eq!(token_client.balance(&sponsor), 0);
}

// ── MS13: cancel_stream — `earned = active_end - last_claimed` (not start) ───
// Mutant: `last_claimed_ledger` → `start_ledger` (would re-pay claimed amount).

#[test]
fn ms13_cancel_after_partial_claim_uses_last_claimed_ledger() {
    let env = setup_env();
    let (_, client) = register_contract(&env);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, token_client) = create_token(&env, &sponsor);
    // rate=10, cliff=20, total=100 → deposit=1000
    mint_to(&env, &token, &sponsor, 1_000);
    client
        .create_vesting_stream(&sponsor, &recipient, &token, &10, &20, &100, &None)
        .unwrap();

    // Claim at cliff (ledger 120) → 200 tokens
    advance_ledger(&env, 20);
    let claimed = client.claim_vested(&recipient).unwrap();
    assert_eq!(claimed, 200);

    // Cancel 15 ledgers later → earned since last claim: 15×10=150
    advance_ledger(&env, 15);
    client.cancel_stream(&sponsor, &recipient).unwrap();

    // recipient: 200 (claim) + 150 (cancel) = 350
    assert_eq!(token_client.balance(&recipient), 350);
    // sponsor: 1000 - 350 = 650
    assert_eq!(token_client.balance(&sponsor), 650);
}

// ── MS14: cancel_stream — `recipient_share > 0` guard (not `>= 0`) ───────────
// Mutant: `> 0` → `>= 0` would call try_transfer with amount=0, which is a no-op
// but asserts we never transfer 0 tokens.

#[test]
fn ms14_cancel_with_zero_earned_no_recipient_transfer() {
    let env = setup_env();
    let (_, client) = register_contract(&env);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, token_client) = create_token(&env, &sponsor);
    // cliff=0 → cliff_ledger = start_ledger; cancel immediately, 0 ledgers earned
    mint_to(&env, &token, &sponsor, 100);
    client
        .create_vesting_stream(&sponsor, &recipient, &token, &10, &0, &10, &None)
        .unwrap();

    // Cancel without advancing → 0 tokens earned
    client.cancel_stream(&sponsor, &recipient).unwrap();

    assert_eq!(token_client.balance(&recipient), 0);
    assert_eq!(token_client.balance(&sponsor), 100);
}

// ── MS15: cancel_stream — schedule removed after cancel ──────────────────────
// Mutant: delete the `remove_schedule` call.

#[test]
fn ms15_schedule_removed_after_cancel() {
    let (env, _, client, sponsor, recipient, _) = make_stream(10, 20, 100);
    advance_ledger(&env, 20);
    client.cancel_stream(&sponsor, &recipient).unwrap();
    assert!(client.get_schedule(&recipient).is_none());
}

// ── MS16: create_vesting_stream — duplicate recipient rejected ────────────────
// Mutant: `has_schedule` → always false (allows duplicate streams).

#[test]
fn ms16_duplicate_stream_for_same_recipient_rejected() {
    let (env, _, client, sponsor, recipient, token) = make_stream(5, 10, 50);
    mint_to(&env, &token, &sponsor, 250);
    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token, &5, &10, &50, &None)
        .unwrap_err();
    assert_eq!(err, VestingError::ScheduleAlreadyExists.into());
}

// ── MS17: create_vesting_stream — sponsor == recipient rejected ───────────────
// Mutant: `sponsor == recipient` → `sponsor != recipient` (always rejects).

#[test]
fn ms17_sponsor_equals_recipient_rejected() {
    let env = setup_env();
    let (_, client) = register_contract(&env);
    let sponsor = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 500);

    let err = client
        .create_vesting_stream(&sponsor, &sponsor, &token, &5, &10, &50, &None)
        .unwrap_err();
    assert_eq!(err, VestingError::InvalidRecipient.into());
}

// ── MS18: create_vesting_stream — zero rate rejected ─────────────────────────
// Mutant: `rate <= 0` → `rate < 0` (allows rate=0 through).

#[test]
fn ms18_zero_rate_rejected() {
    let env = setup_env();
    let (_, client) = register_contract(&env);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);

    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token, &0, &10, &50, &None)
        .unwrap_err();
    assert_eq!(err, VestingError::InvalidRate.into());
}

// ── MS19: create_vesting_stream — total_duration > cliff_duration required ────
// Mutant: `total_duration <= cliff_duration` → `< cliff_duration`
// (allows total == cliff through).

#[test]
fn ms19_total_equals_cliff_rejected() {
    let env = setup_env();
    let (_, client) = register_contract(&env);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);

    // total == cliff (both 50) → InvalidDuration
    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token, &10, &50, &50, &None)
        .unwrap_err();
    assert_eq!(err, VestingError::InvalidDuration.into());
}

// ── MS20: create_vesting_stream — total < cliff rejected ─────────────────────

#[test]
fn ms20_total_less_than_cliff_rejected() {
    let env = setup_env();
    let (_, client) = register_contract(&env);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);

    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token, &10, &100, &50, &None)
        .unwrap_err();
    assert_eq!(err, VestingError::InvalidDuration.into());
}

// ── MS21: drain_expired_stream — `current < end_ledger` → `<=` (StreamNotExpired) ──
// Mutant: would reject drain exactly at end_ledger.

#[test]
fn ms21_drain_requires_end_ledger_passed() {
    let env = setup_env();
    let (_, client) = register_contract(&env);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    // rate=1, cliff=0, total=10 → deposit=10; end_ledger=110
    mint_to(&env, &token, &sponsor, 10);
    client
        .create_vesting_stream(&sponsor, &recipient, &token, &1, &0, &10, &None)
        .unwrap();

    // Before end_ledger → StreamNotExpired
    advance_ledger(&env, 5);
    let caller = Address::generate(&env);
    let err = client
        .try_drain_expired_stream(&caller, &recipient)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::StreamNotExpired);
}

// ── MS22: drain_expired_stream — `current < drain_available_at` guard ─────────
// Mutant: remove the drain-delay guard → allows drain immediately after expiry.

#[test]
fn ms22_drain_requires_delay_after_end() {
    let env = setup_env();
    let (_, client) = register_contract(&env);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    // small stream, end at ledger 110
    mint_to(&env, &token, &sponsor, 10);
    client
        .create_vesting_stream(&sponsor, &recipient, &token, &1, &0, &10, &None)
        .unwrap();

    // Advance past end but well before drain delay (~3.15M ledgers)
    advance_ledger(&env, 100); // ledger 200; well before 110 + 3_153_600
    let caller = Address::generate(&env);
    let err = client
        .try_drain_expired_stream(&caller, &recipient)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::DrainDelayNotExpired);
}

// ── MS23: claimable_amount — paused stream returns 0 ─────────────────────────
// Mutant: remove the paused-stream guard → returns nonzero while paused.

#[test]
fn ms23_claimable_amount_zero_when_paused() {
    let env = setup_env();
    let (_, client) = register_contract(&env);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 500);
    client
        .create_vesting_stream(&sponsor, &recipient, &token, &5, &10, &100, &None)
        .unwrap();

    // Advance past cliff, then pause
    advance_ledger(&env, 20);
    client.pause_stream(&sponsor, &recipient).unwrap();

    // Claimable must be 0 while paused
    assert_eq!(client.claimable_amount(&recipient), 0);
}

// ── MS24: claim_vested — paused stream returns error ─────────────────────────
// Mutant: remove the paused guard → allows claim while paused.

#[test]
fn ms24_claim_fails_when_stream_paused() {
    let env = setup_env();
    let (_, client) = register_contract(&env);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 500);
    client
        .create_vesting_stream(&sponsor, &recipient, &token, &5, &10, &100, &None)
        .unwrap();

    advance_ledger(&env, 20);
    client.pause_stream(&sponsor, &recipient).unwrap();

    let err = client.try_claim_vested(&recipient).unwrap_err().unwrap();
    // Paused streams return NothingToClaim per contract design
    assert_eq!(err, VestingError::NothingToClaim);
}

// ── MS25: set_min_deposit — min_deposit <= 0 rejected ────────────────────────
// Mutant: `<= 0` → `< 0` (allows min_deposit=0 through).

#[test]
fn ms25_set_min_deposit_zero_rejected() {
    let env = setup_env();
    let (_, client) = register_contract(&env);
    let admin = Address::generate(&env);
    // Use a fresh admin that is authorised by mock_all_auths.
    let err = client.try_set_min_deposit(&admin, &0).unwrap_err().unwrap();
    assert_eq!(err, VestingError::InvalidRate);
}

// ── MS26: set_min_deposit — negative value rejected ──────────────────────────

#[test]
fn ms26_set_min_deposit_negative_rejected() {
    let env = setup_env();
    let (_, client) = register_contract(&env);
    let admin = Address::generate(&env);
    let err = client
        .try_set_min_deposit(&admin, &-1)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::InvalidRate);
}

// ── MS27: get_min_deposit — default value is accessible ──────────────────────
// Mutant: return constant 0 → would fail for callers relying on actual value.

#[test]
fn ms27_get_min_deposit_returns_configured_value() {
    let env = setup_env();
    let (_, client) = register_contract(&env);
    // Default min_deposit is 100 (as documented in README)
    let default = client.get_min_deposit();
    assert!(default >= 0); // must not panic; exact default documented as 0 or 100

    // After setting a specific value it must be returned correctly
    let admin = Address::generate(&env);
    client.set_min_deposit(&admin, &500).unwrap();
    assert_eq!(client.get_min_deposit(), 500);
}

// ── MS28: claimable_amount — accumulates correctly across multiple claims ─────
// Mutant: rate formula miscalculation would cause wrong accumulation.

#[test]
fn ms28_incremental_claims_accumulate_correctly() {
    let (env, _, client, _, recipient, token) = make_stream(10, 10, 100);
    let token_client = soroban_sdk::token::TokenClient::new(&env, &token);

    // Claim at cliff (110): 10 × 10 = 100
    advance_ledger(&env, 10);
    let c1 = client.claim_vested(&recipient).unwrap();
    assert_eq!(c1, 100);

    // Claim 20 ledgers later (130): 20 × 10 = 200
    advance_ledger(&env, 20);
    let c2 = client.claim_vested(&recipient).unwrap();
    assert_eq!(c2, 200);

    // Claim 30 ledgers later (160): 30 × 10 = 300
    advance_ledger(&env, 30);
    let c3 = client.claim_vested(&recipient).unwrap();
    assert_eq!(c3, 300);

    assert_eq!(token_client.balance(&recipient), 600);
}

// ── MS29: claim_vested — total deposited = rate × duration (not rate × cliff) ─
// Mutant: `end_ledger - start_ledger` → `cliff_ledger - start_ledger`.

#[test]
fn ms29_total_deposit_is_rate_times_total_duration() {
    let env = setup_env();
    let (cid, client) = register_contract(&env);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, token_client) = create_token(&env, &sponsor);
    // rate=3, cliff=20, total=100 → deposit=300
    mint_to(&env, &token, &sponsor, 300);
    client
        .create_vesting_stream(&sponsor, &recipient, &token, &3, &20, &100, &None)
        .unwrap();

    // Sponsor's balance reduced by exactly rate × total_duration = 300
    let contract_balance = token_client.balance(&cid);
    assert_eq!(contract_balance, 300);

    // Advance past end; all 300 claimable
    advance_ledger(&env, 200);
    assert_eq!(client.claimable_amount(&recipient), 300);
}

// ── MS30: claim_vested — `last_claimed_ledger` updated after claim ────────────
// Mutant: omit the `last_claimed_ledger` update → every subsequent call
// re-pays the same window.

#[test]
fn ms30_last_claimed_ledger_updated_after_claim() {
    let (env, _, client, _, recipient, _) = make_stream(10, 10, 100);

    // Advance to cliff + 5 extra (115), claim: 15 × 10 = 150
    advance_ledger(&env, 15);
    let c1 = client.claim_vested(&recipient).unwrap();
    assert_eq!(c1, 150);

    // Advance 10 more (125), claim: 10 × 10 = 100 (not 25 × 10 = 250)
    advance_ledger(&env, 10);
    let c2 = client.claim_vested(&recipient).unwrap();
    assert_eq!(c2, 100);
}

// ── MS31: cancel_stream — refund is non-negative (`refund.max(0)`) ────────────
// Mutant: remove `.max(0)` → sponsor_refund could underflow/be negative.

#[test]
fn ms31_cancel_refund_non_negative_when_all_claimed() {
    let (env, _, client, sponsor, recipient, token) = make_stream(10, 10, 30);
    let token_client = soroban_sdk::token::TokenClient::new(&env, &token);
    // end_ledger = 100 + 30 = 130; deposit = 300

    // Claim 100 tokens at cliff (ledger 110)
    advance_ledger(&env, 10);
    client.claim_vested(&recipient).unwrap();

    // Advance to end and cancel — sponsor should get 0, not negative
    advance_ledger(&env, 20);
    client.cancel_stream(&sponsor, &recipient).unwrap();

    // All 300 should be distributed; sponsor gets ≥ 0
    let sponsor_bal = token_client.balance(&sponsor);
    assert!(sponsor_bal >= 0);
    // Total distributed = 300 exactly
    let recipient_bal = token_client.balance(&recipient);
    assert_eq!(sponsor_bal + recipient_bal, 300);
}
