//! Contract event snapshot tests (closes #363)
//!
//! These tests verify the exact structure and content of all events emitted
//! by the contract. They serve as a schema guard: if any event's topics, data
//! fields, or field types change, these tests fail until the snapshots are
//! explicitly updated.
//!
//! # Updating snapshots
//!
//! ```bash
//! UPDATE_SNAPSHOTS=1 cargo test --features testutils test_event_snapshots
//! ```
//!
//! When you update a snapshot you **must** add a CHANGELOG entry describing
//! the breaking change so consumers of the event stream can adapt.
//!
//! # Snapshot storage
//!
//! JSON files live in `src/tests/snapshots/`.  Each file documents:
//! - `topics` – the (Symbol, Address) tuple published as the event key
//! - `data`   – the tuple published as the event value
//! - `changelog` – human-readable history of schema changes

#![cfg(test)]

use std::env as std_env;

use soroban_sdk::{
    testutils::Events,
    symbol_short,
    Address,
    IntoVal,
};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    tests::{advance_ledger, setup_env},
};

use super::super::tests::token_helper::{create_token, mint_to};

// ── helpers ──────────────────────────────────────────────────────────────────

/// Returns the path to a snapshot JSON file relative to the workspace root.
fn snapshot_path(name: &str) -> std::path::PathBuf {
    let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .join("src")
        .join("tests")
        .join("snapshots")
        .join(name)
}

/// Reads a snapshot JSON from disk, or returns `None` if the file is absent.
fn read_snapshot(name: &str) -> Option<serde_json::Value> {
    let path = snapshot_path(name);
    let raw = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Writes `value` to the snapshot file (used when `UPDATE_SNAPSHOTS=1`).
fn write_snapshot(name: &str, value: &serde_json::Value) {
    let path = snapshot_path(name);
    let pretty = serde_json::to_string_pretty(value).expect("serialise snapshot");
    std::fs::write(&path, pretty + "\n").expect("write snapshot");
    eprintln!("Updated snapshot: {}", path.display());
}

/// Returns `true` when the caller wants to regenerate snapshots.
fn updating() -> bool {
    std_env::var("UPDATE_SNAPSHOTS")
        .map(|v| v == "1")
        .unwrap_or(false)
}

// ── Snapshot definitions ──────────────────────────────────────────────────────

/// Snapshot definition for the `vc_create` / StreamCreated event.
///
/// Topics : (Symbol("vc_create"), recipient: Address)
/// Data   : (sponsor: Address, token: Address, rate_per_ledger: i128,
///           start_ledger: u32, cliff_ledger: u32, end_ledger: u32)
fn stream_created_snapshot() -> serde_json::Value {
    serde_json::json!({
        "event": "StreamCreated",
        "topics": {
            "0": { "type": "Symbol", "value": "vc_create" },
            "1": { "type": "Address", "description": "recipient address" }
        },
        "data": {
            "0": { "type": "Address", "description": "sponsor address" },
            "1": { "type": "Address", "description": "token address" },
            "2": { "type": "i128",    "description": "rate_per_ledger" },
            "3": { "type": "u32",     "description": "start_ledger" },
            "4": { "type": "u32",     "description": "cliff_ledger" },
            "5": { "type": "u32",     "description": "end_ledger" }
        },
        "changelog": []
    })
}

/// Snapshot definition for the `vc_claim` / TokensClaimed event.
///
/// Topics : (Symbol("vc_claim"), recipient: Address)
/// Data   : (amount: i128, ledger_claimed_through: u32)
fn tokens_claimed_snapshot() -> serde_json::Value {
    serde_json::json!({
        "event": "TokensClaimed",
        "topics": {
            "0": { "type": "Symbol", "value": "vc_claim" },
            "1": { "type": "Address", "description": "recipient address" }
        },
        "data": {
            "0": { "type": "i128", "description": "amount claimed" },
            "1": { "type": "u32",  "description": "ledger_claimed_through" }
        },
        "changelog": []
    })
}

/// Snapshot definition for the `vc_done` / StreamCompleted event.
///
/// Topics : (Symbol("vc_done"), recipient: Address)
/// Data   : (token: Address)
fn stream_completed_snapshot() -> serde_json::Value {
    serde_json::json!({
        "event": "StreamCompleted",
        "topics": {
            "0": { "type": "Symbol", "value": "vc_done" },
            "1": { "type": "Address", "description": "recipient address" }
        },
        "data": {
            "0": { "type": "Address", "description": "token address" }
        },
        "changelog": []
    })
}

/// Snapshot definition for the `vc_cancel` / StreamCancelled event.
///
/// Topics : (Symbol("vc_cancel"), recipient: Address)
/// Data   : (refunded_amount: i128)
fn stream_cancelled_snapshot() -> serde_json::Value {
    serde_json::json!({
        "event": "StreamCancelled",
        "topics": {
            "0": { "type": "Symbol", "value": "vc_cancel" },
            "1": { "type": "Address", "description": "recipient address" }
        },
        "data": {
            "0": { "type": "i128", "description": "refunded_amount to sponsor" }
        },
        "changelog": []
    })
}

// ── StreamCreated event ───────────────────────────────────────────────────────

#[test]
fn test_event_snapshot_stream_created() {
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

    // env starts at ledger 100 (see setup_env), so:
    //   start=100, cliff=150 (100+50), end=300 (100+200)
    let start:  u32 = 100;
    let cliff:  u32 = 150;
    let end:    u32 = 300;
    let rate: i128 = 10;

    // ── Verify event structure matches expected topics + data ─────────────────
    // soroban-sdk testutils Events::all() returns:
    //   soroban_sdk::Vec<(Address, soroban_sdk::Vec<Val>, Val)>
    // where topics is a Vec<Val> and data is a single Val.
    assert_eq!(
        env.events().all(),
        soroban_sdk::vec![
            &env,
            (
                contract_id.clone(),
                // Topics: (symbol, recipient_address)
                (symbol_short!("vc_create"), recipient.clone()).into_val(&env),
                // Data:   (sponsor, token, rate, start, cliff, end)
                (
                    sponsor.clone(),
                    token_id.clone(),
                    rate,
                    start,
                    cliff,
                    end,
                ).into_val(&env),
            )
        ],
        "StreamCreated event schema changed! \
         Update snapshot with UPDATE_SNAPSHOTS=1 and add a CHANGELOG entry."
    );

    // ── Snapshot schema guard ─────────────────────────────────────────────────
    let expected = stream_created_snapshot();
    let file = "event_stream_created.json";

    if updating() {
        write_snapshot(file, &expected);
    } else {
        let on_disk = read_snapshot(file)
            .expect("Snapshot file missing. Run with UPDATE_SNAPSHOTS=1 to generate.");
        assert_eq!(
            on_disk, expected,
            "StreamCreated snapshot JSON schema changed!"
        );
    }
}

// ── TokensClaimed event ───────────────────────────────────────────────────────

#[test]
fn test_event_snapshot_tokens_claimed() {
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

    // Advance past cliff but not to end: ledger 100 → 200.
    advance_ledger(&env, 100);
    client.claim_vested(&recipient).unwrap();

    // After claim_vested (stream not finished), events emitted since the env
    // started are: [vc_create, vc_claim]. We check all events are as expected.
    let amount: i128 = 1_000; // 100 ledgers × rate 10
    let ledger_through: u32 = 200;

    assert_eq!(
        env.events().all(),
        soroban_sdk::vec![
            &env,
            // First event: StreamCreated (emitted during create_vesting_stream)
            (
                contract_id.clone(),
                (symbol_short!("vc_create"), recipient.clone()).into_val(&env),
                (
                    sponsor.clone(),
                    token_id.clone(),
                    10_i128,
                    100_u32,
                    150_u32,
                    300_u32,
                ).into_val(&env),
            ),
            // Second event: TokensClaimed (emitted during claim_vested)
            (
                contract_id.clone(),
                (symbol_short!("vc_claim"), recipient.clone()).into_val(&env),
                (amount, ledger_through).into_val(&env),
            )
        ],
        "TokensClaimed event schema changed! \
         Update snapshot with UPDATE_SNAPSHOTS=1 and add a CHANGELOG entry."
    );

    // ── Snapshot schema guard ─────────────────────────────────────────────────
    let expected = tokens_claimed_snapshot();
    let file = "event_tokens_claimed.json";

    if updating() {
        write_snapshot(file, &expected);
    } else {
        let on_disk = read_snapshot(file)
            .expect("Snapshot file missing. Run with UPDATE_SNAPSHOTS=1 to generate.");
        assert_eq!(on_disk, expected, "TokensClaimed snapshot JSON schema changed!");
    }
}

// ── StreamCompleted event ─────────────────────────────────────────────────────

#[test]
fn test_event_snapshot_stream_completed() {
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

    // Jump well past end_ledger (300) so a single claim drains the whole stream.
    advance_ledger(&env, 500); // ledger → 600

    client.claim_vested(&recipient).unwrap();

    // Both vc_done (stream complete) and vc_claim are emitted by claim_vested.
    // Order: claim is emitted before done inside the function body.
    //   emit_stream_completed then emit_tokens_claimed per contract.rs order.
    // Check in order emitted: vc_create, vc_done, vc_claim.
    // Looking at contract.rs claim_vested: first emit_stream_completed, then emit_tokens_claimed.
    let total: i128 = 2_000; // rate 10 × 200 ledgers
    let ledger_through: u32 = 300; // capped at end_ledger

    assert_eq!(
        env.events().all(),
        soroban_sdk::vec![
            &env,
            // create_vesting_stream
            (
                contract_id.clone(),
                (symbol_short!("vc_create"), recipient.clone()).into_val(&env),
                (
                    sponsor.clone(),
                    token_id.clone(),
                    10_i128,
                    100_u32,
                    150_u32,
                    300_u32,
                ).into_val(&env),
            ),
            // claim_vested → emit_stream_completed (first inside the fn)
            (
                contract_id.clone(),
                (symbol_short!("vc_done"), recipient.clone()).into_val(&env),
                token_id.clone().into_val(&env),
            ),
            // claim_vested → emit_tokens_claimed (second inside the fn)
            (
                contract_id.clone(),
                (symbol_short!("vc_claim"), recipient.clone()).into_val(&env),
                (total, ledger_through).into_val(&env),
            ),
        ],
        "StreamCompleted event schema changed! \
         Update snapshot with UPDATE_SNAPSHOTS=1 and add a CHANGELOG entry."
    );

    // ── Snapshot schema guard ─────────────────────────────────────────────────
    let expected = stream_completed_snapshot();
    let file = "event_stream_completed.json";

    if updating() {
        write_snapshot(file, &expected);
    } else {
        let on_disk = read_snapshot(file)
            .expect("Snapshot file missing. Run with UPDATE_SNAPSHOTS=1 to generate.");
        assert_eq!(on_disk, expected, "StreamCompleted snapshot JSON schema changed!");
    }
}

// ── StreamCancelled event ─────────────────────────────────────────────────────

#[test]
fn test_event_snapshot_stream_cancelled() {
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

    // Cancel before cliff at ledger 120 → full refund.
    // rate(10) × (end(300) − last_claimed(100)) = 10 × 200 = 2000 refunded
    advance_ledger(&env, 20); // ledger → 120 (cliff is 150)
    client.cancel_stream(&sponsor, &recipient).unwrap();

    let refund: i128 = 2_000;

    assert_eq!(
        env.events().all(),
        soroban_sdk::vec![
            &env,
            // create_vesting_stream
            (
                contract_id.clone(),
                (symbol_short!("vc_create"), recipient.clone()).into_val(&env),
                (
                    sponsor.clone(),
                    token_id.clone(),
                    10_i128,
                    100_u32,
                    150_u32,
                    300_u32,
                ).into_val(&env),
            ),
            // cancel_stream → emit_stream_cancelled
            (
                contract_id.clone(),
                (symbol_short!("vc_cancel"), recipient.clone()).into_val(&env),
                refund.into_val(&env),
            )
        ],
        "StreamCancelled event schema changed! \
         Update snapshot with UPDATE_SNAPSHOTS=1 and add a CHANGELOG entry."
    );

    // ── Snapshot schema guard ─────────────────────────────────────────────────
    let expected = stream_cancelled_snapshot();
    let file = "event_stream_cancelled.json";

    if updating() {
        write_snapshot(file, &expected);
    } else {
        let on_disk = read_snapshot(file)
            .expect("Snapshot file missing. Run with UPDATE_SNAPSHOTS=1 to generate.");
        assert_eq!(on_disk, expected, "StreamCancelled snapshot JSON schema changed!");
    }
}
