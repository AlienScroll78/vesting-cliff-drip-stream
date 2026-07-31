extern crate std;

use std::format;
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, Address};

use super::token_helper::{create_token, mint_to};
use crate::contract::VestingDripsClient;
use crate::tests::{advance_ledger, setup_env};

// Property: claimable never exceeds total deposit (rate * total_duration)
proptest! {
    #[test]
    fn prop_claimable_never_exceeds_total(
        rate in 100_i128..1000_i128,
        cliff in 1u32..50u32,
        total in 2u32..100u32,
        advance in 0u32..100u32,
    ) {
        prop_assume!(total > cliff);
        // Ensure total deposit >= DEFAULT_MIN_DEPOSIT (100)
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

        let adv = advance.min(total_duration);
        advance_ledger(&env, adv);

        let claimable = client.claimable_amount(&recipient);
        prop_assert!(claimable <= total_deposit);
    }
}

// Property: claimable is monotonic non-decreasing over time (without claiming)
proptest! {
    #[test]
    fn prop_claimable_monotonic(
        rate in 100_i128..1000_i128,
        cliff in 1u32..50u32,
        total in 2u32..100u32,
        t1 in 0u32..100u32,
        t2 in 0u32..100u32,
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

        let (a, b) = if t1 <= t2 { (t1.min(total_duration), t2.min(total_duration)) } else { (t2.min(total_duration), t1.min(total_duration)) };

        advance_ledger(&env, a);
        let c1 = client.claimable_amount(&recipient);

        advance_ledger(&env, b - a);
        let c2 = client.claimable_amount(&recipient);

        prop_assert!(c1 <= c2);
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

        client.create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &cliff, &total_duration);

        advance_ledger(&env, advance);

        let claimable = client.claimable_amount(&recipient);
        prop_assert!(claimable >= 0, "claimable must be non-negative, got {}", claimable);
    }
}

// Property: claimable_amount equals total_deposit at (or past) end_ledger (Issue #319)
proptest! {
    #[test]
    fn prop_claimable_equals_total_deposit_at_end(
        rate in 1_i128..1000_i128,
        cliff in 1u32..50u32,
        total in 2u32..200u32,
        extra in 0u32..50u32,
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

        client.create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &cliff, &total_duration);

        // Advance to end_ledger (or beyond) — no claims made yet so the full
        // deposit should be claimable.
        advance_ledger(&env, total_duration + extra);

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
