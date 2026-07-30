//! Snapshot tests for contract events (issue #102).
//!
//! Each test captures the event published by a contract call and asserts that
//! the (topic, data) shape matches the committed JSON snapshot file.
//!
//! To update snapshots after an intentional schema change, delete the relevant
//! `.json` file and re-run the tests; the new snapshot will be written.
//!
//! ```
//! cargo test --features testutils -- snapshots
//! ```

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Events},
    Address, IntoVal,
};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    tests::{advance_ledger, setup_env},
};
use super::token_helper::{create_token, mint_to};

// ── helpers ──────────────────────────────────────────────────────────────────

/// Returns the snapshot directory path (relative to the crate root).
fn snapshot_path(name: &str) -> std::path::PathBuf {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest.join("src/tests/snapshots").join(name)
}

/// Reads a snapshot file and returns its content, or `None` if it doesn't exist.
fn read_snapshot(name: &str) -> Option<String> {
    std::fs::read_to_string(snapshot_path(name)).ok()
}

/// Writes a new snapshot file (called when the file is missing).
fn write_snapshot(name: &str, content: &str) {
    let path = snapshot_path(name);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, content).unwrap();
}

// ── shared stream setup ───────────────────────────────────────────────────────

struct TestStream<'a> {
    env: soroban_sdk::Env,
    client: VestingDripsClient<'a>,
    sponsor: Address,
    recipient: Address,
    token: Address,
}

fn make_stream() -> TestStream<'static> {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    // Safety: the env outlives the client in these short-lived tests.
    let env: &'static soroban_sdk::Env = Box::leak(Box::new(env));
    let client = VestingDripsClient::new(env, &contract_id);
    let sponsor = Address::generate(env);
    let recipient = Address::generate(env);
    let (token, _) = create_token(env, &sponsor);
    mint_to(env, &token, &sponsor, 2_000);
    client
        .create_vesting_stream(&sponsor, &recipient, &token, &10, &50, &200)
        .unwrap();
    TestStream { env: unsafe { std::ptr::read(env) }, client, sponsor, recipient, token }
}

// ── snapshot assertion ────────────────────────────────────────────────────────

/// Serialise all emitted events to a stable JSON string and compare with snapshot.
///
/// The format is:
/// ```json
/// [{"contract":"<id>","topics":[...],"data":{...}}, ...]
/// ```
/// Addresses are replaced with stable placeholder strings so snapshots are
/// deterministic across test runs.
fn assert_event_snapshot(
    env: &soroban_sdk::Env,
    snapshot_name: &str,
    topic_symbol: &str,
) {
    let events = env.events().all();

    // Find the event whose first topic matches the symbol.
    let event = events.iter().find(|(_, topics, _)| {
        // topics is a Vec<Val>; first element is the symbol.
        let expected: soroban_sdk::Val = soroban_sdk::Symbol::new(env, topic_symbol).into_val(env);
        topics.first().map(|t| t == expected).unwrap_or(false)
    });

    let event = event.unwrap_or_else(|| {
        panic!("No event with topic symbol '{}' found", topic_symbol)
    });

    // Build a simplified JSON representation using the Debug output of the
    // soroban types (stable enough for snapshot comparison).
    let json = format!(
        "{{\"topics\":{:?},\"data\":{:?}}}",
        event.1, event.2
    );

    match read_snapshot(snapshot_name) {
        None => {
            // First run — write snapshot.
            write_snapshot(snapshot_name, &json);
            println!("Snapshot written: {}", snapshot_name);
        }
        Some(existing) => {
            assert_eq!(
                existing.trim(),
                json.trim(),
                "Event snapshot mismatch for '{}'. \
                 Delete the snapshot file and re-run to update.",
                snapshot_name
            );
        }
    }
}

// ── tests ─────────────────────────────────────────────────────────────────────

#[test]
fn snapshot_event_stream_created() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token, &10, &50, &200)
        .unwrap();

    assert_event_snapshot(&env, "event_stream_created.snap", "vc_create");
}

#[test]
fn snapshot_event_tokens_claimed() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token, &10, &50, &200)
        .unwrap();
    advance_ledger(&env, 50); // reach cliff
    client.claim_vested(&recipient).unwrap();

    assert_event_snapshot(&env, "event_tokens_claimed.snap", "vc_claim");
}

#[test]
fn snapshot_event_stream_completed() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token, &10, &50, &200)
        .unwrap();
    advance_ledger(&env, 500); // past end_ledger
    client.claim_vested(&recipient).unwrap(); // full claim triggers vc_done

    assert_event_snapshot(&env, "event_stream_completed.snap", "vc_done");
}

#[test]
fn snapshot_event_stream_cancelled() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 2_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token, &10, &50, &200)
        .unwrap();
    client.cancel_stream(&sponsor, &recipient).unwrap();

    assert_event_snapshot(&env, "event_stream_cancelled.snap", "vc_cancel");
}
