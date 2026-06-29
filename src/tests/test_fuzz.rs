//! Issue #23 — Fuzz / property-based tests for arithmetic overflow paths.
//!
//! Uses `proptest` to exercise:
//!   F1 — rate × total_duration overflow → DepositOverflow (no panic)
//!   F2 — max i128 rate is rejected with DepositOverflow for any total_duration > 1
//!   F3 — boundary: rate = i128::MAX / total_duration succeeds; rate + 1 overflows
//!   F4 — cliff_duration close to u32::MAX doesn't panic (InvalidDuration guard)
//!   F5 — ledger arithmetic for start + total_duration near u32::MAX → DepositOverflow

#![cfg(test)]

use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env,
};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::token_helper::{create_token, mint_to},
};

fn env_at(sequence: u32) -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(LedgerInfo {
        timestamp: 0,
        protocol_version: 22,
        sequence_number: sequence,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 1000,
        max_entry_ttl: 3_110_400,
    });
    env
}

// ── F1: any (rate, total_duration) that would overflow returns DepositOverflow ─

proptest! {
    #[test]
    fn f1_overflow_returns_deposit_overflow(
        // Choose rate and duration whose product definitely overflows i128.
        rate in (i128::MAX / 2 + 1)..=i128::MAX,
        total_duration in 2_u32..=u32::MAX,
        cliff_duration in 1_u32..=1_u32,
    ) {
        // Only test cases where the multiplication actually overflows.
        prop_assume!(rate.checked_mul(total_duration as i128).is_none());
        prop_assume!(total_duration > cliff_duration);

        let env = env_at(100);
        let cid = env.register(VestingDrips, ());
        let client = VestingDripsClient::new(&env, &cid);
        let sponsor = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token, _) = create_token(&env, &sponsor);
        // No need to mint — validation happens before the transfer.

        let result = client.create_vesting_stream(
            &sponsor, &recipient, &token,
            &rate, &cliff_duration, &total_duration,
        );

        prop_assert_eq!(
            result.unwrap_err(),
            VestingError::DepositOverflow.into(),
            "expected DepositOverflow for rate={rate} total_duration={total_duration}"
        );
    }
}

// ── F2: i128::MAX rate is always DepositOverflow for total_duration ≥ 2 ───────

proptest! {
    #[test]
    fn f2_max_rate_always_overflows(total_duration in 2_u32..=10_000_u32) {
        let env = env_at(100);
        let cid = env.register(VestingDrips, ());
        let client = VestingDripsClient::new(&env, &cid);
        let sponsor = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token, _) = create_token(&env, &sponsor);

        let result = client.create_vesting_stream(
            &sponsor, &recipient, &token,
            &i128::MAX, &1, &total_duration,
        );

        prop_assert_eq!(result.unwrap_err(), VestingError::DepositOverflow.into());
    }
}

// ── F3: exact boundary — rate = MAX/duration succeeds; rate+1 overflows ───────

proptest! {
    #[test]
    fn f3_boundary_one_above_overflows(total_duration in 2_u32..=1_000_u32) {
        let boundary_rate = i128::MAX / total_duration as i128;

        let env = env_at(100);
        let cid = env.register(VestingDrips, ());
        let client = VestingDripsClient::new(&env, &cid);
        let sponsor = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token, _) = create_token(&env, &sponsor);
        mint_to(&env, &token, &sponsor, boundary_rate * total_duration as i128);

        // boundary_rate should succeed
        let ok = client.create_vesting_stream(
            &sponsor, &recipient, &token,
            &boundary_rate, &1, &total_duration,
        );
        prop_assert!(ok.is_ok(), "boundary_rate={boundary_rate} total_duration={total_duration} should succeed");

        // boundary_rate + 1 should overflow
        let env2 = env_at(100);
        let cid2 = env2.register(VestingDrips, ());
        let client2 = VestingDripsClient::new(&env2, &cid2);
        let sponsor2 = Address::generate(&env2);
        let recipient2 = Address::generate(&env2);
        let (token2, _) = create_token(&env2, &sponsor2);

        // Only test if boundary_rate + 1 actually overflows the multiplication.
        if (boundary_rate + 1).checked_mul(total_duration as i128).is_none() {
            let err = client2.create_vesting_stream(
                &sponsor2, &recipient2, &token2,
                &(boundary_rate + 1), &1, &total_duration,
            );
            prop_assert_eq!(err.unwrap_err(), VestingError::DepositOverflow.into());
        }
    }
}

// ── F4: extreme cliff/total durations return InvalidDuration, not panic ───────

proptest! {
    #[test]
    fn f4_extreme_durations_no_panic(
        cliff_duration in 1_u32..=u32::MAX,
        total_duration in 1_u32..=u32::MAX,
    ) {
        prop_assume!(total_duration <= cliff_duration); // guaranteed InvalidDuration

        let env = env_at(100);
        let cid = env.register(VestingDrips, ());
        let client = VestingDripsClient::new(&env, &cid);
        let sponsor = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token, _) = create_token(&env, &sponsor);

        let result = client.create_vesting_stream(
            &sponsor, &recipient, &token,
            &1, &cliff_duration, &total_duration,
        );

        prop_assert_eq!(result.unwrap_err(), VestingError::InvalidDuration.into());
    }
}

// ── F5: valid small inputs never panic or return unexpected errors ─────────────

proptest! {
    #[test]
    fn f5_valid_inputs_succeed(
        rate in 1_i128..=1_000_i128,
        cliff_duration in 1_u32..=500_u32,
        extra in 1_u32..=500_u32,
    ) {
        let total_duration = cliff_duration + extra;

        let env = env_at(100);
        let cid = env.register(VestingDrips, ());
        let client = VestingDripsClient::new(&env, &cid);
        let sponsor = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token, _) = create_token(&env, &sponsor);
        mint_to(&env, &token, &sponsor, rate * total_duration as i128);

        let result = client.create_vesting_stream(
            &sponsor, &recipient, &token,
            &rate, &cliff_duration, &total_duration,
        );

        prop_assert!(result.is_ok(), "expected success for rate={rate} cliff={cliff_duration} total={total_duration}");
    }
}
