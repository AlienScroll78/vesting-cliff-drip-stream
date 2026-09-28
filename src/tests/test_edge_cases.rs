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

