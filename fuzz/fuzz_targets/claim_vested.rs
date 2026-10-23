//! Fuzz harness for `claim_vested` ledger-offset logic.
//!
//! This harness mirrors the claimable-amount calculation in `contract.rs::claim_vested`
//! so libFuzzer can explore arbitrary ledger states and arithmetic boundaries
//! without a live Soroban environment.
//!
//! # Input layout (all little-endian)
//! ```text
//!  [0..4)    current_ledger       – u32  (simulated env.ledger().sequence())
//!  [4..8)    start_ledger         – u32  (schedule.start_ledger)
//!  [8..12)   cliff_duration       – u32  (ledgers added to start for cliff)
//!  [12..16)  total_duration       – u32  (ledgers added to start for end)
//!  [16..20)  last_claimed_ledger  – u32  (schedule.last_claimed_ledger)
//!  [20..36)  rate                 – i128 (schedule.rate_per_ledger)
//!  [36..52)  claimed_amount       – i128 (schedule.claimed_amount / claimed so far)
//!  [52..53)  paused               – u8   (non-zero = stream is paused)
//! ```
//!
//! # Contract paths exercised
//! - `NothingToClaim`   – stream is paused
//! - `CliffNotReached`  – current_ledger < cliff_ledger
//! - `NothingToClaim`   – computed claimable amount is zero
//! - Overflow guard     – `(ledgers * rate)` overflows i128
//! - Linear drip        – normal mid-stream claim
//! - Dust collection    – claim at/past `end_ledger` returns full remainder
//! - Invariant checks   – claimable amount is never negative; never exceeds total deposit
#![no_main]

use libfuzzer_sys::fuzz_target;

const MIN_INPUT: usize = 53;

/// Return type mirroring contract claim outcomes.
#[derive(Debug)]
enum ClaimResult {
    Paused,
    CliffNotReached,
    NothingToClaim,
    Overflow,
    Ok(i128),
}

/// Mirrors the `claim_vested` calculation in `contract.rs`.
///
/// Returns `ClaimResult` instead of `VestingError` so the fuzzer harness
/// can assert invariants without importing the full Soroban SDK.
fn calculate_claimable(
    current_ledger: u32,
    start_ledger: u32,
    cliff_duration: u32,
    total_duration: u32,
    last_claimed_ledger: u32,
    rate: i128,
    claimed_amount: i128,
    paused: bool,
) -> ClaimResult {
    // Derived ledgers (matching contract: checked_add with DepositOverflow).
    let cliff_ledger = match start_ledger.checked_add(cliff_duration) {
        Some(v) => v,
        None => return ClaimResult::Overflow,
    };
    let end_ledger = match start_ledger.checked_add(total_duration) {
        Some(v) => v,
        None => return ClaimResult::Overflow,
    };

    // Paused stream: NothingToClaim
    if paused {
        return ClaimResult::Paused;
    }

    // Cliff not yet reached
    if current_ledger < cliff_ledger {
        return ClaimResult::CliffNotReached;
    }

    // Compute total deposited
    let duration = match end_ledger.checked_sub(start_ledger) {
        Some(d) => d,
        None => return ClaimResult::Overflow,
    };
    let total_deposited = match (duration as i128).checked_mul(rate) {
        Some(v) => v,
        None => return ClaimResult::Overflow,
    };

    // Dust collection: at or past end_ledger return full remainder
    let claimable = if current_ledger >= end_ledger {
        total_deposited.saturating_sub(claimed_amount)
    } else {
        let active_end = current_ledger.min(end_ledger);
        let claimable_ledgers = match active_end.checked_sub(last_claimed_ledger) {
            Some(v) => v,
            None => return ClaimResult::Overflow,
        };
        match (claimable_ledgers as i128).checked_mul(rate) {
            Some(v) => v,
            None => return ClaimResult::Overflow,
        }
    };

    if claimable == 0 {
        return ClaimResult::NothingToClaim;
    }

    ClaimResult::Ok(claimable)
}

fuzz_target!(|data: &[u8]| {
    if data.len() < MIN_INPUT {
        return;
    }

    // ── Parse fields ──────────────────────────────────────────────────────────
    let current = u32::from_le_bytes(data[0..4].try_into().unwrap());
    let start = u32::from_le_bytes(data[4..8].try_into().unwrap());
    let cliff_dur = u32::from_le_bytes(data[8..12].try_into().unwrap());
    let total_dur = u32::from_le_bytes(data[12..16].try_into().unwrap());
    let last_claimed = u32::from_le_bytes(data[16..20].try_into().unwrap());
    let rate = i128::from_le_bytes(data[20..36].try_into().unwrap());
    let claimed_amount = i128::from_le_bytes(data[36..52].try_into().unwrap());
    let paused = data[52] != 0;

    // ── Run claim calculation ─────────────────────────────────────────────────
    let result = calculate_claimable(
        current,
        start,
        cliff_dur,
        total_dur,
        last_claimed,
        rate,
        claimed_amount,
        paused,
    );

    // ── Assert invariants ─────────────────────────────────────────────────────
    //
    // These assertions verify that the mirrored logic upholds the same
    // invariants the contract must uphold. A panic here flags a bug in
    // either this harness or the contract logic it mirrors.

    if let ClaimResult::Ok(amount) = result {
        // Claimable amount must always be positive when Ok is returned
        assert!(
            amount > 0,
            "claim returned Ok(0) — should have returned NothingToClaim"
        );

        // Claimable amount must never exceed total deposit (if rate is sane)
        if rate > 0 && total_dur > cliff_dur {
            if let Some(cliff_l) = start.checked_add(cliff_dur) {
                if let Some(end_l) = start.checked_add(total_dur) {
                    if let Some(dur) = end_l.checked_sub(start) {
                        if let Some(total_deposited) = (dur as i128).checked_mul(rate) {
                            if total_deposited >= 0 && claimed_amount >= 0 {
                                let max_claimable = total_deposited.saturating_sub(claimed_amount);
                                // Only assert when arithmetic doesn't overflow the test
                                if max_claimable >= 0 {
                                    assert!(
                                        amount <= max_claimable,
                                        "claimable {amount} exceeds remaining deposit {max_claimable} \
                                         (total={total_deposited}, claimed={claimed_amount})"
                                    );
                                }
                            }
                            // cliff_l and end_l used to suppress dead-code warnings
                            let _ = (cliff_l, end_l);
                        }
                    }
                }
            }
        }

        // Claimable amount must be non-negative
        assert!(
            amount >= 0,
            "claimable amount is negative: {amount}"
        );
    }
});
