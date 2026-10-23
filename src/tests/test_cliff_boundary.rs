#![cfg(test)]

//! Cliff boundary condition mutation tests targeting operator boundary mutants (Issue #1061).
//!
//! Specifically targets `cliff - 1`, `cliff`, and `cliff + 1` boundary ledgers to kill
//! comparison operator mutants (`<` ↔ `<=`, `>=` ↔ `>`, etc.) in `contract.rs`.
//!
//! ### Mutants targeted:
//! 1. `contract.rs: is_cliff_passed`: `current >= cliff_ledger`
//!    - Mutant: replace `>=` with `>` (killed by asserting `is_cliff_passed` is `true` at `current == cliff_ledger`).
//!    - Mutant: replace `>=` with `<` or `<=` (killed by testing at `cliff - 1` and `cliff + 1`).
//! 2. `contract.rs: claimable_amount`: `current < cliff_ledger`
//!    - Mutant: replace `<` with `<=` (killed by asserting `claimable_amount > 0` at `current == cliff_ledger`).
//! 3. `contract.rs: claim_vested`: `current < cliff_ledger` -> `CliffNotReached`
//!    - Mutant: replace `<` with `<=` (killed by asserting `claim_vested` succeeds at `current == cliff_ledger`).
//! 4. `contract.rs: stream_status`: `current < cliff_ledger` -> `StreamStatus::PreCliff`
//!    - Mutant: replace `<` with `<=` (killed by asserting status is `Active` at `current == cliff_ledger`).
//! 5. `contract.rs: cancel_stream`: `effective_ledger >= cliff_ledger`
//!    - Mutant: replace `>=` with `>` (killed by verifying recipient receives accrued share at `current == cliff_ledger`).
//! 6. `contract.rs: get_claimable_batch`: `current >= cliff_ledger`
//!    - Mutant: replace `>=` with `>` (killed by verifying non-zero claimable at `current == cliff_ledger`).
//! 7. `contract.rs: end_ledger`: `current >= end_ledger` (full claim / dust collection boundary)
//!    - Mutant: replace `>=` with `>` (killed by verifying full deposit claimed at `current == end_ledger`).

use soroban_sdk::{
    testutils::Address as _,
    Address, Env, Vec,
};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::{advance_ledger, generate_addresses, register_contract, setup_env, setup_token},
    types::{StreamStatus, RATE_DECIMALS},
};

const START_LEDGER: u32 = 100;
const CLIFF_DURATION: u32 = 50;  // cliff at ledger 150
const TOTAL_DURATION: u32 = 200; // end at ledger 300
const RATE: i128 = 10 * RATE_DECIMALS; // 10 tokens/ledger

fn setup_stream_fixture<'a>(env: &'a Env) -> (VestingDripsClient<'a>, Address, Address, Address, u32, u32) {
    let (_contract_id, client) = register_contract(env);
    let (sponsor, recipient) = generate_addresses(env);
    let total_deposit = (TOTAL_DURATION as i128) * RATE;
    let (token_id, _) = setup_token(env, &sponsor, total_deposit);

    client
        .create_vesting_stream(
            &sponsor,
            &recipient,
            &token_id,
            &RATE,
            &CLIFF_DURATION,
            &TOTAL_DURATION,
            &None,
        )
        .unwrap();

    let cliff_ledger = START_LEDGER + CLIFF_DURATION;
    let end_ledger = START_LEDGER + TOTAL_DURATION;

    (client, sponsor, recipient, token_id, cliff_ledger, end_ledger)
}

/// Kills mutant: `is_cliff_passed` operator `>=` replaced with `>` or `<=`.
#[test]
fn test_is_cliff_passed_boundary_kills_gte_mutants() {
    let env = setup_env();
    let (client, _, recipient, _, cliff_ledger, _) = setup_stream_fixture(&env);

    // 1. At cliff - 1 (ledger 149): cliff not yet passed
    advance_ledger(&env, CLIFF_DURATION - 1);
    assert_eq!(env.ledger().sequence(), cliff_ledger - 1);
    assert!(!client.is_cliff_passed(&recipient), "cliff - 1 must return false");

    // 2. At cliff exact (ledger 150): cliff is passed (kills `>=` -> `>`)
    advance_ledger(&env, 1);
    assert_eq!(env.ledger().sequence(), cliff_ledger);
    assert!(client.is_cliff_passed(&recipient), "cliff exact must return true (kills >= to > mutant)");

    // 3. At cliff + 1 (ledger 151): cliff is passed
    advance_ledger(&env, 1);
    assert_eq!(env.ledger().sequence(), cliff_ledger + 1);
    assert!(client.is_cliff_passed(&recipient), "cliff + 1 must return true");
}

/// Kills mutant: `claimable_amount` operator `<` replaced with `<=`.
#[test]
fn test_claimable_amount_boundary_kills_lt_mutants() {
    let env = setup_env();
    let (client, _, recipient, _, cliff_ledger, _) = setup_stream_fixture(&env);

    // 1. At cliff - 1 (ledger 149): 0 claimable before cliff
    advance_ledger(&env, CLIFF_DURATION - 1);
    assert_eq!(env.ledger().sequence(), cliff_ledger - 1);
    assert_eq!(client.claimable_amount(&recipient), 0, "claimable at cliff - 1 must be 0");

    // 2. At cliff exact (ledger 150): accrued tokens available (kills `<` -> `<=`)
    advance_ledger(&env, 1);
    assert_eq!(env.ledger().sequence(), cliff_ledger);
    let expected_at_cliff = (CLIFF_DURATION as i128) * RATE;
    assert_eq!(
        client.claimable_amount(&recipient),
        expected_at_cliff,
        "claimable at cliff exact must equal cliff duration * rate (kills < to <= mutant)"
    );

    // 3. At cliff + 1 (ledger 151): accrued tokens increase by 1 ledger rate
    advance_ledger(&env, 1);
    assert_eq!(env.ledger().sequence(), cliff_ledger + 1);
    let expected_at_cliff_plus_1 = ((CLIFF_DURATION + 1) as i128) * RATE;
    assert_eq!(
        client.claimable_amount(&recipient),
        expected_at_cliff_plus_1,
        "claimable at cliff + 1 must equal (cliff duration + 1) * rate"
    );
}

/// Kills mutant: `claim_vested` operator `<` replaced with `<=` in cliff check.
#[test]
fn test_claim_vested_boundary_kills_cliff_not_reached_mutant() {
    let env = setup_env();
    let (client, _, recipient, _, cliff_ledger, _) = setup_stream_fixture(&env);

    // 1. At cliff - 1 (ledger 149): claim fails with CliffNotReached
    advance_ledger(&env, CLIFF_DURATION - 1);
    assert_eq!(env.ledger().sequence(), cliff_ledger - 1);
    let err = client.try_claim_vested(&recipient, &None).unwrap_err().unwrap();
    assert_eq!(err, VestingError::CliffNotReached);

    // 2. At cliff exact (ledger 150): claim succeeds (kills `<` -> `<=`)
    advance_ledger(&env, 1);
    assert_eq!(env.ledger().sequence(), cliff_ledger);
    let claimed = client.claim_vested(&recipient, &None);
    let expected_claim = (CLIFF_DURATION as i128) * RATE;
    assert_eq!(claimed, expected_claim, "claim at cliff exact must succeed (kills < to <= mutant)");
}

/// Kills mutant: `stream_status` operator `<` replaced with `<=` in PreCliff check.
#[test]
fn test_stream_status_boundary_kills_status_mutants() {
    let env = setup_env();
    let (client, _, recipient, _, cliff_ledger, end_ledger) = setup_stream_fixture(&env);

    // 1. At cliff - 1: PreCliff
    advance_ledger(&env, CLIFF_DURATION - 1);
    assert_eq!(env.ledger().sequence(), cliff_ledger - 1);
    assert_eq!(client.stream_status(&recipient), StreamStatus::PreCliff);

    // 2. At cliff exact: Active (kills `<` -> `<=`)
    advance_ledger(&env, 1);
    assert_eq!(env.ledger().sequence(), cliff_ledger);
    assert_eq!(client.stream_status(&recipient), StreamStatus::Active, "status at cliff must be Active");

    // 3. At end_ledger - 1: Active
    advance_ledger(&env, TOTAL_DURATION - CLIFF_DURATION - 1);
    assert_eq!(env.ledger().sequence(), end_ledger - 1);
    assert_eq!(client.stream_status(&recipient), StreamStatus::Active);

    // 4. At end_ledger exact: Expired (kills `<` -> `<=`)
    advance_ledger(&env, 1);
    assert_eq!(env.ledger().sequence(), end_ledger);
    assert_eq!(client.stream_status(&recipient), StreamStatus::Expired, "status at end_ledger must be Expired");
}

/// Kills mutant: `cancel_stream` operator `>=` replaced with `>` in recipient refund check.
#[test]
fn test_cancel_stream_boundary_kills_cancel_mutant() {
    let env = setup_env();
    let (client, sponsor, recipient, token_id, cliff_ledger, _) = setup_stream_fixture(&env);
    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);

    // Advance to cliff exact (ledger 150)
    advance_ledger(&env, CLIFF_DURATION);
    assert_eq!(env.ledger().sequence(), cliff_ledger);

    // Cancel stream at exact cliff boundary
    client.cancel_stream(&sponsor, &recipient, &0);

    // Recipient receives earned tokens up to cliff (kills `>=` -> `>`)
    let expected_recipient_earned = (CLIFF_DURATION as i128) * RATE;
    assert_eq!(
        token_client.balance(&recipient),
        expected_recipient_earned,
        "recipient must receive accrued share at cliff exact cancellation"
    );

    // Sponsor receives remaining refund
    let expected_sponsor_refund = ((TOTAL_DURATION - CLIFF_DURATION) as i128) * RATE;
    assert_eq!(
        token_client.balance(&sponsor),
        expected_sponsor_refund,
        "sponsor must receive remaining balance refund"
    );
}

/// Kills mutant: `get_claimable_batch` operator `>=` replaced with `>`.
#[test]
fn test_get_claimable_batch_boundary_kills_batch_mutant() {
    let env = setup_env();
    let (client, _, recipient, _, cliff_ledger, _) = setup_stream_fixture(&env);

    let mut recipients = Vec::new(&env);
    recipients.push_back(recipient.clone());

    // 1. At cliff - 1: batch returns 0
    advance_ledger(&env, CLIFF_DURATION - 1);
    assert_eq!(env.ledger().sequence(), cliff_ledger - 1);
    let batch_pre = client.get_claimable_batch(&recipients);
    assert_eq!(batch_pre.get(0).unwrap(), 0);

    // 2. At cliff exact: batch returns accrued amount (kills `>=` -> `>`)
    advance_ledger(&env, 1);
    assert_eq!(env.ledger().sequence(), cliff_ledger);
    let batch_cliff = client.get_claimable_batch(&recipients);
    let expected = (CLIFF_DURATION as i128) * RATE;
    assert_eq!(
        batch_cliff.get(0).unwrap(),
        expected,
        "get_claimable_batch at cliff exact must return accrued tokens (kills >= to > mutant)"
    );
}
