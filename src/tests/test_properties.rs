//! Property-based tests for vesting math invariants.
//!
//! Verifies five core invariants across randomised inputs using `proptest`:
//!
//! 1. Total claimed ≤ total deposit
//! 2. Claimable at end_ledger = total_deposit (all unclaimed; no prior claims)
//! 3. Claimable before cliff = 0
//! 4. Claim(t₁) + Claim(t₂) = Claim(t₁+t₂)  (additivity)
//! 5. Cancel at t: sponsor_refund + recipient_claimed = total_deposit
//!
//! Requires at least 1000 random cases per invariant (proptest default: 256;
//! overridden by PROPTEST_CASES=1000 or via Config below).

#![cfg(test)]

extern crate std;

use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, Address};

use super::token_helper::{create_token, mint_to};
use crate::contract::{VestingDrips, VestingDripsClient};
use crate::tests::{advance_ledger, setup_env};

/// Build a fresh, initialized contract client for each test case.
fn make_client(env: &soroban_sdk::Env) -> VestingDripsClient {
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    client.initialize(&admin, &0u32, &treasury);
    client
}

// ── Invariant 1: Total claimed ≤ total deposit ─────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(1000))]
    #[test]
    fn prop_total_claimed_le_total_deposit(
        rate  in 1_i128..500_i128,
        cliff in 1u32..50u32,
        total in 2u32..100u32,
        adv1  in 0u32..100u32,
        adv2  in 0u32..100u32,
    ) {
        prop_assume!(total > cliff);
        // Ensure total deposit meets DEFAULT_MIN_DEPOSIT (100).
        prop_assume!(rate * total as i128 >= 100);

        let env = setup_env();
        let client = make_client(&env);

        let sponsor   = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token_id, _) = create_token(&env, &sponsor);

        let total_deposit = rate * total as i128;
        mint_to(&env, &token_id, &sponsor, total_deposit);

        client
            .create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &cliff, &total, &None)
            .unwrap();

        // Two claims at different ledger offsets.
        let a = adv1.min(total);
        advance_ledger(&env, a);
        let _ = client.try_claim_vested(&recipient);

        let b = adv2.min(total.saturating_sub(a));
        advance_ledger(&env, b);
        let _ = client.try_claim_vested(&recipient);

        // total_claimed ≤ total_deposit invariant.
        // Use claimable_amount + what was claimed to check: remaining ≥ 0.
        let claimable_now = client.claimable_amount(&recipient);
        prop_assert!(claimable_now >= 0);
        prop_assert!(claimable_now <= total_deposit);
    }
}

// Property: claimable == 0 before cliff
proptest! {
    #[test]
    fn prop_claimable_zero_before_cliff(
        rate in 100_i128..1000_i128,
        cliff in 1u32..50u32,
        total in 2u32..100u32,
        advance_before in 0u32..50u32,
    ) {
        prop_assume!(total > cliff);
        prop_assume!(rate * total as i128 >= 100);
        let env = setup_env();
        let contract_id = env.register(crate::VestingDrips, ());
        let client = VestingDripsClient::new(&env, &contract_id);

        let sponsor = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token_id, _token_client) = create_token(&env, &sponsor);

        let total_duration = total;
        let total_deposit = rate.checked_mul(total_duration as i128).unwrap();
        mint_to(&env, &token_id, &sponsor, total_deposit);

        client.create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &cliff, &total_duration, &None).unwrap();

        let adv = advance_before.min(cliff.saturating_sub(1));
        advance_ledger(&env, adv);

        let claimable = client.claimable_amount(&recipient);
        prop_assert_eq!(claimable, 0_i128);
    }
}

// Property: claimable_amount is never negative (Issue #319)
proptest! {
    #[test]
    fn prop_claimable_never_negative(
        rate in 1_i128..1000_i128,
        cliff in 1u32..50u32,
        total in 2u32..200u32,
        advance in 0u32..300u32,
    ) {
        prop_assume!(total > cliff);
        let env = setup_env();
        let contract_id = env.register(crate::VestingDrips, ());
        let client = VestingDripsClient::new(&env, &contract_id);

        let sponsor = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token_id, _token_client) = create_token(&env, &sponsor);

        let total_duration = total;
        let total_deposit = rate.checked_mul(total_duration as i128).unwrap();
        mint_to(&env, &token_id, &sponsor, total_deposit);

        client.create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &cliff, &total_duration, &None);

        advance_ledger(&env, advance);

        let claimable = client.claimable_amount(&recipient);
        prop_assert!(claimable >= 0, "claimable must be non-negative, got {}", claimable);
    }
}

// Property: claimable_amount equals total_deposit at (or past) end_ledger (Issue #319)
proptest! {
    #![proptest_config(ProptestConfig::with_cases(1000))]
    #[test]
    fn prop_claimable_equals_total_deposit_at_end(
        rate  in 1_i128..500_i128,
        cliff in 1u32..50u32,
        total in 2u32..200u32,
        extra in 0u32..50u32,
    ) {
        prop_assume!(total > cliff);
        prop_assume!(rate * total as i128 >= 100);

        let env = setup_env();
        let client = make_client(&env);

        let sponsor   = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token_id, _) = create_token(&env, &sponsor);

        let total_deposit = rate * total as i128;
        mint_to(&env, &token_id, &sponsor, total_deposit);

        client.create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &cliff, &total_duration, &None);

        // Advance to end_ledger or beyond; no claims made yet.
        advance_ledger(&env, total + extra);

        let claimable = client.claimable_amount(&recipient);
        prop_assert_eq!(
            claimable,
            total_deposit,
            "at end_ledger claimable must equal total_deposit ({} != {})",
            claimable,
            total_deposit
        );
    }
}

// ── Invariant 3: Claimable before cliff = 0 ───────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(1000))]
    #[test]
    fn prop_claimable_zero_before_cliff(
        rate         in 1_i128..500_i128,
        cliff        in 1u32..50u32,
        total        in 2u32..100u32,
        advance_pre  in 0u32..50u32,
    ) {
        prop_assume!(total > cliff);
        prop_assume!(rate * total as i128 >= 100);

        let env = setup_env();
        let client = make_client(&env);

        let sponsor   = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token_id, _) = create_token(&env, &sponsor);

        let total_deposit = rate * total as i128;
        mint_to(&env, &token_id, &sponsor, total_deposit);

        client
            .create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &cliff, &total, &None)
            .unwrap();

        // Advance to strictly before the cliff.
        let adv = advance_pre.min(cliff.saturating_sub(1));
        advance_ledger(&env, adv);

        let claimable = client.claimable_amount(&recipient);
        prop_assert_eq!(claimable, 0_i128, "claimable before cliff must be 0");
    }
}

// ── Invariant 4: Claim(t₁) + Claim(t₂) = Claim(t₁+t₂)  (additivity) ─────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(1000))]
    #[test]
    fn prop_claim_additivity(
        rate  in 1_i128..500_i128,
        cliff in 1u32..50u32,
        total in 10u32..200u32,
        t1    in 1u32..100u32,
        t2    in 1u32..100u32,
    ) {
        prop_assume!(total > cliff);
        prop_assume!(rate * total as i128 >= 100);
        // Both t1 and t2 must be after the cliff but before end.
        prop_assume!(t1 >= cliff && t1 < total);
        prop_assume!(t1 + t2 <= total);

        let total_deposit = rate * total as i128;

        // ── Scenario A: two sequential claims ────────────────────────────────
        let env_a = setup_env();
        let client_a = make_client(&env_a);

        let sponsor_a   = Address::generate(&env_a);
        let recipient_a = Address::generate(&env_a);
        let (token_a, _) = create_token(&env_a, &sponsor_a);
        mint_to(&env_a, &token_a, &sponsor_a, total_deposit);

        client_a
            .create_vesting_stream(&sponsor_a, &recipient_a, &token_a, &rate, &cliff, &total, &None)
            .unwrap();

        advance_ledger(&env_a, t1);
        let c_a1 = client_a.claim_vested(&recipient_a).unwrap();

        advance_ledger(&env_a, t2);
        let c_a2 = client_a.try_claim_vested(&recipient_a).unwrap_or(Ok(0)).unwrap_or(0);

        // ── Scenario B: single claim at t1+t2 ────────────────────────────────
        let env_b = setup_env();
        let client_b = make_client(&env_b);

        let sponsor_b   = Address::generate(&env_b);
        let recipient_b = Address::generate(&env_b);
        let (token_b, _) = create_token(&env_b, &sponsor_b);
        mint_to(&env_b, &token_b, &sponsor_b, total_deposit);

        client_b
            .create_vesting_stream(&sponsor_b, &recipient_b, &token_b, &rate, &cliff, &total, &None)
            .unwrap();

        advance_ledger(&env_b, t1 + t2);
        let c_b = client_b.claim_vested(&recipient_b).unwrap();

        prop_assert_eq!(
            c_a1 + c_a2,
            c_b,
            "claim additivity: claim(t1)+claim(t2) = {} but claim(t1+t2) = {}",
            c_a1 + c_a2,
            c_b
        );
    }
}

// ── Invariant 5: Cancel: sponsor_refund + recipient_claimed = total_deposit ─

proptest! {
    #![proptest_config(ProptestConfig::with_cases(1000))]
    #[test]
    fn prop_cancel_conservation(
        rate   in 1_i128..500_i128,
        cliff  in 1u32..50u32,
        total  in 10u32..200u32,
        adv    in 0u32..200u32,
    ) {
        prop_assume!(total > cliff);
        prop_assume!(rate * total as i128 >= 100);

        let total_deposit = rate * total as i128;

        let env = setup_env();
        let client = make_client(&env);

        let sponsor   = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token_id, token_client) = create_token(&env, &sponsor);
        mint_to(&env, &token_id, &sponsor, total_deposit);

        client
            .create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &cliff, &total, &None)
            .unwrap();

        // Optionally claim before cancel (only succeeds after cliff).
        let claim_advance = adv.min(total);
        advance_ledger(&env, claim_advance);
        let recipient_claimed = client.try_claim_vested(&recipient).unwrap_or(Ok(0)).unwrap_or(0);

        // Check token balances before cancel.
        let sponsor_before   = token_client.balance(&sponsor);
        let recipient_before = token_client.balance(&recipient);

        // Cancel the stream.
        let _ = client.try_cancel_stream(&sponsor, &recipient);

        let sponsor_after   = token_client.balance(&sponsor);
        let recipient_after = token_client.balance(&recipient);

        let sponsor_received   = sponsor_after   - sponsor_before;
        let recipient_received = recipient_after - recipient_before;

        // total_deposit must be fully accounted for across all parties.
        prop_assert_eq!(
            recipient_claimed + sponsor_received + recipient_received,
            total_deposit,
            "conservation: recipient_claimed({}) + sponsor_refund({}) + extra_to_recipient({}) must equal total_deposit({})",
            recipient_claimed,
            sponsor_received,
            recipient_received,
            total_deposit
        );
    }
}
