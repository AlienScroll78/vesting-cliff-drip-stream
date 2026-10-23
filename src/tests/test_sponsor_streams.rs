//! Tests for sponsor stream index tracking.
#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::tests::{create_vesting_stream, generate_addresses, register_contract, setup_env};

#[test]
fn test_get_streams_for_sponsor_empty_initially() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let sponsor = Address::generate(&env);

    let streams = client.get_streams_for_sponsor(&sponsor);
    assert_eq!(streams.len(), 0);
}

#[test]
fn test_get_streams_for_sponsor_after_create() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    let streams = client.get_streams_for_sponsor(&sponsor);
    assert_eq!(streams.len(), 1);
    assert!(streams.contains(&recipient));
}

#[test]
fn test_get_streams_for_sponsor_multiple_recipients() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient_a) = generate_addresses(&env);
    let recipient_b = Address::generate(&env);

    create_vesting_stream(&env, &client, &sponsor, &recipient_a, 10, 50, 200);
    create_vesting_stream(&env, &client, &sponsor, &recipient_b, 5, 30, 100);

    let streams = client.get_streams_for_sponsor(&sponsor);
    assert_eq!(streams.len(), 2);
    assert!(streams.contains(&recipient_a));
    assert!(streams.contains(&recipient_b));
}
