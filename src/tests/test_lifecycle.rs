//! Full stream lifecycle integration test (issue #1051).
//!
//! Drives a single stream through its complete life using the Soroban test
//! environment: create -> cliff passage -> claim -> mid-stream partial claim
//! -> end-of-stream claim -> exhaustion.
//!
//! # Acceptance criteria covered
//! 1. Create a stream, advance to the cliff, verify claimable == rate × cliff.
//! 2. Claim at the cliff, verify amount == rate × cliff_duration.
//! 3. Advance to mid-stream, claim partial, verify remaining.
//! 4. Advance to end_ledger, claim remainder, verify stream exhausted.
//! 5. Verify `NothingToClaim` after the stream is fully claimed.

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, token::TokenClient, Address};

use crate::{
    error::VestingError,
    tests::{advance_ledger, register_contract, setup_env, setup_token},
    types::RATE_DECIMALS,
};

/// Drives a stream through create -> cliff -> claim -> mid -> end -> exhausted.
#[test]
fn test_lifecycle_create_cliff_claim_complete() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);

    // Rate of 10 tokens/ledger (scaled by RATE_DECIMALS), cliff 50, total 200.
    let rate_per_ledger: i128 = RATE_DECIMALS * 10;
    let cliff_duration: u32 = 50;
    let total_duration: u32 = 200;
    let total_deposit: i128 = 10 * total_duration as i128; // 2_000

    let (token_id, _) = setup_token(&env, &sponsor, total_deposit);
    let tc = TokenClient::new(&env, &token_id);

    let start_ledger = env.ledger().sequence(); // 100
    let cliff_ledger = start_ledger + cliff_duration;
    let end_ledger = start_ledger + total_duration;

    client.create_vesting_stream(
        &sponsor,
        &recipient,
        &token_id,
        &rate_per_ledger,
        &cliff_duration,
        &total_duration,
        &None,
    );

    let schedule = client.get_schedule(&recipient).expect("schedule must exist");
    assert_eq!(schedule.start_ledger, start_ledger);
    assert_eq!(schedule.cliff_ledger, cliff_ledger);
    assert_eq!(schedule.end_ledger, end_ledger);

    // ── 1. Advance to cliff, verify claimable == rate × cliff_duration ─────────
    advance_ledger(&env, cliff_duration);
    assert_eq!(env.ledger().sequence(), cliff_ledger);

    let expected_at_cliff: i128 = 10 * cliff_duration as i128; // 500
    assert_eq!(
        client.claimable_amount(&recipient),
        expected_at_cliff,
        "claimable at cliff should equal rate × cliff_duration"
    );

    // ── 2. Claim at cliff ──────────────────────────────────────────────────────
    let claimed_at_cliff = client.claim_vested(&recipient);
    assert_eq!(claimed_at_cliff, expected_at_cliff);
    assert_eq!(tc.balance(&recipient), expected_at_cliff);
    assert_eq!(client.claimable_amount(&recipient), 0);

    // ── 3. Mid-stream partial claim, verify remaining ─────────────────────────
    let post_cliff: u32 = total_duration - cliff_duration; // 150
    let half: u32 = post_cliff / 2; // 75
    advance_ledger(&env, half);

    let expected_mid: i128 = 10 * half as i128; // 750
    assert_eq!(client.claimable_amount(&recipient), expected_mid);

    let claimed_mid = client.claim_vested(&recipient);
    assert_eq!(claimed_mid, expected_mid);
    assert_eq!(client.claimable_amount(&recipient), 0);

    // ── 4. Advance to end_ledger, claim remainder, verify exhausted ────────────
    advance_ledger(&env, post_cliff - half); // sequence == end_ledger
    assert_eq!(env.ledger().sequence(), end_ledger);

    let expected_remaining: i128 = total_deposit - (expected_at_cliff + expected_mid);
    assert_eq!(client.claimable_amount(&recipient), expected_remaining);

    let claimed_remainder = client.claim_vested(&recipient);
    assert_eq!(claimed_remainder, expected_remainder);
    assert_eq!(tc.balance(&recipient), total_deposit);
    assert_eq!(client.claimable_amount(&recipient), 0);

    // ── 5. NothingToClaim after the stream is fully claimed ───────────────────
    let err = client.claim_vested(&recipient).unwrap_err();
    assert_eq!(err, VestingError::NothingToClaim.into());
}
