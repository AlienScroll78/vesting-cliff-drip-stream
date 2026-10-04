//! # Vesting Cliff Drip Stream
//!
//! A Soroban smart contract that introduces a time-locked cliff period to a
//! linear token streaming model with fixed-point rate precision.
//!
//! ## How It Works
//! 1. A sponsor deposits the full token allocation upfront into the contract vault.
//! 2. The recipient cannot claim anything until the `cliff_ledger` is reached.
//! 3. Once the cliff passes, all tokens accrued since `start_ledger` unlock instantly.
//! 4. Remaining tokens continue to drip linearly per ledger until `end_ledger`.
//!
//! ## Fixed-Point Rates
//! `rate_per_ledger` is stored scaled by `RATE_DECIMALS = 10_000_000`.
//! Pass `rate = 10_000_000` for 1 token/ledger, `rate = 5_000_000` for 0.5/ledger.

#![no_std]
#![cfg_attr(not(test), deny(missing_docs))]

// proptest and other test utilities require std macros (format!, vec!, etc.)
#[cfg(test)]
#[macro_use]
extern crate std;

mod contract;
mod error;
mod events;
mod migration;
mod storage;
mod types;

pub use contract::{calculate_total_deposit, StreamStats, VestingDrips};
pub use error::VestingError;
pub use events::{StreamClawedBackData, StreamCreatedData};
pub use types::{RateSegment, StreamStatus, VariableRateSchedule, VestingSchedule, MAX_CLIFF_RATIO, RATE_DECIMALS};

#[cfg(test)]
mod tests;
