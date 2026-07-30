//! Instruction-count benchmarks for every contract entry point.
//!
//! Each test calls `env.budget().reset_default()` before the measured call,
//! then reads `env.budget().cpu_instruction_cost()` and
//! `env.budget().memory_bytes_cost()` immediately after to isolate the cost of
//! that single invocation.
//!
//! The CI workflow captures output with:
//!
//! ```sh
//! cargo test --features testutils bench_ -- --nocapture 2>/dev/null \
//!   | grep '^BENCH' | sed 's/^BENCH //' \
//!   | jq -s '{benchmarks: .}' > benchmarks/results.json
//! ```
//!
//! Each measurement line has the form:
//!
//! ```text
//! BENCH {"fn":"<name>","cpu_instructions":<u64>,"memory_bytes":<u64>}
//! ```

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    tests::{advance_ledger, setup_env},
};

use super::token_helper::{create_token, mint_to};

// ── helpers ──────────────────────────────────────────────────────────────────

/// Emit one BENCH line that the CI capture script recognises.
fn emit(fn_name: &str, cpu: u64, mem: u64) {
    println!(
        "BENCH {{\"fn\":\"{fn_name}\",\"cpu_instructions\":{cpu},\"memory_bytes\":{mem}}}"
    );
}

/// Create a stream with standard parameters.
/// rate=10, cliff_duration=50, total_duration=200 → deposit=2000
fn create_stream<'a>(
    env: &'a Env,
    client: &VestingDripsClient<'a>,
    sponsor: &Address,
    recipient: &Address,
) {
    let (token_id, _) = create_token(env, sponsor);
    mint_to(env, &token_id, sponsor, 2_000);
    client
        .create_vesting_stream(sponsor, recipient, &token_id, &10, &50, &200)
        .unwrap();
}

// ─────────────────────────────────────────────────────────────────────────────
// create_vesting_stream
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn bench_create_vesting_stream() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 2_000);

    env.budget().reset_default();
    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &50, &200)
        .unwrap();

    let cpu = env.budget().cpu_instruction_cost();
    let mem = env.budget().memory_bytes_cost();
    emit("create_vesting_stream", cpu, mem);
}

// ─────────────────────────────────────────────────────────────────────────────
// claim_vested — first claim at the cliff (includes catch-up accrual)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn bench_claim_vested_at_cliff() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    create_stream(&env, &client, &sponsor, &recipient);

    advance_ledger(&env, 50); // exactly at cliff

    env.budget().reset_default();
    client.claim_vested(&recipient).unwrap();

    let cpu = env.budget().cpu_instruction_cost();
    let mem = env.budget().memory_bytes_cost();
    emit("claim_vested_at_cliff", cpu, mem);
}

// ─────────────────────────────────────────────────────────────────────────────
// claim_vested — mid-stream incremental claim (no catch-up)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn bench_claim_vested_mid_stream() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    create_stream(&env, &client, &sponsor, &recipient);

    // Clear catch-up accrual first.
    advance_ledger(&env, 50);
    client.claim_vested(&recipient).unwrap();

    // Measure a clean incremental claim.
    advance_ledger(&env, 50);

    env.budget().reset_default();
    client.claim_vested(&recipient).unwrap();

    let cpu = env.budget().cpu_instruction_cost();
    let mem = env.budget().memory_bytes_cost();
    emit("claim_vested_mid_stream", cpu, mem);
}

// ─────────────────────────────────────────────────────────────────────────────
// cancel_stream — before cliff (full refund path)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn bench_cancel_stream_before_cliff() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    create_stream(&env, &client, &sponsor, &recipient);

    advance_ledger(&env, 10); // still before cliff

    env.budget().reset_default();
    client.cancel_stream(&sponsor, &recipient).unwrap();

    let cpu = env.budget().cpu_instruction_cost();
    let mem = env.budget().memory_bytes_cost();
    emit("cancel_stream_before_cliff", cpu, mem);
}

// ─────────────────────────────────────────────────────────────────────────────
// cancel_stream — after cliff (split-payout path)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn bench_cancel_stream_after_cliff() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    create_stream(&env, &client, &sponsor, &recipient);

    advance_ledger(&env, 100); // well past the cliff

    env.budget().reset_default();
    client.cancel_stream(&sponsor, &recipient).unwrap();

    let cpu = env.budget().cpu_instruction_cost();
    let mem = env.budget().memory_bytes_cost();
    emit("cancel_stream_after_cliff", cpu, mem);
}

// ─────────────────────────────────────────────────────────────────────────────
// get_schedule (view — active stream)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn bench_get_schedule() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    create_stream(&env, &client, &sponsor, &recipient);

    env.budget().reset_default();
    let _ = client.get_schedule(&recipient);

    let cpu = env.budget().cpu_instruction_cost();
    let mem = env.budget().memory_bytes_cost();
    emit("get_schedule", cpu, mem);
}

// ─────────────────────────────────────────────────────────────────────────────
// claimable_amount — before cliff (returns 0)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn bench_claimable_amount_before_cliff() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    create_stream(&env, &client, &sponsor, &recipient);

    advance_ledger(&env, 20); // before cliff

    env.budget().reset_default();
    let _ = client.claimable_amount(&recipient);

    let cpu = env.budget().cpu_instruction_cost();
    let mem = env.budget().memory_bytes_cost();
    emit("claimable_amount_before_cliff", cpu, mem);
}

// ─────────────────────────────────────────────────────────────────────────────
// claimable_amount — after cliff (non-zero result)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn bench_claimable_amount_after_cliff() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    create_stream(&env, &client, &sponsor, &recipient);

    advance_ledger(&env, 75); // past cliff

    env.budget().reset_default();
    let _ = client.claimable_amount(&recipient);

    let cpu = env.budget().cpu_instruction_cost();
    let mem = env.budget().memory_bytes_cost();
    emit("claimable_amount_after_cliff", cpu, mem);
}

// ─────────────────────────────────────────────────────────────────────────────
// is_cliff_passed
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn bench_is_cliff_passed() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    create_stream(&env, &client, &sponsor, &recipient);

    advance_ledger(&env, 50); // exactly at cliff

    env.budget().reset_default();
    let _ = client.is_cliff_passed(&recipient);

    let cpu = env.budget().cpu_instruction_cost();
    let mem = env.budget().memory_bytes_cost();
    emit("is_cliff_passed", cpu, mem);
}
