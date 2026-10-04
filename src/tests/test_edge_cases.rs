#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    tests::{
        advance_ledger, setup_env,
        factory::StreamBuilder,
        token_helper::{create_token, mint_to},
    },
};

/// A stream with a 1-ledger cliff unlocks instantly on the very next ledger.
#[test]
fn test_minimal_cliff_one_ledger() {
    let env = setup_env();
    let (stream, addrs) = StreamBuilder::default()
        .rate(10)
        .cliff_duration(1)
        .total_duration(10)
        .build(&env);

    // Cliff is start_ledger + 1; advance just 1.
    advance_ledger(&env, 1);
    let claimed = stream.client.claim_vested(&addrs.recipient).unwrap();
    assert_eq!(claimed, 10); // 1 ledger × 10
}

/// Multiple recipients can hold independent simultaneous streams on the same contract.
#[test]
fn test_multiple_independent_streams() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 5_000);

    // A: rate=10, cliff=50, total=200 → deposit=2000
    client
        .create_vesting_stream(&sponsor, &recipient_a, &token_id, &10, &50, &200)
        .unwrap();
    // B: rate=15, cliff=20, total=200 → deposit=3000
    client
        .create_vesting_stream(&sponsor, &recipient_b, &token_id, &15, &20, &200)
        .unwrap();

    // Advance to ledger 170 (70 past start; both cliffs passed).
    advance_ledger(&env, 70);

    let claimed_a = client.claim_vested(&recipient_a).unwrap();
    let claimed_b = client.claim_vested(&recipient_b).unwrap();

    assert_eq!(claimed_a, 700);   // 70 × 10
    assert_eq!(claimed_b, 1_050); // 70 × 15
    assert_eq!(token_client.balance(&recipient_a), 700);
    assert_eq!(token_client.balance(&recipient_b), 1_050);
}

/// Claiming exactly at `end_ledger` clears the schedule.
#[test]
fn test_claim_exactly_at_end_removes_schedule() {
    let env = setup_env();
    let (stream, addrs) = StreamBuilder::default()
        .rate(10)
        .cliff_duration(10)
        .total_duration(100)
        .build(&env);

    advance_ledger(&env, 100); // exactly end_ledger
    stream.client.claim_vested(&addrs.recipient).unwrap();

    assert!(stream.client.get_schedule(&addrs.recipient).is_none());
}

/// Incremental claims made across multiple windows should sum to the full deposit.
#[test]
fn test_incremental_claims_sum_to_total() {
    let env = setup_env();
    // rate=5, cliff=20, total=100 → deposit=500
    let (stream, addrs) = StreamBuilder::default()
        .rate(5)
        .cliff_duration(20)
        .total_duration(100)
        .build(&env);

    advance_ledger(&env, 20);
    stream.client.claim_vested(&addrs.recipient).unwrap();
    advance_ledger(&env, 40);
    stream.client.claim_vested(&addrs.recipient).unwrap();
    advance_ledger(&env, 40);
    stream.client.claim_vested(&addrs.recipient).unwrap();

    // All 500 tokens claimed in total.
    let token_client =
        soroban_sdk::token::TokenClient::new(&env, &stream.token);
    assert_eq!(token_client.balance(&addrs.recipient), 500);
}

// ── Issue #3: claimable_amount overflow regression ────────────────────────────

/// claimable_amount with a corrupted schedule whose rate would overflow i128
/// must return DepositOverflow (error 5) rather than panic.
#[test]
fn test_claimable_amount_overflow_returns_error() {
    use crate::error::VestingError;
    use crate::contract::{VestingDrips, VestingDripsClient};
    use crate::tests::{setup_env, token_helper::{create_token, mint_to}};

    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let admin = soroban_sdk::Address::generate(&env);
    let treasury = soroban_sdk::Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury);

    let sponsor = soroban_sdk::Address::generate(&env);
    let recipient = soroban_sdk::Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    // Mint a small amount — the overflow happens in arithmetic, not in balance.
    mint_to(&env, &token_id, &sponsor, 1_000);

    client.create_vesting_stream(&sponsor, &recipient, &token_id, &10, &5, &100, &None);

    // Advance past cliff.
    advance_ledger(&env, 6);

    // Manually corrupt the schedule's rate to i128::MAX to force overflow.
    let mut schedule = client.get_schedule(&recipient).unwrap();
    schedule.rate_per_ledger = i128::MAX;
    env.as_contract(&contract_id, || {
        crate::storage::set_schedule(&env, &recipient, &schedule);
    });

    // claimable_amount must return DepositOverflow, not panic.
    let result = client.try_claimable_amount(&recipient);
    match result {
        Err(Ok(VestingError::DepositOverflow)) => {} // expected
        other => panic!("expected DepositOverflow, got {:?}", other),
    }
}

/// claim_vested with a corrupted schedule whose rate would overflow i128
/// must return DepositOverflow rather than panic.
#[test]
fn test_claim_vested_overflow_returns_error() {
    use crate::error::VestingError;
    use crate::contract::{VestingDrips, VestingDripsClient};
    use crate::tests::{setup_env, token_helper::{create_token, mint_to}};

    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let admin = soroban_sdk::Address::generate(&env);
    let treasury = soroban_sdk::Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury);

    let sponsor = soroban_sdk::Address::generate(&env);
    let recipient = soroban_sdk::Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000);

    client.create_vesting_stream(&sponsor, &recipient, &token_id, &10, &5, &100, &None);

    advance_ledger(&env, 6);

    // Corrupt the rate.
    let mut schedule = client.get_schedule(&recipient).unwrap();
    schedule.rate_per_ledger = i128::MAX;
    env.as_contract(&contract_id, || {
        crate::storage::set_schedule(&env, &recipient, &schedule);
    });

    let err = client.try_claim_vested(&recipient, &None).unwrap_err().unwrap();
    assert_eq!(
        err,
        VestingError::DepositOverflow,
        "claim_vested must return DepositOverflow on rate overflow"
    );
}
