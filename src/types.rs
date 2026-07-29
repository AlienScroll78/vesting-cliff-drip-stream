// `#[contracttype]` emits an inherent `impl Type { spec_xdr() }` with no doc
// comment of its own; rustc doesn't propagate item-level `#[allow]` onto
// attribute-macro-generated sibling impls, so the allow has to be module-scoped.
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
/// The field is placed **last** in the struct so that XDR-encoded storage
/// entries written before this field was introduced (which omit it) decode
/// with an implicit default of `0`, allowing `migrate_schedule` to upgrade
/// them in-place.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
#[allow(missing_docs)]
pub struct VestingSchedule {
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

    /// Mutation counter — incremented atomically on every state-changing operation.
    ///
    /// | Value | Meaning                              |
    /// |-------|--------------------------------------|
    /// | `0`   | Legacy entry written before versioning was added; upgrade with `migrate_schedule` |
    /// | `1`   | Created (initial value)              |
    /// | `n>1` | Modified `n-1` times since creation  |
    ///
    /// Placed last so that old XDR-encoded entries (which lack this field)
    /// decode with an implicit XDR default of `0`.
    pub version: u32,
}

impl VestingSchedule {
    /// Increments the version counter, returning `VersionOverflow` at `u32::MAX`.
    pub fn increment_version(&mut self) -> Result<(), crate::error::VestingError> {
        self.version = self
            .version
            .checked_add(1)
            .ok_or(crate::error::VestingError::VersionOverflow)?;
        Ok(())
    }
}

/// Storage key variants used for keying contract data.
#[contracttype]
#[derive(Clone)]
#[allow(missing_docs)]
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
#[allow(missing_docs)]
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
