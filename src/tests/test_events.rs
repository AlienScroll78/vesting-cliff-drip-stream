#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Events as _},
    Address, Symbol, TryFromVal,
};

use crate::{
    tests::{advance_ledger, create_vesting_stream, generate_addresses, register_contract, setup_env},
    types::RATE_DECIMALS,
};

/// Verify that create_vesting_stream emits a StreamCreated event.
#[test]
fn test_stream_created_event_emitted() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury);

    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    // rate=10, cliff_duration=50, total_duration=200
    // start_ledger=100 (setup_env starts at 100)
    // cliff_ledger = 100 + 50 = 150
    // end_ledger   = 100 + 200 = 300
    // total_deposit = 10 * 200 = 2000
    let rate: i128 = 10;
    let cliff_duration: u32 = 50;
    let total_duration: u32 = 200;
    let total_deposit: i128 = rate * total_duration as i128;

    mint_to(&env, &token_id, &sponsor, total_deposit);

    client.create_vesting_stream(
        &sponsor,
        &recipient,
        &token_id,
        &rate,
        &cliff_duration,
        &total_duration,
        &None,
    );

    // Retrieve all events (requires testutils::Events trait in scope).
    let all_events = env.events().all();
    let found = all_events.iter().any(|(contract, topics, _data)| {
        if contract != contract_id {
            return false;
        }
        if let Some(first_topic) = topics.get(0) {
            if let Ok(sym) = Symbol::try_from_val(&env, &first_topic) {
                return sym == Symbol::new(&env, "StreamCreated");
            }
        }
        false
    });

    assert!(found, "StreamCreated event not found in emitted events");
}

/// Verify that cancel_stream emits a StreamCancelled event with all required fields.
#[test]
fn test_stream_cancelled_event_emitted() {
    let env = setup_env();
    let (contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    advance_ledger(&env, 100);
    client.cancel_stream(&sponsor, &recipient);

    let all_events = env.events().all();
    let found = all_events.iter().any(|(contract, topics, _data)| {
        if contract != contract_id {
            return false;
        }
        if let Some(first_topic) = topics.get(0) {
            if let Ok(sym) = Symbol::try_from_val(&env, &first_topic) {
                return sym == Symbol::new(&env, "StreamCancelled");
            }
        }
        false
    });

    assert!(found, "StreamCancelled event not found after cancel_stream");
}

/// Verify that transfer_stream emits a StreamTransferred event.
#[test]
fn test_stream_transferred_event_emitted() {
    let env = setup_env();
    let (contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    let new_recipient = Address::generate(&env);

    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);
    client.transfer_stream(&recipient, &new_recipient);

    let all_events = env.events().all();
    let found = all_events.iter().any(|(contract, topics, _data)| {
        if contract != contract_id {
            return false;
        }
        if let Some(first_topic) = topics.get(0) {
            if let Ok(sym) = Symbol::try_from_val(&env, &first_topic) {
                return sym == Symbol::new(&env, "StreamTransferred");
            }
        }
        false
    });

    assert!(found, "StreamTransferred event not found after transfer_stream");
}
