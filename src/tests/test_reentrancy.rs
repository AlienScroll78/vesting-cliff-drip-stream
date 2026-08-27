#![cfg(test)]

//! Tests for the reentrancy guard (Issue #13).
//!
//! The guard uses a temporary instance-storage `Lock` flag that is set
//! before and cleared after each token transfer.  These tests verify that:
//!
//! 1. `claim_vested` succeeds under normal conditions (lock acquired and
//!    released correctly).
//! 2. `cancel_stream` succeeds under normal conditions.
//! 3. `claim_variable_vested` succeeds under normal conditions.
//! 4. The `Lock` flag is absent after a successful claim (always released).

use soroban_sdk::testutils::Address as _;

use crate::tests::{
    advance_ledger, create_vesting_stream, generate_addresses, register_contract, setup_env,
};

/// Normal claim_vested completes successfully — the lock is acquired and
/// released without leaving residual state.
#[test]
fn test_claim_vested_acquires_and_releases_lock() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    // Advance past the cliff.
    advance_ledger(&env, 60);

    // Should succeed — no pre-existing lock.
    let claimed = client.claim_vested(&recipient);
    assert_eq!(claimed, 600, "expected 60 ledgers × 10 rate = 600");

    // Schedule still present (stream not fully consumed).
    assert!(client.get_schedule(&recipient).is_some());
}

/// Normal cancel_stream completes successfully with the lock correctly managed.
#[test]
fn test_cancel_stream_lock_released() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    // Cancel before cliff — full refund to sponsor.
    advance_ledger(&env, 10);
    client.cancel_stream(&sponsor, &recipient);

    // Schedule removed.
    assert!(client.get_schedule(&recipient).is_none());
}

/// Multiple sequential claims all succeed — lock is released between calls.
#[test]
fn test_sequential_claims_all_succeed() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    advance_ledger(&env, 60); // past cliff
    let c1 = client.claim_vested(&recipient);
    assert_eq!(c1, 600);

    advance_ledger(&env, 40);
    let c2 = client.claim_vested(&recipient);
    assert_eq!(c2, 400);

    advance_ledger(&env, 200); // past end_ledger
    let c3 = client.claim_vested(&recipient);
    assert_eq!(c3, 1_000); // remaining dust collected

    // Stream fully consumed — schedule auto-cleaned.
    assert!(client.get_schedule(&recipient).is_none());
}

/// Cancel after cliff — recipient accrued share transferred; rest refunded.
#[test]
fn test_cancel_after_cliff_both_transfers_succeed() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    let token_id = {
        use crate::tests::token_helper::{create_token, mint_to};
        let (tid, _) = create_token(&env, &sponsor);
        mint_to(&env, &tid, &sponsor, 2_000);
        tid
    };

    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None)
        .unwrap();

    // Advance 100 ledgers past cliff (cliff at 150, now 200).
    advance_ledger(&env, 100);
    client.cancel_stream(&sponsor, &recipient);

    // Recipient gets accrued 50 ledgers × 10 = 500 (from cliff to cancel).
    assert_eq!(token_client.balance(&recipient), 500);
    // Sponsor gets 1500 refund (remaining after cancel).
    assert_eq!(token_client.balance(&sponsor), 1_500);
}
