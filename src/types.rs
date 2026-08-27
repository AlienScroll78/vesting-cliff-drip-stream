// Soroban #[contracttype] generates impl blocks whose methods cannot carry
// doc comments — suppress the missing_docs lint for this module.
#![allow(missing_docs)]
use soroban_sdk::{contracttype, Address};

/// Represents a single vesting schedule stored per recipient.
///
/// Persisted in contract storage keyed by the recipient's `Address`.
///
/// ## Schema versioning
///
/// The `version` field guards against future deserialization mismatches.
/// All schedules created by the current contract code carry `version = 2`.
/// Schedules written before this field was introduced have an implicit
/// `version = 0` (XDR default for a missing `u32`). Schedules from v1
/// have `version = 1` (no pause fields). Use `migrate_schedule` to
/// upgrade old entries in-place.
#[allow(missing_docs)]
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VestingSchedule {
    /// Schema version for forward-compatibility.
    ///
    /// | Value | Meaning                          |
    /// |-------|----------------------------------|
    /// | `0`   | Legacy – written before versioning was added |
    /// | `1`   | Version 1 – no pause fields      |
    /// | `2`   | Current – all fields present     |
    pub version: u32,

    /// The token being streamed.
    pub token: Address,

    /// Tokens released per ledger once the cliff has passed.
    pub rate_per_ledger: i128,

    /// Ledger sequence at which the stream was created.
    pub start_ledger: u32,

    /// Ledger sequence the recipient must wait for before any claim is valid.
    pub cliff_ledger: u32,

    /// Ledger sequence at which the stream ends (no more accrual after this).
    pub end_ledger: u32,

    /// Tracks the last ledger up to which tokens have been claimed.
    /// Initialised to `start_ledger` so accrual is calculated correctly on first claim.
    pub last_claimed_ledger: u32,

    /// Running total of tokens transferred to the recipient via `claim_vested`.
    /// Initialised to `0` on stream creation and incremented on every successful claim.
    /// Useful for audits and UI displays without requiring off-chain event indexing.
    pub total_claimed: i128,

    /// Whether the stream is currently paused.
    /// When `true`, no tokens accrue and `claim_vested` returns `StreamPaused`.
    pub paused: bool,

    /// The ledger sequence at which the stream was last paused.
    /// `0` when the stream has never been paused or has been resumed.
    /// Used to compute the pause duration when resuming so that `end_ledger`,
    /// `cliff_ledger`, and related fields are offset by the frozen time.
    pub pause_ledger: u32,

    /// The sponsor who created this stream.
    /// Only this address may call `pause_stream` and `resume_stream`.
    pub sponsor: Address,
}

/// Storage key variants used for keying contract data.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Per-recipient vesting schedule.
    Schedule(Address),
}

/// Human-readable status of a vesting stream.
///
/// Returned by `get_status` and consumed by front-end badge components.
///
/// # Badge colour mapping
/// | Variant      | Colour  | Hex       | ARIA label     |
/// |--------------|---------|-----------|----------------|
/// | PreCliff     | Amber   | `#F59E0B` | "Pre-cliff"    |
/// | Active       | Blue    | `#3B82F6` | "Active"       |
/// | Completed    | Green   | `#22C55E` | "Completed"    |
/// | Cancelled    | Red     | `#EF4444` | "Cancelled"    |
/// | Paused       | Orange  | `#F97316` | "Paused"       |
#[allow(missing_docs)]
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StreamStatus {
    /// Cliff has not yet been reached; no tokens can be claimed.
    PreCliff,
    /// Cliff passed; tokens are dripping linearly until `end_ledger`.
    Active,
    /// Stream fully drained (`end_ledger` reached or all tokens claimed).
    Completed,
    /// Sponsor cancelled the stream before it reached `end_ledger`.
    Cancelled,
    /// Sponsor has paused the stream; no accrual until resumed.
    Paused,
}
