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
#[allow(missing_docs)]
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

    /// **Code 5** — The computed total deposit would overflow an `i128`.
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

    /// **Code 12** — The token address is not a valid SAC (Stellar Asset Contract). Try calling try_balance before storing the schedule.
    InvalidToken = 12,

    /// **Code 20** — The `metadata` string exceeds the 256-byte limit.
    MetadataTooLong = 20,

    /// **Code 21** — The token does not have the SAC clawback flag enabled.
    ///
    /// `clawback_stream` is only available on tokens where the Stellar Asset
    /// Contract issuer has set `AUTH_CLAWBACK_ENABLED_FLAG`. Use `cancel_stream`
    /// to recover tokens from non-clawback-enabled token streams.
    TokenDoesNotSupportClawback = 21,

    /// **Code 22** — The clawback `reason` string exceeds 256 bytes.
    ///
    /// Reason strings are stored on-chain in the emitted event. Trim the reason
    /// to at most 256 UTF-8 bytes before retrying.
    ReasonTooLong = 22,
}
