#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    error::VestingError,
    tests::{create_vesting_stream, generate_addresses, register_contract, setup_env, setup_token},
};

#[test]
fn test_default_fee_is_zero() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    // Default fee is 0 bps — full deposit goes to stream, no fee collected
    let (_token_id, token_client) = create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    // Sponsor balance after 2,000 token deposit is 0 (minted exactly 2,000)
    assert_eq!(token_client.balance(&sponsor), 0);
}

#[test]
fn test_set_fee_and_fee_collection_success() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);

    client.initialize(&admin);

    // Admin configures 250 bps (2.5%) protocol fee
    client.set_fee(&admin, &250, &treasury);

    // Total deposit = 10 * 200 = 2,000
    // Fee = 2,000 * 250 / 10,000 = 50 tokens
    // Mint 2,050 tokens to sponsor so sponsor can cover deposit + fee
    let (token_id, token_client) = setup_token(&env, &sponsor, 2_050);

    client.create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200);

    // Treasury received 50 tokens fee
    assert_eq!(token_client.balance(&treasury), 50);
}

#[test]
fn test_set_fee_exceeds_max_cap_fails() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    client.initialize(&admin);

    // 501 bps (5.01%) exceeds max cap of 500 bps (5%)
    let err = client.try_set_fee(&admin, &501, &treasury).unwrap_err();
    assert_eq!(err, Ok(VestingError::InvalidRate));
}

#[test]
fn test_non_admin_cannot_set_fee() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let treasury = Address::generate(&env);

    client.initialize(&admin);

    let err = client.try_set_fee(&attacker, &100, &treasury).unwrap_err();
    assert_eq!(err, Ok(VestingError::Unauthorized));
}
