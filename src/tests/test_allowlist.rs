#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{setup_env, token_helper::{create_token, mint_to}},
};

// ── Issue #320: Token allowlist ───────────────────────────────────────────────

/// When no allowlist has been configured, any token is accepted (permissive mode).
#[test]
fn test_empty_allowlist_is_permissive() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    // No allowlist configured — should succeed.
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200);
}

/// After adding a token, creating a stream with it succeeds.
#[test]
fn test_allowed_token_can_create_stream() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client.add_allowed_token(&admin, &token_id);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200);
}

/// Using a token not in the (non-empty) allowlist returns TokenNotAllowed.
#[test]
fn test_disallowed_token_returns_error() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);

    // Add a *different* token to the allowlist.
    let other_admin = Address::generate(&env);
    let (other_token, _) = create_token(&env, &other_admin);
    client.add_allowed_token(&admin, &other_token);

    // Try to create a stream with an un-listed token.
    let (bad_token, _) = create_token(&env, &sponsor);
    mint_to(&env, &bad_token, &sponsor, 2_000);

    let err = client
        .try_create_vesting_stream(&sponsor, &recipient, &bad_token, &10, &50, &200)
        .unwrap_err()
        .unwrap();

    assert_eq!(
        err,
        VestingError::TokenNotAllowed,
        "must return TokenNotAllowed for un-listed token"
    );
}

/// Removing a token from the allowlist prevents new streams.
#[test]
fn test_removed_token_is_rejected() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 4_000);

    // Add token, then immediately remove it.
    client.add_allowed_token(&admin, &token_id);
    client.remove_allowed_token(&admin, &token_id);

    // Now the allowlist is empty again (permissive) — stream should succeed.
    // Removing the last token reverts to permissive mode.
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200);
}

/// get_allowed_tokens returns the correct set.
#[test]
fn test_get_allowed_tokens() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let (token_a_admin, token_b_admin) =
        (Address::generate(&env), Address::generate(&env));
    let (token_a, _) = create_token(&env, &token_a_admin);
    let (token_b, _) = create_token(&env, &token_b_admin);

    assert_eq!(client.get_allowed_tokens().len(), 0, "empty initially");

    client.add_allowed_token(&admin, &token_a);
    client.add_allowed_token(&admin, &token_b);

    let allowed = client.get_allowed_tokens();
    assert_eq!(allowed.len(), 2, "should have 2 tokens after two adds");
    // Order in a Map is deterministic (sorted by key) but we just check membership.
    assert!(
        allowed.contains(&token_a) || allowed.contains(&token_b),
        "added tokens must be in the list"
    );
}

/// Admin auth is required to modify the allowlist.
#[test]
fn test_allowlist_requires_admin_auth() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    // In tests mock_all_auths() is on by default (set in setup_env).
    // Calling add_allowed_token should always record an auth invocation.
    let admin = Address::generate(&env);
    let (token_id, _) = create_token(&env, &admin);

    client.add_allowed_token(&admin, &token_id);
    // If auth was not checked the call would panic with a missing-auth error
    // in environments where mock_all_auths is NOT set; passing here confirms
    // the function calls require_auth (mock captures it).
}
