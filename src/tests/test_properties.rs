#![cfg(test)]

use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::contract::VestingDripsClient;
use crate::tests::{advance_ledger, setup_env};
use super::token_helper::{create_token, mint_to};

// Property: claimable never exceeds total deposit (rate * total_duration)
proptest! {
    #[test]
    fn prop_claimable_never_exceeds_total(
        rate in 1_i128..1000_i128,
        cliff in 1u32..50u32,
        total in 2u32..200u32,
        advance in 0u32..200u32,
    ) {
        prop_assume!(total > cliff);
        let env = setup_env();
        let contract_id = env.register(crate::VestingDrips, ());
        let client = VestingDripsClient::new(&env, &contract_id);

        let sponsor = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token_id, _token_client) = create_token(&env, &sponsor);

        let total_duration = total;
        // mint enough to cover total deposit
        let total_deposit = rate.checked_mul(total_duration as i128).unwrap();
        mint_to(&env, &token_id, &sponsor, total_deposit);

        client.create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &cliff, &total_duration).unwrap();

        // advance ledger by `advance` but cap at total_duration (we only care up to end)
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
        rate in 1_i128..1000_i128,
        cliff in 1u32..50u32,
        total in 2u32..200u32,
        t1 in 0u32..200u32,
        t2 in 0u32..200u32,
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

        client.create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &cliff, &total_duration).unwrap();

        // choose times relative to start; ensure t1 <= t2 by swapping when necessary
        let (a, b) = if t1 <= t2 { (t1.min(total_duration), t2.min(total_duration)) } else { (t2.min(total_duration), t1.min(total_duration)) };

        advance_ledger(&env, a);
        let c1 = client.claimable_amount(&recipient);

        // advance remaining difference
        advance_ledger(&env, b - a);
        let c2 = client.claimable_amount(&recipient);

        prop_assert!(c1 <= c2);
    }
}

// Property: claimable == 0 before cliff
proptest! {
    #[test]
    fn prop_claimable_zero_before_cliff(
        rate in 1_i128..1000_i128,
        cliff in 1u32..50u32,
        total in 2u32..200u32,
        advance_before in 0u32..50u32,
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

        client.create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &cliff, &total_duration).unwrap();

        // ensure we advance to somewhere strictly before the cliff
        let adv = advance_before.min(cliff.saturating_sub(1));
        advance_ledger(&env, adv);

        let claimable = client.claimable_amount(&recipient);
        prop_assert_eq!(claimable, 0_i128);
    }
}
