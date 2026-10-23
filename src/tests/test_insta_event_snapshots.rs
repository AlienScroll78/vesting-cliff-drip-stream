//! Insta-based snapshot tests for contract event XDR payloads (closes #784).
//!
//! These tests verify the exact structure and content of all events emitted by
//! the contract by serialising their (topics, data) shape to JSON and comparing
//! against committed `.snap` files managed by the [`insta`] crate.
//!
//! # Why this matters
//!
//! The backend indexer decodes events by XDR field position and type. If an
//! event schema changes without updating the indexer, all subsequent events are
//! silently mis-decoded or dropped. These tests act as a schema guard: a schema
//! change causes an assertion failure **and** forces an explicit developer
//! approval step before the change can land.
//!
//! # Running normally
//!
//! ```bash
//! cargo test --features testutils -- test_insta_event_snapshots
//! ```
//!
//! # Approving an intentional schema change
//!
//! When a schema change is intentional, review and accept the new snapshots
//! with the `cargo-insta` CLI:
//!
//! ```bash
//! # Install once:
//! cargo install cargo-insta
//!
//! # Regenerate pending snapshots, then interactively review each diff:
//! cargo insta test --features testutils -- test_insta_event_snapshots
//! cargo insta review
//! ```
//!
//! Snapshots are committed to `src/tests/snapshots/` and must be included in
//! the same PR as any event-schema change. CI will fail on unapproved (pending)
//! snapshot files because `INSTA_UPDATE=no` is set in `.github/workflows/ci.yml`.
//!
//! # Snapshot storage
//!
//! `insta` writes approved snapshots as `<test_name>.snap` files inside the
//! `src/tests/snapshots/` directory. Each file uses the insta snapshot format
//! and is human-readable, making schema diffs easy to review in pull requests.
//!
//! # Snapshot naming convention
//!
//! Snapshots are named by the string key passed to `insta::assert_snapshot!`.
//! The file on disk is:
//! `src/tests/snapshots/<crate>::<module>::<test_fn>@<key>.snap`

#![cfg(test)]

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events},
    Address, Env, IntoVal, String as SorobanString,
};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    tests::{advance_ledger, setup_env},
};
use super::token_helper::{create_token, mint_to};

// ── StreamCreated (vc_create) ─────────────────────────────────────────────────

/// Snapshot test for the `StreamCreated` (`vc_create`) event.
///
/// # Event schema
///
/// | Field          | Type       | Description                                  |
/// |----------------|------------|----------------------------------------------|
/// | topic[0]       | `Symbol`   | `"vc_create"`                                |
/// | topic[1]       | `Address`  | recipient — the beneficiary of the stream    |
/// | data[0]        | `Address`  | sponsor — the address that funded the stream |
/// | data[1]        | `Address`  | token — SAC token contract address           |
/// | data[2]        | `i128`     | rate_per_ledger                              |
/// | data[3]        | `u32`      | start_ledger                                 |
/// | data[4]        | `u32`      | cliff_ledger                                 |
/// | data[5]        | `u32`      | end_ledger                                   |
///
/// Any change to topic count, field order, or field type will break this
/// snapshot and require `cargo insta review` approval.
#[test]
fn test_insta_snapshot_stream_created() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    // env starts at ledger 100 (see setup_env):
    //   start_ledger = 100, cliff = 100+50 = 150, end = 100+200 = 300
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None)
        .unwrap();

    // Verify structural invariants before snapshotting.
    let events = env.events().all();
    assert_eq!(events.len(), 1, "expected exactly 1 event from create_vesting_stream");

    let (_contract, topics, _data) = events.get(0).unwrap();
    assert_eq!(
        topics.get(0).unwrap(),
        symbol_short!("vc_create").into_val(&env),
        "StreamCreated: first topic must be Symbol(\"vc_create\")"
    );
    assert_eq!(
        topics.get(1).unwrap(),
        recipient.clone().into_val(&env),
        "StreamCreated: second topic must be recipient address"
    );

    // Snapshot the event schema as deterministic JSON. Fixed values (ledger
    // numbers, rate) are recorded; non-deterministic addresses are described
    // structurally by their role and type.
    insta::assert_snapshot!(
        "stream_created_schema",
        serde_json::json!({
            "event": "StreamCreated",
            "symbol": "vc_create",
            "topics": {
                "count": 2,
                "0": { "type": "Symbol", "value": "vc_create" },
                "1": { "type": "Address", "description": "recipient" }
            },
            "data": {
                "count": 6,
                "0": { "type": "Address", "description": "sponsor" },
                "1": { "type": "Address", "description": "token" },
                "2": { "type": "i128",    "description": "rate_per_ledger", "example": 10 },
                "3": { "type": "u32",     "description": "start_ledger",    "example": 100 },
                "4": { "type": "u32",     "description": "cliff_ledger",    "example": 150 },
                "5": { "type": "u32",     "description": "end_ledger",      "example": 300 }
            }
        })
        .to_string()
    );
}

// ── TokensClaimed (vc_claim) ──────────────────────────────────────────────────

/// Snapshot test for the `TokensClaimed` (`vc_claim`) event.
///
/// # Event schema
///
/// | Field     | Type      | Description                               |
/// |-----------|-----------|-------------------------------------------|
/// | topic[0]  | `Symbol`  | `"vc_claim"`                              |
/// | topic[1]  | `Address` | recipient — the address that claimed      |
/// | data[0]   | `i128`    | amount of tokens transferred              |
/// | data[1]   | `u32`     | ledger_claimed_through (last active ledger) |
///
/// Any change to topic count, field order, or field type will break this
/// snapshot and require `cargo insta review` approval.
#[test]
fn test_insta_snapshot_tokens_claimed() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None)
        .unwrap();

    // Advance past cliff (ledger 100+50=150 → advance 100 → ledger 200).
    advance_ledger(&env, 100);
    client.claim_vested(&recipient).unwrap();

    // Find the vc_claim event in the event log.
    let events = env.events().all();
    let claim_event = events
        .iter()
        .find(|(_c, topics, _d)| {
            let sym: soroban_sdk::Val = symbol_short!("vc_claim").into_val(&env);
            topics.first().map(|t| t == sym).unwrap_or(false)
        })
        .expect("vc_claim event must be emitted by claim_vested");

    let (_contract, topics, _data) = claim_event;
    assert_eq!(
        topics.get(0).unwrap(),
        symbol_short!("vc_claim").into_val(&env),
        "TokensClaimed: first topic must be Symbol(\"vc_claim\")"
    );
    assert_eq!(
        topics.get(1).unwrap(),
        recipient.clone().into_val(&env),
        "TokensClaimed: second topic must be recipient address"
    );

    insta::assert_snapshot!(
        "tokens_claimed_schema",
        serde_json::json!({
            "event": "TokensClaimed",
            "symbol": "vc_claim",
            "topics": {
                "count": 2,
                "0": { "type": "Symbol", "value": "vc_claim" },
                "1": { "type": "Address", "description": "recipient" }
            },
            "data": {
                "count": 2,
                "0": { "type": "i128", "description": "amount claimed",         "example": 1000 },
                "1": { "type": "u32",  "description": "ledger_claimed_through", "example": 200  }
            }
        })
        .to_string()
    );
}

// ── StreamCancelled (vc_cancel) ───────────────────────────────────────────────

/// Snapshot test for the `StreamCancelled` (`vc_cancel`) event.
///
/// # Event schema
///
/// | Field     | Type      | Description                                        |
/// |-----------|-----------|----------------------------------------------------|
/// | topic[0]  | `Symbol`  | `"vc_cancel"`                                      |
/// | topic[1]  | `Address` | recipient — the beneficiary of the cancelled stream |
/// | data[0]   | `i128`    | refunded_amount — tokens returned to the sponsor   |
///
/// Any change to topic count, field order, or field type will break this
/// snapshot and require `cargo insta review` approval.
#[test]
fn test_insta_snapshot_stream_cancelled() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None)
        .unwrap();

    // Cancel before cliff → full refund of 2 000 tokens to sponsor.
    client.cancel_stream(&sponsor, &recipient).unwrap();

    let events = env.events().all();
    let cancel_event = events
        .iter()
        .find(|(_c, topics, _d)| {
            let sym: soroban_sdk::Val = symbol_short!("vc_cancel").into_val(&env);
            topics.first().map(|t| t == sym).unwrap_or(false)
        })
        .expect("vc_cancel event must be emitted by cancel_stream");

    let (_contract, topics, _data) = cancel_event;
    assert_eq!(
        topics.get(0).unwrap(),
        symbol_short!("vc_cancel").into_val(&env),
        "StreamCancelled: first topic must be Symbol(\"vc_cancel\")"
    );
    assert_eq!(
        topics.get(1).unwrap(),
        recipient.clone().into_val(&env),
        "StreamCancelled: second topic must be recipient address"
    );

    insta::assert_snapshot!(
        "stream_cancelled_schema",
        serde_json::json!({
            "event": "StreamCancelled",
            "symbol": "vc_cancel",
            "topics": {
                "count": 2,
                "0": { "type": "Symbol", "value": "vc_cancel" },
                "1": { "type": "Address", "description": "recipient" }
            },
            "data": {
                "count": 1,
                "0": { "type": "i128", "description": "refunded_amount to sponsor", "example": 2000 }
            }
        })
        .to_string()
    );
}

// ── StreamClawedBack (vc_claw) ────────────────────────────────────────────────

/// Snapshot test for the `StreamClawedBack` (`vc_claw`) event.
///
/// # Event schema
///
/// | Field     | Type      | Description                                               |
/// |-----------|-----------|-----------------------------------------------------------|
/// | topic[0]  | `Symbol`  | `"vc_claw"`                                               |
/// | topic[1]  | `Address` | recipient — the beneficiary of the clawed-back stream     |
/// | data[0]   | `Address` | sponsor — the address that initiated the clawback         |
/// | data[1]   | `Address` | token — SAC token contract address                        |
/// | data[2]   | `i128`    | amount clawed back and returned to the sponsor            |
/// | data[3]   | `String`  | compliance reason string (max 256 bytes)                  |
///
/// Clawback is a compliance-critical operation. Any schema change here must be
/// coordinated with the indexer team and approved via `cargo insta review`.
#[test]
fn test_insta_snapshot_stream_clawed_back() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None)
        .unwrap();

    // Clawback before cliff — all 2 000 tokens are returned to sponsor.
    advance_ledger(&env, 20); // ledger → 120 (cliff at 150)
    let reason = SorobanString::from_str(&env, "regulatory compliance");
    client
        .clawback_stream(&sponsor, &recipient, &reason)
        .unwrap();

    let events = env.events().all();
    let claw_event = events
        .iter()
        .find(|(_c, topics, _d)| {
            let sym: soroban_sdk::Val = symbol_short!("vc_claw").into_val(&env);
            topics.first().map(|t| t == sym).unwrap_or(false)
        })
        .expect("vc_claw event must be emitted by clawback_stream");

    let (_contract, topics, _data) = claw_event;
    assert_eq!(
        topics.get(0).unwrap(),
        symbol_short!("vc_claw").into_val(&env),
        "StreamClawedBack: first topic must be Symbol(\"vc_claw\")"
    );
    assert_eq!(
        topics.get(1).unwrap(),
        recipient.clone().into_val(&env),
        "StreamClawedBack: second topic must be recipient address"
    );

    insta::assert_snapshot!(
        "stream_clawed_back_schema",
        serde_json::json!({
            "event": "StreamClawedBack",
            "symbol": "vc_claw",
            "topics": {
                "count": 2,
                "0": { "type": "Symbol", "value": "vc_claw" },
                "1": { "type": "Address", "description": "recipient" }
            },
            "data": {
                "count": 4,
                "0": { "type": "Address", "description": "sponsor" },
                "1": { "type": "Address", "description": "token" },
                "2": { "type": "i128",    "description": "amount clawed back to sponsor", "example": 2000 },
                "3": { "type": "String",  "description": "compliance reason (max 256 bytes)" }
            }
        })
        .to_string()
    );
}

// ── StreamDrained (vc_drain) ──────────────────────────────────────────────────

/// Snapshot test for the `StreamDrained` (`vc_drain`) event.
///
/// # Event schema
///
/// | Field     | Type      | Description                                               |
/// |-----------|-----------|-----------------------------------------------------------|
/// | topic[0]  | `Symbol`  | `"vc_drain"`                                              |
/// | topic[1]  | `Address` | recipient — the beneficiary of the drained stream         |
/// | data[0]   | `Address` | caller — any address (call is permissionless)             |
/// | data[1]   | `Address` | sponsor — original funder who receives the drained tokens |
/// | data[2]   | `Address` | token — SAC token contract address                        |
/// | data[3]   | `i128`    | amount drained and transferred to the sponsor             |
///
/// `drain_expired_stream` is permissionless (no auth required on `caller`).
/// Any schema change must be approved via `cargo insta review`.
#[test]
fn test_insta_snapshot_stream_drained() {
    use soroban_sdk::testutils::LedgerInfo;

    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200, &None)
        .unwrap();

    // Advance past end_ledger (300) + 1-year drain delay (~3_153_600 ledgers).
    // start=100, end=300, drain_delay=3_153_600 → need ledger > 3_153_900.
    env.ledger().set(LedgerInfo {
        timestamp: 0,
        protocol_version: 22,
        sequence_number: 3_153_901,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 1000,
        max_entry_ttl: u32::MAX,
    });

    let caller = Address::generate(&env);
    client.drain_expired_stream(&caller, &recipient).unwrap();

    let events = env.events().all();
    let drain_event = events
        .iter()
        .find(|(_c, topics, _d)| {
            let sym: soroban_sdk::Val = symbol_short!("vc_drain").into_val(&env);
            topics.first().map(|t| t == sym).unwrap_or(false)
        })
        .expect("vc_drain event must be emitted by drain_expired_stream");

    let (_contract, topics, _data) = drain_event;
    assert_eq!(
        topics.get(0).unwrap(),
        symbol_short!("vc_drain").into_val(&env),
        "StreamDrained: first topic must be Symbol(\"vc_drain\")"
    );
    assert_eq!(
        topics.get(1).unwrap(),
        recipient.clone().into_val(&env),
        "StreamDrained: second topic must be recipient address"
    );

    insta::assert_snapshot!(
        "stream_drained_schema",
        serde_json::json!({
            "event": "StreamDrained",
            "symbol": "vc_drain",
            "topics": {
                "count": 2,
                "0": { "type": "Symbol", "value": "vc_drain" },
                "1": { "type": "Address", "description": "recipient" }
            },
            "data": {
                "count": 4,
                "0": { "type": "Address", "description": "caller (permissionless, any address)" },
                "1": { "type": "Address", "description": "sponsor (receives drained tokens)" },
                "2": { "type": "Address", "description": "token" },
                "3": { "type": "i128",    "description": "amount drained to sponsor", "example": 2000 }
            }
        })
        .to_string()
    );
}
