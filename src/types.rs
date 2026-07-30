// `#[contracttype]` emits an inherent `impl Type { spec_xdr() }` with no doc
// comment of its own; rustc doesn't propagate item-level `#[allow]` onto
// attribute-macro-generated sibling impls, so the allow has to be module-scoped.
#![allow(missing_docs)]

use soroban_sdk::{contracttype, Address, Vec};

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

    /// Cumulative tokens already claimed, used for dust-collection at `end_ledger`.
    ///
    /// At stream expiry, `claimable = total_deposited - claimed_amount` to ensure
    /// no sub-1-token dust remains permanently locked in the contract vault.
    /// Identical to `total_claimed`; kept as a separate field so dust-collection
    /// logic can be changed independently of the total_claimed audit counter.
    pub claimed_amount: i128,
}

/// A rate segment used in variable-rate streams.
///
/// Each segment specifies the ledger at which this segment ends and the rate
/// at which tokens vest during the segment.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RateSegment {
    /// The ledger at which this segment ends (exclusive; next segment starts here).
    pub end_ledger: u32,
    /// Tokens released per ledger during this segment (must be > 0).
    pub rate: i128,
}

/// A variable-rate vesting schedule with multiple rate segments.
///
/// Supports stepped vesting where the drip rate increases or decreases over
/// time.  The schedule is stored alongside the standard [`VestingSchedule`]
/// fields (cliff, start, token, sponsor) plus the ordered segment list.
///
/// ## Deposit calculation
///
/// ```
/// total_deposit = Σ rate_i × (end_i - start_i)
/// ```
///
/// where `start_i` is `end_{i-1}` (or `start_ledger` for the first segment).
///
/// ## Claimable amount
///
/// Computed by iterating over segments and accumulating accrued tokens from
/// `last_claimed_ledger` up to `min(current_ledger, last_segment.end_ledger)`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VariableRateSchedule {
    /// Schema version; always `1` for schedules created by this contract version.
    pub version: u32,

    /// The token being streamed.
    pub token: Address,

    /// The sponsor (funder) who created this stream.
    pub sponsor: Address,

    /// Ledger sequence at which the stream was created.
    pub start_ledger: u32,

    /// Ledger sequence the recipient must wait for before any claim is valid.
    pub cliff_ledger: u32,

    /// Ledger at which the last segment ends; no more accrual after this.
    pub end_ledger: u32,

    /// Tracks the last ledger up to which tokens have been claimed.
    pub last_claimed_ledger: u32,

    /// Running total of tokens transferred to the recipient via `claim_vested`.
    pub total_claimed: i128,

    /// Cumulative tokens already claimed, used for dust-collection at `end_ledger`.
    pub claimed_amount: i128,

    /// Total tokens deposited when the stream was created.
    /// Pre-computed at creation time to avoid re-summing on every claim.
    pub total_deposited: i128,

    /// Ordered list of rate segments (max 10).
    ///
    /// Segments must be in strictly ascending `end_ledger` order.
    /// The first segment starts at `start_ledger`; each subsequent segment
    /// starts where the previous one ended.
    pub segments: Vec<RateSegment>,
}

/// Storage key variants used for keying contract data.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Per-recipient vesting schedule (fixed rate).
    Schedule(Address),

    /// Per-recipient variable-rate vesting schedule.
    VariableSchedule(Address),

    /// Instance-level configuration: minimum deposit (i128).
    MinDeposit,

    /// Instance-level configuration: admin address.
    Admin,

    /// Instance-level configuration: fee in basis points (u32, 0–500).
    FeeBps,

    /// Instance-level configuration: treasury address for fee collection.
    Treasury,

    /// Instance-level flag: set to `true` after `initialize` is called.
    Initialized,
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
