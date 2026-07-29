#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Events as _},
    Address, FromVal, Symbol, TryFromVal,
};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    events::StreamCreatedData,
    tests::{setup_env, token_helper::{create_token, mint_to}},
};

/// Verify that the StreamCreated event emitted by create_vesting_stream
/// contains every schedule field, allowing full off-chain reconstruction.
///
/// Issue #321 acceptance criteria:
/// - Topics: [Symbol("StreamCreated"), sponsor, recipient]
/// - Data struct: { token, rate, start_ledger, cliff_ledger, end_ledger, total_deposit }
#[test]
fn test_stream_created_event_has_all_fields() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);

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
    );

    // Retrieve all events (requires testutils::Events trait in scope).
    let all_events = env.events().all();

    // Find the StreamCreated event emitted by our contract.
    // Topics are Vec<Val>; decode the first topic as Symbol for identification.
    let stream_created = all_events.iter().find(|(contract, topics, _data)| {
        if contract != &contract_id {
            return false;
        }
        if let Some(first_topic) = topics.get(0) {
            if let Ok(sym) = Symbol::try_from_val(&env, &first_topic) {
                return sym == Symbol::new(&env, "StreamCreated");
            }
        }
        false
    });

    assert!(
        stream_created.is_some(),
        "StreamCreated event not found in emitted events"
    );

    let (_, topics, data) = stream_created.unwrap();

    // ── Verify topics: [Symbol("StreamCreated"), sponsor, recipient] ──────────
    assert_eq!(topics.len(), 3, "expected 3 topics");

    let topic0_sym = Symbol::try_from_val(&env, &topics.get(0).unwrap())
        .expect("topic[0] must be a Symbol");
    assert_eq!(topic0_sym, Symbol::new(&env, "StreamCreated"), "topic[0] must be Symbol(StreamCreated)");

    let topic1_addr = Address::try_from_val(&env, &topics.get(1).unwrap())
        .expect("topic[1] must be an Address");
    assert_eq!(topic1_addr, sponsor, "topic[1] must be sponsor");

    let topic2_addr = Address::try_from_val(&env, &topics.get(2).unwrap())
        .expect("topic[2] must be an Address");
    assert_eq!(topic2_addr, recipient, "topic[2] must be recipient");

    // ── Verify data struct fields ─────────────────────────────────────────────
    let event_data = StreamCreatedData::try_from_val(&env, &data)
        .expect("event data must decode as StreamCreatedData");

    assert_eq!(event_data.token,         token_id,      "data.token mismatch");
    assert_eq!(event_data.rate,          rate,          "data.rate mismatch");
    assert_eq!(event_data.start_ledger,  100,           "data.start_ledger mismatch");
    assert_eq!(event_data.cliff_ledger,  150,           "data.cliff_ledger mismatch");
    assert_eq!(event_data.end_ledger,    300,           "data.end_ledger mismatch");
    assert_eq!(event_data.total_deposit, total_deposit, "data.total_deposit mismatch");
}
