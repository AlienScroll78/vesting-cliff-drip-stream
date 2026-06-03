use soroban_sdk::contracterror;

/// All error codes returned by the VestingDrips contract.
///
/// These are surfaced as numeric codes on-chain so client tooling can
/// identify failure reasons without parsing panic messages.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VestingError {
    /// The recipient has no active vesting schedule.
    ScheduleNotFound = 1,

    /// The current ledger has not yet reached the cliff.
    CliffNotReached = 2,

    /// `total_duration` must be greater than `cliff_duration`.
    InvalidDuration = 3,

    /// `rate_per_ledger` must be a positive non-zero value.
    InvalidRate = 4,

    /// The computed total deposit would overflow an i128.
    DepositOverflow = 5,

    /// A vesting schedule already exists for this recipient.
    ScheduleAlreadyExists = 6,

    /// Nothing available to claim at the current ledger.
    NothingToClaim = 7,
}
