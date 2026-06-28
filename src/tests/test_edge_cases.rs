#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{calculate_total_deposit, VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{advance_ledger, setup_env},
};

use super::super::tests::token_helper::{create_token, mint_to};

/// Ensures the stream still works with a very small cliff of 1 ledger.
#[test]
fn test_minimal_cliff_one_ledger() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 100);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &1, &10)
        .unwrap();

    // Cliff is at ledger 101; advance just 1.
    advance_ledger(&env, 1);
    let claimed = client.claim_vested(&recipient).unwrap();
    assert_eq!(claimed, 10); // 1 ledger × 10
    assert_eq!(token_client.balance(&recipient), 10);
}

/// Multiple recipients can have independent simultaneous streams.
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

    // Advance to ledger 170 (70 past start; B cliff at 120 passed, A cliff at 150 passed)
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
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &10, &100)
        .unwrap();

    advance_ledger(&env, 100); // exactly end_ledger
    client.claim_vested(&recipient).unwrap();

    assert!(client.get_schedule(&recipient).is_none());
}

/// Verifies incremental claims sum to the total deposit.
#[test]
fn test_incremental_claims_sum_to_total() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    // rate=5, cliff=20, total=100 → deposit=500
    mint_to(&env, &token_id, &sponsor, 500);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &5, &20, &100)
        .unwrap();

    // Claim in three separate windows: cliff, mid, end
    advance_ledger(&env, 20);
    client.claim_vested(&recipient).unwrap();
    advance_ledger(&env, 40);
    client.claim_vested(&recipient).unwrap();
    advance_ledger(&env, 40);
    client.claim_vested(&recipient).unwrap();

    assert_eq!(token_client.balance(&recipient), 500);
}

// ── Issue #103: Regression tests for known edge cases ────────────────────────

/// Guard: cliff_duration = total_duration - 1 (minimum gap of 1 ledger).
/// Only 1 ledger of tokens should accrue post-cliff.
#[test]
fn test_regression_cliff_equals_total_minus_one() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    // rate=10, cliff=99, total=100 → deposit=1000; only 1 post-cliff ledger
    mint_to(&env, &token_id, &sponsor, 1_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &99, &100)
        .unwrap();

    // Jump exactly to end_ledger (100 ledgers).
    advance_ledger(&env, 100);
    let claimed = client.claim_vested(&recipient).unwrap();
    // 100 ledgers total × 10 = 1000
    assert_eq!(claimed, 1_000);
    assert_eq!(token_client.balance(&recipient), 1_000);
    // Stream should be fully consumed.
    assert!(client.get_schedule(&recipient).is_none());
}

/// Guard: rate = 1 (minimum valid rate) produces correct accrual.
/// Prevents a regression where small rates were rounded to zero.
#[test]
fn test_regression_rate_of_one() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 100); // rate=1, total=100

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &1, &10, &100)
        .unwrap();

    advance_ledger(&env, 10); // exactly at cliff
    let claimed = client.claim_vested(&recipient).unwrap();
    assert_eq!(claimed, 10); // 10 ledgers × 1
    assert_eq!(token_client.balance(&recipient), 10);
}

/// Guard: claim immediately after end_ledger returns only the remaining tokens,
/// not an inflated amount due to unbounded ledger arithmetic.
#[test]
fn test_regression_claim_well_past_end_caps_correctly() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    // rate=10, cliff=10, total=50 → deposit=500
    mint_to(&env, &token_id, &sponsor, 500);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &10, &50)
        .unwrap();

    // Advance 10_000 ledgers past the end.
    advance_ledger(&env, 10_000);
    let claimed = client.claim_vested(&recipient).unwrap();
    // Must be exactly the deposit, not 10_000 × 10.
    assert_eq!(claimed, 500);
    assert_eq!(token_client.balance(&recipient), 500);
}

/// Guard: claimable_amount view returns 0 before cliff and correct value after.
/// Prevents a regression where the view leaked pre-cliff accrual.
#[test]
fn test_regression_claimable_amount_zero_before_cliff() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &100)
        .unwrap();

    // Before cliff: view must be 0.
    advance_ledger(&env, 30);
    assert_eq!(client.claimable_amount(&recipient), 0);

    // After cliff: view must reflect accrued ledgers.
    advance_ledger(&env, 20); // now at ledger 150 = cliff
    assert_eq!(client.claimable_amount(&recipient), 500); // 50 × 10
}

/// Guard: is_cliff_passed returns false before and true at/after the cliff.
/// Prevents off-by-one regression in the boundary check (>= vs >).
#[test]
fn test_regression_is_cliff_passed_boundary() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 500);

    // cliff_duration=50 → cliff_ledger=150
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &5, &50, &100)
        .unwrap();

    advance_ledger(&env, 49); // ledger 149 — one before cliff
    assert!(!client.is_cliff_passed(&recipient));

    advance_ledger(&env, 1); // ledger 150 — exactly cliff
    assert!(client.is_cliff_passed(&recipient));
}

/// Guard: negative rate is rejected.
/// Ensures the rate validation covers both zero and negative values.
#[test]
fn test_regression_negative_rate_rejected() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    use crate::error::VestingError;
    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &-1, &50, &100)
        .unwrap_err();
    assert_eq!(err, VestingError::InvalidRate.into());
}

// ── TTL bump & expiry tests ───────────────────────────────────────────────────

/// TTL write path: `set_schedule` bumps TTL to PERSISTENT_BUMP_AMOUNT (518_400) ledgers.
/// Verified via `env.as_contract` + `get_ttl`.
///
/// TTL = bump_amount - 1 because the current ledger is counted during creation.
#[test]
fn test_ttl_bumped_on_write() {
    use soroban_sdk::testutils::storage::Persistent;
    use crate::types::DataKey;

    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &10, &100)
        .unwrap();

    // PERSISTENT_BUMP_AMOUNT = 518_400; TTL doesn't include the current ledger,
    // so initial TTL = 518_400 - 1 = 518_399.
    env.as_contract(&contract_id, || {
        assert_eq!(
            env.storage()
                .persistent()
                .get_ttl(&DataKey::Schedule(recipient.clone())),
            518_399
        );
    });
}

/// TTL read path: `get_schedule` re-extends TTL on every read.
///
/// Verify that after ledger advances (reducing TTL), a contract call that reads
/// the schedule bumps TTL back to PERSISTENT_BUMP_AMOUNT - 1 from the new ledger.
#[test]
fn test_ttl_bumped_on_read() {
    use soroban_sdk::testutils::storage::Persistent;
    use crate::types::DataKey;

    let env = setup_env(); // sequence_number = 100
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &10, &100)
        .unwrap();

    // Advance 200_000 ledgers without any contract interaction.
    // TTL decays from 518_399 to 318_399.
    advance_ledger(&env, 200_000);

    env.as_contract(&contract_id, || {
        assert_eq!(
            env.storage()
                .persistent()
                .get_ttl(&DataKey::Schedule(recipient.clone())),
            318_399
        );
    });

    // Any read-touching call (claimable_amount → get_schedule) re-bumps TTL.
    client.claimable_amount(&recipient);

    // TTL is restored to 518_399 relative to the new current ledger.
    env.as_contract(&contract_id, || {
        assert_eq!(
            env.storage()
                .persistent()
                .get_ttl(&DataKey::Schedule(recipient.clone())),
            518_399
        );
    });
}

/// Expiry path: without TTL bumps, advancing far enough makes the entry's TTL
/// drop to 0 (archived). The SDK then auto-restores persistent entries on the
/// next access, so `ScheduleNotFound` is not produced by natural expiry. This
/// test instead verifies the TTL decay observable state and confirms that
/// `ScheduleNotFound` is returned by `get_schedule` returning `None` after
/// an explicit `cancel_stream` removes the entry — the concrete error path
/// reachable by callers.
///
/// TTL decay behaviour (no bumps):
///   - After creation: TTL = 518_399
///   - After +518_399 ledgers: TTL = 0 (entry archived on-chain)
///   - SDK auto-restores on next contract call (persistent archival semantics)
///
/// Therefore `ScheduleNotFound` is always raised via explicit removal, not expiry.
#[test]
fn test_expired_ttl_reaches_zero_and_cancelled_stream_returns_schedule_not_found() {
    use soroban_sdk::testutils::storage::Persistent;
    use crate::types::DataKey;

    let env = setup_env(); // sequence_number = 100
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &10, &100)
        .unwrap();

    // Advance exactly 518_399 ledgers — TTL hits 0 (archived state).
    // No reads/writes occur, so the bump is never triggered.
    advance_ledger(&env, 518_399);

    env.as_contract(&contract_id, || {
        assert_eq!(
            env.storage()
                .persistent()
                .get_ttl(&DataKey::Schedule(recipient.clone())),
            0
        );
    });

    // Cancel removes the entry from storage entirely.
    client.cancel_stream(&sponsor, &recipient).unwrap();

    // Subsequent calls now return ScheduleNotFound because the entry was removed.
    let err = client.claim_vested(&recipient).unwrap_err();
    assert_eq!(err, VestingError::ScheduleNotFound.into());

    let err2 = client.cancel_stream(&sponsor, &recipient).unwrap_err();
    assert_eq!(err2, VestingError::ScheduleNotFound.into());
}
