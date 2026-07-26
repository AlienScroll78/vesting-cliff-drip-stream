//! # Instruction-Count Benchmarks
//!
//! Measures CPU instruction counts and memory byte allocations for every
//! contract entry point using the Soroban test environment's budget tracker.
//!
//! ## Usage
//!
//! ```bash
//! # Runs all benchmarks and writes benchmarks/results.json
//! cargo test --features testutils --test bench bench_all_write_json -- --nocapture
//!
//! # Run individual benchmarks:
//! cargo test --features testutils --test bench -- --nocapture
//!
//! # Via Makefile:
//! make bench
//! ```
//!
//! The output JSON mirrors the `wasm_instruction_counts` section of
//! `benchmarks/baseline.json` so `benchmarks/compare.js` can diff them directly.

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env,
};

use vesting_cliff_drip_stream::{
    contract::{VestingDrips, VestingDripsClient},
};

// Re-use the token helper from the existing test suite.
#[path = "src/tests/token_helper.rs"]
mod token_helper;
use token_helper::{create_token, mint_to};

// ── Environment helpers ───────────────────────────────────────────────────────

fn setup() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(LedgerInfo {
        timestamp: 0,
        protocol_version: 22,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 1000,
        max_entry_ttl: 3_110_400,
    });
    env
}

fn advance(env: &Env, n: u32) {
    let seq = env.ledger().sequence();
    env.ledger().set(LedgerInfo {
        timestamp: 0,
        protocol_version: 22,
        sequence_number: seq + n,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 1000,
        max_entry_ttl: 3_110_400,
    });
}

/// Resets the budget counters so only the subsequent operation is measured.
fn reset_budget(env: &Env) {
    env.budget().reset_default();
    env.budget().reset_tracker();
}

/// Returns `(cpu_instructions, mem_bytes)` consumed since the last reset.
fn sample(env: &Env) -> (u64, u64) {
    let cpu = env.budget().cpu_instruction_count();
    let mem = env.budget().memory_bytes_count();
    (cpu, mem)
}

/// Prints one structured line to stdout that the CI script collects.
fn emit(name: &str, cpu: u64, mem: u64) {
    println!(
        r#"BENCH_RESULT {{"name":"{name}","cpu_instructions":{cpu},"mem_bytes":{mem}}}"#
    );
}

// ── Per-entry-point benchmarks ────────────────────────────────────────────────

#[test]
fn bench_create_vesting_stream() {
    let env = setup();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000_000_000);

    reset_budget(&env);
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10_i128, &50_u32, &200_u32)
        .expect("create_vesting_stream failed");
    let (cpu, mem) = sample(&env);
    emit("create_vesting_stream", cpu, mem);
    assert!(cpu > 0, "cpu instructions should be > 0");
}

#[test]
fn bench_claim_vested() {
    let env = setup();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000_000_000);
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10_i128, &50_u32, &200_u32)
        .expect("create failed");
    advance(&env, 51);

    reset_budget(&env);
    client.claim_vested(&recipient).expect("claim failed");
    let (cpu, mem) = sample(&env);
    emit("claim_vested", cpu, mem);
    assert!(cpu > 0);
}

#[test]
fn bench_cancel_stream_pre_cliff() {
    let env = setup();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000_000_000);
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10_i128, &50_u32, &200_u32)
        .expect("create failed");

    reset_budget(&env);
    client.cancel_stream(&sponsor, &recipient).expect("cancel failed");
    let (cpu, mem) = sample(&env);
    emit("cancel_stream_pre_cliff", cpu, mem);
    assert!(cpu > 0);
}

#[test]
fn bench_cancel_stream_post_cliff() {
    let env = setup();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000_000_000);
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10_i128, &50_u32, &200_u32)
        .expect("create failed");
    advance(&env, 51);

    reset_budget(&env);
    client.cancel_stream(&sponsor, &recipient).expect("cancel failed");
    let (cpu, mem) = sample(&env);
    emit("cancel_stream_post_cliff", cpu, mem);
    assert!(cpu > 0);
}

#[test]
fn bench_get_schedule() {
    let env = setup();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000_000_000);
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10_i128, &50_u32, &200_u32)
        .expect("create failed");

    reset_budget(&env);
    let _ = client.get_schedule(&recipient);
    let (cpu, mem) = sample(&env);
    emit("get_schedule", cpu, mem);
    assert!(cpu > 0);
}

#[test]
fn bench_claimable_amount() {
    let env = setup();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000_000_000);
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10_i128, &50_u32, &200_u32)
        .expect("create failed");
    advance(&env, 51);

    reset_budget(&env);
    let _ = client.claimable_amount(&recipient);
    let (cpu, mem) = sample(&env);
    emit("claimable_amount", cpu, mem);
    assert!(cpu > 0);
}

#[test]
fn bench_is_cliff_passed() {
    let env = setup();
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &cid);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000_000_000);
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10_i128, &50_u32, &200_u32)
        .expect("create failed");
    advance(&env, 51);

    reset_budget(&env);
    let _ = client.is_cliff_passed(&recipient);
    let (cpu, mem) = sample(&env);
    emit("is_cliff_passed", cpu, mem);
    assert!(cpu > 0);
}

// ── Aggregate runner — writes benchmarks/results.json ────────────────────────

/// Runs every benchmark in sequence and writes `benchmarks/results.json`.
/// Invoked by `make bench`.
#[test]
fn bench_all_write_json() {
    use std::fs;

    struct Row {
        name: &'static str,
        cpu: u64,
        mem: u64,
    }

    let mut rows: Vec<Row> = Vec::new();

    macro_rules! scenario {
        ($name:expr, $setup_body:expr, $measure_body:expr) => {{
            let env = setup();
            $setup_body(&env);
            reset_budget(&env);
            $measure_body(&env);
            let (cpu, mem) = sample(&env);
            emit($name, cpu, mem);
            rows.push(Row { name: $name, cpu, mem });
        }};
    }

    // Helper closure to create a stream in an env.
    let make_stream = |env: &Env| {
        let cid = env.register(VestingDrips, ());
        let client = VestingDripsClient::new(env, &cid);
        let sponsor = Address::generate(env);
        let recipient = Address::generate(env);
        let (token_id, _) = create_token(env, &sponsor);
        mint_to(env, &token_id, &sponsor, 1_000_000_000);
        client
            .create_vesting_stream(&sponsor, &recipient, &token_id, &10_i128, &50_u32, &200_u32)
            .expect("create failed");
        (cid, sponsor, recipient, token_id)
    };

    // create_vesting_stream
    {
        let env = setup();
        let cid = env.register(VestingDrips, ());
        let client = VestingDripsClient::new(&env, &cid);
        let sponsor = Address::generate(&env);
        let recipient = Address::generate(&env);
        let (token_id, _) = create_token(&env, &sponsor);
        mint_to(&env, &token_id, &sponsor, 1_000_000_000);
        reset_budget(&env);
        let _ = client.create_vesting_stream(
            &sponsor, &recipient, &token_id, &10_i128, &50_u32, &200_u32,
        );
        let (cpu, mem) = sample(&env);
        emit("create_vesting_stream", cpu, mem);
        rows.push(Row { name: "create_vesting_stream", cpu, mem });
    }

    // claim_vested
    {
        let env = setup();
        let (cid, _, recipient, token_id) = make_stream(&env);
        let client = VestingDripsClient::new(&env, &cid);
        advance(&env, 51);
        reset_budget(&env);
        let _ = client.claim_vested(&recipient);
        let (cpu, mem) = sample(&env);
        emit("claim_vested", cpu, mem);
        rows.push(Row { name: "claim_vested", cpu, mem });
    }

    // cancel_stream_pre_cliff
    {
        let env = setup();
        let (cid, sponsor, recipient, _) = make_stream(&env);
        let client = VestingDripsClient::new(&env, &cid);
        reset_budget(&env);
        let _ = client.cancel_stream(&sponsor, &recipient);
        let (cpu, mem) = sample(&env);
        emit("cancel_stream_pre_cliff", cpu, mem);
        rows.push(Row { name: "cancel_stream_pre_cliff", cpu, mem });
    }

    // cancel_stream_post_cliff
    {
        let env = setup();
        let (cid, sponsor, recipient, _) = make_stream(&env);
        let client = VestingDripsClient::new(&env, &cid);
        advance(&env, 51);
        reset_budget(&env);
        let _ = client.cancel_stream(&sponsor, &recipient);
        let (cpu, mem) = sample(&env);
        emit("cancel_stream_post_cliff", cpu, mem);
        rows.push(Row { name: "cancel_stream_post_cliff", cpu, mem });
    }

    // get_schedule
    {
        let env = setup();
        let (cid, _, recipient, _) = make_stream(&env);
        let client = VestingDripsClient::new(&env, &cid);
        reset_budget(&env);
        let _ = client.get_schedule(&recipient);
        let (cpu, mem) = sample(&env);
        emit("get_schedule", cpu, mem);
        rows.push(Row { name: "get_schedule", cpu, mem });
    }

    // claimable_amount
    {
        let env = setup();
        let (cid, _, recipient, _) = make_stream(&env);
        let client = VestingDripsClient::new(&env, &cid);
        advance(&env, 51);
        reset_budget(&env);
        let _ = client.claimable_amount(&recipient);
        let (cpu, mem) = sample(&env);
        emit("claimable_amount", cpu, mem);
        rows.push(Row { name: "claimable_amount", cpu, mem });
    }

    // is_cliff_passed
    {
        let env = setup();
        let (cid, _, recipient, _) = make_stream(&env);
        let client = VestingDripsClient::new(&env, &cid);
        advance(&env, 51);
        reset_budget(&env);
        let _ = client.is_cliff_passed(&recipient);
        let (cpu, mem) = sample(&env);
        emit("is_cliff_passed", cpu, mem);
        rows.push(Row { name: "is_cliff_passed", cpu, mem });
    }

    // Serialise to JSON (no extra dependency needed).
    let mut json = String::from("{\n  \"wasm_instruction_counts\": {\n");
    for (i, row) in rows.iter().enumerate() {
        let comma = if i + 1 < rows.len() { "," } else { "" };
        json.push_str(&format!(
            "    \"{}\": {{\"cpu_instructions\":{},\"mem_bytes\":{}}}{}\n",
            row.name, row.cpu, row.mem, comma
        ));
    }
    json.push_str("  }\n}\n");

    let out = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("benchmarks")
        .join("results.json");
    fs::create_dir_all(out.parent().unwrap()).expect("create benchmarks dir");
    fs::write(&out, &json).expect("write results.json");
    println!("Wrote benchmark results to {}", out.display());
}
