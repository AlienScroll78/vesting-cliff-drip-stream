#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{calculate_total_deposit, VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{
        advance_ledger, create_vesting_stream, generate_addresses, register_contract, setup_env, setup_token,
        token_helper::{create_token, mint_to},
    },
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
fn test_multiple_independent_streams() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient_a) = generate_addresses(&env);
    let recipient_b = Address::generate(&env);
    let (token_id, tc) = setup_token(&env, &sponsor, 5_000);

    client
        .create_vesting_stream(&sponsor, &recipient_a, &token_id, &10, &50, &200);
    client
        .create_vesting_stream(&sponsor, &recipient_b, &token_id, &15, &20, &200);

    advance_ledger(&env, 70);

    let claimed_a = client.claim_vested(&recipient_a);
    let claimed_b = client.claim_vested(&recipient_b);

    assert_eq!(claimed_a, 700);
    assert_eq!(claimed_b, 1_050);
    assert_eq!(tc.balance(&recipient_a), 700);
    assert_eq!(tc.balance(&recipient_b), 1_050);
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

    assert_eq!(tc.balance(&recipient), 500);
}

#[test]
fn test_regression_cliff_equals_total_minus_one() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let (token_id, _) = create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 99, 100);
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
        .try_create_vesting_stream(&sponsor, &recipient, &token_id, &-1, &50, &100)
        .unwrap_err();
    assert_eq!(err, Ok(VestingError::InvalidRate));
}

// ── TTL bump & expiry tests ───────────────────────────────────────────────────

/// TTL write path: `set_schedule` bumps TTL to PERSISTENT_BUMP_AMOUNT (518_400) ledgers.
/// Verified via `env.as_contract` + `get_ttl`.
///
/// TTL = bump_amount - 1 because the current ledger is counted during creation.
#[test]
fn test_ttl_bumped_on_write() {
    use crate::types::DataKey;
    use soroban_sdk::testutils::storage::Persistent;

    let env = setup_env();
    let (contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 10, 100);

    // PERSISTENT_BUMP_AMOUNT = 3_110_400; TTL doesn't include current ledger,
    // so initial TTL = 3_110_400 - 1 = 3_110_399 (or 3_110_400 depending on SDK).
    env.as_contract(&contract_id, || {
        let ttl = env
            .storage()
            .persistent()
            .get_ttl(&DataKey::Schedule(recipient.clone()));
        assert!(ttl == 3_110_399 || ttl == 3_110_400);
    });
}

/// TTL read path: mutating and view calls re-extend TTL to max window when below threshold.
#[test]
fn test_ttl_bumped_on_read() {
    use crate::types::DataKey;
    use soroban_sdk::testutils::storage::Persistent;

    let env = setup_env(); // sequence_number = 100
    let (contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    let (token_id, _) = create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 10, 500_000);

    // Keep token contract instance active when advancing ledgers
    env.as_contract(&token_id, || {
        env.storage().instance().extend_ttl(100, 3_110_400);
    });

    // Advance 200,000 ledgers (TTL decays to 2,910,399, below 3,000,000 threshold).
    advance_ledger(&env, 200_000);

    env.as_contract(&contract_id, || {
        let ttl = env
            .storage()
            .persistent()
            .get_ttl(&DataKey::Schedule(recipient.clone()));
        assert!(ttl == 2_910_399 || ttl == 2_910_400);
    });

    // A mutating/read call (get_schedule) re-bumps TTL.
    client.get_schedule(&recipient);

    // TTL is restored relative to the new current ledger.
    env.as_contract(&contract_id, || {
        let ttl = env
            .storage()
            .persistent()
            .get_ttl(&DataKey::Schedule(recipient.clone()));
        assert!(ttl == 3_110_399 || ttl == 3_110_400);
    });
}

/// Views (claimable_amount, get_schedule, is_cliff_passed) bump TTL on read when below threshold.
#[test]
fn test_claimable_amount_bumps_ttl_on_read() {
    use crate::types::DataKey;
    use soroban_sdk::testutils::storage::Persistent;

    let env = setup_env(); // sequence_number = 100
    let (contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    let (token_id, _) = create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 10, 500_000);

    // Keep token contract instance active when advancing ledgers
    env.as_contract(&token_id, || {
        env.storage().instance().extend_ttl(100, 3_110_400);
    });

    // Advance 200,000 ledgers (TTL decays to 2,910,399, below 3,000,000 threshold).
    advance_ledger(&env, 200_000);

    // View call bumps TTL to max window.
    client.claimable_amount(&recipient);

    env.as_contract(&contract_id, || {
        let ttl = env
            .storage()
            .persistent()
            .get_ttl(&DataKey::Schedule(recipient.clone()));
        assert!(ttl == 3_110_399 || ttl == 3_110_400);
    });
}

/// Expiry path test.
#[test]
fn test_expired_ttl_reaches_zero_and_cancelled_stream_returns_schedule_not_found() {
    use crate::types::DataKey;
    use soroban_sdk::testutils::storage::Persistent;

    let env = setup_env(); // sequence_number = 100
    let (contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    let (token_id, _) = create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 10, 100);

    // Advance exactly 3_110_399 ledgers — TTL hits 0 (archived state).
    advance_ledger(&env, 3_110_399);

    env.as_contract(&contract_id, || {
        assert_eq!(
            env.storage()
                .persistent()
                .get_ttl(&DataKey::Schedule(recipient.clone())),
            0
        );
    });

    // Fresh setup to verify explicit cancel removal error path:
    let env2 = setup_env();
    let (_contract_id2, client2) = register_contract(&env2);
    let (sponsor2, recipient2) = generate_addresses(&env2);
    create_vesting_stream(&env2, &client2, &sponsor2, &recipient2, 10, 10, 100);

    // Cancel removes the entry from storage entirely.
    client2.cancel_stream(&sponsor2, &recipient2);

    // Subsequent calls now return ScheduleNotFound because the entry was removed.
    let err = client2.try_claim_vested(&recipient2).unwrap_err();
    assert_eq!(err, Ok(VestingError::ScheduleNotFound));

    let err2 = client2.try_cancel_stream(&sponsor2, &recipient2).unwrap_err();
    assert_eq!(err2, Ok(VestingError::ScheduleNotFound));
}
