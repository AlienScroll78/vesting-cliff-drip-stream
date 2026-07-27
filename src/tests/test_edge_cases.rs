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

// ── Arithmetic boundary tests (Issue #366) ───────────────────────────────────

/// rate = i128::MAX / total_duration → deposit exactly at i128::MAX; must succeed.
///
/// This is the highest valid rate for the given duration. The multiplication
/// `rate * total_duration` should equal `i128::MAX` (truncated), which is still
/// representable, so `calculate_total_deposit` must return `Ok`.
#[test]
fn test_arithmetic_boundary_rate_max_div_duration_succeeds() {
    let total_duration: u32 = 1_000;
    let rate: i128 = i128::MAX / total_duration as i128;

    // Direct unit-test of the helper — no environment needed.
    let result = calculate_total_deposit(rate, total_duration);
    assert!(
        result.is_ok(),
        "rate = i128::MAX / total_duration should succeed, got: {:?}",
        result
    );
}

/// rate = i128::MAX / total_duration + 1 → overflow; must return DepositOverflow.
///
/// One unit above the safe boundary overflows `checked_mul`, so the contract
/// must reject the stream-creation request with error code 5.
#[test]
fn test_arithmetic_boundary_rate_one_above_max_overflows() {
    let total_duration: u32 = 1_000;
    let rate: i128 = i128::MAX / total_duration as i128 + 1;

    let err = calculate_total_deposit(rate, total_duration)
        .expect_err("rate one above boundary should overflow");
    assert_eq!(err, VestingError::DepositOverflow);
}

/// create_vesting_stream with rate one above the overflow boundary returns
/// DepositOverflow (error code 5) from the contract entry-point.
#[test]
fn test_create_stream_rate_overflow_rejected() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    // No mint needed — rejection happens before any transfer.

    let total_duration: u32 = 1_000;
    let rate: i128 = i128::MAX / total_duration as i128 + 1;

    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &10, &total_duration)
        .unwrap_err();
    assert_eq!(err, VestingError::DepositOverflow.into());
}

/// cliff_duration = total_duration - 1 → maximum valid cliff (gap of 1 ledger).
/// The contract must accept this configuration and produce a stream with exactly
/// 1 post-cliff ledger of accrual.
#[test]
fn test_arithmetic_boundary_cliff_equals_total_minus_one_succeeds() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);

    let rate: i128 = 7;
    let total_duration: u32 = 50;
    let cliff_duration: u32 = total_duration - 1; // maximum valid cliff = 49
    let deposit = rate * total_duration as i128;   // 350
    mint_to(&env, &token_id, &sponsor, deposit);

    // Must not error.
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &cliff_duration, &total_duration)
        .unwrap();

    // Advance to end_ledger (100 + 50 = 150) to capture all accrual.
    advance_ledger(&env, total_duration);
    let claimed = client.claim_vested(&recipient).unwrap();
    assert_eq!(claimed, deposit);
    assert_eq!(token_client.balance(&recipient), deposit);
}

/// cliff_duration = total_duration → stream with no post-cliff period is invalid.
/// Must return InvalidDuration (error code 3).
#[test]
fn test_arithmetic_boundary_cliff_equals_total_duration_rejected() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    let total_duration: u32 = 50;
    let cliff_duration: u32 = total_duration; // cliff == total → no post-cliff period

    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &cliff_duration, &total_duration)
        .unwrap_err();
    assert_eq!(err, VestingError::InvalidDuration.into());
}

/// rate = 1 (minimum valid rate) → stream created and accrual is correct.
/// Prevents a regression where small rates were rounded to zero inside arithmetic.
#[test]
fn test_arithmetic_boundary_minimum_rate_one_succeeds() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);

    let total_duration: u32 = 200;
    let cliff_duration: u32 = 50;
    let rate: i128 = 1;
    mint_to(&env, &token_id, &sponsor, total_duration as i128);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &cliff_duration, &total_duration)
        .unwrap();

    // Advance exactly to cliff; catch-up claim covers start_ledger..cliff_ledger.
    advance_ledger(&env, cliff_duration);
    let at_cliff = client.claim_vested(&recipient).unwrap();
    assert_eq!(at_cliff, cliff_duration as i128); // 50 × 1

    // Advance to end; remaining post-cliff accrual.
    advance_ledger(&env, total_duration - cliff_duration);
    let remaining = client.claim_vested(&recipient).unwrap();
    assert_eq!(remaining, (total_duration - cliff_duration) as i128); // 150 × 1

    assert_eq!(token_client.balance(&recipient), total_duration as i128);
}

/// total_duration = 1 (minimum valid duration with cliff_duration = 0).
/// A stream of exactly 1 ledger must succeed and pay `rate` tokens on claim.
#[test]
fn test_arithmetic_boundary_minimum_total_duration_one_succeeds() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);

    let rate: i128 = 42;
    let cliff_duration: u32 = 0;
    let total_duration: u32 = 1;
    mint_to(&env, &token_id, &sponsor, rate);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &cliff_duration, &total_duration)
        .unwrap();

    // Advance 1 ledger → at cliff (cliff=0 means cliff_ledger = start = 100,
    // but we are still at 100 here; advance to 101 which is >= cliff_ledger
    // AND == end_ledger).
    advance_ledger(&env, 1);
    let claimed = client.claim_vested(&recipient).unwrap();
    assert_eq!(claimed, rate);
    assert_eq!(token_client.balance(&recipient), rate);
    // Stream fully consumed at end_ledger.
    assert!(client.get_schedule(&recipient).is_none());
}

/// Claim at exactly cliff_ledger returns all tokens accrued since start_ledger.
///
/// This validates the "instant catch-up" behaviour: on the first claim at the
/// cliff boundary, `(cliff_ledger - start_ledger) * rate` tokens are released.
#[test]
fn test_claim_at_exactly_cliff_ledger_returns_cliff_amount() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);

    let rate: i128 = 10;
    let cliff_duration: u32 = 30;
    let total_duration: u32 = 100;
    mint_to(&env, &token_id, &sponsor, rate * total_duration as i128);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &rate, &cliff_duration, &total_duration)
        .unwrap();

    // Ledger starts at 100; advance exactly to cliff (100 + 30 = 130).
    advance_ledger(&env, cliff_duration);
    assert!(client.is_cliff_passed(&recipient));

    let claimed = client.claim_vested(&recipient).unwrap();
    // Catch-up: 30 ledgers × 10 = 300 tokens.
    assert_eq!(claimed, rate * cliff_duration as i128);
    assert_eq!(token_client.balance(&recipient), rate * cliff_duration as i128);
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
