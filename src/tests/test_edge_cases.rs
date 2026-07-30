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

/// TTL read path: mutating calls (via `storage::get_schedule`) re-extend TTL.
///
/// Verify that after ledger advances (reducing TTL), a contract call that
/// reads the schedule on a mutating path bumps TTL back to
/// PERSISTENT_BUMP_AMOUNT - 1 from the new ledger.
#[test]
fn test_ttl_bumped_on_read() {
    use crate::types::DataKey;
    use soroban_sdk::testutils::storage::Persistent;

    let env = setup_env(); // sequence_number = 100
    let (contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 10, 100);

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

    // A mutating call (claim_vested → storage::get_schedule) re-bumps TTL.
    client.claim_vested(&recipient);

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

/// Perf optimisation (issue #16): pure read-only views must NOT bump TTL.
///
/// `claimable_amount` is called on every UI refresh, far more often than any
/// mutating entry point. Routing it through `storage::get_schedule_readonly`
/// skips the `extend_ttl` host call entirely, cutting its instruction cost
/// without changing the returned value.
#[test]
fn test_claimable_amount_does_not_bump_ttl() {
    use soroban_sdk::testutils::storage::Persistent;
    use crate::types::DataKey;

    let env = setup_env(); // sequence_number = 100
    let (contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 10, 100);

    // Advance 200_000 ledgers without any contract interaction.
    // TTL decays from 518_399 to 318_399.
    advance_ledger(&env, 200_000);

    // A pure view call must not touch the entry's TTL.
    client.claimable_amount(&recipient);

    env.as_contract(&contract_id, || {
        assert_eq!(
            env.storage()
                .persistent()
                .get_ttl(&DataKey::Schedule(recipient.clone())),
            318_399
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
    use crate::types::DataKey;
    use soroban_sdk::testutils::storage::Persistent;

    let env = setup_env(); // sequence_number = 100
    let (contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 10, 100);

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
    client.cancel_stream(&sponsor, &recipient);

    // Subsequent calls now return ScheduleNotFound because the entry was removed.
    let err = client.try_claim_vested(&recipient).unwrap_err();
    assert_eq!(err, Ok(VestingError::ScheduleNotFound));

    let err2 = client.try_cancel_stream(&sponsor, &recipient).unwrap_err();
    assert_eq!(err2, Ok(VestingError::ScheduleNotFound));
}
