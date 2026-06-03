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

/// Storage key variants used for keying contract data.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Per-recipient vesting schedule.
    Schedule(Address),
}
