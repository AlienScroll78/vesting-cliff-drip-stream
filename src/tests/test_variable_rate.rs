//! Tests for variable-rate vesting streams (issue #326).
//!
//! Verifies creation, segment validation, claimable_amount computation across
//! segments, dust collection at end_ledger, and error codes.

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, vec, Vec};

use crate::{
    error::VestingError,
    tests::{advance_ledger, generate_addresses, register_contract, setup_env, setup_token},
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Creates a variable-rate stream. Segments are absolute ledger numbers.
/// Mints the required deposit to `sponsor` automatically.
fn create_var_stream(
    env: &soroban_sdk::Env,
    client: &crate::contract::VestingDripsClient,
    sponsor: &soroban_sdk::Address,
    recipient: &soroban_sdk::Address,
    cliff_duration: u32,
    segments: Vec<(u32, i128)>,
) -> soroban_sdk::Address {
    // Compute required deposit
    let start = env.ledger().sequence();
    let mut prev = start;
    let mut deposit: i128 = 0;
    for i in 0..segments.len() {
        let (end, rate) = segments.get(i).unwrap();
        deposit += rate * (end - prev) as i128;
        prev = end;
    }
    let (token_id, _) = setup_token(env, sponsor, deposit);
    client
        .create_variable_rate_stream(sponsor, recipient, &token_id, &cliff_duration, &segments)
        .unwrap();
    token_id
}

// ── Creation and validation ───────────────────────────────────────────────────

/// Successful creation: two-segment stream, ascending ledgers, positive rates.
#[test]
fn test_create_variable_rate_stream_succeeds() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    // Segments: [110→120 at rate 5], [120→150 at rate 10]
    // start=100, so first segment covers ledgers 100..110? No — segments use
    // absolute ledger numbers. start=100, seg1 end=120, seg2 end=150.
    // deposit = 5×(120-100) + 10×(150-120) = 100 + 300 = 400
    let segments = vec![&env, (120u32, 5i128), (150u32, 10i128)];
    let token_id = create_var_stream(&env, &client, &sponsor, &recipient, 10, segments);

    let sched = client.get_variable_schedule(&recipient).unwrap();
    assert_eq!(sched.start_ledger, 100);
    assert_eq!(sched.cliff_ledger, 110);
    assert_eq!(sched.end_ledger, 150);
    assert_eq!(sched.total_deposited, 400);
    assert_eq!(sched.segments.len(), 2);
    let _ = token_id;
}

/// Empty segment list is rejected with `InvalidSegments`.
#[test]
fn test_empty_segments_rejected() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = setup_token(&env, &sponsor, 10_000);

    let segments: Vec<(u32, i128)> = Vec::new(&env);
    let err = client
        .try_create_variable_rate_stream(&sponsor, &recipient, &token_id, &10, &segments)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::InvalidSegments);
}

/// More than 10 segments is rejected with `InvalidSegments`.
#[test]
fn test_too_many_segments_rejected() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = setup_token(&env, &sponsor, 100_000);

    let mut segments: Vec<(u32, i128)> = Vec::new(&env);
    for i in 1..=11u32 {
        segments.push_back((100 + i * 10, 10i128));
    }
    let err = client
        .try_create_variable_rate_stream(&sponsor, &recipient, &token_id, &5, &segments)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::InvalidSegments);
}

/// Non-ascending segment end_ledger values are rejected.
#[test]
fn test_non_ascending_segments_rejected() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = setup_token(&env, &sponsor, 10_000);

    // second segment end_ledger (110) < first (150) → rejected
    let segments = vec![&env, (150u32, 5i128), (110u32, 10i128)];
    let err = client
        .try_create_variable_rate_stream(&sponsor, &recipient, &token_id, &10, &segments)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::InvalidSegments);
}

/// Zero rate in a segment is rejected.
#[test]
fn test_zero_rate_in_segment_rejected() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = setup_token(&env, &sponsor, 10_000);

    let segments = vec![&env, (150u32, 0i128)];
    let err = client
        .try_create_variable_rate_stream(&sponsor, &recipient, &token_id, &10, &segments)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::InvalidSegments);
}

/// Negative rate in a segment is rejected.
#[test]
fn test_negative_rate_in_segment_rejected() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = setup_token(&env, &sponsor, 10_000);

    let segments = vec![&env, (150u32, -5i128)];
    let err = client
        .try_create_variable_rate_stream(&sponsor, &recipient, &token_id, &10, &segments)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::InvalidSegments);
}

/// Cliff at or past end_ledger is rejected.
#[test]
fn test_cliff_at_end_ledger_rejected() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = setup_token(&env, &sponsor, 10_000);

    // start=100, cliff_duration=50 → cliff=150, end=150 → cliff == end → rejected
    let segments = vec![&env, (150u32, 10i128)];
    let err = client
        .try_create_variable_rate_stream(&sponsor, &recipient, &token_id, &50, &segments)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::InvalidSegments);
}

/// `sponsor == recipient` is rejected with `InvalidRecipient`.
#[test]
fn test_sponsor_equals_recipient_rejected() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let sponsor = soroban_sdk::Address::generate(&env);
    let (token_id, _) = setup_token(&env, &sponsor, 10_000);

    let segments = vec![&env, (200u32, 10i128)];
    let err = client
        .try_create_variable_rate_stream(&sponsor, &sponsor, &token_id, &10, &segments)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::InvalidRecipient);
}

// ── Claimable amount across segments ─────────────────────────────────────────

/// Before cliff, claimable is zero.
#[test]
fn test_claimable_variable_before_cliff_is_zero() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    // start=100, cliff_duration=20, end=150
    // segments: [130 at 5], [150 at 10]
    let segments = vec![&env, (130u32, 5i128), (150u32, 10i128)];
    create_var_stream(&env, &client, &sponsor, &recipient, 20, segments);

    advance_ledger(&env, 10); // ledger 110, still before cliff 120
    assert_eq!(client.claimable_variable_amount(&recipient), 0);
}

/// At cliff, the catch-up burst covers accrual from start through cliff.
#[test]
fn test_claimable_variable_at_cliff_includes_catchup() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    // start=100, cliff_duration=20 → cliff=120, end=150
    // segment 1: 100..130 at rate 5  (deposit for 30 ledgers = 150)
    // segment 2: 130..150 at rate 10 (deposit for 20 ledgers = 200)
    // total deposit = 350
    let segments = vec![&env, (130u32, 5i128), (150u32, 10i128)];
    create_var_stream(&env, &client, &sponsor, &recipient, 20, segments);

    // Advance to cliff (ledger 120)
    advance_ledger(&env, 20);
    let claimable = client.claimable_variable_amount(&recipient);
    // ledgers 100..120 at rate 5 = 20 × 5 = 100
    assert_eq!(claimable, 100);
}

/// Claimable correctly crosses segment boundary.
#[test]
fn test_claimable_variable_crosses_segment_boundary() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    // start=100, cliff=10→110, segments: [120 at 5], [140 at 10]
    // deposit = 5×(120-100) + 10×(140-120) = 100 + 200 = 300
    let segments = vec![&env, (120u32, 5i128), (140u32, 10i128)];
    create_var_stream(&env, &client, &sponsor, &recipient, 10, segments);

    // Advance to ledger 130 (10 ledgers into segment 2)
    advance_ledger(&env, 30);
    let claimable = client.claimable_variable_amount(&recipient);
    // seg1 covers 100..120 (20 ledgers × 5 = 100)
    // seg2 covers 120..130 (10 ledgers × 10 = 100)
    // total = 200
    assert_eq!(claimable, 200);
}

/// Claim then check claimable accumulates correctly.
#[test]
fn test_claim_variable_then_claimable_correct() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    // start=100, cliff=10→110, segments: [120 at 5], [140 at 10]
    let segments = vec![&env, (120u32, 5i128), (140u32, 10i128)];
    let token_id = create_var_stream(&env, &client, &sponsor, &recipient, 10, segments);
    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);

    // Advance to cliff (110) and claim
    advance_ledger(&env, 10);
    let first = client.claim_variable_vested(&recipient).unwrap();
    // 10 ledgers × 5 = 50
    assert_eq!(first, 50);
    assert_eq!(token_client.balance(&recipient), 50);

    // Advance to end_ledger (140) and claim remainder
    advance_ledger(&env, 30);
    let second = client.claim_variable_vested(&recipient).unwrap();
    // 300 − 50 = 250
    assert_eq!(second, 250);
    assert_eq!(token_client.balance(&recipient), 300);
    assert!(client.get_variable_schedule(&recipient).is_none());
}

// ── Dust collection ───────────────────────────────────────────────────────────

/// At end_ledger, claim collects dust — total received equals total_deposited.
#[test]
fn test_variable_stream_dust_collection_at_end() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    // start=100, cliff=5→105, segments: [115 at 7], [130 at 3]
    // deposit = 7×15 + 3×15 = 105 + 45 = 150
    let segments = vec![&env, (115u32, 7i128), (130u32, 3i128)];
    let token_id = create_var_stream(&env, &client, &sponsor, &recipient, 5, segments);
    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);

    // Advance to end_ledger (130) and claim in one shot
    advance_ledger(&env, 30);
    let claimed = client.claim_variable_vested(&recipient).unwrap();
    assert_eq!(claimed, 150);
    assert_eq!(token_client.balance(&recipient), 150);
    assert!(client.get_variable_schedule(&recipient).is_none());
}

// ── Error codes ───────────────────────────────────────────────────────────────

/// Verify `InvalidSegments` has error code 19.
#[test]
fn test_invalid_segments_error_code() {
    assert_eq!(VestingError::InvalidSegments as u32, 19);
}

/// `claim_variable_vested` before cliff returns `CliffNotReached`.
#[test]
fn test_claim_variable_before_cliff_fails() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    let segments = vec![&env, (200u32, 10i128)];
    create_var_stream(&env, &client, &sponsor, &recipient, 50, segments);

    advance_ledger(&env, 10); // still before cliff

    let err = client.try_claim_variable_vested(&recipient).unwrap_err().unwrap();
    assert_eq!(err, VestingError::CliffNotReached);
}

/// Max segments (10) is accepted.
#[test]
fn test_max_10_segments_accepted() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    let mut segments: Vec<(u32, i128)> = Vec::new(&env);
    let mut total_deposit: i128 = 0;
    let mut prev = 100u32;
    for i in 1..=10u32 {
        let end = 100 + i * 20;
        segments.push_back((end, 5i128));
        total_deposit += 5 * (end - prev) as i128;
        prev = end;
    }

    let (token_id, _) = setup_token(&env, &sponsor, total_deposit);
    client
        .create_variable_rate_stream(&sponsor, &recipient, &token_id, &5, &segments)
        .unwrap();

    let sched = client.get_variable_schedule(&recipient).unwrap();
    assert_eq!(sched.segments.len(), 10);
}
