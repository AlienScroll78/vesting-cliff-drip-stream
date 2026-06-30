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
