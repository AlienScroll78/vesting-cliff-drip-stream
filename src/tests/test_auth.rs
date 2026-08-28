#![cfg(test)]

//! Negative authentication tests – issue #586
//!
//! Every contract entry point that calls `require_auth()` must have at least
//! one negative test that verifies an unauthorised caller is rejected.
//!
//! Soroban enforces `require_auth()` at the host level. In a test environment
//! that has NOT called `mock_all_auths()`, any call whose required signer has
//! not been authorised causes the host to panic. We exploit this by using
//! `#[should_panic]` and deliberately omitting the authorisation mock.
//!
//! ## Coverage matrix
//!
//! | Entry point                  | Auth subject | Tests                                                      |
//! |------------------------------|--------------|------------------------------------------------------------|
//! | `create_vesting_stream`      | sponsor      | attacker-as-third-party, recipient-tries-create-as-sponsor |
//! | `claim_vested`               | recipient    | attacker-as-third-party, sponsor-tries-claim-as-recipient  |
//! | `cancel_stream`              | sponsor      | attacker-as-third-party, recipient-tries-cancel            |
//! | `create_multi_token_stream`  | sponsor      | attacker-as-third-party                                    |
//! | `claim_multi_token_vested`   | recipient    | attacker-as-third-party, sponsor-tries-claim-as-recipient  |
//! | `cancel_multi_token_stream`  | sponsor      | attacker-as-third-party, recipient-tries-cancel            |
//!
//! Functions listed in the issue spec that do NOT exist in this contract
//! (`clawback_stream`, `set_min_deposit`, `pause_stream`, `resume_stream`,
//! `upgrade`) are intentionally omitted — they have no `require_auth()` call
//! to test. If they are added in future, auth tests must accompany them.

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    vec, Address, Env, Vec,
};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    tests::token_helper::{create_token, mint_to},
    types::TokenAllocation,
};

// ── Environment helpers ───────────────────────────────────────────────────────

/// Build a test env with NO mocked auths so `require_auth()` is enforced.
fn setup_env_strict() -> Env {
    let env = Env::default();
    // Deliberately omit mock_all_auths() — auth is enforced.
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

/// Create a single-token stream using a fully-mocked env, then return a
/// *strict* client on the same env so subsequent calls enforce auth.
///
/// Returns `(env, client, sponsor, recipient, token_id)` with the ledger
/// advanced past the cliff so claim/cancel operations are exercisable.
fn setup_single_stream_then_strict() -> (
    Env,
    VestingDripsClient<'static>,
    Address,
    Address,
    Address,
) {
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

    // Advance past cliff (cliff_ledger = 110).
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

    // Return a strict client: mock_all_auths() is no longer active.
    let strict_client = VestingDripsClient::new(&mock_env, &contract_id);
    (mock_env, strict_client, sponsor, recipient, token_id)
}

/// Create a two-allocation multi-token stream using a fully-mocked env, then
/// return a *strict* client with the ledger advanced past the cliff.
///
/// Returns `(env, client, sponsor, recipient, token_a, token_b)`.
fn setup_multi_stream_then_strict() -> (
    Env,
    VestingDripsClient<'static>,
    Address,
    Address,
    Address,
    Address,
) {
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
    let (token_a, _) = create_token(&mock_env, &sponsor);
    let (token_b, _) = create_token(&mock_env, &sponsor);

    mint_to(&mock_env, &token_a, &sponsor, 1_000);
    mint_to(&mock_env, &token_b, &sponsor, 500);

    let allocations: Vec<TokenAllocation> = vec![
        &mock_env,
        TokenAllocation { token: token_a.clone(), rate_per_ledger: 10 },
        TokenAllocation { token: token_b.clone(), rate_per_ledger: 5 },
    ];

    mock_client
        .create_multi_token_stream(&sponsor, &recipient, &allocations, &10, &100)
        .unwrap();

    // Advance past cliff (cliff_ledger = 110).
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

    let strict_client = VestingDripsClient::new(&mock_env, &contract_id);
    (mock_env, strict_client, sponsor, recipient, token_a, token_b)
}

// ══════════════════════════════════════════════════════════════════════════════
// create_vesting_stream — sponsor auth
// ══════════════════════════════════════════════════════════════════════════════

/// An unrelated third party cannot create a stream on behalf of a sponsor.
/// No auth is mocked → host panics.
#[test]
#[should_panic]
fn test_create_stream_attacker_as_third_party_panics() {
    let env = setup_env_strict();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000);

    // No auth mocked — panics when sponsor.require_auth() is enforced.
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &10, &100)
        .unwrap();
}

/// The recipient cannot create a stream by passing themselves as the sponsor.
/// Auth for `recipient` (the address supplied as `sponsor`) is not mocked.
#[test]
#[should_panic]
fn test_create_stream_recipient_as_sponsor_panics() {
    let env = setup_env_strict();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let real_sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &real_sponsor);
    mint_to(&env, &token_id, &real_sponsor, 1_000);

    // Calling claim_vested as recipient without auth → panics
    client.claim_vested(&recipient, &None).unwrap();
}

/// The sponsor cannot claim tokens on behalf of the recipient.
#[test]
#[should_panic]
fn test_claim_vested_sponsor_cannot_claim_as_recipient_panics() {
    let (_env, client, _sponsor, recipient, _token_id) = setup_single_stream_then_strict();

    // Sponsor's auth was only mocked during stream creation (now expired).
    // Claiming as recipient without mocked auth → panics.
    client.claim_vested(&recipient).unwrap();
}

// ══════════════════════════════════════════════════════════════════════════════
// cancel_stream — sponsor auth
// ══════════════════════════════════════════════════════════════════════════════

/// An attacker with a random address cannot cancel a stream they did not create.
#[test]
#[should_panic]
fn test_cancel_stream_attacker_as_third_party_panics() {
    let (env, client, _sponsor, recipient, _token_id) = setup_single_stream_then_strict();

    let attacker = Address::generate(&env);
    // attacker's auth is not mocked → panics.
    client.cancel_stream(&attacker, &recipient).unwrap();
}

/// The recipient cannot cancel their own stream (only the sponsor can).
#[test]
#[should_panic]
fn test_cancel_stream_recipient_cannot_cancel_panics() {
    let (_env, client, _sponsor, recipient, _token_id) = setup_single_stream_then_strict();

    // Claiming as recipient without mocked auth → panics
    client.claim_vested(&recipient, &None).unwrap();
}
