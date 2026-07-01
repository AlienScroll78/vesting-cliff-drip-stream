//! Tests that verify `TransferFailed` (code 9) is returned — and no state is
//! mutated — when the underlying SAC token rejects a transfer.
//!
//! The SAC built-in supports `set_authorized(address, false)` which freezes an
//! account so that all transfers to/from it are rejected by the token contract.
//! We use this as a lightweight stand-in for any "token-level rejection" (frozen
//! account, clawback, etc.) without needing a custom mock contract.

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{advance_ledger, setup_env},
};

use super::super::tests::token_helper::{create_token, mint_to};

// ── Helper ────────────────────────────────────────────────────────────────────

/// Freeze `account` so that any SAC transfer involving it will be rejected.
fn freeze_account(env: &soroban_sdk::Env, token: &Address, account: &Address) {
    StellarAssetClient::new(env, token).set_authorized(account, &false);
}

// ── create_vesting_stream ────────────────────────────────────────────────────

/// When the sponsor's account is frozen the deposit transfer fails.
/// The schedule must NOT be written to storage.
#[test]
fn test_create_transfer_failed_no_schedule_written() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // Mint tokens but then freeze the sponsor before the stream is created.
    mint_to(&env, &token_id, &sponsor, 2_000);
    freeze_account(&env, &token_id, &sponsor);

    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap_err();

    assert_eq!(err, VestingError::TransferFailed.into());

    // No schedule should have been persisted.
    assert!(
        client.get_schedule(&recipient).is_none(),
        "schedule must not be written when deposit transfer fails"
    );
}

// ── claim_vested ─────────────────────────────────────────────────────────────

/// When the recipient's account is frozen, `claim_vested` returns
/// `TransferFailed` and leaves `last_claimed_ledger` unchanged.
#[test]
fn test_claim_transfer_failed_schedule_not_mutated() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // rate=10, cliff=50, total=200 → deposit=2000; cliff_ledger=150
    mint_to(&env, &token_id, &sponsor, 2_000);
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Advance past the cliff.
    advance_ledger(&env, 60); // ledger 160

    // Capture pre-attempt schedule.
    let schedule_before = client.get_schedule(&recipient).unwrap();

    // Freeze the recipient so the outbound transfer will be rejected.
    freeze_account(&env, &token_id, &recipient);

    let err = client.claim_vested(&recipient).unwrap_err();
    assert_eq!(err, VestingError::TransferFailed.into());

    // Schedule must be untouched — last_claimed_ledger not advanced.
    let schedule_after = client.get_schedule(&recipient).unwrap();
    assert_eq!(
        schedule_after.last_claimed_ledger,
        schedule_before.last_claimed_ledger,
        "last_claimed_ledger must not advance when transfer fails"
    );
}

/// When the stream is fully consumed (active_end == end_ledger) but the
/// transfer fails, the schedule must NOT be removed from storage.
#[test]
fn test_claim_final_transfer_failed_schedule_preserved() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // rate=10, cliff=50, total=100 → deposit=1000; end_ledger=200
    mint_to(&env, &token_id, &sponsor, 1_000);
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &100)
        .unwrap();

    // Advance past end of stream.
    advance_ledger(&env, 110); // ledger 210, past end_ledger=200

    freeze_account(&env, &token_id, &recipient);

    let err = client.claim_vested(&recipient).unwrap_err();
    assert_eq!(err, VestingError::TransferFailed.into());

    // Schedule must still exist — not removed on transfer failure.
    assert!(
        client.get_schedule(&recipient).is_some(),
        "schedule must not be removed when final claim transfer fails"
    );
}

// ── cancel_stream ─────────────────────────────────────────────────────────────

/// After cliff: if the recipient's account is frozen, the recipient-share
/// transfer fails and the schedule must remain intact.
#[test]
fn test_cancel_recipient_frozen_schedule_not_removed() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // rate=10, cliff=50, total=200 → deposit=2000; cliff_ledger=150
    mint_to(&env, &token_id, &sponsor, 2_000);
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Advance past the cliff so recipient has a non-zero share.
    advance_ledger(&env, 60); // ledger 160

    // Freeze the recipient.
    freeze_account(&env, &token_id, &recipient);

    let err = client.cancel_stream(&sponsor, &recipient).unwrap_err();
    assert_eq!(err, VestingError::TransferFailed.into());

    // Schedule must still be present — cancel did not commit.
    assert!(
        client.get_schedule(&recipient).is_some(),
        "schedule must not be removed when cancel transfer fails"
    );
}

/// Before cliff: only the sponsor receives a refund. If the sponsor's account
/// is frozen the transfer fails and the schedule is preserved.
#[test]
fn test_cancel_before_cliff_sponsor_frozen_schedule_not_removed() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

    // rate=10, cliff=50, total=200 → deposit=2000; cliff_ledger=150
    mint_to(&env, &token_id, &sponsor, 2_000);
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Still before cliff (ledger 100 < cliff_ledger 150).

    // Freeze the sponsor so the refund transfer will fail.
    freeze_account(&env, &token_id, &sponsor);

    let err = client.cancel_stream(&sponsor, &recipient).unwrap_err();
    assert_eq!(err, VestingError::TransferFailed.into());

    // Schedule must be intact — nothing was removed.
    assert!(
        client.get_schedule(&recipient).is_some(),
        "schedule must not be removed when refund transfer fails"
    );
}
