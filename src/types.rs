// `#[contracttype]` emits an inherent `impl Type { spec_xdr() }` with no doc
// comment of its own; rustc doesn't propagate item-level `#[allow]` onto
// attribute-macro-generated sibling impls, so the allow has to be module-scoped.
#![allow(missing_docs)]

use soroban_sdk::{contracttype, Address, Vec};

/// A single rate segment for variable-rate vesting streams.
///
/// Defines the rate per ledger from the start of the segment up to `end_ledger`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RateSegment {
    /// Absolute ledger number at which this segment ends.
    pub end_ledger: u32,
    /// Tokens released per ledger in this segment (must be > 0).
    pub rate: i128,
}

/// A variable-rate vesting schedule stored per recipient.
///
/// Supports stepped vesting schedules where the drip rate changes at defined
/// ledger boundaries.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VariableRateSchedule {
    /// The token being streamed.
    pub token: Address,

    /// The sponsor (funder) who created this stream.
    pub sponsor: Address,

    /// Ordered list of rate segments.
    pub segments: Vec<RateSegment>,

    /// Ledger sequence at which the stream was created.
    pub start_ledger: u32,

    /// Ledger sequence the recipient must wait for before any claim is valid.
    pub cliff_ledger: u32,

    /// Ledger sequence at which the stream ends.
    pub end_ledger: u32,

    /// Total tokens deposited when the stream was created.
    pub total_deposited: i128,

    /// Tracks the last ledger up to which tokens have been claimed.
    pub last_claimed_ledger: u32,

    /// Running total of tokens transferred to the recipient.
    pub claimed_amount: i128,

    /// Alias for `claimed_amount`; kept for API compatibility.
    pub total_claimed: i128,

    /// If set, the ledger at which the stream was paused.
    pub paused_at_ledger: Option<u32>,
}

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
    pub total_claimed: i128,

    /// Alias for `total_claimed`; incremented on every successful claim.
    /// Exposed as a separate field for API compatibility with dust-tracking tests.
    pub claimed_amount: i128,

    /// Sub-unit token remainder accumulated due to integer division.
    /// Carried forward and added to the next claim once it reaches ≥ 1 token.
    pub dust: i128,

    /// Optional free-form metadata attached at stream creation (max 256 bytes, UTF-8).
    pub metadata: Option<String>,

    /// If set, the ledger sequence at which this stream was paused.
    pub paused_at_ledger: Option<u32>,

    /// Total ledgers the stream has been paused (used to extend end_ledger on resume).
    pub accumulated_pause_ledgers: u32,

    /// Monotonically increasing mutation counter.
    /// Initialised to `1` at stream creation; incremented on every state change.
    /// `0` is the legacy default for schedules created before versioning was added.
    pub version: u32,
}

impl VestingSchedule {
    /// Increments the version counter.
    ///
    /// Returns `Err(VestingError::VersionOverflow)` if already at `u32::MAX`.
    pub fn increment_version(&mut self) -> Result<(), crate::error::VestingError> {
        self.version = self
            .version
            .checked_add(1)
            .ok_or(crate::error::VestingError::VersionOverflow)?;
        Ok(())
    }
}

/// Analytics snapshot for a single vesting stream.
///
/// Returned by `VestingDrips::get_stream_info`. All token amounts are in the
/// smallest unit of the streamed token (same denomination as `rate_per_ledger`).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamInfo {
    /// Total tokens deposited when the stream was created.
    pub total_deposit: i128,

    /// Tokens already transferred to the recipient via `claim_vested`.
    pub claimed_so_far: i128,

    /// Tokens currently available to claim (zero if cliff not yet reached).
    pub claimable_now: i128,

    /// Tokens that will still drip after the current ledger.
    pub remaining_locked: i128,

    /// Percentage of the stream that has been claimed, in basis points (0–10 000).
    pub percent_vested_bps: u32,

    /// `true` if the cliff has been reached at the queried ledger.
    pub cliff_reached: bool,

    /// `true` if the stream has ended (current ledger >= `end_ledger`).
    pub stream_ended: bool,
}

/// A single milestone entry for milestone-based vesting streams.
///
/// Each milestone specifies a ledger sequence at which a percentage (in basis
/// points) of the total tokens becomes claimable by the recipient.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Milestone {
    /// Ledger sequence at which this milestone unlocks.
    pub ledger: u32,

    /// Percentage of total tokens that unlock at this milestone, in basis points.
    /// 10000 bps = 100%; 2500 bps = 25%.
    pub bps_unlock: u32,
}

/// A milestone-based vesting schedule stored per recipient.
///
/// Instead of a single cliff, tokens unlock incrementally at each milestone.
/// Max 20 milestones to prevent excessive storage costs.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneSchedule {
    /// The token being vested.
    pub token: Address,

    /// The sponsor (funder) who created this stream.
    pub sponsor: Address,

    /// Total tokens deposited at stream creation.
    pub total_deposited: i128,

    /// Ordered list of (ledger, bps_unlock) milestones.
    /// Must be in strictly ascending ledger order.
    pub milestones: Vec<Milestone>,

    /// Index of the next unclaimed milestone (0-based).
    pub next_milestone_idx: u32,

    /// Ledger sequence at which the stream ends.
    pub end_ledger: u32,

    /// Running total of tokens transferred to the recipient.
    pub total_claimed: i128,
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

    /// Per-recipient milestone-based vesting schedule.
    MilestoneSchedule(Address),

    /// Instance-level configuration: minimum deposit (i128).
    MinDeposit,

    /// Storage key for configured contract admin address.
    Admin,

    /// Storage key for configured fee basis points (0-500).
    FeeBps,

    /// Storage key for configured protocol treasury address.
    Treasury,

    /// Storage key for the allowlist of approved token addresses.
    AllowedTokens,

    /// Storage key tracking whether the contract has been initialized.
    Initialized,
}

/// Human-readable status of a vesting stream.
///
/// Returned by `stream_status` (typed enum view, issue #311) and by the
/// legacy `get_status` view.
///
/// The `NotFound` variant indicates no schedule exists for the queried recipient,
/// allowing callers to avoid a separate existence check.
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
    /// No schedule exists for this recipient.
    NotFound,
}
