//! Golden-path integration test: complete 10-day vesting scenario.
//!
//! This test serves as living documentation of the vesting math.
//!
//! # Scenario
//! - Rate:           10 tokens/ledger (scaled: 10 * RATE_DECIMALS)
//! - Cliff:          17,280 ledgers  (~1 day at 5 s/ledger)
//! - Total duration: 172,800 ledgers (~10 days at 5 s/ledger)
//! - Total deposit:  1,728,000 tokens (10 * 172,800)
//!
//! # Checkpoints
//! 1. After creation    – sponsor balance reduced by 1,728,000.
//! 2. At cliff - 1      – `claimable_amount` == 0 (cliff not yet reached).
//! 3. At cliff          – `claimable_amount` == 172,800 (17,280 ledgers * 10 tokens).
//! 4. Claim at cliff    – recipient receives 172,800 tokens.
//! 5. At 50% of post-cliff remaining duration – `claimable_amount` == 777,600.
//! 6. At end_ledger     – `claimable_amount` == 1,555,200 (full remainder).
//! 7. After full claim  – sponsor vault balance == 0 (stream cleared).

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, token::TokenClient, Address};

use crate::{
    tests::{advance_ledger, register_contract, setup_env, setup_token},
    types::RATE_DECIMALS,
};

/// Runs the complete golden-path 10-day vesting scenario end-to-end.
#[test]
fn test_golden_path_10_day_vesting() {
    // ── Setup ─────────────────────────────────────────────────────────────────

    let env = setup_env(); // ledger sequence starts at 100
    let (_contract_id, client) = register_contract(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);

    // Stream parameters (raw, un-scaled rates — helpers scale by RATE_DECIMALS)
    // We use the unscaled rate here for clarity.  The contract's deposit formula
    // is: deposit = rate * total_duration / RATE_DECIMALS.
    // With rate = RATE_DECIMALS * 10 (10 tokens/ledger) and duration = 172_800:
    //   deposit = (RATE_DECIMALS * 10) * 172_800 / RATE_DECIMALS = 1_728_000.
    let rate_per_ledger: i128 = RATE_DECIMALS * 10; // 10 tokens/ledger (scaled)
    let cliff_duration: u32 = 17_280;               // ~1 day
    let total_duration: u32 = 172_800;              // ~10 days
    let total_deposit: i128 = 1_728_000;            // 10 * 172_800

    // Mint exactly total_deposit tokens to the sponsor.
    let (token_id, _) = setup_token(&env, &sponsor, total_deposit);
    let tc = TokenClient::new(&env, &token_id);

    let start_ledger = env.ledger().sequence(); // 100
    let cliff_ledger = start_ledger + cliff_duration; // 17_380
    let end_ledger = start_ledger + total_duration;   // 172_900

    // ── Checkpoint 1: After creation ─────────────────────────────────────────
    // Sponsor balance starts at total_deposit; after creation it should be 0
    // because the full deposit is transferred into the contract vault.

    let sponsor_balance_before = tc.balance(&sponsor);
    assert_eq!(
        sponsor_balance_before, total_deposit,
        "CP1: sponsor should hold exactly total_deposit before stream creation"
    );

    client.create_vesting_stream(
        &sponsor,
        &recipient,
        &token_id,
        &rate_per_ledger,
        &cliff_duration,
        &total_duration,
        &None,
    );

    let sponsor_balance_after_create = tc.balance(&sponsor);
    assert_eq!(
        sponsor_balance_after_create, 0,
        "CP1: sponsor balance should be 0 after deposit (full deposit transferred to vault)"
    );

    // Verify the stream was stored correctly.
    let schedule = client.get_schedule(&recipient).expect("schedule must exist after creation");
    assert_eq!(schedule.start_ledger, start_ledger);
    assert_eq!(schedule.cliff_ledger, cliff_ledger);
    assert_eq!(schedule.end_ledger, end_ledger);
    assert_eq!(schedule.rate_per_ledger, rate_per_ledger);

    // ── Checkpoint 2: At cliff - 1 ledger ────────────────────────────────────
    // One ledger before the cliff nothing should be claimable.

    // Advance to exactly one ledger before the cliff.
    // start_ledger=100, cliff_ledger=17_380 → advance 17_279 ledgers.
    advance_ledger(&env, cliff_duration - 1); // sequence = 17_379

    assert_eq!(
        env.ledger().sequence(),
        cliff_ledger - 1,
        "CP2: ledger should be at cliff - 1"
    );
    assert_eq!(
        client.claimable_amount(&recipient),
        0,
        "CP2: nothing claimable one ledger before cliff"
    );
    assert!(
        !client.is_cliff_passed(&recipient),
        "CP2: cliff should not be passed yet"
    );

    // ── Checkpoint 3: At cliff ────────────────────────────────────────────────
    // At exactly cliff_ledger the full accrual since start_ledger should unlock.
    // accrued = cliff_duration * rate_per_ledger / RATE_DECIMALS
    //         = 17_280 * (10 * RATE_DECIMALS) / RATE_DECIMALS
    //         = 17_280 * 10
    //         = 172_800 tokens.

    advance_ledger(&env, 1); // sequence = 17_380 == cliff_ledger

    assert_eq!(
        env.ledger().sequence(),
        cliff_ledger,
        "CP3: ledger should be at cliff"
    );

    let expected_at_cliff: i128 = cliff_duration as i128 * 10; // 172_800
    assert_eq!(
        client.claimable_amount(&recipient),
        expected_at_cliff,
        "CP3: claimable at cliff should equal cliff_duration * rate"
    );
    assert!(
        client.is_cliff_passed(&recipient),
        "CP3: cliff should now be passed"
    );

    // ── Checkpoint 4: Claim at cliff ──────────────────────────────────────────
    // Claiming at the cliff should transfer exactly 172_800 tokens.

    let claimed_at_cliff = client.claim_vested(&recipient);
    assert_eq!(
        claimed_at_cliff, expected_at_cliff,
        "CP4: claim at cliff should return exactly cliff accrual"
    );
    assert_eq!(
        tc.balance(&recipient),
        expected_at_cliff,
        "CP4: recipient balance should equal claimed amount"
    );

    // After claiming, nothing more should be claimable at the same ledger.
    assert_eq!(
        client.claimable_amount(&recipient),
        0,
        "CP4: no more claimable immediately after claim"
    );

    // ── Checkpoint 5: At 50% of remaining post-cliff duration ─────────────────
    // After the cliff claim, `last_claimed_ledger` == cliff_ledger = 17_380.
    // Remaining duration after cliff: total_duration - cliff_duration = 155_520 ledgers.
    // 50% of that = 77_760 ledgers after cliff_ledger → absolute ledger = 95_140.
    // Tokens accrued over those 77_760 ledgers = 77_760 * 10 = 777_600.

    let post_cliff_duration: u32 = total_duration - cliff_duration; // 155_520
    let half_post_cliff: u32 = post_cliff_duration / 2;             // 77_760
    advance_ledger(&env, half_post_cliff); // sequence = 17_380 + 77_760 = 95_140

    let expected_at_half: i128 = half_post_cliff as i128 * 10; // 777_600
    assert_eq!(
        client.claimable_amount(&recipient),
        expected_at_half,
        "CP5: claimable at 50%% post-cliff should equal half post-cliff duration * rate"
    );

    // ── Checkpoint 6: At end_ledger ───────────────────────────────────────────
    // Advance to end_ledger. At or past end_ledger the full remaining deposit
    // (total_deposit minus already-claimed tokens) should be claimable.
    // Already claimed: 172_800.
    // Remaining: 1_728_000 - 172_800 = 1_555_200.

    // Current ledger = 95_140; end_ledger = 172_900.  Need to advance 77_760 more.
    advance_ledger(&env, half_post_cliff); // sequence = 172_900 == end_ledger

    assert_eq!(
        env.ledger().sequence(),
        end_ledger,
        "CP6: ledger should be at end_ledger"
    );

    let expected_remaining: i128 = total_deposit - expected_at_cliff; // 1_555_200
    assert_eq!(
        client.claimable_amount(&recipient),
        expected_remaining,
        "CP6: claimable at end_ledger should equal total_deposit minus cliff claim"
    );

    // ── Checkpoint 7: After full claim — sponsor vault balance == 0 ───────────
    // Claiming the remainder should drain the vault completely.

    let claimed_remainder = client.claim_vested(&recipient);
    assert_eq!(
        claimed_remainder, expected_remaining,
        "CP7: claim at end should return remaining tokens"
    );

    // Recipient holds 172_800 + 1_555_200 = 1_728_000 == total_deposit.
    assert_eq!(
        tc.balance(&recipient),
        total_deposit,
        "CP7: recipient total balance should equal total_deposit"
    );

    // Stream schedule should have been removed (dust-collection auto-cleanup).
    assert!(
        client.get_schedule(&recipient).is_none(),
        "CP7: schedule should be removed after full claim"
    );

    // Sponsor vault: the contract should hold 0 tokens for this stream.
    // (No direct vault-balance view; we verify via total_claimed and removed schedule.)
    assert_eq!(
        client.get_total_claimed(&recipient),
        0, // schedule removed, helper returns 0
        "CP7: get_total_claimed returns 0 after schedule removal"
    );
}

/// Validates the exact ledger arithmetic constants used in the golden path.
///
/// This test is independent of the contract and exists purely to document
/// the numerical relationships between the scenario parameters.
#[test]
fn test_golden_path_ledger_arithmetic() {
    const RATE: i128 = 10;                      // tokens per ledger
    const CLIFF_DURATION: u32 = 17_280;         // ledgers
    const TOTAL_DURATION: u32 = 172_800;        // ledgers
    const TOTAL_DEPOSIT: i128 = 1_728_000;      // tokens

    // Verify total_deposit = rate × total_duration
    assert_eq!(
        RATE * TOTAL_DURATION as i128,
        TOTAL_DEPOSIT,
        "total_deposit == rate * total_duration"
    );

    // Verify cliff accrual = rate × cliff_duration
    let cliff_accrual: i128 = RATE * CLIFF_DURATION as i128;
    assert_eq!(cliff_accrual, 172_800, "cliff accrual == 172_800 tokens");

    // Verify post-cliff half = rate × (total_duration - cliff_duration) / 2
    let post_cliff: u32 = TOTAL_DURATION - CLIFF_DURATION;
    let half_post_cliff_accrual: i128 = RATE * (post_cliff / 2) as i128;
    assert_eq!(half_post_cliff_accrual, 777_600, "half post-cliff accrual == 777_600 tokens");

    // Verify remaining after cliff claim = total_deposit - cliff_accrual
    let remaining: i128 = TOTAL_DEPOSIT - cliff_accrual;
    assert_eq!(remaining, 1_555_200, "remaining after cliff claim == 1_555_200 tokens");

    // Verify cliff_accrual + remaining == total_deposit
    assert_eq!(
        cliff_accrual + remaining,
        TOTAL_DEPOSIT,
        "cliff_accrual + remaining == total_deposit"
    );
}
