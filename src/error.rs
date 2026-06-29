use soroban_sdk::contracterror;

/// All error codes returned by the VestingDrips contract.
///
/// Codes are pinned to explicit `u32` values so clients can switch on them
/// reliably across contract upgrades (see ADR-0004). Code 0 is reserved for
/// success by the Soroban runtime and must never be used here.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VestingError {
    /// **Code 1** — No active vesting schedule exists for the given recipient.
    ///
    /// Returned by `claim_vested`, `cancel_stream`, and any view that requires
    /// a schedule to be present.
    ScheduleNotFound = 1,

    /// **Code 2** — The current ledger sequence is still below `cliff_ledger`.
    ///
    /// Tokens cannot be claimed until the cliff is reached. Check
    /// `is_cliff_passed` before calling `claim_vested`.
    CliffNotReached = 2,

    /// **Code 3** — `total_duration` must be strictly greater than `cliff_duration`.
    ///
    /// A stream where the cliff equals or exceeds the total length would
    /// never produce any post-cliff drip.
    InvalidDuration = 3,

    /// **Code 4** — `rate_per_ledger` must be a positive, non-zero value.
    ///
    /// Zero or negative rates are rejected at stream-creation time.
    InvalidRate = 4,

    /// **Code 5** — The computed total deposit (`rate × total_duration`) would
    /// overflow an `i128`.
    ///
    /// The safe upper bound for `rate` is `i128::MAX / total_duration`.
    DepositOverflow = 5,

    /// **Code 6** — A vesting schedule already exists for this recipient.
    ///
    /// Cancel the existing stream before creating a new one for the same
    /// recipient address.
    ScheduleAlreadyExists = 6,

    /// **Code 7** — The claimable amount is zero at the current ledger.
    ///
    /// This can occur when the stream has already been fully claimed up to
    /// `end_ledger`, or when the ledger has not advanced since the last claim.
    NothingToClaim = 7,

    /// **Code 8** — The stream's `end_ledger` has not yet been reached.
    ///
    /// `emergency_drain` requires the stream to have fully expired before the
    /// drain delay begins. Call this only after `end_ledger` has passed.
    StreamNotExpired = 8,

    /// **Code 9** — The emergency-drain delay period has not yet elapsed.
    ///
    /// The sponsor must wait `end_ledger + DRAIN_DELAY_LEDGERS` ledgers before
    /// calling `emergency_drain`. This prevents abuse on recently-ended streams.
    DrainDelayNotExpired = 9,
}
