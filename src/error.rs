// `#[contracterror]` emits an inherent `impl VestingError { spec_xdr() }` with
// no doc comment of its own; rustc doesn't propagate item-level `#[allow]`
// onto attribute-macro-generated sibling impls, so the allow has to be
// module-scoped here.
#![allow(missing_docs)]

use soroban_sdk::contracterror;

/// All error codes returned by the VestingDrips contract.
///
/// # Stability tiers
///
/// **Stable (codes 1–26)** – These codes match the publicly documented API
/// in the README error table (see ADR-0004). Clients should switch on these
/// codes reliably across contract upgrades.
///
/// **Implementation (codes 27–36)** – Internal codes used by contract features
/// not yet in the stable public API. May be reorganised in future versions.
///
/// Code 0 is reserved for success by the Soroban runtime and must never be
/// used here.
#[allow(missing_docs)]
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VestingError {
    // ── Stable public codes (1–26) ────────────────────────────────────────────

    /// **Code 1** — No active vesting schedule exists for the given recipient.
    ScheduleNotFound = 1,

    /// **Code 2** — The current ledger sequence is still below `cliff_ledger`.
    CliffNotReached = 2,

    /// **Code 3** — `total_duration` must be strictly greater than `cliff_duration`.
    InvalidDuration = 3,

    /// **Code 4** — `rate_per_ledger` must be a positive, non-zero value;
    /// also returned when `fee_bps` exceeds 500.
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

    /// **Code 12** — `cliff_duration` is zero or exceeds the maximum cliff
    /// ratio; a zero-length cliff provides no lockup guarantee.
    ///
    /// Also used when `cliff_duration / total_duration` exceeds the configured
    /// `max_cliff_ratio` threshold.
    InvalidCliffDuration = 12,

    /// **Code 13** — `initialize` has already been called.
    AlreadyInitialized = 13,

    /// **Code 14** — The recipient is not on the configured allowlist.
    RecipientNotAllowed = 14,

    /// **Code 15** — A claim was attempted on a paused stream.
    StreamPaused = 15,

    /// **Code 16** — The batch size exceeds the maximum of 20.
    BatchTooLarge = 16,

    /// **Code 17** — `rate × total_duration` is below the configured minimum.
    RateTooLow = 17,

    /// **Code 18** — `initialize` has not yet been called.
    NotInitialized = 18,

    /// **Code 19** — Variable-rate segments are invalid (empty, out-of-order,
    /// or contain a non-positive rate).
    InvalidSegments = 19,

    /// **Code 13** — Contract has already been initialized.
    AlreadyInitialized = 13,

    /// **Code 14** — Recipient is not allowed.
    RecipientNotAllowed = 14,

    /// **Code 15** — The stream is currently paused.
    StreamPaused = 15,

    /// **Code 16** — Batch size exceeds the maximum allowed limit.
    BatchTooLarge = 16,

    /// **Code 17** — Rate is below the minimum allowed rate.
    RateTooLow = 17,

    /// **Code 18** — Contract has not been initialized.
    NotInitialized = 18,

    /// **Code 19** — Variable-rate segments are invalid.
    InvalidSegments = 19,

    /// **Code 20** — The `metadata` string exceeds the 256-byte limit.
    MetadataTooLong = 20,

    /// **Code 21** — The caller is not the contract admin or the original sponsor.
    Unauthorized = 21,

    /// **Code 22** — Total deposit is below the configured minimum.
    DepositBelowMinimum = 22,

    /// **Code 23** — The stream is already paused.
    StreamAlreadyPaused = 23,

    /// **Code 24** — `resume_stream` was called on a stream that is not paused.
    StreamNotPaused = 24,

    /// **Code 25** — The version counter has reached `u32::MAX`.
    VersionOverflow = 25,

    /// **Code 26** — The token does not have the SAC clawback flag enabled.
    ///
    /// `clawback_stream` is only available on tokens where the Stellar Asset
    /// Contract issuer has set `AUTH_CLAWBACK_ENABLED_FLAG`. Use `cancel_stream`
    /// to recover tokens from non-clawback-enabled token streams.
    ClawbackNotSupported = 26,

    // ── Implementation-only codes (27+) ───────────────────────────────────────

    /// **Code 27** — The token address is not a valid SAC (Stellar Asset
    /// Contract). Detected by probing `try_balance` before storing the schedule.
    InvalidToken = 27,

    /// **Code 28** — The clawback `reason` string exceeds 256 bytes.
    ///
    /// Reason strings are stored on-chain in the emitted event. Trim the reason
    /// to at most 256 UTF-8 bytes before retrying.
    ReasonTooLong = 22,

    /// **Code 23** — The stream is already paused.
    StreamAlreadyPaused = 23,

    /// **Code 24** — The stream is not currently paused.
    StreamNotPaused = 24,

    /// **Code 25** — Version counter overflow.
    VersionOverflow = 25,

    /// **Code 26** — Caller is not authorized to perform this operation.
    Unauthorized = 26,

    /// **Code 27** — Deposit is below the configured minimum deposit.
    DepositBelowMinimum = 27,

    /// **Code 28** — Milestone configuration is invalid.
    InvalidMilestones = 28,

    /// **Code 29** — Reentrancy guard: reentrant call rejected.
    Reentrancy = 29,
}
