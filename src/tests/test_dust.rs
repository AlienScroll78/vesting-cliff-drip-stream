//! Tests for dust collection — sub-1-token remainder handling (issue #322).
//!
//! With integer arithmetic, `rate × elapsed_ledgers` can leave a remainder
//! when the stream expires. The final claim must collect this remainder so
//! no tokens are permanently locked in the contract vault.

#![cfg(test)]

use soroban_sdk::testutils::Address as _;

use crate::{
    tests::{advance_ledger, create_vesting_stream, generate_addresses, register_contract, setup_env},
};

// ── Dust collection at end_ledger ─────────────────────────────────────────────

/// Full deposit is returned when the stream is claimed at exactly `end_ledger`.
///
/// A rate of 7 over 100 ledgers deposits 700 tokens.  Claiming at exactly
/// end_ledger should return all 700 (no remainder left in vault).
#[test]
fn test_claim_at_end_ledger_returns_full_deposit() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = create_vesting_stream(&env, &client, &sponsor, &recipient, 7, 20, 100);

    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);

    // Advance to exactly end_ledger (start=100, total_duration=100 → end=200)
    advance_ledger(&env, 100);

    let claimed = client.claim_vested(&recipient).unwrap();
    assert_eq!(claimed, 700, "full deposit should be returned at end_ledger");
    assert_eq!(token_client.balance(&recipient), 700);
    // Stream must be deleted after full claim
    assert!(client.get_schedule(&recipient).is_none());
}

/// Claim before end_ledger uses normal formula; claim at end_ledger collects dust.
///
/// Rate=3, total_duration=10 → deposit=30.
/// Claim at ledger 107 (7 ledgers post-cliff, cliff_duration=5):
///   normal formula: 7 × 3 = 21
/// Then claim at end_ledger (100+10=110):
///   dust formula: 30 − 21 = 9 (not 3×3=9, but the remainder path is exercised)
#[test]
fn test_partial_then_dust_claim() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    // rate=3, cliff=5, total=10 → deposit=30, start=100, cliff=105, end=110
    let (token_id, _) = create_vesting_stream(&env, &client, &sponsor, &recipient, 3, 5, 10);

    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);

    // Advance to ledger 107 (past cliff, before end)
    advance_ledger(&env, 7);
    let first_claim = client.claim_vested(&recipient).unwrap();
    // (107 - 100) × 3 = 21
    assert_eq!(first_claim, 21);

    // Advance to end_ledger (ledger 110)
    advance_ledger(&env, 3);
    let dust_claim = client.claim_vested(&recipient).unwrap();
    // 30 − 21 = 9
    assert_eq!(dust_claim, 9);
    assert_eq!(token_client.balance(&recipient), 30, "recipient must hold full deposit");
    assert!(client.get_schedule(&recipient).is_none());
}

/// `claimable_amount` at end_ledger reports the full remainder, not rate × delta.
#[test]
fn test_claimable_amount_at_end_ledger_is_full_remainder() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    // rate=7, cliff=10, total=30 → deposit=210, start=100, end=130
    create_vesting_stream(&env, &client, &sponsor, &recipient, 7, 10, 30);

    // Claim 70 tokens at ledger 110 (10 ledgers × 7)
    advance_ledger(&env, 10);
    client.claim_vested(&recipient).unwrap();

    // Advance to end_ledger
    advance_ledger(&env, 20);
    let claimable = client.claimable_amount(&recipient);
    // Remaining = 210 − 70 = 140
    assert_eq!(claimable, 140);
}

/// Past end_ledger: claimable amount is still the remaining balance, not zero.
#[test]
fn test_claimable_amount_past_end_ledger() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    // rate=5, cliff=10, total=20 → deposit=100, end=120
    create_vesting_stream(&env, &client, &sponsor, &recipient, 5, 10, 20);

    // Skip past end_ledger by 500 ledgers without claiming
    advance_ledger(&env, 500);
    let claimable = client.claimable_amount(&recipient);
    assert_eq!(claimable, 100, "all 100 tokens still claimable past end_ledger");
}

/// Claiming past end_ledger returns the full deposit in one shot.
#[test]
fn test_claim_past_end_ledger_returns_full_deposit() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    // rate=10, cliff=50, total=200 → deposit=2000
    let (token_id, _) = create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);
    advance_ledger(&env, 500);

    let claimed = client.claim_vested(&recipient).unwrap();
    assert_eq!(claimed, 2_000);
    assert_eq!(token_client.balance(&recipient), 2_000);
    assert!(client.get_schedule(&recipient).is_none());
}

/// No tokens remain in contract after a fully claimed expired stream.
#[test]
fn test_no_tokens_remain_after_full_claim() {
    let env = setup_env();
    let (contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = create_vesting_stream(&env, &client, &sponsor, &recipient, 11, 10, 50);

    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);

    // Advance to end_ledger and claim
    advance_ledger(&env, 50);
    client.claim_vested(&recipient).unwrap();

    // Contract must hold zero tokens for this stream
    assert_eq!(token_client.balance(&contract_id), 0);
}

/// `claimed_amount` field is incremented correctly across multiple claims.
#[test]
fn test_claimed_amount_tracking() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    // rate=10, cliff=10, total=40 → deposit=400
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 10, 40);

    // Claim at cliff (ledger 110): 10 ledgers × 10 = 100
    advance_ledger(&env, 10);
    client.claim_vested(&recipient).unwrap();
    let sched = client.get_schedule(&recipient).unwrap();
    assert_eq!(sched.claimed_amount, 100);
    assert_eq!(sched.total_claimed, 100);

    // Claim at ledger 120: 10 more ledgers × 10 = 100
    advance_ledger(&env, 10);
    client.claim_vested(&recipient).unwrap();
    let sched = client.get_schedule(&recipient).unwrap();
    assert_eq!(sched.claimed_amount, 200);
}
