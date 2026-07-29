//! # Vesting Cliff Drip Stream
//!
//! A Soroban smart contract that introduces a time-locked cliff period to a
//! linear token streaming model. Designed for long-term contributor retention.
//!
//! ## How It Works
//! 1. A sponsor deposits the full token allocation upfront into the contract vault.
//! 2. The recipient cannot claim anything until the `cliff_ledger` is reached.
//! 3. Once the cliff passes, all tokens accrued since `start_ledger` unlock instantly.
//! 4. Remaining tokens continue to drip linearly per ledger until `end_ledger`.

#![no_std]
#![deny(missing_docs)]

mod contract;
mod error;
mod events;
mod storage;
mod types;

pub use contract::{StreamStats, VestingDrips};
pub use error::VestingError;
pub use types::{StreamStatus, VestingSchedule};

#[cfg(test)]
mod tests;
