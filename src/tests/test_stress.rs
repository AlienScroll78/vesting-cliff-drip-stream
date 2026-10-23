#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env,
};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    tests::{advance_ledger, setup_env},
};

use super::super::tests::token_helper::{create_token, mint_to};

const RECIPIENT_COUNT: usize = 100;
const EXPIRED_STREAM_COUNT: usize = 1_000;

#[contract]
struct StressMockToken;

#[contracttype]
#[derive(Clone)]
enum StressMockTokenKey {
    Balance(Address),
}

#[contractimpl]
impl StressMockToken {
    pub fn mint(env: Env, account: Address, amount: i128) {
        let key = StressMockTokenKey::Balance(account);
        let balance = env.storage().persistent().get(&key).unwrap_or(0_i128);
        env.storage().persistent().set(&key, &(balance + amount));
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        let from_key = StressMockTokenKey::Balance(from);
        let to_key = StressMockTokenKey::Balance(to);
        let from_balance = env
            .storage()
            .persistent()
            .get(&from_key)
            .unwrap_or(0_i128);
        assert!(from_balance >= amount, "insufficient mock token balance");
        let to_balance = env.storage().persistent().get(&to_key).unwrap_or(0_i128);
        env.storage()
            .persistent()
            .set(&from_key, &(from_balance - amount));
        env.storage()
            .persistent()
            .set(&to_key, &(to_balance + amount));
    }

    pub fn balance(env: Env, account: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&StressMockTokenKey::Balance(account))
            .unwrap_or(0_i128)
    }
}

fn advance_ledger_high_ttl(env: &Env, n: u32) {
    let current = env.ledger().sequence();
    env.ledger().set(LedgerInfo {
        timestamp: 0,
        protocol_version: 22,
        sequence_number: current + n,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 1_000,
        max_entry_ttl: u32::MAX,
    });
}

/// Stress test: many recipients each create and claim a stream.
///
/// Validates:
/// - All streams are created without error
/// - All claims succeed after the cliff (0% error rate)
/// - Each recipient receives the correct token amount
#[test]
fn test_high_load_recipients_claim() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury);

    // rate=10, cliff=50, total=100 → deposit=1000 per recipient
    let rate: i128 = 10;
    let cliff_duration: u32 = 50;
    let total_duration: u32 = 100;
    let deposit_per = rate * total_duration as i128;
    let total_deposit = deposit_per * RECIPIENT_COUNT as i128;

    let sponsor = Address::generate(&env);
    let (token_id, token_client) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, total_deposit);

    // Create all streams
    let recipients: Vec<Address> = (0..RECIPIENT_COUNT)
        .map(|_| {
            let r = Address::generate(&env);
            client.create_vesting_stream(
                &sponsor,
                &r,
                &token_id,
                &rate,
                &cliff_duration,
                &total_duration,
                &None,
            );
            r
        })
        .collect();

    // Advance past the cliff
    advance_ledger(&env, cliff_duration);

    // All claims must succeed (0 errors)
    let mut errors = 0usize;
    let mut total_claimed: i128 = 0;

    for r in &recipients {
        match client.try_claim_vested(r) {
            Ok(Ok(amount)) => total_claimed += amount,
            _ => errors += 1,
        }
    }

    assert_eq!(errors, 0, "error rate must be 0% under load");

    // Each recipient claimed cliff accrual: cliff_duration × rate = 500
    let expected_per = cliff_duration as i128 * rate;
    assert_eq!(total_claimed, expected_per * RECIPIENT_COUNT as i128);

    // Spot-check one recipient's token balance
    assert_eq!(token_client.balance(&recipients[0]), expected_per);
}

/// Verifies that all streams can be fully claimed end-to-end.
#[test]
fn test_high_load_recipients_full_drain() {
    let env = setup_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury);

    let rate: i128 = 10;
    let total_duration: u32 = 100;
    let deposit_per = rate * total_duration as i128;

    let sponsor = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, deposit_per * RECIPIENT_COUNT as i128);

    let recipients: Vec<Address> = (0..RECIPIENT_COUNT)
        .map(|_| {
            let r = Address::generate(&env);
            client.create_vesting_stream(
                &sponsor,
                &r,
                &token_id,
                &rate,
                &10,
                &total_duration,
                &None,
            );
            r
        })
        .collect();

    // Advance past end_ledger
    advance_ledger(&env, total_duration + 1);

    let mut errors = 0usize;
    for r in &recipients {
        if client.try_claim_vested(r).is_err() {
            errors += 1;
        }
    }

    assert_eq!(errors, 0, "full-drain error rate must be 0%");

    // All schedules should be cleared
    for r in &recipients {
        assert!(client.get_schedule(r).is_none());
    }
}

/// Exercises permissionless cleanup at 1,000 expired recipients. This is
/// opt-in because of its scale; `make stress-test` reports average Soroban CPU
/// instructions and memory bytes per drain.
#[test]
#[ignore = "run explicitly with make stress-test"]
fn test_drain_1000_expired_streams() {
    use crate::contract::DRAIN_DELAY_LEDGERS;

    let env = setup_env();
    advance_ledger_high_ttl(&env, 0);
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury);

    let sponsor = Address::generate(&env);
    let token_id = env.register(StressMockToken, ());
    let token = StressMockTokenClient::new(&env, &token_id);
    let caller = Address::generate(&env);
    let rate = 10_i128;
    let cliff_duration = 50_u32;
    let total_duration = 200_u32;
    let deposit_per_stream = rate * total_duration as i128;
    let total_deposit = deposit_per_stream * EXPIRED_STREAM_COUNT as i128;
    token.mint(&sponsor, &total_deposit);

    let mut recipients = Vec::with_capacity(EXPIRED_STREAM_COUNT);
    for _ in 0..EXPIRED_STREAM_COUNT {
        let recipient = Address::generate(&env);
        env.budget().reset_default();
        client
            .create_vesting_stream(
                &sponsor,
                &recipient,
                &token_id,
                &rate,
                &cliff_duration,
                &total_duration,
                &None,
            )
            .unwrap();
        recipients.push(recipient);
    }

    advance_ledger_high_ttl(&env, total_duration + DRAIN_DELAY_LEDGERS);

    let mut total_cpu_instructions = 0_u64;
    let mut total_memory_bytes = 0_u64;
    for recipient in &recipients {
        env.budget().reset_default();
        client.drain_expired_stream(&caller, recipient).unwrap();
        total_cpu_instructions += env.budget().cpu_instruction_cost();
        total_memory_bytes += env.budget().memory_bytes_cost();
    }

    assert_eq!(token.balance(&sponsor), total_deposit);
    for recipient in &recipients {
        env.budget().reset_default();
        assert_eq!(token.balance(recipient), 0);
    }

    let mut remaining_streams = 0;
    for recipient in &recipients {
        env.budget().reset_default();
        let has_stream = env.as_contract(&contract_id, || {
            !crate::storage::get_stream_ids(&env, recipient).is_empty()
        });
        remaining_streams += usize::from(has_stream);
    }
    assert_eq!(remaining_streams, 0, "draining must remove every stream key");

    eprintln!(
        "drain_expired_stream average per call: {} CPU instructions, {} memory bytes",
        total_cpu_instructions / EXPIRED_STREAM_COUNT as u64,
        total_memory_bytes / EXPIRED_STREAM_COUNT as u64,
    );
}
