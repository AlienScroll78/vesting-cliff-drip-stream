use soroban_sdk::{contracttype, Address};

/// Represents a single vesting schedule stored per recipient.
///
/// Persisted in contract storage keyed by the recipient's `Address`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VestingSchedule {
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
}
