//! Property-based tests for `claimable_amount` accrual invariants.
//!
//! Properties verified:
//!   P1 — claimable_amount never exceeds the total deposit
//!   P2 — claimable_amount is 0 for any ledger before the cliff
//!   P3 — claimable_amount is monotonically non-decreasing over time
//!   P4 — sum of all claims equals exactly the total deposit

#![cfg(test)]

use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env,
};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    tests::token_helper::{create_token, mint_to},
};

// ── Test environment helpers ─────────────────────────────────────────────────

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

fn set_ledger(env: &Env, sequence: u32) {
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
}

// ── Strategy helpers ─────────────────────────────────────────────────────────

/// Generates (rate, cliff_duration, total_duration) with total > cliff and rate > 0.
fn stream_params() -> impl Strategy<Value = (i128, u32, u32)> {
    (1_i128..=1_000_i128, 1_u32..=500_u32, 1_u32..=500_u32).prop_map(
        |(rate, cliff, extra)| (rate, cliff, cliff + extra), // total = cliff + extra > cliff
    )
}

// ── P1: claimable_amount never exceeds total deposit ────────────────────────

proptest! {
    #[test]
    fn p1_claimable_never_exceeds_deposit(
        (rate, cliff_duration, total_duration) in stream_params(),
        ledger_offset in 0_u32..=1000_u32,
    ) {
        let start: u32 = 100;
        let env = env_at(start);
        let cid = env.register(VestingDrips, ());
        let client = VestingDripsClient::new(&env, &cid);
        let sponsor = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token, _) = create_token(&env, &sponsor);

        let total_deposit = rate * total_duration as i128;
        mint_to(&env, &token, &sponsor, total_deposit);
        client
            .create_vesting_stream(
                &sponsor, &recipient, &token,
                &rate, &cliff_duration, &total_duration,
            )
            .unwrap();

        set_ledger(&env, start + ledger_offset);
        let claimable = client.claimable_amount(&recipient);

        prop_assert!(
            claimable >= 0 && claimable <= total_deposit,
            "claimable={claimable} exceeded deposit={total_deposit}"
        );
    }
}

// ── P2: claimable_amount is 0 before the cliff ──────────────────────────────

proptest! {
    #[test]
    fn p2_claimable_is_zero_before_cliff(
        (rate, cliff_duration, total_duration) in stream_params(),
        // ledger offset strictly less than cliff_duration → still before cliff
        pre_cliff_offset in 0_u32..=499_u32,
    ) {
        let start: u32 = 100;
        // Only run when offset is actually before the cliff
        prop_assume!(pre_cliff_offset < cliff_duration);

        let env = env_at(start);
        let cid = env.register(VestingDrips, ());
        let client = VestingDripsClient::new(&env, &cid);
        let sponsor = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token, _) = create_token(&env, &sponsor);

        mint_to(&env, &token, &sponsor, rate * total_duration as i128);
        client
            .create_vesting_stream(
                &sponsor, &recipient, &token,
                &rate, &cliff_duration, &total_duration,
            )
            .unwrap();

        set_ledger(&env, start + pre_cliff_offset);
        prop_assert_eq!(
            client.claimable_amount(&recipient),
            0,
            "expected 0 before cliff at offset {pre_cliff_offset} (cliff_duration={cliff_duration})"
        );
    }
}

// ── P3: claimable_amount is monotonically non-decreasing ────────────────────

proptest! {
    #[test]
    fn p3_claimable_monotonically_non_decreasing(
        (rate, cliff_duration, total_duration) in stream_params(),
        t1_offset in 0_u32..=600_u32,
        t2_extra in 0_u32..=200_u32,
    ) {
        let start: u32 = 100;
        let env = env_at(start);
        let cid = env.register(VestingDrips, ());
        let client = VestingDripsClient::new(&env, &cid);
        let sponsor = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token, _) = create_token(&env, &sponsor);

        mint_to(&env, &token, &sponsor, rate * total_duration as i128);
        client
            .create_vesting_stream(
                &sponsor, &recipient, &token,
                &rate, &cliff_duration, &total_duration,
            )
            .unwrap();

        set_ledger(&env, start + t1_offset);
        let claimable_t1 = client.claimable_amount(&recipient);

        set_ledger(&env, start + t1_offset + t2_extra);
        let claimable_t2 = client.claimable_amount(&recipient);

        prop_assert!(
            claimable_t2 >= claimable_t1,
            "claimable decreased: t1={claimable_t1} t2={claimable_t2} at offsets {t1_offset}+{t2_extra}"
        );
    }
}

// ── P4: sum of all incremental claims equals total deposit ──────────────────

proptest! {
    #[test]
    fn p4_sum_of_claims_equals_total_deposit(
        (rate, cliff_duration, total_duration) in stream_params(),
    ) {
        let start: u32 = 100;
        let env = env_at(start);
        let cid = env.register(VestingDrips, ());
        let client = VestingDripsClient::new(&env, &cid);
        let sponsor = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token, token_client) = create_token(&env, &sponsor);

        let total_deposit = rate * total_duration as i128;
        mint_to(&env, &token, &sponsor, total_deposit);
        client
            .create_vesting_stream(
                &sponsor, &recipient, &token,
                &rate, &cliff_duration, &total_duration,
            )
            .unwrap();

        // Claim at cliff, midpoint, and past end — three passes covering the full stream.
        let cliff_ledger = start + cliff_duration;
        let mid_ledger = cliff_ledger + (total_duration - cliff_duration) / 2;
        let end_ledger = start + total_duration + 1; // past end

        let mut total_claimed: i128 = 0;

        set_ledger(&env, cliff_ledger);
        if let Ok(amt) = client.claim_vested(&recipient) {
            total_claimed += amt;
        }

        set_ledger(&env, mid_ledger);
        if let Ok(amt) = client.claim_vested(&recipient) {
            total_claimed += amt;
        }

        set_ledger(&env, end_ledger);
        if let Ok(amt) = client.claim_vested(&recipient) {
            total_claimed += amt;
        }

        prop_assert_eq!(
            token_client.balance(&recipient),
            total_deposit,
            "recipient balance {balance} != total deposit {total_deposit}",
            balance = token_client.balance(&recipient),
        );
        prop_assert_eq!(total_claimed, total_deposit);
    }
}
