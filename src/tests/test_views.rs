#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    storage::{PERSISTENT_BUMP_AMOUNT, PERSISTENT_LEDGER_THRESHOLD},
    tests::{advance_ledger, setup_env},
};

use super::super::tests::token_helper::{create_token, mint_to};

#[test]
fn test_claimable_amount_before_cliff_is_zero() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    advance_ledger(&env, 30);
    assert_eq!(client.claimable_amount(&recipient), 0);
}

#[test]
fn test_claimable_amount_after_cliff() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    advance_ledger(&env, 75); // 75 ledgers past start → 75 × 10 = 750
    assert_eq!(client.claimable_amount(&recipient), 750);
}

#[test]
fn test_is_cliff_passed() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    assert!(!client.is_cliff_passed(&recipient));
    advance_ledger(&env, 50);
    assert!(client.is_cliff_passed(&recipient));
}

#[test]
fn test_get_schedule_returns_none_after_completion() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    advance_ledger(&env, 300);
    client.claim_vested(&recipient).unwrap();

    assert!(client.get_schedule(&recipient).is_none());
}

// ── get_stream_info tests ─────────────────────────────────────────────────────

#[test]
fn test_get_stream_info_returns_none_for_unknown_recipient() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let unknown = Address::generate(&env);
    assert!(client.get_stream_info(&unknown).is_none());
}

#[test]
fn test_get_stream_info_before_cliff() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    // rate=10, cliff=50, total=200 → deposit=2000
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Query before cliff (ledger 100, cliff at 150)
    let info = client.get_stream_info(&recipient).unwrap();
    assert_eq!(info.total_deposit, 2_000);
    assert_eq!(info.claimed_so_far, 0);
    assert_eq!(info.claimable_now, 0); // cliff not reached
    assert_eq!(info.remaining_locked, 2_000);
    assert_eq!(info.percent_vested_bps, 0);
    assert!(!info.cliff_reached);
    assert!(!info.stream_ended);
}

#[test]
fn test_get_stream_info_at_cliff() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Advance exactly to the cliff (ledger 150 = 100 + 50).
    advance_ledger(&env, 50);

    let info = client.get_stream_info(&recipient).unwrap();
    assert_eq!(info.total_deposit, 2_000);
    assert_eq!(info.claimed_so_far, 0);
    // 50 ledgers × 10 = 500 claimable
    assert_eq!(info.claimable_now, 500);
    assert_eq!(info.remaining_locked, 1_500); // 2000 - 0 - 500
    assert_eq!(info.percent_vested_bps, 0); // nothing claimed yet
    assert!(info.cliff_reached);
    assert!(!info.stream_ended);
}

#[test]
fn test_get_stream_info_mid_stream_after_claim() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Advance to ledger 200 and claim.
    advance_ledger(&env, 100);
    client.claim_vested(&recipient).unwrap(); // claims 1000 (100 × 10)

    let info = client.get_stream_info(&recipient).unwrap();
    assert_eq!(info.total_deposit, 2_000);
    assert_eq!(info.claimed_so_far, 1_000);
    assert_eq!(info.claimable_now, 0); // just claimed, same ledger
    assert_eq!(info.remaining_locked, 1_000);
    // 1000 / 2000 * 10000 = 5000 bps
    assert_eq!(info.percent_vested_bps, 5_000);
    assert!(info.cliff_reached);
    assert!(!info.stream_ended);
}

#[test]
fn test_get_stream_info_at_stream_end() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    // Advance past end ledger (100 + 200 = 300), but do NOT claim.
    advance_ledger(&env, 250);

    let info = client.get_stream_info(&recipient).unwrap();
    assert_eq!(info.total_deposit, 2_000);
    assert_eq!(info.claimed_so_far, 0);
    assert_eq!(info.claimable_now, 2_000); // entire deposit claimable
    assert_eq!(info.remaining_locked, 0);
    assert!(info.cliff_reached);
    assert!(info.stream_ended);
}

// ── get_config tests ──────────────────────────────────────────────────────────

#[test]
fn test_get_config_returns_compiled_in_constants() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let config = client.get_config();
    assert_eq!(config.persistent_ledger_threshold, PERSISTENT_LEDGER_THRESHOLD);
    assert_eq!(config.persistent_bump_amount, PERSISTENT_BUMP_AMOUNT);
}
