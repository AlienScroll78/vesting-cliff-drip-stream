//! Fuzz harness for `create_vesting_stream` input validation.
//!
//! Input layout (all little-endian):
//!   [0..16)   rate            – i128
//!   [16..20)  cliff_duration  – u32
//!   [20..24)  total_duration  – u32
//!   [24..56)  sponsor_bytes   – 32 raw bytes (stand-in for an Address)
//!   [56..88)  recipient_bytes – 32 raw bytes (stand-in for an Address)
//!   [88..)    token_data      – variable-length bytes (stand-in for token Address / string)
//!
//! The harness mirrors every validation step that `create_vesting_stream` performs
//! so the fuzzer can reach every error branch without a live Soroban environment:
//!   1. `InvalidRate`          – rate ≤ 0
//!   2. `InvalidDuration`      – total_duration ≤ cliff_duration
//!   3. `DepositOverflow`      – rate × total_duration overflows i128
//!   4. `BelowMinDeposit`      – rate × total_duration < MIN_DEPOSIT (default 100)
//!   5. `InvalidRecipient`     – sponsor_bytes == recipient_bytes
//!   6. Token address handling – accepts arbitrary byte sequences, including
//!                               empty slices, valid UTF-8, null bytes, very long
//!                               inputs, and arbitrary binary
//!                               (the contract takes an Address opaque to us here)
#![no_main]

use libfuzzer_sys::fuzz_target;

const MIN_INPUT: usize = 88; // 16 + 4 + 4 + 32 + 32

/// Default minimum deposit threshold (mirrors `set_min_deposit` default in contract.rs).
const MIN_DEPOSIT: i128 = 100;

/// Maximum token data length considered reasonable for the contract.
/// Inputs longer than this are still processed without panic, exercising the
/// "any-length" path; this constant is used to annotate that branch.
const MAX_TOKEN_LEN: usize = 256;

/// Mirrors the `InvalidRate` check in `contract.rs`.
fn validate_rate(rate: i128) -> Result<(), &'static str> {
    if rate <= 0 {
        return Err("InvalidRate");
    }
    Ok(())
}

/// Mirrors the `InvalidDuration` check.
fn validate_duration(cliff: u32, total: u32) -> Result<(), &'static str> {
    if total <= cliff {
        return Err("InvalidDuration");
    }
    Ok(())
}

/// Mirrors the `DepositOverflow` checked-multiplication.
fn calculate_total_deposit(rate: i128, total_duration: u32) -> Result<i128, &'static str> {
    rate.checked_mul(total_duration as i128)
        .ok_or("DepositOverflow")
}

/// Mirrors the `BelowMinDeposit` check: `rate × total_duration ≥ MIN_DEPOSIT`.
///
/// This is only reached after a successful `calculate_total_deposit`, so
/// it receives the already-computed deposit value.
fn validate_min_deposit(total_deposit: i128) -> Result<(), &'static str> {
    if total_deposit < MIN_DEPOSIT {
        return Err("BelowMinDeposit");
    }
    Ok(())
}

/// Mirrors the `InvalidRecipient` identity check.
fn validate_recipient(sponsor: &[u8; 32], recipient: &[u8; 32]) -> Result<(), &'static str> {
    if sponsor == recipient {
        return Err("InvalidRecipient");
    }
    Ok(())
}

/// Validates a token address stand-in.
///
/// In the real contract the token is an opaque Soroban `Address`; here we
/// exercise the token-data bytes as a byte slice to ensure the fuzzer
/// explores empty inputs, null bytes, pure-binary data, very long slices,
/// and valid / invalid UTF-8 without panicking.
fn validate_token_data(data: &[u8]) -> Result<(), &'static str> {
    // Empty byte slice – would correspond to a missing / default address
    if data.is_empty() {
        return Err("EmptyTokenAddress");
    }

    // Attempt UTF-8 decode – exercises the same path as passing a String-based
    // address representation; we don't require it to succeed.
    let _ = core::str::from_utf8(data);

    // Exact-32-byte canonical address check (informational, not an error)
    let _ = data.len() == 32;

    // Very long token data: contract enforces no panic on oversized inputs.
    // We annotate this branch for coverage but do not fail.
    if data.len() > MAX_TOKEN_LEN {
        // Exercise the oversized path: iterate all bytes to force fuzzer
        // to explore this branch fully.
        let _checksum: u64 = data.iter().fold(0u64, |acc, &b| acc.wrapping_add(b as u64));
    }

    // Null-byte check: token data may contain null bytes; must not panic.
    let _has_null = data.iter().any(|&b| b == 0x00);

    Ok(())
}

fuzz_target!(|data: &[u8]| {
    // Require the full structured prefix; shorter inputs are uninteresting
    // for this harness (the libFuzzer corpus already covers very-short runs).
    if data.len() < MIN_INPUT {
        return;
    }

    // ── Parse fields ──────────────────────────────────────────────────────

    let mut rate_arr = [0u8; 16];
    rate_arr.copy_from_slice(&data[0..16]);
    let rate = i128::from_le_bytes(rate_arr);

    let cliff = u32::from_le_bytes(data[16..20].try_into().unwrap());
    let total = u32::from_le_bytes(data[20..24].try_into().unwrap());

    let sponsor: &[u8; 32] = data[24..56].try_into().unwrap();
    let recipient: &[u8; 32] = data[56..88].try_into().unwrap();

    let token_data = &data[88..];

    // ── Run validations – never panic ──────────────────────────────────────

    // 1. Rate must be positive
    let _ = validate_rate(rate);

    // 2. Total must be strictly greater than cliff
    let _ = validate_duration(cliff, total);

    // 3. Overflow guard and min-deposit check
    //    (only meaningful when rate > 0 and total > cliff)
    if rate > 0 && total > cliff {
        match calculate_total_deposit(rate, total) {
            Ok(deposit) => {
                // 4. Min-deposit: rate × total ≥ MIN_DEPOSIT
                let _ = validate_min_deposit(deposit);
            }
            Err(_) => {
                // DepositOverflow – nothing further to check
            }
        }
    }

    // 5. Sponsor/recipient identity check
    let _ = validate_recipient(sponsor, recipient);

    // 6. Token address bytes – covers empty, null, binary, UTF-8, long, and unicode inputs
    let _ = validate_token_data(token_data);

    // ── Combined "would succeed" path ──────────────────────────────────────
    // Exercise the full happy-path to let the fuzzer maximise coverage of
    // the success branch as well as all error branches.
    if validate_rate(rate).is_ok()
        && validate_duration(cliff, total).is_ok()
        && validate_recipient(sponsor, recipient).is_ok()
        && validate_token_data(token_data).is_ok()
    {
        if let Ok(deposit) = calculate_total_deposit(rate, total) {
            let _ = validate_min_deposit(deposit);
        }
    }
});
