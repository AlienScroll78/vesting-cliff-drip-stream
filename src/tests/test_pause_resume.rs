#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    error::VestingError,
    tests::{advance_ledger, create_vesting_stream, generate_addresses, register_contract, setup_env},
};

#[test]
fn test_pause_and_resume_stream_success() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    // Advance 30 ledgers (pre-cliff) and pause
    advance_ledger(&env, 30);
    client.pause_stream(&sponsor, &recipient);

    let sched = client.get_schedule(&recipient).unwrap();
    assert_eq!(sched.paused_at_ledger, Some(130));

    // Claimable amount is 0 while paused
    advance_ledger(&env, 50);
    assert_eq!(client.claimable_amount(&recipient), 0);

    // Resume after 50 ledgers paused
    client.resume_stream(&sponsor, &recipient);

    let sched_resumed = client.get_schedule(&recipient).unwrap();
    assert_eq!(sched_resumed.paused_at_ledger, None);
    assert_eq!(sched_resumed.accumulated_pause_ledgers, 50);
    assert_eq!(sched_resumed.end_ledger, 350); // Original 300 + 50
    assert_eq!(sched_resumed.cliff_ledger, 200); // Original 150 + 50
}

#[test]
fn test_cannot_pause_already_paused_stream() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    client.pause_stream(&sponsor, &recipient);

    let err = client.try_pause_stream(&sponsor, &recipient).unwrap_err();
    assert_eq!(err, Ok(VestingError::StreamAlreadyPaused));
}

#[test]
fn test_cannot_resume_unpaused_stream() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    let err = client.try_resume_stream(&sponsor, &recipient).unwrap_err();
    assert_eq!(err, Ok(VestingError::StreamNotPaused));
}

#[test]
fn test_non_sponsor_cannot_pause_or_resume() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let attacker = Address::generate(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    let err = client.try_pause_stream(&attacker, &recipient).unwrap_err();
    assert_eq!(err, Ok(VestingError::Unauthorized));
}
