#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    tests::{advance_ledger, setup_env},
};

use super::super::tests::token_helper::{create_token, mint_to};

const RECIPIENT_COUNT: usize = 1000;

/// Stress test: 1000 recipients each create and claim a stream.
///
/// Validates:
/// - All streams are created without error
/// - All claims succeed after the cliff (0% error rate)
/// - Each recipient receives the correct token amount
#[test]
fn test_high_load_1000_recipients_claim() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    // rate=10, cliff=50, total=100 → deposit=1000 per recipient
    let rate: i128 = 10;
    let cliff_duration: u32 = 50;
    let total_duration: u32 = 100;
    let deposit_per = rate * total_duration as i128;

    let total_deposit = deposit_per * RECIPIENT_COUNT as i128;

    let sponsor = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, total_deposit);

    // Create all streams
    let recipients: Vec<Address> = (0..RECIPIENT_COUNT)
        .map(|_| {
            let r = Address::generate(&env);
            client
                .create_vesting_stream(&sponsor, &r, &token_id, &rate, &cliff_duration, &total_duration)
                .expect("create_vesting_stream failed");
            r
        })
        .collect();

    // Advance past the cliff
    advance_ledger(&env, cliff_duration);

    // All 1000 claims must succeed (0 errors)
    let mut errors = 0usize;
    let mut total_claimed: i128 = 0;

    for r in &recipients {
        match client.claim_vested(r) {
            Ok(amount) => total_claimed += amount,
            Err(_) => errors += 1,
        }
    }

    assert_eq!(errors, 0, "error rate must be 0% under load");

    // Each recipient claimed cliff accrual: cliff_duration × rate = 500
    let expected_per = cliff_duration as i128 * rate;
    assert_eq!(total_claimed, expected_per * RECIPIENT_COUNT as i128);

    // Spot-check one recipient's token balance
    assert_eq!(token_client.balance(&recipients[0]), expected_per);
}

/// Verifies that all 1000 streams can be fully drained (end-to-end).
#[test]
fn test_high_load_1000_recipients_full_drain() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let rate: i128 = 10;
    let total_duration: u32 = 100;
    let deposit_per = rate * total_duration as i128;

    let sponsor = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, deposit_per * RECIPIENT_COUNT as i128);

    let recipients: Vec<Address> = (0..RECIPIENT_COUNT)
        .map(|_| {
            let r = Address::generate(&env);
            client
                .create_vesting_stream(&sponsor, &r, &token_id, &rate, &10, &total_duration)
                .expect("create failed");
            r
        })
        .collect();

    // Advance past end_ledger
    advance_ledger(&env, total_duration + 1);

    let mut errors = 0usize;
    for r in &recipients {
        if client.claim_vested(r).is_err() {
            errors += 1;
        }
    }

    assert_eq!(errors, 0, "full-drain error rate must be 0%");

    // All schedules should be cleared
    for r in &recipients {
        assert!(client.get_schedule(r).is_none());
    }
}
