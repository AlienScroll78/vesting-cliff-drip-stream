use soroban_sdk::contracterror;

/// All error codes returned by the VestingDrips contract.
///
/// These are surfaced as numeric codes on-chain so client tooling can
/// identify failure reasons without parsing panic messages.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VestingError {
    /// Invalid transition for `claim_vested` or `cancel_stream` when the stream
    /// is not present in storage (NotFound, Cancelled, Drained, or Expired).
    ScheduleNotFound = 1,

    /// Invalid transition for `claim_vested` while the stream is still in the
    /// PreCliff state (or a Paused state before the cliff is reached).
    CliffNotReached = 2,

    /// Invalid transition for `create_vesting_stream` when the requested
    /// duration is not strictly longer than the cliff window.
    InvalidDuration = 3,

    /// Invalid transition for `create_vesting_stream` when the rate is zero or
    /// negative.
    InvalidRate = 4,

    /// Invalid transition for `create_vesting_stream` when the total deposit
    /// cannot be represented safely in `i128`.
    DepositOverflow = 5,

    /// Invalid transition for `create_vesting_stream` when a stream already
    /// exists for the recipient in an active lifecycle state.
    ScheduleAlreadyExists = 6,

    /// Invalid transition for `claim_vested` when the stream is in an active
    /// lifecycle state but there is no additional accrual to claim.
    NothingToClaim = 7,
}
