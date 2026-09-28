//! Tests for StreamCancelled structured event (closes #7).
//!
//! `cancel_stream` must emit `StreamCancelled` with fields:
//! - `sponsor` — the stream funder
//! - `refund_to_sponsor` — tokens returned to sponsor
//! - `released_to_recipient` — tokens earned and sent to recipient
//! - `ledger` — ledger at which the cancellation occurred

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Events as _},
    Address, Symbol, TryFromVal,
};

use crate::{
    tests::{advance_ledger, create_vesting_stream, generate_addresses, register_contract, setup_env},
};

/// Cancelling before cliff emits StreamCancelled with released=0.
#[test]
fn test_cancel_before_cliff_emits_event_with_zero_release() {
    let env = setup_env();
    let (contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    advance_ledger(&env, 20); // still before cliff
    client.cancel_stream(&sponsor, &recipient);

    let all_events = env.events().all();
    let cancel_event = all_events.iter().find(|(contract, topics, _data)| {
        if *contract != contract_id {
            return false;
        }
        if let Some(first) = topics.get(0) {
            if let Ok(sym) = Symbol::try_from_val(&env, &first) {
                return sym == Symbol::new(&env, "StreamCancelled");
            }
        }
        false
    });

    assert!(cancel_event.is_some(), "StreamCancelled event not emitted");

    let (_, topics, data) = cancel_event.unwrap();

    // Topics: [Symbol("StreamCancelled"), recipient]
    assert_eq!(topics.len(), 2);
    let topic_sym = Symbol::try_from_val(&env, &topics.get(0).unwrap()).unwrap();
    assert_eq!(topic_sym, Symbol::new(&env, "StreamCancelled"));
    let topic_recipient = Address::try_from_val(&env, &topics.get(1).unwrap()).unwrap();
    assert_eq!(topic_recipient, recipient);

    // Data: (sponsor, refund_to_sponsor, released_to_recipient, ledger)
    // Before cliff: refund_to_sponsor=2000, released=0
    let (ev_sponsor, ev_refund, ev_released, ev_ledger): (Address, i128, i128, u32) =
        soroban_sdk::TryFromVal::try_from_val(&env, &data).unwrap();
    assert_eq!(ev_sponsor, sponsor);
    assert_eq!(ev_refund, 2_000);
    assert_eq!(ev_released, 0);
    assert_eq!(ev_ledger, 120); // start=100, advanced 20 → ledger 120
}

/// Cancelling after cliff emits StreamCancelled with correct split.
#[test]
fn test_cancel_after_cliff_emits_event_with_split() {
    let env = setup_env();
    let (contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    // At ledger 200 (100 ledgers after start): earned = 100 * 10 = 1000
    advance_ledger(&env, 100);
    client.cancel_stream(&sponsor, &recipient);

    let all_events = env.events().all();
    let cancel_event = all_events.iter().find(|(contract, topics, _data)| {
        if *contract != contract_id {
            return false;
        }
        if let Some(first) = topics.get(0) {
            if let Ok(sym) = Symbol::try_from_val(&env, &first) {
                return sym == Symbol::new(&env, "StreamCancelled");
            }
        }
        false
    });

    assert!(cancel_event.is_some(), "StreamCancelled event not emitted");

    let (_, _topics, data) = cancel_event.unwrap();

    let (ev_sponsor, ev_refund, ev_released, ev_ledger): (Address, i128, i128, u32) =
        soroban_sdk::TryFromVal::try_from_val(&env, &data).unwrap();
    assert_eq!(ev_sponsor, sponsor);
    assert_eq!(ev_released, 1_000); // 100 ledgers * 10
    assert_eq!(ev_refund, 1_000);   // remaining 100 ledgers * 10
    assert_eq!(ev_ledger, 200);     // start=100, advanced 100 → ledger 200
}

/// Event is emitted at the exact cancellation ledger.
#[test]
fn test_cancel_event_ledger_matches_current() {
    let env = setup_env();
    let (contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    advance_ledger(&env, 50); // exactly at cliff, ledger=150
    client.cancel_stream(&sponsor, &recipient);

    let all_events = env.events().all();
    let cancel_event = all_events
        .iter()
        .find(|(contract, topics, _)| {
            if *contract != contract_id {
                return false;
            }
            topics
                .get(0)
                .and_then(|t| Symbol::try_from_val(&env, &t).ok())
                .map(|s| s == Symbol::new(&env, "StreamCancelled"))
                .unwrap_or(false)
        });

    let (_, _, data) = cancel_event.unwrap();
    let (_sponsor, _refund, _released, ev_ledger): (Address, i128, i128, u32) =
        soroban_sdk::TryFromVal::try_from_val(&env, &data).unwrap();
    assert_eq!(ev_ledger, 150); // 100 + 50 = 150
}

/// Event contains sponsor address as first data field.
#[test]
fn test_cancel_event_sponsor_field() {
    let env = setup_env();
    let (contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);

    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    client.cancel_stream(&sponsor, &recipient);

    let all_events = env.events().all();
    let cancel_event = all_events
        .iter()
        .find(|(contract, topics, _)| {
            if *contract != contract_id {
                return false;
            }
            topics
                .get(0)
                .and_then(|t| Symbol::try_from_val(&env, &t).ok())
                .map(|s| s == Symbol::new(&env, "StreamCancelled"))
                .unwrap_or(false)
        });

    let (_, _, data) = cancel_event.unwrap();
    let (ev_sponsor, _, _, _): (Address, i128, i128, u32) =
        soroban_sdk::TryFromVal::try_from_val(&env, &data).unwrap();
    assert_eq!(ev_sponsor, sponsor);
}
