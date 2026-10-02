// `#[contracttype]` emits an inherent `impl Type { spec_xdr() }` with no doc
// comment of its own; rustc doesn't propagate item-level `#[allow]` onto
// attribute-macro-generated sibling impls, so the allow has to be module-scoped.
#![allow(missing_docs)]

use soroban_sdk::{contracttype, Address, String, Vec};

use crate::error::VestingError;

/// Current schema version written into every new `VestingSchedule`.
///
/// Increment this constant when adding new fields. The `migrate_schedule`
/// function maps each prior version to the current one by filling defaults.
pub const CURRENT_SCHEMA_VERSION: u32 = 2;

/// Represents a single fixed-rate vesting schedule stored per recipient.
///
/// Persisted in contract storage keyed by the recipient's `Address`.
///
/// ## Schema versions
/// | Version | Description                                          |
/// |---------|------------------------------------------------------|
/// | 1       | Original schema (no `schema_version` field present). |
/// | 2       | Added `schema_version` field (this release, #736).   |
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
    pub version: u32,
    /// On-storage schema version, used by `migrate_schedule` to apply
    /// forward-compatible defaults when the struct gains new fields.
    ///
    /// Default: [`CURRENT_SCHEMA_VERSION`].
    /// Old records stored without this field will decode as `0`; the
    /// migration function treats `0` as V1 and upgrades automatically.
    pub schema_version: u32,
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
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamInfo {
    pub total_deposit: i128,
    pub claimed_so_far: i128,
    pub claimable_now: i128,
    pub remaining_locked: i128,
    pub percent_vested_bps: u32,
    pub cliff_reached: bool,
    pub stream_ended: bool,
}

/// A single token allocation within a multi-token vesting stream.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenAllocation {
    pub token: Address,
    pub rate_per_ledger: i128,
}

/// Vesting schedule for a stream that vests multiple SAC tokens simultaneously.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultiTokenSchedule {
    pub allocations: Vec<TokenAllocation>,
    pub start_ledger: u32,
    pub cliff_ledger: u32,
    pub end_ledger: u32,
    pub last_claimed_ledger: u32,
}

/// Storage key variants used for keying contract data.
#[contracttype]
#[derive(Clone)]
#[allow(missing_docs)]
pub enum DataKey {
    /// Legacy single-stream schedule key retained for existing deployments.
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
    /// Instance-level: whether the contract has been initialized.
    Initialized,
    /// Instance-level: reentrancy lock flag.
    Lock,
    /// Instance-level: allowed token addresses (Vec<Address>).
    AllowedTokens,
    /// Instance-level: allowlist enabled flag.
    AllowlistEnabled,
    /// Per-address: recipient allowlist entry.
    RecipientAllowlist(Address),
    /// Per-sponsor: list of recipient addresses with active streams.
    SponsorStreams(Address),
    /// Instance-level configuration: maximum cliff ratio in basis points (default 5000 = 50%).
    ConfigMaxCliffRatio,
    /// Instance-level configuration: minimum rate per ledger (default 1).
    ConfigMinRate,
    /// Per-recipient fixed-rate schedule keyed by its stream ID.
    ScheduleById(Address, u32),
    /// Next stream ID to allocate for a recipient.
    NextStreamId(Address),
}

/// Human-readable status of a vesting stream.
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

// ── Public constants ──────────────────────────────────────────────────────────

/// Scaling factor for fixed-point rate arithmetic.
///
/// `rate_per_ledger` is stored multiplied by this constant to preserve
/// sub-token precision. Pass `rate = RATE_DECIMALS` for 1 token/ledger,
/// `rate = RATE_DECIMALS / 2` for 0.5 tokens/ledger, etc.
pub const RATE_DECIMALS: i128 = 10_000_000;

/// Default maximum cliff ratio in percentage points (0–100).
///
/// Streams where `cliff_duration / total_duration > MAX_CLIFF_RATIO / 100`
/// are rejected. Default is 80% (i.e. at most 80% of the total duration may
/// be the cliff period).
pub const MAX_CLIFF_RATIO: u32 = 80;
