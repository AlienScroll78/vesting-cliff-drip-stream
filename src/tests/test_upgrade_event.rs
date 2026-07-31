//! Tests for the admin upgrade mechanism with ContractUpgraded event (issue #313).

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, BytesN};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::setup_env,
};

fn make_client(env: &soroban_sdk::Env) -> VestingDripsClient {
    let contract_id = env.register(VestingDrips, ());
    VestingDripsClient::new(env, &contract_id)
}

fn treasury(env: &soroban_sdk::Env) -> Address {
    Address::generate(env)
}

/// `initialize` stores the admin so `upgrade` can gate against it.
#[test]
fn test_initialize_sets_admin() {
    let env = setup_env();
    let client = make_client(&env);

    let admin = Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury(&env));
    // No assertion needed — would panic on error.
}

/// `initialize` cannot be called twice (prevents admin hijack).
#[test]
fn test_initialize_twice_rejected() {
    let env = setup_env();
    let client = make_client(&env);

    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury(&env));

    let err = client
        .try_initialize(&attacker, &0u32, &treasury(&env))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::AlreadyInitialized);
}

/// `upgrade` must reject a caller that is not the stored admin.
#[test]
fn test_upgrade_rejects_non_admin() {
    let env = setup_env();
    let client = make_client(&env);

    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury(&env));

    let mock_hash = BytesN::from_array(&env, &[7u8; 32]);
    let err = client.try_upgrade(&attacker, &mock_hash).unwrap_err().unwrap();
    assert_eq!(err, VestingError::Unauthorized);
}

/// `upgrade` passes the admin gate (host rejects only on missing WASM).
#[test]
fn test_upgrade_allows_admin_through_auth_gate() {
    let env = setup_env();
    let client = make_client(&env);

    let admin = Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury(&env));

    let mock_hash = BytesN::from_array(&env, &[7u8; 32]);
    let result = client.try_upgrade(&admin, &mock_hash);

    match result {
        Ok(_) => {}
        Err(e) => {
            if let Ok(err) = e {
                assert_ne!(err, VestingError::Unauthorized);
            }
        }
    }
}

/// `transfer_admin` moves authority to `new_admin`; old admin then loses access.
#[test]
fn test_transfer_admin_changes_authority() {
    let env = setup_env();
    let client = make_client(&env);

    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury(&env));

    client.transfer_admin(&admin, &new_admin);

    let mock_hash = BytesN::from_array(&env, &[9u8; 32]);

    // Old admin now unauthorized.
    let old_result = client.try_upgrade(&admin, &mock_hash).unwrap_err().unwrap();
    assert_eq!(old_result, VestingError::Unauthorized);

    // New admin passes auth gate.
    let new_result = client.try_upgrade(&new_admin, &mock_hash);
    match new_result {
        Ok(_) => {}
        Err(e) => {
            if let Ok(err) = e {
                assert_ne!(err, VestingError::Unauthorized);
            }
        }
    }
}

/// Non-admin cannot call `transfer_admin`.
#[test]
fn test_transfer_admin_rejects_non_admin() {
    let env = setup_env();
    let client = make_client(&env);

    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury(&env));

    let err = client
        .try_transfer_admin(&attacker, &attacker)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VestingError::Unauthorized);
}
