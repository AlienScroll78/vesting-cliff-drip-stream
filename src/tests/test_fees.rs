#![cfg(test)]

//! Tests for the protocol fee feature (Issue #4).
//!
//! Covers:
//! - Zero fee → recipient gets full amount.
//! - Non-zero fee → treasury receives fee, recipient receives net.
//! - 100 bps = exactly 1% deducted.
//! - Max fee (500 bps = 5%) works correctly.
//! - Fee > 500 bps rejected by set_fee.
//! - get_fee_config returns correct values.

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{advance_ledger, setup_env, token_helper::{create_token, mint_to}},
};

/// Helper: create a contract with a given fee_bps and treasury.
fn make_client_with_fee(env: &soroban_sdk::Env, fee_bps: u32) -> (VestingDripsClient, Address, Address) {
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    client.initialize(&admin, &fee_bps, &treasury);
    (client, admin, treasury)
}

/// Zero fee: recipient receives the full claimable amount.
#[test]
fn test_zero_fee_recipient_gets_full_amount() {
    let env = setup_env();
    let (client, _, treasury) = make_client_with_fee(&env, 0);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    // rate=10, cliff=50, total=200 → deposit=2000 (raw, no RATE_DECIMALS scaling here)
    mint_to(&env, &token_id, &sponsor, 2_000);

    client.create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None);

    // Advance exactly to cliff.
    advance_ledger(&env, 50);
    let claimed = client.claim_vested(&recipient, &None).unwrap();

    // With 0 bps fee, recipient gets the full claimable amount.
    assert!(claimed > 0, "should have claimed something");
    assert_eq!(token_client.balance(&treasury), 0, "treasury should receive nothing at 0 bps");
    assert_eq!(token_client.balance(&recipient), claimed);
}

/// 100 bps = 1%: treasury gets exactly 1%, recipient gets 99%.
#[test]
fn test_fee_100_bps_deducts_one_percent() {
    let env = setup_env();
    let (client, admin, treasury) = make_client_with_fee(&env, 0);

    // Update to 100 bps after init.
    client.set_fee(&admin, &100u32, &treasury);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    // rate=100, cliff=1, total=100 → deposit=10_000
    mint_to(&env, &token_id, &sponsor, 10_000);

    client.create_vesting_stream(&sponsor, &recipient, &token_id, &100, &1, &100, &None);

    // Advance 1 ledger past cliff; claimed = 1 ledger × 100 = 100 tokens.
    advance_ledger(&env, 1);
    let net = client.claim_vested(&recipient, &None).unwrap();

    let treasury_balance = token_client.balance(&treasury);
    let recipient_balance = token_client.balance(&recipient);

    // fee = 100 * 100 / 10_000 = 1; net = 99
    assert_eq!(treasury_balance, 1, "treasury should receive 1% (1 token)");
    assert_eq!(recipient_balance, 99, "recipient should receive 99 tokens");
    assert_eq!(net, 99, "return value should be net amount");
}

/// 500 bps = 5% (max fee): treasury gets exactly 5%, recipient gets 95%.
#[test]
fn test_fee_500_bps_max_fee() {
    let env = setup_env();
    let (client, admin, treasury) = make_client_with_fee(&env, 0);

    client.set_fee(&admin, &500u32, &treasury);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    // rate=200, cliff=1, total=100 → deposit=20_000
    mint_to(&env, &token_id, &sponsor, 20_000);

    client.create_vesting_stream(&sponsor, &recipient, &token_id, &200, &1, &100, &None);

    // Advance 1 ledger past cliff; claimable = 200 tokens.
    advance_ledger(&env, 1);
    let net = client.claim_vested(&recipient, &None).unwrap();

    // fee = 200 * 500 / 10_000 = 10; net = 190
    assert_eq!(token_client.balance(&treasury), 10, "treasury should receive 5% (10 tokens)");
    assert_eq!(token_client.balance(&recipient), 190, "recipient should receive 190 tokens");
    assert_eq!(net, 190, "return value should be net amount");
}

/// fee_bps > 500 is rejected by set_fee with InvalidRate (code 4).
#[test]
fn test_fee_above_500_bps_rejected() {
    let env = setup_env();
    let (client, admin, treasury) = make_client_with_fee(&env, 0);

    let err = client.try_set_fee(&admin, &501u32, &treasury).unwrap_err().unwrap();
    assert_eq!(err, VestingError::InvalidRate, "fee_bps > 500 must return InvalidRate");
}

/// fee_bps > 500 is also rejected by initialize.
#[test]
fn test_initialize_rejects_fee_above_500_bps() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    let err = client.try_initialize(&admin, &501u32, &treasury).unwrap_err().unwrap();
    assert_eq!(err, VestingError::InvalidRate, "initialize must reject fee_bps > 500");
}

/// get_fee_config returns the configured values.
#[test]
fn test_get_fee_config_returns_configured_values() {
    let env = setup_env();
    let (client, admin, treasury) = make_client_with_fee(&env, 0);

    client.set_fee(&admin, &250u32, &treasury);

    let (fee_bps, config_treasury) = client.get_fee_config().unwrap();
    assert_eq!(fee_bps, 250, "get_fee_config must return configured bps");
    assert_eq!(config_treasury, treasury, "get_fee_config must return configured treasury");
}

/// get_fee_config returns 0 bps when no fee is set.
#[test]
fn test_get_fee_config_returns_zero_when_not_set() {
    let env = setup_env();
    let (client, _, _) = make_client_with_fee(&env, 0);

    let (fee_bps, _) = client.get_fee_config().unwrap();
    assert_eq!(fee_bps, 0, "get_fee_config must return 0 when no fee configured");
}

/// Multiple claims all apply the fee correctly.
#[test]
fn test_fee_applied_on_every_claim() {
    let env = setup_env();
    let (client, admin, treasury) = make_client_with_fee(&env, 0);

    client.set_fee(&admin, &100u32, &treasury); // 1% fee

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    // rate=1000, cliff=1, total=100 → deposit=100_000
    mint_to(&env, &token_id, &sponsor, 100_000);

    client.create_vesting_stream(&sponsor, &recipient, &token_id, &1000, &1, &100, &None);

    // First claim: 1 ledger × 1000 = 1000 tokens; fee = 10; net = 990.
    advance_ledger(&env, 1);
    let net1 = client.claim_vested(&recipient, &None).unwrap();
    assert_eq!(net1, 990);

    // Second claim: advance 10 more; 10 × 1000 = 10_000; fee = 100; net = 9_900.
    advance_ledger(&env, 10);
    let net2 = client.claim_vested(&recipient, &None).unwrap();
    assert_eq!(net2, 9_900);

    let total_treasury = token_client.balance(&treasury);
    assert_eq!(total_treasury, 110, "treasury accumulates 10 + 100 = 110");
}
