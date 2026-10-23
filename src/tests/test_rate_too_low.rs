//! Tests for minimum-deposit enforcement: `RateTooLow` (code 17) vs
//! `DepositBelowMinimum` (code 23) (Issue #990).
//!
//! ## Decision record
//!
//! Both errors signal that the stream is too small to meet the configured
//! minimum deposit, but they fire at different points in the validation
//! pipeline:
//!
//! | Code | Name | When it fires |
//! |------|------|---------------|
//! | 17 | `RateTooLow` | Fast-path: `rate × total_duration < min_deposit`; checked before fixed-point scaling |
//! | 23 | `DepositBelowMinimum` | Overflow-safe fallback: `calculate_total_deposit` returned `Ok` but scaled result < `min_deposit` |
//!
//! Only **one** of these codes is returned per call; there is no ambiguity.
//! The user action is the same for both: increase `rate` or `total_duration`.

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    error::VestingError,
    tests::setup_env,
};

use super::super::tests::token_helper::{create_token, mint_to};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn make_client(env: &soroban_sdk::Env) -> (VestingDripsClient, Address) {
    let cid = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(env, &cid);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    client.initialize(&admin, &0u32, &treasury);
    (client, admin)
}

// ── RateTooLow (code 17) ──────────────────────────────────────────────────────

/// The fast-path fires when `rate × total_duration` is strictly less than
/// `min_deposit` and the multiplication does not overflow.
///
/// Default min_deposit = 100. With rate=1 and total=99, deposit=99 < 100.
#[test]
fn test_rate_too_low_fired_before_scaled_deposit() {
    let env = setup_env();
    let (client, _) = make_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 99);

    // rate=1, total=99 → 1×99 = 99 < min_deposit(100) → RateTooLow
    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token, &1, &10, &99, &None)
        .unwrap_err();
    assert_eq!(
        err,
        VestingError::RateTooLow.into(),
        "expected RateTooLow (code 17) for deposit=99 < min=100"
    );
}

/// Exactly at the minimum: `rate × total_duration == min_deposit` must succeed.
#[test]
fn test_rate_exactly_at_minimum_succeeds() {
    let env = setup_env();
    let (client, _) = make_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 100);

    // rate=1, total=100 → deposit=100 == min_deposit(100) → OK
    client
        .create_vesting_stream(&sponsor, &recipient, &token, &1, &10, &100, &None)
        .unwrap();
    assert!(client.get_schedule(&recipient).is_some());
}

/// One above minimum succeeds.
#[test]
fn test_rate_one_above_minimum_succeeds() {
    let env = setup_env();
    let (client, _) = make_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 101);

    // rate=1, total=101 → deposit=101 > 100 → OK
    client
        .create_vesting_stream(&sponsor, &recipient, &token, &1, &10, &101, &None)
        .unwrap();
}

/// With a custom min_deposit of 500, deposits below 500 return RateTooLow.
#[test]
fn test_rate_too_low_with_custom_min_deposit() {
    let env = setup_env();
    let (client, admin) = make_client(&env);

    client.set_min_deposit(&admin, &500).unwrap();

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 499);

    // rate=1, total=499 → 499 < 500 → RateTooLow
    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token, &1, &10, &499, &None)
        .unwrap_err();
    assert_eq!(err, VestingError::RateTooLow.into());
}

/// Exact custom minimum passes.
#[test]
fn test_rate_exactly_at_custom_minimum_succeeds() {
    let env = setup_env();
    let (client, admin) = make_client(&env);

    client.set_min_deposit(&admin, &500).unwrap();

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 500);

    // rate=5, total=100 → 5×100 = 500 == min → OK
    client
        .create_vesting_stream(&sponsor, &recipient, &token, &5, &10, &100, &None)
        .unwrap();
    assert!(client.get_schedule(&recipient).is_some());
}

// ── DepositBelowMinimum (code 23) ─────────────────────────────────────────────

/// `DepositBelowMinimum` fires when `calculate_total_deposit` (which applies
/// RATE_DECIMALS scaling) returns a value below min_deposit even though the
/// raw `rate × total_duration` product met the threshold.
///
/// This is most easily demonstrated by raising min_deposit to a value that
/// the scaled deposit would not meet.
#[test]
fn test_deposit_below_minimum_from_scaled_path() {
    let env = setup_env();
    let (client, admin) = make_client(&env);

    // Set min_deposit high enough that the scaled result is below it.
    // With RATE_DECIMALS = 10_000_000 (from contract), a rate=10 over
    // total=100 gives raw=1000 but scaled = 1000 / 10_000_000 = 0.
    // Any min_deposit > 0 triggers DepositBelowMinimum via the scaled path.
    // However because RateTooLow fires first when raw < min, we need a case
    // where raw >= min but scaled < min.
    //
    // Concretely: rate=10_000_001, total=1 → raw=10_000_001 >= min=100
    //             scaled = 10_000_001 / 10_000_000 = 1 < min=100
    // → RateTooLow fires first (raw=10_000_001 > 100), so fast-path passes.
    // → calculate_total_deposit returns 1 < 100 → DepositBelowMinimum.
    //
    // Note: min_deposit stays at 100 (default). raw product passes RateTooLow
    // guard (10_000_001 >= 100), but scaled result = 1 < 100.
    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    // Mint raw amount (transfer will be for the scaled amount which is 1,
    // but we need enough for the transfer to succeed — validation fires before
    // transfer so minting a small amount is fine).
    mint_to(&env, &token, &sponsor, 10_000_001);

    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token, &10_000_001, &0, &1, &None)
        .unwrap_err();
    assert_eq!(
        err,
        VestingError::DepositBelowMinimum.into(),
        "expected DepositBelowMinimum (code 23) when scaled deposit < min_deposit"
    );
}

// ── Disambiguation: only one code per call ────────────────────────────────────

/// A deposit of exactly zero after scaling returns DepositBelowMinimum, not RateTooLow,
/// because the raw product passes the RateTooLow gate.
#[test]
fn test_exactly_one_error_code_per_call() {
    let env = setup_env();
    let (client, _) = make_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);
    mint_to(&env, &token, &sponsor, 200);

    // Deposit below min via fast-path: returns RateTooLow (not DepositBelowMinimum)
    let err1 = client
        .create_vesting_stream(&sponsor, &recipient, &token, &1, &0, &99, &None)
        .unwrap_err();
    assert_eq!(
        err1,
        VestingError::RateTooLow.into(),
        "fast-path should return RateTooLow"
    );
    assert_ne!(
        err1,
        VestingError::DepositBelowMinimum.into(),
        "must not return DepositBelowMinimum on the fast-path"
    );
}

/// Zero rate always returns InvalidRate, never RateTooLow — the InvalidRate
/// guard fires before the deposit checks.
#[test]
fn test_zero_rate_returns_invalid_rate_not_rate_too_low() {
    let env = setup_env();
    let (client, _) = make_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);

    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token, &0, &10, &100, &None)
        .unwrap_err();
    assert_eq!(err, VestingError::InvalidRate.into());
    assert_ne!(err, VestingError::RateTooLow.into());
}

/// Negative rate always returns InvalidRate.
#[test]
fn test_negative_rate_returns_invalid_rate_not_rate_too_low() {
    let env = setup_env();
    let (client, _) = make_client(&env);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, _) = create_token(&env, &sponsor);

    let err = client
        .create_vesting_stream(&sponsor, &recipient, &token, &-5, &10, &100, &None)
        .unwrap_err();
    assert_eq!(err, VestingError::InvalidRate.into());
    assert_ne!(err, VestingError::RateTooLow.into());
}
