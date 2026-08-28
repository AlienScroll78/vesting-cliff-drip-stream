// `#[contracttype]` emits an inherent `impl Type { spec_xdr() }` with no doc
// comment of its own; rustc doesn't propagate item-level `#[allow]` onto
// attribute-macro-generated sibling impls, so the allow has to be module-scoped.
#![allow(missing_docs)]

use soroban_sdk::{contracttype, Address, String, Vec};

use crate::error::VestingError;

/// Represents a single fixed-rate vesting schedule stored per recipient.
///
/// Persisted in contract storage keyed by the recipient's `Address`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
#[allow(missing_docs)]
pub struct VestingSchedule {
    pub token: Address,
    pub sponsor: Address,
    pub rate_per_ledger: i128,
    pub start_ledger: u32,
    pub cliff_ledger: u32,
    pub end_ledger: u32,
    /// Last ledger up to which tokens have been claimed.
    pub last_claimed_ledger: u32,
    /// Running total of tokens transferred to the recipient.
    pub total_claimed: i128,
    /// Tracks total claimed for dust-collection purposes (mirrors total_claimed).
    pub claimed_amount: i128,
    /// Optional free-form metadata (max 256 bytes, UTF-8).
    pub metadata: Option<String>,
    /// Ledger at which the stream was paused, or `None` if active.
    pub paused_at_ledger: Option<u32>,
    /// Total ledgers accumulated across all pause periods.
    pub accumulated_pause_ledgers: u32,
    /// Monotonically increasing mutation counter (starts at 1).
    /// Field placed last for XDR forward-compatibility.
    pub version: u32,
}

impl VestingSchedule {
    /// Increment the version counter. Returns `VersionOverflow` at `u32::MAX`.
    pub fn increment_version(&mut self) -> Result<(), VestingError> {
        self.version = self
            .version
            .checked_add(1)
            .ok_or(VestingError::VersionOverflow)?;
        Ok(())
    }
}

/// A single rate segment for variable-rate vesting streams.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RateSegment {
    /// Absolute ledger at which this segment ends.
    pub end_ledger: u32,
    /// Tokens per ledger for this segment.
    pub rate: i128,
}

/// A variable-rate vesting schedule with multiple rate segments.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VariableRateSchedule {
    pub token: Address,
    pub sponsor: Address,
    pub start_ledger: u32,
    pub cliff_ledger: u32,
    pub end_ledger: u32,
    pub last_claimed_ledger: u32,
    pub total_deposited: i128,
    pub claimed_amount: i128,
    pub total_claimed: i128,
    pub segments: Vec<RateSegment>,
    pub paused_at_ledger: Option<u32>,
}

/// A single milestone entry for milestone-based vesting streams.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Milestone {
    pub ledger: u32,
    pub bps_unlock: u32,
}

/// A milestone-based vesting schedule stored per recipient.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneSchedule {
    pub token: Address,
    pub sponsor: Address,
    pub total_deposited: i128,
    pub milestones: Vec<Milestone>,
    pub next_milestone_idx: u32,
    pub drip_start_ledger: u32,
    pub drip_rate_per_ledger: i128,
    pub end_ledger: u32,
    pub total_claimed: i128,
    /// Alias for `total_claimed`; used by dust-collection paths.
    pub claimed_amount: i128,
    /// If `Some(ledger)`, the stream was paused at that ledger.
    pub paused_at_ledger: Option<u32>,
}

/// Analytics snapshot for a single vesting stream.
///
/// Returned by `VestingDrips::get_stream_info`.
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

/// A single token allocation within a multi-token vesting stream.
///
/// Each entry pairs a SAC token address with a per-ledger emission rate.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenAllocation {
    /// SAC-compatible token contract address.
    pub token: Address,
    /// Tokens of this denomination released per ledger (must be > 0).
    pub rate_per_ledger: i128,
}

/// Vesting schedule for a stream that vests multiple SAC tokens simultaneously.
///
/// Persisted in contract storage under a composite key `(recipient, token)`
/// — one entry per `(recipient, token)` pair — following Option A from the
/// multi-token design doc. This keeps entry sizes bounded and TTL management
/// per-entry.
///
/// # Storage key
/// `DataKey::MultiSchedule(recipient, token)`
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultiTokenSchedule {
    /// The allocations (token + rate) vested by this stream.
    pub allocations: Vec<TokenAllocation>,

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
#[allow(missing_docs)]
pub enum DataKey {
    /// Per-recipient fixed-rate vesting schedule.
    Schedule(Address),
    /// Per-recipient variable-rate vesting schedule.
    VariableSchedule(Address),
    /// Per-recipient milestone-based vesting schedule.
    MilestoneSchedule(Address),
    /// Instance-level: minimum deposit (i128).
    MinDeposit,
    /// Instance-level: contract admin address.
    Admin,
    /// Instance-level: protocol fee basis points (0-500).
    FeeBps,
    /// Instance-level: protocol treasury address.
    Treasury,

    /// Instance-level configuration: maximum cliff ratio in basis points (default 5000 = 50%).
    ConfigMaxCliffRatio,

    /// Instance-level configuration: minimum rate per ledger (default 1).
    ConfigMinRate,
}

/// Human-readable status of a vesting stream.
///
/// Returned by `stream_status` (typed enum view, issue #583) and by the
/// legacy `get_status` view.
///
/// The `NotFound` variant indicates no schedule exists for the queried recipient,
/// allowing callers to avoid a separate existence check.
///
/// # Badge colour mapping
/// | Variant      | Colour | Hex       | ARIA label      |
/// |--------------|--------|-----------|-----------------|
/// | PreCliff     | Amber  | `#F59E0B` | "Pre-cliff"     |
/// | Active       | Blue   | `#3B82F6` | "Active"        |
/// | Expired      | Green  | `#22C55E` | "Expired"       |
/// | Cancelled    | Red    | `#EF4444` | "Cancelled"     |
/// | Paused       | Yellow | `#EAB308` | "Paused"        |
/// | Drained      | Purple | `#A855F7` | "Drained"       |
/// | NotFound     | Grey   | `#6B7280` | "Not found"     |
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
#[allow(missing_docs)]
pub enum StreamStatus {
    PreCliff,
    Active,
    Expired,
    Cancelled,
    /// Sponsor paused the stream; token accrual is halted until resumed.
    Paused,
    /// Stream was fully drained (all tokens recovered by sponsor after expiry drain delay).
    Drained,
    /// No schedule exists for this recipient.
    NotFound,
}
