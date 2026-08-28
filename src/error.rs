// `#[contracterror]` emits an inherent `impl VestingError { spec_xdr() }` with
// no doc comment of its own; rustc doesn't propagate item-level `#[allow]`
// onto attribute-macro-generated sibling impls, so the allow has to be
// module-scoped here.
#![allow(missing_docs)]

use soroban_sdk::contracterror;

/// All error codes returned by the VestingDrips contract.
///
/// Codes are pinned to explicit `u32` values so clients can switch on them
/// reliably across contract upgrades (see ADR-0004). Code 0 is reserved for
/// success by the Soroban runtime and must never be used here.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
#[allow(missing_docs)]
pub enum VestingError {
    /// **Code 1** — No active vesting schedule exists for the given recipient.
    ScheduleNotFound = 1,

    /// **Code 2** — The current ledger sequence is still below `cliff_ledger`.
    CliffNotReached = 2,

    /// **Code 3** — `total_duration` must be strictly greater than `cliff_duration`.
    InvalidDuration = 3,

    /// **Code 4** — `rate_per_ledger` must be a positive, non-zero value.
    InvalidRate = 4,

    /// **Code 5** — The computed total deposit (`rate × total_duration`) would overflow.
    DepositOverflow = 5,

    /// **Code 6** — A vesting schedule already exists for this recipient.
    ScheduleAlreadyExists = 6,

    /// **Code 7** — The claimable amount is zero at the current ledger.
    NothingToClaim = 7,

    /// **Code 8** — The stream's `end_ledger` has not yet been reached.
    StreamNotExpired = 8,

    /// **Code 9** — A token transfer call failed.
    TransferFailed = 9,

    /// **Code 10** — The emergency-drain delay period has not yet elapsed.
    DrainDelayNotExpired = 10,

    /// **Code 11** — `sponsor` and `recipient` must be distinct addresses.
    InvalidRecipient = 11,

    /// **Code 12** — Caller is not the contract admin or stream sponsor.
    Unauthorized = 12,

    /// **Code 13** — `initialize` has already been called; cannot reinitialize.
    AlreadyInitialized = 13,

    /// **Code 14** — `initialize` must be called before this operation.
    NotInitialized = 14,

    /// **Code 15** — Milestone array is empty, out-of-order, or bps do not sum to 10000.
    InvalidMilestones = 15,

    /// **Code 16** — Total deposit is below the configured minimum deposit threshold.
    DepositBelowMinimum = 16,

    /// **Code 17** — Version counter would overflow `u32::MAX`.
    VersionOverflow = 17,

    /// **Code 18** — Token does not support SAC clawback flag.
    ClawbackNotSupported = 18,

    /// **Code 19** — Variable-rate segment array is empty, out-of-order, or invalid.
    InvalidSegments = 19,

    /// **Code 20** — The `metadata` string exceeds the 256-byte limit.
    MetadataTooLong = 20,

    /// **Code 21** — Token is not in the allowlist (allowlist enforcement is active).
    TokenNotAllowed = 21,

    /// **Code 22** — Stream is already paused; cannot pause again.
    StreamAlreadyPaused = 22,

    /// **Code 23** — Stream is not currently paused; cannot resume.
    StreamNotPaused = 23,
}
