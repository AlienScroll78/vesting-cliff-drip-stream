// `#[contracttype]` emits an inherent `impl Type { spec_xdr() }` with no doc
// comment of its own; rustc doesn't propagate item-level `#[allow]` onto
// attribute-macro-generated sibling impls, so the allow has to be module-scoped.
#![allow(missing_docs)]

use soroban_sdk::{contracttype, Address};

/// Represents a single vesting schedule stored per recipient.
///
/// Persisted in contract storage keyed by the recipient's `Address`.
///
/// ## Schema versioning
///
/// The `version` field guards against future deserialization mismatches.
/// All schedules created by the current contract code carry `version = 1`.
/// Schedules written before this field was introduced have an implicit
/// `version = 0` (XDR default for a missing `u32`).  Use
/// `migrate_schedule` to upgrade old entries in-place.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VestingSchedule {
    /// Schema version for forward-compatibility.
    ///
    /// | Value | Meaning                          |
    /// |-------|----------------------------------|
    /// | `0`   | Legacy – written before versioning was added |
    /// | `1`   | Current – all fields present     |
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
}

/// Analytics snapshot for a single vesting stream.
///
/// Returned by `VestingDrips::get_stream_info`.  All token amounts are in the
/// smallest unit of the streamed token (same denomination as `rate_per_ledger`).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamInfo {
    /// Total tokens deposited when the stream was created.
    /// Equal to `rate_per_ledger * (end_ledger - start_ledger)`.
    pub total_deposit: i128,

    /// Tokens already transferred to the recipient via `claim_vested`.
    /// Computed as `rate_per_ledger * (last_claimed_ledger - start_ledger)`.
    pub claimed_so_far: i128,

    /// Tokens currently available to claim (zero if cliff not yet reached).
    pub claimable_now: i128,

    /// Tokens that will still drip after the current ledger.
    pub remaining_locked: i128,

    /// Percentage of the stream that has been claimed, in basis points (0–10 000).
    /// Example: `5000` = 50.00 %.
    pub percent_vested_bps: u32,

    /// `true` if the cliff has been reached at the queried ledger.
    pub cliff_reached: bool,

    /// `true` if the stream has ended (current ledger >= `end_ledger`).
    pub stream_ended: bool,
}

/// Storage key variants used for keying contract data.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Per-recipient vesting schedule.
    Schedule(Address),

    /// Instance-level configuration: minimum deposit (i128).
    MinDeposit,
}

/// Human-readable status of a vesting stream.
///
/// Returned by `get_status` and consumed by front-end badge components.
///
/// # Badge colour mapping
/// | Variant      | Colour | Hex       | ARIA label     |
/// |--------------|--------|-----------|----------------|
/// | PreCliff     | Amber  | `#F59E0B` | "Pre-cliff"    |
/// | Active       | Blue   | `#3B82F6` | "Active"       |
/// | Completed    | Green  | `#22C55E` | "Completed"    |
/// | Cancelled    | Red    | `#EF4444` | "Cancelled"    |
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
}
