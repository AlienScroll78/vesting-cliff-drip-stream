// `#[contracterror]` emits an inherent `impl VestingError { spec_xdr() }` with
// no doc comment of its own; rustc doesn't propagate item-level `#[allow]`
// onto attribute-macro-generated sibling impls, so the allow has to be
// module-scoped here.
#![allow(missing_docs)]

use soroban_sdk::contracterror;

/// All error codes returned by the VestingDrips contract.
///
/// Codes are pinned to explicit `u32` values so clients can switch on them
/// reliably across contract upgrades. Code 0 is reserved for success by the
/// Soroban runtime and must never be used here.
#[allow(missing_docs)]
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VestingError {
    /// **Code 1** — No active vesting schedule exists for the given recipient.
    ScheduleNotFound = 1,

    /// **Code 2** — The current ledger sequence is still below `cliff_ledger`.
    CliffNotReached = 2,

    /// **Code 3** — `total_duration` must be strictly greater than `cliff_duration`.
    InvalidDuration = 3,

    /// **Code 4** — `rate_per_ledger` must be a positive, non-zero value.
    InvalidRate = 4,

    /// **Code 5** — The computed total deposit would overflow an `i128`.
    DepositOverflow = 5,

    /// **Code 6** — A vesting schedule already exists for this recipient.
    ScheduleAlreadyExists = 6,

    /// **Code 7** — The claimable amount is zero at the current ledger.
    NothingToClaim = 7,

    /// **Code 8** — The stream's `end_ledger` has not yet been reached.
    StreamNotExpired = 8,

    /// **Code 9** — The emergency-drain delay period has not yet elapsed.
    DrainDelayNotExpired = 9,

    /// **Code 10** — `sponsor` and `recipient` must be distinct addresses.
    InvalidRecipient = 10,

    /// **Code 11** — A token transfer call failed.
    TransferFailed = 11,

    /// **Code 12** — `cliff_duration` is zero.
    InvalidCliffDuration = 12,

    /// **Code 13** — `initialize` has already been called.
    AlreadyInitialized = 13,

    /// **Code 14** — Recipient is not on the configured allowlist.
    RecipientNotAllowed = 14,

    /// **Code 15** — Claim attempted on a paused stream.
    StreamPaused = 15,

    /// **Code 16** — Batch size exceeds the maximum of 20.
    BatchTooLarge = 16,

    /// **Code 17** — `rate × total_duration` is below the configured minimum deposit.
    RateTooLow = 17,

    /// **Code 18** — `initialize` has not yet been called.
    NotInitialized = 18,

    /// **Code 19** — Variable-rate segments are invalid.
    InvalidSegments = 19,

    /// **Code 20** — The `metadata` string exceeds the 256-byte limit.
    MetadataTooLong = 20,

    /// **Code 21** — Caller is not the contract admin or original sponsor.
    Unauthorized = 21,

    /// **Code 22** — Total deposit is below the configured minimum.
    DepositBelowMinimum = 22,

    /// **Code 23** — Stream is already paused.
    StreamAlreadyPaused = 23,

    /// **Code 24** — `resume_stream` called on a non-paused stream.
    StreamNotPaused = 24,

    /// **Code 25** — Version counter has reached `u32::MAX`.
    VersionOverflow = 25,

    /// **Code 26** — Token does not support the SAC clawback flag.
    ClawbackNotSupported = 26,

    /// **Code 27** — The clawback `reason` string exceeds 256 bytes.
    ReasonTooLong = 27,

    /// **Code 28** — Reentrancy detected.
    Reentrancy = 28,

    /// **Code 29** — Batch size exceeds the maximum of 50 (extended batch endpoint).
    BatchSizeExceeded = 29,

    /// **Code 30** — Milestone validation failed.
    InvalidMilestones = 30,

    /// **Code 31** — The token address is not a valid SAC.
    InvalidToken = 31,
}
