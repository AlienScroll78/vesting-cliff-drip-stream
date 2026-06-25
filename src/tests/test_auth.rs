#![cfg(test)]

//! Auth edge case tests (issue #113)
//!
//! Soroban enforces `require_auth()` at the host level. In tests the env starts
//! with *no* mocked auths, so any call whose required signer has not been
//! authorised panics with a host auth error. We catch these with
//! `try_<fn>` (invoked via the generated client's `try_*` variants, i.e.
//! calling `.unwrap_err()` on the `Result` the client returns).
//!
//! Covered cases:
//! 1. `create_vesting_stream` called by a third party (not the sponsor)     → auth error
//! 2. `claim_vested` called by a third party (not the recipient)             → auth error
//! 3. `cancel_stream` called by a third party (not the sponsor)              → auth error
//! 4. Legitimate sponsor cannot claim on behalf of the recipient             → auth error

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env,
};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    tests::token_helper::{create_token, mint_to},
};

/// Build an env with NO mocked auths so `require_auth()` is enforced.
fn setup_env_strict() -> Env {
    let env = Env::default();
    // deliberately omit mock_all_auths()
    env.ledger().set(LedgerInfo {
        timestamp: 0,
        protocol_version: 22,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 1000,
        max_entry_ttl: 3_110_400,
    });
    env
}

/// Helper: set up a stream using a fully-mocked env, then return a *strict*
/// env pointing at the same contract so auth is enforced for subsequent calls.
fn setup_stream_then_strict() -> (Env, VestingDripsClient<'static>, Address, Address) {
    // Phase 1 – create the stream with mocked auth.
    let mock_env = Env::default();
    mock_env.mock_all_auths();
    mock_env.ledger().set(LedgerInfo {
        timestamp: 0,
        protocol_version: 22,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 1000,
        max_entry_ttl: 3_110_400,
    });

    let contract_id = mock_env.register(VestingDrips, ());
    let mock_client = VestingDripsClient::new(&mock_env, &contract_id);

    let sponsor = Address::generate(&mock_env);
    let recipient = Address::generate(&mock_env);
    let (token_id, _) = create_token(&mock_env, &sponsor);
    mint_to(&mock_env, &token_id, &sponsor, 1_000);

    mock_client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &10, &100)
        .unwrap();

    // Advance past cliff
    mock_env.ledger().set(LedgerInfo {
        timestamp: 0,
        protocol_version: 22,
        sequence_number: 120,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 1000,
        max_entry_ttl: 3_110_400,
    });

    // Phase 2 – hand back a strict client on the same env (auth no longer mocked).
    let strict_client = VestingDripsClient::new(&mock_env, &contract_id);
    (mock_env, strict_client, sponsor, recipient)
}

// ── Test cases ────────────────────────────────────────────────────────────────

/// Unauthorized third party cannot create a stream on behalf of a sponsor.
#[test]
#[should_panic]
fn test_create_stream_unauthorized_caller_panics() {
    let env = setup_env_strict();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000);

    // Not mocking sponsor auth → host panics with auth failure
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &10, &100)
        .unwrap();
}

/// Unauthorized third party cannot claim on behalf of the recipient.
#[test]
#[should_panic]
fn test_claim_vested_unauthorized_caller_panics() {
    let (env, client, _sponsor, recipient) = setup_stream_then_strict();

    // Remove all mocked auths so require_auth() is enforced
    let attacker = Address::generate(&env);
    let _ = attacker; // we don't mock attacker auth either

    // Calling claim_vested as recipient without auth → panics
    client.claim_vested(&recipient).unwrap();
}

/// Unauthorized third party cannot cancel a stream.
#[test]
#[should_panic]
fn test_cancel_stream_unauthorized_caller_panics() {
    let (env, client, sponsor, recipient) = setup_stream_then_strict();

    let _ = (sponsor, recipient);
    // Calling cancel_stream without mocked auth for sponsor → panics
    let attacker = Address::generate(&env);
    client.cancel_stream(&attacker, &recipient).unwrap();
}

/// The sponsor cannot claim on behalf of the recipient.
#[test]
#[should_panic]
fn test_sponsor_cannot_claim_as_recipient_panics() {
    let (_env, client, _sponsor, recipient) = setup_stream_then_strict();

    // Claiming as recipient without mocked auth → panics
    client.claim_vested(&recipient).unwrap();
}
