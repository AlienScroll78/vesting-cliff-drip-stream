//! Fuzz harness for `create_vesting_stream` input validation.
//!
//! This harness mirrors every validation branch in `contract.rs::create_vesting_stream`
//! so that libFuzzer can reach all error paths without a live Soroban environment.
//!
//! # Input layout (all little-endian)
//! ```text
//!  [0..16)   rate            – i128 (tokens per ledger, must be > 0)
//!  [16..20)  cliff_duration  – u32  (ledgers until cliff)
//!  [20..24)  total_duration  – u32  (total stream length; must be > cliff_duration)
//!  [24..56)  sponsor_bytes   – 32 raw bytes (stand-in for sponsor Address)
//!  [56..88)  recipient_bytes – 32 raw bytes (stand-in for recipient Address)
//!  [88..92)  start_ledger    – u32  (current ledger sequence at creation)
//!  [92..93)  has_metadata    – u8   (0 = no metadata, non-zero = metadata present)
//!  [93..)    metadata_or_tok – variable-length bytes used as metadata and/or token data
//! ```
//!
//! # Validations exercised (matching contract order)
//! 1. `InvalidRecipient`     – sponsor_bytes == recipient_bytes
//! 2. `InvalidRate`          – rate ≤ 0 or rate < min_rate (default 1)
//! 3. `InvalidDuration`      – total_duration ≤ cliff_duration
//! 4. `InvalidDuration`      – cliff_ratio > max_cliff_ratio (default 5000 bps = 50 %)
//! 5. `DepositOverflow`      – start_ledger + cliff_duration overflows u32
//! 6. `DepositOverflow`      – start_ledger + total_duration overflows u32
//! 7. `DepositOverflow`      – rate × total_duration overflows i128
//! 8. `DepositBelowMinimum`  – total_deposit < min_deposit (default 100)
//! 9. `MetadataTooLong`      – metadata byte length > 256
#![no_main]

use libfuzzer_sys::fuzz_target;

const MIN_INPUT: usize = 93; // 16 + 4 + 4 + 32 + 32 + 4 + 1

// Contract constants (mirrors contract.rs defaults)
const MIN_DEPOSIT: i128 = 100;
const MIN_RATE: i128 = 1;
const MAX_CLIFF_RATIO_BPS: u32 = 5_000; // 50 %
const MAX_METADATA_BYTES: usize = 256;

// ── Validation functions mirroring contract.rs ────────────────────────────────

/// Mirrors `InvalidRecipient` check.
#[inline]
fn check_recipient(sponsor: &[u8; 32], recipient: &[u8; 32]) -> Result<(), &'static str> {
    if sponsor == recipient {
        Err("InvalidRecipient")
    } else {
        Ok(())
    }
}

/// Mirrors `InvalidRate` checks (rate ≤ 0 and rate < min_rate).
#[inline]
fn check_rate(rate: i128) -> Result<(), &'static str> {
    if rate <= 0 {
        return Err("InvalidRate(non-positive)");
    }
    if rate < MIN_RATE {
        return Err("InvalidRate(below-min-rate)");
    }
    Ok(())
}

/// Mirrors `InvalidDuration` check: total must be strictly greater than cliff.
#[inline]
fn check_duration(cliff: u32, total: u32) -> Result<(), &'static str> {
    if total <= cliff {
        return Err("InvalidDuration(total<=cliff)");
    }
    Ok(())
}

/// Mirrors the cliff-ratio check: cliff/total must not exceed MAX_CLIFF_RATIO_BPS.
/// Only called after duration validation passes (total > cliff, total > 0).
#[inline]
fn check_cliff_ratio(cliff: u32, total: u32) -> Result<(), &'static str> {
    // Guard against division by zero (total > 0 guaranteed by check_duration)
    let ratio_bps = (cliff as u64)
        .saturating_mul(10_000)
        .checked_div(total as u64)
        .unwrap_or(u64::MAX) as u32;
    if ratio_bps > MAX_CLIFF_RATIO_BPS {
        return Err("InvalidDuration(cliff-ratio)");
    }
    Ok(())
}

/// Mirrors cliff/end-ledger u32 overflow check.
#[inline]
fn check_ledger_overflow(start: u32, cliff: u32, total: u32) -> Result<(u32, u32), &'static str> {
    let cliff_ledger = start
        .checked_add(cliff)
        .ok_or("DepositOverflow(cliff-ledger)")?;
    let end_ledger = start
        .checked_add(total)
        .ok_or("DepositOverflow(end-ledger)")?;
    Ok((cliff_ledger, end_ledger))
}

/// Mirrors checked total-deposit arithmetic in `calculate_total_deposit`.
#[inline]
fn check_deposit(rate: i128, total_duration: u32) -> Result<i128, &'static str> {
    rate.checked_mul(total_duration as i128)
        .ok_or("DepositOverflow(arithmetic)")
}

/// Mirrors minimum-deposit threshold guard.
#[inline]
fn check_min_deposit(deposit: i128) -> Result<(), &'static str> {
    if deposit < MIN_DEPOSIT {
        return Err("DepositBelowMinimum");
    }
    Ok(())
}

/// Mirrors `MetadataTooLong` check.
#[inline]
fn check_metadata(bytes: &[u8]) -> Result<(), &'static str> {
    if bytes.len() > MAX_METADATA_BYTES {
        return Err("MetadataTooLong");
    }
    Ok(())
}

// ── Fuzz entry point ──────────────────────────────────────────────────────────

fuzz_target!(|data: &[u8]| {
    if data.len() < MIN_INPUT {
        return;
    }

    // ── Parse structured fields ───────────────────────────────────────────────

    let rate = i128::from_le_bytes(data[0..16].try_into().unwrap());
    let cliff = u32::from_le_bytes(data[16..20].try_into().unwrap());
    let total = u32::from_le_bytes(data[20..24].try_into().unwrap());
    let sponsor: &[u8; 32] = data[24..56].try_into().unwrap();
    let recipient: &[u8; 32] = data[56..88].try_into().unwrap();
    let start = u32::from_le_bytes(data[88..92].try_into().unwrap());
    let has_metadata = data[92] != 0;
    let tail = &data[93..];

    // Split tail into metadata and token_data halves so the fuzzer explores
    // both channels independently.
    let mid = tail.len() / 2;
    let (metadata_bytes, token_bytes) = tail.split_at(mid);

    // ── Run each validation in contract order ─────────────────────────────────

    // 1. Sponsor ≠ recipient
    let _ = check_recipient(sponsor, recipient);

    // 2. Rate validity
    let _ = check_rate(rate);

    // 3. Duration ordering
    let _ = check_duration(cliff, total);

    // 4. Cliff ratio (only meaningful when duration check passes)
    if total > cliff && total > 0 {
        let _ = check_cliff_ratio(cliff, total);
    }

    // 5 & 6. Ledger overflow for cliff and end
    let _ = check_ledger_overflow(start, cliff, total);

    // 7 & 8. Deposit arithmetic and minimum (only meaningful when rate > 0)
    if rate > 0 {
        match check_deposit(rate, total) {
            Ok(deposit) => {
                let _ = check_min_deposit(deposit);
            }
            Err(_) => {
                // DepositOverflow – nothing further to check
            }
        }
    }

    // 9. Metadata length
    if has_metadata {
        let _ = check_metadata(metadata_bytes);
    }

    // ── Token bytes: exercise all byte patterns without panicking ─────────────
    // Empty, null, binary, UTF-8, very long – all must be handled gracefully.
    let _ = token_bytes.is_empty();
    let _ = core::str::from_utf8(token_bytes);
    if token_bytes.len() > MAX_METADATA_BYTES {
        let _sum: u64 = token_bytes
            .iter()
            .fold(0u64, |acc, &b| acc.wrapping_add(b as u64));
    }

    // ── Full happy-path simulation ────────────────────────────────────────────
    // Drive the fuzzer toward inputs that pass all validations so it also
    // maximises coverage of the success branch.
    if check_recipient(sponsor, recipient).is_ok()
        && check_rate(rate).is_ok()
        && check_duration(cliff, total).is_ok()
        && (total == 0 || check_cliff_ratio(cliff, total).is_ok())
        && check_ledger_overflow(start, cliff, total).is_ok()
    {
        if let Ok(deposit) = check_deposit(rate, total) {
            let _ = check_min_deposit(deposit);
        }
        if has_metadata {
            let _ = check_metadata(metadata_bytes);
        }
    }
});
