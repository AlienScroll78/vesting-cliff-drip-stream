//! Property-based tests for `claimable_amount` calculation.
//!
//! Verifies five mathematical invariants across arbitrarily generated schedule
//! configurations and ledger positions using `proptest`.
//!
//! ## Properties (issue #778)
//!
//! 1. **Monotonicity**          – `claimable_amount(t+1) >= claimable_amount(t)`.
//! 2. **Pre-cliff zero**        – `claimable_amount(t) == 0` for all `t < cliff_ledger`.
//! 3. **Post-cliff continuity** – `claimable_amount(cliff_ledger) == rate * (cliff_ledger − start_ledger)`.
//! 4. **Bounded**               – `claimable_amount(t) <= rate * total_duration` for all `t`.
//! 5. **Claim idempotency**     – Claiming twice at the same ledger returns `0` on the second call.
//!
//! Each property runs **10 000 cases**.

#![cfg(test)]

extern crate std;

use proptest::prelude::*;
use soroban_sdk::testutils::Address as _;

use super::token_helper::{create_token, mint_to};
use crate::{
    contract::{VestingDrips, VestingDripsClient},
    tests::{advance_ledger, setup_env},
};

// ── Shared helpers ────────────────────────────────────────────────────────────

/// Returns a freshly registered, initialised contract client.
///
/// Uses zero protocol fee so stream creation never fails due to fee config.
fn make_client(env: &soroban_sdk::Env) -> VestingDripsClient {
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(env, &contract_id);
    let admin = soroban_sdk::Address::generate(env);
    let treasury = soroban_sdk::Address::generate(env);
    client.initialize(&admin, &0u32, &treasury);
    client
}

/// Creates a fixed-rate stream, minting `rate * total_duration` tokens to
/// `sponsor`.  Returns `(sponsor, recipient, token_client)`.
fn setup_stream<'e>(
    env: &'e soroban_sdk::Env,
    client: &VestingDripsClient<'e>,
    rate: i128,
    cliff: u32,
    total: u32,
) -> (
    soroban_sdk::Address,
    soroban_sdk::Address,
    soroban_sdk::token::TokenClient<'e>,
) {
    let sponsor = soroban_sdk::Address::generate(env);
    let recipient = soroban_sdk::Address::generate(env);
    let (token_id, token_client) = create_token(env, &sponsor);
    let deposit = rate * total as i128;
    mint_to(env, &token_id, &sponsor, deposit);
    client.create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &cliff, &total, &None);
    (sponsor, recipient, token_client)
}

// ── Property 1: Monotonicity ──────────────────────────────────────────────────
//
// claimable_amount must be non-decreasing over time when no claims are made.
// We verify by comparing two independent envs: one advanced to offset `a`,
// the other to offset `b >= a`.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    /// `claimable_amount(t) <= claimable_amount(t + delta)` for any `delta >= 0`.
    #[test]
    fn prop_monotonicity(
        rate    in 1_i128..=10_000_i128,
        cliff   in 1_u32..=100_u32,
        total   in 2_u32..=1_000_u32,
        offset_a in 0_u32..=500_u32,
        offset_b in 0_u32..=500_u32,
    ) {
        // Structural constraints.
        prop_assume!(total > cliff);
        // cliff / total < 80 % (MAX_CLIFF_RATIO).
        prop_assume!((cliff as u64 * 100) < (total as u64 * 80));
        // Minimum deposit: rate * total >= 100.
        prop_assume!(rate * total as i128 >= 100);
        // Cap offsets within stream lifetime to keep the comparison meaningful.
        let offset_a = offset_a.min(total);
        let offset_b = offset_b.min(total);
        // Ensure a <= b.
        let (a, b) = if offset_a <= offset_b {
            (offset_a, offset_b)
        } else {
            (offset_b, offset_a)
        };

        let env_a = setup_env();
        let client_a = make_client(&env_a);
        let (_, recipient_a, _) = setup_stream(&env_a, &client_a, rate, cliff, total);
        advance_ledger(&env_a, a);
        let claimable_a = client_a.claimable_amount(&recipient_a);

        let env_b = setup_env();
        let client_b = make_client(&env_b);
        let (_, recipient_b, _) = setup_stream(&env_b, &client_b, rate, cliff, total);
        advance_ledger(&env_b, b);
        let claimable_b = client_b.claimable_amount(&recipient_b);

        prop_assert!(
            claimable_a <= claimable_b,
            "monotonicity violated: claimable({a})={claimable_a} > claimable({b})={claimable_b} \
             (rate={rate}, cliff={cliff}, total={total})"
        );
    }
}

// ── Property 2: Pre-cliff zero ────────────────────────────────────────────────
//
// For any ledger strictly before cliff_ledger, claimable_amount must return 0.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    /// `claimable_amount(t) == 0` for all `t < cliff_ledger`.
    #[test]
    fn prop_pre_cliff_zero(
        rate              in 1_i128..=10_000_i128,
        cliff             in 2_u32..=200_u32,
        total             in 3_u32..=1_000_u32,
        ledgers_before    in 1_u32..=100_u32,
    ) {
        prop_assume!(total > cliff);
        prop_assume!((cliff as u64 * 100) < (total as u64 * 80));
        prop_assume!(rate * total as i128 >= 100);
        // Must stay strictly before the cliff.
        prop_assume!(ledgers_before < cliff);

        let env = setup_env(); // sequence = 100; stream starts at ledger 100
        let client = make_client(&env);
        let (_, recipient, _) = setup_stream(&env, &client, rate, cliff, total);

        // Advance to (cliff − ledgers_before), which is strictly before cliff_ledger.
        let advance = cliff - ledgers_before;
        advance_ledger(&env, advance);

        let claimable = client.claimable_amount(&recipient);
        prop_assert_eq!(
            claimable,
            0_i128,
            "pre-cliff claimable must be 0 at offset {advance} \
             (cliff={cliff}, rate={rate}, total={total}), got {claimable}"
        );
    }
}

// ── Property 3: Post-cliff continuity ────────────────────────────────────────
//
// At exactly cliff_ledger the instant catch-up must equal rate * cliff_duration.
// start_ledger = 100 (setup_env), cliff_ledger = 100 + cliff.
// last_claimed_ledger is initialised to start_ledger, so:
//   expected = (cliff_ledger − start_ledger) * rate = cliff * rate.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    /// `claimable_amount(cliff_ledger) == rate * (cliff_ledger − start_ledger)`.
    #[test]
    fn prop_post_cliff_continuity(
        rate  in 1_i128..=10_000_i128,
        cliff in 1_u32..=200_u32,
        total in 2_u32..=1_000_u32,
    ) {
        prop_assume!(total > cliff);
        prop_assume!((cliff as u64 * 100) < (total as u64 * 80));
        prop_assume!(rate * total as i128 >= 100);

        let env = setup_env(); // start_ledger = 100
        let client = make_client(&env);
        let (_, recipient, _) = setup_stream(&env, &client, rate, cliff, total);

        // Advance exactly to the cliff.
        advance_ledger(&env, cliff);

        let claimable = client.claimable_amount(&recipient);
        // cliff_ledger − start_ledger = cliff (we advanced exactly `cliff` ledgers).
        let expected = cliff as i128 * rate;
        prop_assert_eq!(
            claimable,
            expected,
            "post-cliff continuity: claimable={claimable}, expected rate*cliff={expected} \
             (rate={rate}, cliff={cliff}, total={total})"
        );
    }
}

// ── Property 4: Bounded ───────────────────────────────────────────────────────
//
// claimable_amount must never exceed the total deposit (rate * total_duration)
// regardless of the current ledger position.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    /// `claimable_amount(t) <= rate * total_duration` for all `t`.
    #[test]
    fn prop_bounded(
        rate   in 1_i128..=10_000_i128,
        cliff  in 1_u32..=200_u32,
        total  in 2_u32..=1_000_u32,
        offset in 0_u32..=2_000_u32,
    ) {
        prop_assume!(total > cliff);
        prop_assume!((cliff as u64 * 100) < (total as u64 * 80));
        prop_assume!(rate * total as i128 >= 100);

        let env = setup_env();
        let client = make_client(&env);
        let (_, recipient, _) = setup_stream(&env, &client, rate, cliff, total);

        advance_ledger(&env, offset);

        let claimable = client.claimable_amount(&recipient);
        let upper_bound = rate * total as i128;

        prop_assert!(
            claimable <= upper_bound,
            "bounded invariant violated: claimable={claimable} > rate*total={upper_bound} \
             (rate={rate}, cliff={cliff}, total={total}, offset={offset})"
        );
    }
}

// ── Property 5: Claim idempotency ─────────────────────────────────────────────
//
// Calling claim_vested twice in the same ledger: the second call must return 0
// (or NothingToClaim).  The recipient's token balance must not change between
// the two calls.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    /// Claiming twice at the same ledger yields `0` on the second call.
    #[test]
    fn prop_claim_idempotency(
        rate  in 1_i128..=10_000_i128,
        cliff in 1_u32..=200_u32,
        total in 2_u32..=1_000_u32,
        extra in 0_u32..=500_u32,
    ) {
        prop_assume!(total > cliff);
        prop_assume!((cliff as u64 * 100) < (total as u64 * 80));
        prop_assume!(rate * total as i128 >= 100);
        // Advance to cliff + extra, capped just before end so stream is still alive.
        let advance_to = cliff.saturating_add(extra).min(total - 1);
        prop_assume!(advance_to >= cliff);

        let env = setup_env();
        let client = make_client(&env);
        let (_, recipient, token_client) = setup_stream(&env, &client, rate, cliff, total);

        // Advance to a ledger at or past the cliff.
        advance_ledger(&env, advance_to);

        // First claim.
        let _ = client.try_claim_vested(&recipient);

        // Record balance after the first claim.
        let balance_after_first = token_client.balance(&recipient);

        // Second claim in the same ledger — must not transfer any tokens.
        let second_amount = match client.try_claim_vested(&recipient) {
            Ok(Ok(amount)) => amount,
            _ => 0,
        };

        let balance_after_second = token_client.balance(&recipient);

        prop_assert_eq!(
            second_amount,
            0_i128,
            "idempotency: second claim returned {second_amount} != 0 \
             (rate={rate}, cliff={cliff}, total={total}, advance_to={advance_to})"
        );
        prop_assert_eq!(
            balance_after_second,
            balance_after_first,
            "idempotency: balance changed after second claim \
             (before={balance_after_first}, after={balance_after_second})"
        );
    }
}
