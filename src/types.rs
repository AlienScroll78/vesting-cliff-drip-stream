// Soroban #[contracttype] generates impl blocks whose methods cannot carry
// doc comments — suppress the missing_docs lint for this module.
#![allow(missing_docs)]
use soroban_sdk::{contracttype, Address};

/// Represents a single vesting schedule stored per recipient.
///
/// Persisted in contract storage keyed by the recipient's `Address`.
///
/// ## Mutation versioning (Issue #318)
///
/// The `version` field is a monotonically increasing mutation counter that
/// provides an on-chain audit trail.  It is initialised to `1` at stream
/// creation and incremented atomically on every state-changing operation
/// (cancel, claim, transfer, etc.).  Overflow to `u32::MAX` returns
/// [`VestingError::VersionOverflow`] rather than wrapping.
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
#[allow(missing_docs)]
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

    /// The sponsor (funder) who created this stream.
    /// Required for drain operations where unclaimed tokens are returned to sponsor.
    pub sponsor: Address,

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
#[allow(missing_docs)]
pub enum DataKey {
    /// Per-recipient vesting schedule (fixed rate).
    Schedule(Address),

    /// Per-recipient variable-rate vesting schedule.
    VariableSchedule(Address),

    /// Instance-level configuration: minimum deposit (i128).
    MinDeposit,

    /// Storage key for configured contract admin address.
    Admin,

    /// Storage key for configured fee basis points (0-500).
    FeeBps,

    /// Storage key for configured protocol treasury address.
    Treasury,
}

/// Human-readable status of a vesting stream.
///
/// Returned by `stream_status` (typed enum view, issue #311) and by the
/// legacy `get_status` view.
///
/// The `NotFound` variant indicates no schedule exists for the queried recipient,
/// allowing callers to avoid a separate existence check.
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
#[allow(missing_docs)]
pub enum StreamStatus {
    /// Cliff has not yet been reached; no tokens can be claimed.
    PreCliff,
    /// Cliff passed; tokens are dripping linearly until `end_ledger`.
    Active,
    /// Stream fully expired (`end_ledger` reached or all tokens claimed).
    Expired,
    /// Sponsor cancelled the stream before it reached `end_ledger`.
    Cancelled,
    /// Sponsor has paused the stream; no accrual until resumed.
    Paused,
}
