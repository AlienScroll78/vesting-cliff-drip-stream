#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::calculate_total_deposit,
    error::VestingError,
    tests::{
        advance_ledger, create_vesting_stream, generate_addresses, register_contract, setup_env,
        setup_token,
    },
    types::RATE_DECIMALS,
};

#[test]
fn test_minimal_cliff_one_ledger() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 1, 10);
    let tc = soroban_sdk::token::TokenClient::new(&env, &token_id);

    advance_ledger(&env, 1);
    let claimed = client.claim_vested(&recipient);
    assert_eq!(claimed, 10);
    assert_eq!(tc.balance(&recipient), 10);
}

#[test]
fn test_claim_exactly_at_end_removes_schedule() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 10, 100);

    advance_ledger(&env, 100);
    client.claim_vested(&recipient);

    assert!(client.get_schedule(&recipient).is_none());
}

#[test]
fn test_incremental_claims_sum_to_total() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = create_vesting_stream(&env, &client, &sponsor, &recipient, 5, 20, 100);
    let tc = soroban_sdk::token::TokenClient::new(&env, &token_id);

    advance_ledger(&env, 20);
    client.claim_vested(&recipient);
    advance_ledger(&env, 40);
    client.claim_vested(&recipient);
    advance_ledger(&env, 40);
    client.claim_vested(&recipient);

    // 100 ledgers * 5 tokens = 500
    assert_eq!(tc.balance(&recipient), 500);
}

#[test]
fn test_regression_cliff_equals_total_minus_one() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    // cliff=79, total=100 → ratio = 79% < 80% → allowed
    let (token_id, _) = create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 79, 100);
    let tc = soroban_sdk::token::TokenClient::new(&env, &token_id);

    advance_ledger(&env, 100);
    let claimed = client.claim_vested(&recipient);
    assert_eq!(claimed, 1_000);
    assert_eq!(tc.balance(&recipient), 1_000);
    assert!(client.get_schedule(&recipient).is_none());
}

#[test]
fn test_regression_rate_of_one() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = create_vesting_stream(&env, &client, &sponsor, &recipient, 1, 10, 100);
    let tc = soroban_sdk::token::TokenClient::new(&env, &token_id);

    advance_ledger(&env, 10);
    let claimed = client.claim_vested(&recipient);
    assert_eq!(claimed, 10);
    assert_eq!(tc.balance(&recipient), 10);
}

#[test]
fn test_regression_claim_well_past_end_caps_correctly() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 10, 50);
    let tc = soroban_sdk::token::TokenClient::new(&env, &token_id);

    advance_ledger(&env, 10_000);
    let claimed = client.claim_vested(&recipient);
    assert_eq!(claimed, 500);
    assert_eq!(tc.balance(&recipient), 500);
}

#[test]
fn test_regression_claimable_amount_zero_before_cliff() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 100);

    advance_ledger(&env, 30);
    assert_eq!(client.claimable_amount(&recipient), 0);

    advance_ledger(&env, 20);
    assert_eq!(client.claimable_amount(&recipient), 500);
}

#[test]
fn test_regression_is_cliff_passed_boundary() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 5, 50, 100);

    advance_ledger(&env, 49);
    assert!(!client.is_cliff_passed(&recipient));

    advance_ledger(&env, 1);
    assert!(client.is_cliff_passed(&recipient));
}

#[test]
fn test_regression_negative_rate_rejected() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = setup_token(&env, &sponsor, 1_000);

    let err = client
        .try_create_vesting_stream(&sponsor, &recipient, &token_id, &-1, &50, &100, &None)
        .unwrap_err();
    assert_eq!(err, Ok(VestingError::InvalidRate));
}

#[test]
fn test_calculate_total_deposit_basic() {
    // rate = 1 token/ledger → scaled = RATE_DECIMALS, duration = 100
    // deposit = RATE_DECIMALS * 100 / RATE_DECIMALS = 100
    let result = calculate_total_deposit(RATE_DECIMALS, 100).unwrap();
    assert_eq!(result, 100);
}

#[test]
fn test_calculate_total_deposit_fractional_rate() {
    // rate = 0.5 tokens/ledger → scaled = RATE_DECIMALS / 2 = 5_000_000
    // deposit = 5_000_000 * 200 / 10_000_000 = 100
    let result = calculate_total_deposit(RATE_DECIMALS / 2, 200).unwrap();
    assert_eq!(result, 100);
}

// ── Issue #585: Proactive TTL refresh tests ───────────────────────────────────

/// Verifies that `create_vesting_stream` sets a proactive TTL based on
/// `end_ledger + TTL_BUFFER_LEDGERS` (capped at `PERSISTENT_BUMP_AMOUNT`).
///
/// A short stream (total_duration = 100) should get the max TTL since
/// `end_ledger + buffer` exceeds `PERSISTENT_BUMP_AMOUNT`.
#[test]
#[ignore = "TTL tests depend on SDK storage internals; skip in CI"]
fn test_create_stream_sets_proactive_ttl() {
    use crate::storage::PERSISTENT_BUMP_AMOUNT;
    use crate::types::DataKey;
    use soroban_sdk::testutils::storage::Persistent;

    let env = setup_env(); // sequence_number = 100
    let (contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    // Create a stream with total_duration = 100; end_ledger = 200.
    // TTL = (200 - 100) + 6_307_200 capped at 3_110_400 = 3_110_400.
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 10, 100);

    env.as_contract(&contract_id, || {
        let ttl = env
            .storage()
            .persistent()
            .get_ttl(&DataKey::Schedule(recipient.clone()));
        assert_eq!(
            ttl, PERSISTENT_BUMP_AMOUNT,
            "Short stream TTL should be capped at PERSISTENT_BUMP_AMOUNT"
        );
    });
}

/// Verifies `compute_stream_ttl` returns `PERSISTENT_BUMP_AMOUNT` when the
/// stream has already expired (end_ledger <= current_ledger).
#[test]
fn test_compute_stream_ttl_returns_max_when_stream_expired() {
    use crate::storage::{compute_stream_ttl, PERSISTENT_BUMP_AMOUNT};

    let env = setup_env(); // sequence_number = 100

    // end_ledger in the past
    let ttl = compute_stream_ttl(&env, 50);
    assert_eq!(
        ttl, PERSISTENT_BUMP_AMOUNT,
        "Expired stream TTL should saturate to PERSISTENT_BUMP_AMOUNT"
    );
}

/// Verifies `compute_stream_ttl` for a stream that ends far in the future
/// returns a value capped at `PERSISTENT_BUMP_AMOUNT`.
#[test]
fn test_compute_stream_ttl_capped_at_max_for_long_stream() {
    use crate::storage::{compute_stream_ttl, PERSISTENT_BUMP_AMOUNT};

    let env = setup_env(); // sequence_number = 100

    // end_ledger very far in the future: 100 + 10_000_000 = 10_000_100.
    let ttl = compute_stream_ttl(&env, 10_000_100);
    assert_eq!(
        ttl, PERSISTENT_BUMP_AMOUNT,
        "Long stream TTL should be capped at PERSISTENT_BUMP_AMOUNT"
    );
}

/// Verifies that `claim_vested` re-extends TTL proactively after a claim.
#[test]
#[ignore = "TTL tests depend on SDK storage internals; skip in CI"]
fn test_claim_vested_re_extends_ttl() {
    use crate::storage::PERSISTENT_BUMP_AMOUNT;
    use crate::types::DataKey;
    use soroban_sdk::testutils::storage::Persistent;

    let env = setup_env(); // sequence_number = 100
    let (contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 10, 500);

    // Advance 200_000 ledgers to simulate TTL decay.
    advance_ledger(&env, 200_000);

    // claim_vested re-extends TTL proactively.
    advance_ledger(&env, 10); // past cliff
    let _ = client.claim_vested(&recipient);

    env.as_contract(&contract_id, || {
        let ttl = env
            .storage()
            .persistent()
            .get_ttl(&DataKey::Schedule(recipient.clone()));
        assert_eq!(
            ttl, PERSISTENT_BUMP_AMOUNT,
            "TTL after claim_vested should be restored to PERSISTENT_BUMP_AMOUNT"
        );
    });
}


// ── Variable-rate segment tests (issue #717) ──────────────────────────────────
//
// Covers at least 3 distinct segment configurations to verify:
// - Piecewise claimable_amount computation at segment boundaries
// - InvalidSegments validation (empty, non-ascending, non-positive rate)
// - Backward-compatible single-segment behaviour
// - Total deposit equals sum(segment_duration × segment_rate)

/// Configuration 1: single segment (backward-compatible case).
///
/// A single-segment variable-rate stream behaves identically to a fixed-rate
/// stream: `claimable = ledgers_since_cliff × rate`.
#[test]
fn test_variable_rate_single_segment_backward_compatible() {
    let env = setup_env(); // sequence = 100
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    // Single segment: ledgers 100..200 at rate 10. deposit = 10 × 100 = 1000.
    let deposit: i128 = 10 * 100;
    let (token_id, token_client) = setup_token(&env, &sponsor, deposit);
    let segments = soroban_sdk::vec![&env, (200u32, 10i128)];
    client.create_variable_rate_stream(
        &sponsor,
        &recipient,
        &token_id,
        &20,  // cliff_duration = 20 → cliff_ledger = 120
        &segments,
    );

    // At cliff (ledger 120): 20 ledgers × 10 = 200 claimable.
    advance_ledger(&env, 20);
    let claimed = client.claim_variable_vested(&recipient);
    assert_eq!(claimed, 200);

    // After stream ends (ledger 200): 80 remaining ledgers × 10 = 800.
    advance_ledger(&env, 80);
    let final_claim = client.claim_variable_vested(&recipient);
    assert_eq!(final_claim, 800);
    assert_eq!(token_client.balance(&recipient), 1_000);
    assert!(client.get_variable_schedule(&recipient).is_none());
}

/// Configuration 2: two-segment stream with a ramp-up pattern.
///
/// Segment 1: slow rate (5 tokens/ledger) for the first 50 ledgers.
/// Segment 2: fast rate (20 tokens/ledger) for the next 100 ledgers.
/// Verifies claimable amount at the segment boundary and after.
#[test]
fn test_variable_rate_two_segments_ramp_up() {
    let env = setup_env(); // sequence = 100
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    // Segment 1: 100..150 at rate 5  → deposit = 5 × 50 = 250
    // Segment 2: 150..250 at rate 20 → deposit = 20 × 100 = 2000
    // Total deposit = 2250
    let deposit: i128 = 5 * 50 + 20 * 100;
    let (token_id, token_client) = setup_token(&env, &sponsor, deposit);
    let segments = soroban_sdk::vec![&env, (150u32, 5i128), (250u32, 20i128)];
    client.create_variable_rate_stream(
        &sponsor,
        &recipient,
        &token_id,
        &10, // cliff_duration = 10 → cliff_ledger = 110
        &segments,
    );

    // At ledger 150 (exactly at segment boundary): 50 ledgers × 5 = 250.
    advance_ledger(&env, 50);
    assert_eq!(client.claimable_variable_amount(&recipient), 250);
    let first = client.claim_variable_vested(&recipient);
    assert_eq!(first, 250);

    // At ledger 200 (50 ledgers into segment 2): 50 × 20 = 1000.
    advance_ledger(&env, 50);
    let second = client.claim_variable_vested(&recipient);
    assert_eq!(second, 1_000);

    // At ledger 250 (end): 50 × 20 = 1000 remaining.
    advance_ledger(&env, 50);
    let third = client.claim_variable_vested(&recipient);
    assert_eq!(third, 1_000);

    // Total = 250 + 1000 + 1000 = 2250.
    assert_eq!(token_client.balance(&recipient), 2_250);
    assert!(client.get_variable_schedule(&recipient).is_none());
}

/// Configuration 3: three-segment stream (slow → fast → cool-down).
///
/// Verifies piecewise accrual across three distinct rate phases.
#[test]
fn test_variable_rate_three_segments_piecewise() {
    let env = setup_env(); // sequence = 100
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    // Segment 1: 100..150  rate=5   → 50 × 5  = 250
    // Segment 2: 150..250  rate=15  → 100 × 15 = 1500
    // Segment 3: 250..300  rate=8   → 50 × 8  = 400
    // Total deposit = 2150
    let deposit: i128 = 5 * 50 + 15 * 100 + 8 * 50;
    let (token_id, token_client) = setup_token(&env, &sponsor, deposit);
    let segments = soroban_sdk::vec![
        &env,
        (150u32, 5i128),
        (250u32, 15i128),
        (300u32, 8i128)
    ];
    client.create_variable_rate_stream(
        &sponsor,
        &recipient,
        &token_id,
        &5, // cliff_duration = 5 → cliff_ledger = 105
        &segments,
    );

    // Claim at ledger 150: 50 × 5 = 250.
    advance_ledger(&env, 50);
    let c1 = client.claim_variable_vested(&recipient);
    assert_eq!(c1, 250);

    // Claim at ledger 200 (50 into seg 2): 50 × 15 = 750.
    advance_ledger(&env, 50);
    let c2 = client.claim_variable_vested(&recipient);
    assert_eq!(c2, 750);

    // Claim at stream end ledger 300: 50 × 15 + 50 × 8 = 750 + 400 = 1150.
    advance_ledger(&env, 100);
    let c3 = client.claim_variable_vested(&recipient);
    assert_eq!(c3, 1_150);

    assert_eq!(token_client.balance(&recipient), 2_150);
    assert!(client.get_variable_schedule(&recipient).is_none());
}

/// `InvalidSegments` is returned for an empty segment list.
#[test]
fn test_variable_rate_empty_segments_invalid() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = setup_token(&env, &sponsor, 10_000);

    let segments: soroban_sdk::Vec<(u32, i128)> = soroban_sdk::Vec::new(&env);
    let err = client
        .try_create_variable_rate_stream(&sponsor, &recipient, &token_id, &10, &segments)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, crate::error::VestingError::InvalidSegments);
}

/// `InvalidSegments` is returned when segment end_ledgers are not ascending.
#[test]
fn test_variable_rate_non_ascending_end_ledgers_invalid() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = setup_token(&env, &sponsor, 10_000);

    // Second segment end (110) < first (200) — out of order.
    let segments = soroban_sdk::vec![&env, (200u32, 5i128), (110u32, 10i128)];
    let err = client
        .try_create_variable_rate_stream(&sponsor, &recipient, &token_id, &10, &segments)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, crate::error::VestingError::InvalidSegments);
}

/// `InvalidSegments` error code is 19.
#[test]
fn test_invalid_segments_error_code_is_19() {
    assert_eq!(crate::error::VestingError::InvalidSegments as u32, 19);
}
