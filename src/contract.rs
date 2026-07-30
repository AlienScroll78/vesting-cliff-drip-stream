// `#[contracttype]`/`#[contract]` emit inherent `impl` blocks (`spec_xdr()`,
// `spec_xdr_<method>()`) with no doc comments of their own; rustc doesn't
// propagate item-level `#[allow]` onto attribute-macro-generated sibling
// impls, so the allow has to be module-scoped.
#![allow(missing_docs)]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, BytesN, Env, String, Vec};

use crate::{
    error::VestingError,
    events, storage,
    types::{DataKey, RateSegment, StreamStatus, VariableRateSchedule, VestingSchedule},
};

/// ~1 year at ~5 s/ledger: 6 * 60 * 24 * 365 = 3_153_600 ledgers.
const DRAIN_DELAY_LEDGERS: u32 = 3_153_600;

/// Maximum number of segments allowed in a variable-rate stream.
const MAX_SEGMENTS: u32 = 10;

/// Maximum fee in basis points (5 %).
const MAX_FEE_BPS: u32 = 500;

/// Consolidated statistics for a vesting stream.
///
/// Returned by [`VestingDrips::get_stats`].
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamStats {
    /// Total tokens deposited when the stream was created (`rate × total_duration`).
    pub total_deposited: i128,
    /// Tokens already transferred to the recipient via `claim_vested`.
    pub total_claimed: i128,
    /// Tokens still held by the contract vault for this stream.
    pub remaining: i128,
    /// Tokens claimable right now (zero if cliff not yet reached).
    pub claimable_now: i128,
}

/// The vesting-drip contract entry point.
#[contract]
pub struct VestingDrips;

#[contractimpl]
impl VestingDrips {
    // ── Initialization ────────────────────────────────────────────────────────

    /// Configures the contract with admin, fee, and treasury settings.
    ///
    /// Must be called **once** immediately after deployment. Subsequent calls
    /// are rejected with `AlreadyInitialized`.
    ///
    /// # Arguments
    /// * `admin`    – Address that gains authority to call admin-gated functions.
    /// * `fee_bps`  – Protocol fee in basis points (0–500, i.e. 0 %–5 %).
    /// * `treasury` – Address that receives collected protocol fees.
    ///
    /// # Errors
    /// * `AlreadyInitialized` – `initialize` has already been called.
    /// * `InvalidRate`        – `fee_bps` exceeds 500.
    pub fn initialize(
        env: Env,
        admin: Address,
        fee_bps: u32,
        treasury: Address,
    ) -> Result<(), VestingError> {
        if storage::is_initialized(&env) {
            return Err(VestingError::AlreadyInitialized);
        }
        if fee_bps > MAX_FEE_BPS {
            return Err(VestingError::InvalidRate);
        }
        admin.require_auth();
        storage::set_admin(&env, &admin);
        storage::set_fee_bps(&env, fee_bps);
        storage::set_treasury(&env, &treasury);
        storage::set_initialized(&env);
        events::emit_contract_initialized(&env, &admin, fee_bps, &treasury);
        Ok(())
    }

    /// Upgrades the contract to the WASM referenced by `new_wasm_hash`.
    ///
    /// # Errors
    /// * `Unauthorized` – `admin` is not the address set during `initialize`.
    pub fn upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), VestingError> {
        admin.require_auth();
        if storage::get_admin(&env) != Some(admin) {
            return Err(VestingError::Unauthorized);
        }
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    /// Transfers admin authority from the current admin to `new_admin`.
    ///
    /// # Errors
    /// * `Unauthorized` – `admin` is not the address set during `initialize`.
    pub fn transfer_admin(
        env: Env,
        admin: Address,
        new_admin: Address,
    ) -> Result<(), VestingError> {
        admin.require_auth();
        if storage::get_admin(&env) != Some(admin) {
            return Err(VestingError::Unauthorized);
        }
        storage::set_admin(&env, &new_admin);
        Ok(())
    }

    // ── Stream creation ───────────────────────────────────────────────────────

    /// Creates a new cliff-vesting stream for `recipient`.
    ///
    /// The contract must have been initialized via `initialize` before streams
    /// can be created.
    ///
    /// # Arguments
    /// * `sponsor`        – The funder; must authorise this call and hold sufficient tokens.
    /// * `recipient`      – The beneficiary who will claim tokens after the cliff.
    /// * `token`          – SAC-compatible token contract address.
    /// * `rate`           – Tokens released per ledger (must be > 0).
    /// * `cliff_duration` – Ledgers from now until the cliff is reached.
    /// * `total_duration` – Total ledgers the stream runs for (must be > cliff_duration).
    ///
    /// # Errors
    /// * `NotInitialized`         – `initialize` has not been called yet.
    /// * `InvalidRate`            – `rate` is zero or negative.
    /// * `InvalidDuration`        – `total_duration` ≤ `cliff_duration`.
    /// * `DepositOverflow`        – Total deposit exceeds i128 bounds.
    /// * `DepositBelowMinimum`    – Total deposit is below the configured minimum.
    /// * `ScheduleAlreadyExists`  – A stream already exists for `recipient`.
    /// * `InvalidRecipient`       – `sponsor` and `recipient` are the same address.
    pub fn create_vesting_stream(
        env: Env,
        sponsor: Address,
        recipient: Address,
        token: Address,
        rate: i128,
        cliff_duration: u32,
        total_duration: u32,
    ) -> Result<(), VestingError> {
        if !storage::is_initialized(&env) {
            return Err(VestingError::NotInitialized);
        }
        if rate <= 0 {
            return Err(VestingError::InvalidRate);
        }
        if total_duration <= cliff_duration {
            return Err(VestingError::InvalidDuration);
        }
        if sponsor == recipient {
            return Err(VestingError::InvalidRecipient);
        }
        if storage::has_schedule(&env, &recipient) {
            return Err(VestingError::ScheduleAlreadyExists);
        }

        sponsor.require_auth();

        let start_ledger: u32 = env.ledger().sequence();
        let cliff_ledger: u32 = start_ledger
            .checked_add(cliff_duration)
            .ok_or(VestingError::DepositOverflow)?;
        let end_ledger: u32 = start_ledger
            .checked_add(total_duration)
            .ok_or(VestingError::DepositOverflow)?;

        let total_deposit: i128 = calculate_total_deposit(rate, total_duration)?;

        let min_deposit = storage::get_min_deposit(&env);
        if total_deposit < min_deposit {
            return Err(VestingError::DepositBelowMinimum);
        }

        let token_client = token::Client::new(&env, &token);
        token_client
            .try_transfer(&sponsor, &env.current_contract_address(), &total_deposit)
            .map_err(|_| VestingError::TransferFailed)?;

        let schedule = VestingSchedule {
            version: 1,
            token: token.clone(),
            sponsor: sponsor.clone(),
            rate_per_ledger: rate,
            start_ledger,
            cliff_ledger,
            end_ledger,
            last_claimed_ledger: start_ledger,
            total_claimed: 0,
            claimed_amount: 0,
        };
        storage::set_schedule(&env, &recipient, &schedule);

        events::emit_stream_created(
            &env,
            &sponsor,
            &recipient,
            &token,
            rate,
            start_ledger,
            cliff_ledger,
            end_ledger,
        );

        Ok(())
    }

    /// Creates a variable-rate vesting stream with scheduled rate changes.
    ///
    /// Supports stepped vesting schedules where the drip rate increases or
    /// decreases at specified ledger boundaries.
    ///
    /// # Arguments
    /// * `sponsor`        – The funder; must authorise this call.
    /// * `recipient`      – The beneficiary.
    /// * `token`          – SAC-compatible token contract address.
    /// * `cliff_duration` – Ledgers from now until the cliff is reached.
    /// * `segments`       – Ordered `Vec<(u32, i128)>` of `(end_ledger, rate)`.
    ///
    /// # Segment rules
    /// * Must contain 1–10 entries.
    /// * `end_ledger` values must be strictly ascending.
    /// * All rates must be > 0.
    /// * The first segment's start is `start_ledger`; each subsequent start is
    ///   the previous segment's `end_ledger`.
    /// * `cliff_duration` must be less than the final segment's `end_ledger` offset.
    ///
    /// # Deposit
    /// `total_deposit = Σ rate_i × (end_i − start_i)` for each segment.
    ///
    /// # Errors
    /// * `NotInitialized`        – Contract not yet initialized.
    /// * `InvalidRecipient`      – Sponsor and recipient are the same.
    /// * `ScheduleAlreadyExists` – A stream already exists for `recipient`.
    /// * `InvalidSegments`       – Segment list is empty, too long, not ascending,
    ///                             or contains a non-positive rate.
    /// * `DepositOverflow`       – Overflow computing total deposit.
    /// * `DepositBelowMinimum`   – Total deposit below minimum.
    /// * `TransferFailed`        – Token transfer failed.
    pub fn create_variable_rate_stream(
        env: Env,
        sponsor: Address,
        recipient: Address,
        token: Address,
        cliff_duration: u32,
        segments: Vec<(u32, i128)>,
    ) -> Result<(), VestingError> {
        if !storage::is_initialized(&env) {
            return Err(VestingError::NotInitialized);
        }
        if sponsor == recipient {
            return Err(VestingError::InvalidRecipient);
        }
        if storage::has_variable_schedule(&env, &recipient)
            || storage::has_schedule(&env, &recipient)
        {
            return Err(VestingError::ScheduleAlreadyExists);
        }

        // ── Validate segments ─────────────────────────────────────────────────
        let n = segments.len();
        if n == 0 || n > MAX_SEGMENTS {
            return Err(VestingError::InvalidSegments);
        }

        let start_ledger: u32 = env.ledger().sequence();
        let mut prev_end: u32 = start_ledger;
        let mut total_deposit: i128 = 0;
        let mut rate_segments: Vec<RateSegment> = Vec::new(&env);

        for i in 0..n {
            let (seg_end_offset, rate) = segments.get(i).unwrap();
            // seg_end_offset is treated as an absolute ledger number
            let seg_end: u32 = seg_end_offset;

            if rate <= 0 {
                return Err(VestingError::InvalidSegments);
            }
            if seg_end <= prev_end {
                return Err(VestingError::InvalidSegments);
            }

            let duration = (seg_end - prev_end) as i128;
            let seg_deposit = rate
                .checked_mul(duration)
                .ok_or(VestingError::DepositOverflow)?;
            total_deposit = total_deposit
                .checked_add(seg_deposit)
                .ok_or(VestingError::DepositOverflow)?;

            rate_segments.push_back(RateSegment {
                end_ledger: seg_end,
                rate,
            });

            prev_end = seg_end;
        }

        let end_ledger = prev_end; // last segment's end_ledger

        // cliff must be before the stream end
        let cliff_ledger = start_ledger
            .checked_add(cliff_duration)
            .ok_or(VestingError::DepositOverflow)?;
        if cliff_ledger >= end_ledger {
            return Err(VestingError::InvalidSegments);
        }

        let min_deposit = storage::get_min_deposit(&env);
        if total_deposit < min_deposit {
            return Err(VestingError::DepositBelowMinimum);
        }

        sponsor.require_auth();

        let token_client = token::Client::new(&env, &token);
        token_client
            .try_transfer(&sponsor, &env.current_contract_address(), &total_deposit)
            .map_err(|_| VestingError::TransferFailed)?;

        let schedule = VariableRateSchedule {
            version: 1,
            token: token.clone(),
            sponsor: sponsor.clone(),
            start_ledger,
            cliff_ledger,
            end_ledger,
            last_claimed_ledger: start_ledger,
            total_claimed: 0,
            claimed_amount: 0,
            total_deposited: total_deposit,
            segments: rate_segments,
        };
        storage::set_variable_schedule(&env, &recipient, &schedule);

        events::emit_variable_stream_created(
            &env,
            &sponsor,
            &recipient,
            &token,
            start_ledger,
            cliff_ledger,
            end_ledger,
            total_deposit,
        );

        Ok(())
    }

    // ── Claiming ──────────────────────────────────────────────────────────────

    /// Claims all vested tokens accrued since the last claim (fixed-rate stream).
    ///
    /// Implements dust collection: if the current ledger is at or beyond
    /// `end_ledger`, the claimable amount is `total_deposited − claimed_amount`
    /// rather than `rate × elapsed_ledgers`, ensuring no sub-1-token remainder
    /// is permanently locked in the contract vault.
    ///
    /// # Errors
    /// * `ScheduleNotFound` – No stream exists for `recipient`.
    /// * `CliffNotReached`  – Current ledger < `cliff_ledger`.
    /// * `NothingToClaim`   – Claimable amount is zero.
    pub fn claim_vested(env: Env, recipient: Address) -> Result<i128, VestingError> {
        recipient.require_auth();

        let mut schedule =
            storage::get_schedule(&env, &recipient).ok_or(VestingError::ScheduleNotFound)?;

        let current_ledger = env.ledger().sequence();

        if current_ledger < schedule.cliff_ledger {
            return Err(VestingError::CliffNotReached);
        }

        let total_deposited =
            (schedule.end_ledger - schedule.start_ledger) as i128 * schedule.rate_per_ledger;

        // Dust collection: at or past end_ledger return the full remainder so
        // no sub-1-token dust stays locked in the vault.
        let claimable_amount = if current_ledger >= schedule.end_ledger {
            total_deposited - schedule.claimed_amount
        } else {
            let active_end = current_ledger.min(schedule.end_ledger);
            (active_end - schedule.last_claimed_ledger) as i128 * schedule.rate_per_ledger
        };

        if claimable_amount == 0 {
            return Err(VestingError::NothingToClaim);
        }

        let token_client = token::Client::new(&env, &schedule.token);
        token_client
            .try_transfer(
                &env.current_contract_address(),
                &recipient,
                &claimable_amount,
            )
            .map_err(|_| VestingError::TransferFailed)?;

        let active_end = current_ledger.min(schedule.end_ledger);
        schedule.last_claimed_ledger = active_end;
        schedule.total_claimed += claimable_amount;
        schedule.claimed_amount += claimable_amount;
        let stream_finished = schedule.claimed_amount >= total_deposited;

        if stream_finished {
            storage::remove_schedule(&env, &recipient);
            events::emit_stream_completed(&env, &recipient, &schedule.token);
        } else {
            storage::set_schedule(&env, &recipient, &schedule);
        }

        events::emit_tokens_claimed(&env, &recipient, claimable_amount, active_end);

        Ok(claimable_amount)
    }

    /// Claims all vested tokens from a variable-rate stream.
    ///
    /// Iterates over segments to accumulate the claimable amount from
    /// `last_claimed_ledger` to `min(current_ledger, end_ledger)`.
    ///
    /// Implements dust collection: at `end_ledger` returns `total_deposited −
    /// claimed_amount` to capture any sub-1-token remainder.
    ///
    /// # Errors
    /// * `ScheduleNotFound` – No variable-rate stream exists for `recipient`.
    /// * `CliffNotReached`  – Current ledger < `cliff_ledger`.
    /// * `NothingToClaim`   – Claimable amount is zero.
    pub fn claim_variable_vested(env: Env, recipient: Address) -> Result<i128, VestingError> {
        recipient.require_auth();

        let mut schedule = storage::get_variable_schedule(&env, &recipient)
            .ok_or(VestingError::ScheduleNotFound)?;

        let current_ledger = env.ledger().sequence();

        if current_ledger < schedule.cliff_ledger {
            return Err(VestingError::CliffNotReached);
        }

        // Dust collection at stream end.
        let claimable_amount = if current_ledger >= schedule.end_ledger {
            schedule.total_deposited - schedule.claimed_amount
        } else {
            compute_variable_claimable(
                &schedule.segments,
                schedule.last_claimed_ledger,
                current_ledger,
                schedule.start_ledger,
            )
        };

        if claimable_amount == 0 {
            return Err(VestingError::NothingToClaim);
        }

        let token_client = token::Client::new(&env, &schedule.token);
        token_client
            .try_transfer(
                &env.current_contract_address(),
                &recipient,
                &claimable_amount,
            )
            .map_err(|_| VestingError::TransferFailed)?;

        let active_end = current_ledger.min(schedule.end_ledger);
        schedule.last_claimed_ledger = active_end;
        schedule.total_claimed += claimable_amount;
        schedule.claimed_amount += claimable_amount;
        let stream_finished = schedule.claimed_amount >= schedule.total_deposited;

        if stream_finished {
            storage::remove_variable_schedule(&env, &recipient);
            events::emit_stream_completed(&env, &recipient, &schedule.token);
        } else {
            storage::set_variable_schedule(&env, &recipient, &schedule);
        }

        events::emit_variable_tokens_claimed(&env, &recipient, claimable_amount, active_end);

        Ok(claimable_amount)
    }

    // ── Cancellation / Clawback ───────────────────────────────────────────────

    /// Allows the original sponsor to cancel an active stream.
    ///
    /// Tokens already accrued up to the current ledger remain claimable
    /// by `recipient` only if the cliff has been passed; otherwise the
    /// entire deposit is refunded to `sponsor`.
    ///
    /// # Errors
    /// * `ScheduleNotFound` – No stream exists for `recipient`.
    pub fn cancel_stream(
        env: Env,
        sponsor: Address,
        recipient: Address,
    ) -> Result<(), VestingError> {
        sponsor.require_auth();

        let schedule =
            storage::get_schedule(&env, &recipient).ok_or(VestingError::ScheduleNotFound)?;

        let current_ledger = env.ledger().sequence();
        let token_client = token::Client::new(&env, &schedule.token);

        let (recipient_share, sponsor_refund) = if current_ledger >= schedule.cliff_ledger {
            let active_end = current_ledger.min(schedule.end_ledger);
            let earned_ledgers = active_end - schedule.last_claimed_ledger;
            let earned = earned_ledgers as i128 * schedule.rate_per_ledger;
            let unclaimed_from_end =
                (schedule.end_ledger - active_end) as i128 * schedule.rate_per_ledger;
            (earned, unclaimed_from_end)
        } else {
            let total_remaining = (schedule.end_ledger - schedule.last_claimed_ledger) as i128
                * schedule.rate_per_ledger;
            (0_i128, total_remaining)
        };

        if recipient_share > 0 {
            token_client
                .try_transfer(
                    &env.current_contract_address(),
                    &recipient,
                    &recipient_share,
                )
                .map_err(|_| VestingError::TransferFailed)?;
        }
        if sponsor_refund > 0 {
            token_client
                .try_transfer(&env.current_contract_address(), &sponsor, &sponsor_refund)
                .map_err(|_| VestingError::TransferFailed)?;
        }

        storage::remove_schedule(&env, &recipient);
        events::emit_stream_cancelled(&env, &recipient, sponsor_refund);

        Ok(())
    }

    /// Compliance clawback: the original sponsor recovers **all** remaining tokens.
    ///
    /// # Errors
    /// * `ScheduleNotFound`     – No stream exists for `recipient`.
    /// * `ClawbackNotSupported` – Token does not support SAC clawback.
    pub fn clawback_stream(
        env: Env,
        sponsor: Address,
        recipient: Address,
        reason: String,
    ) -> Result<(), VestingError> {
        sponsor.require_auth();

        let schedule = storage::get_schedule(&env, &recipient)
            .ok_or(VestingError::ScheduleNotFound)?;

        let remaining = (schedule.end_ledger - schedule.last_claimed_ledger) as i128
            * schedule.rate_per_ledger;

        let sac_admin_client = token::StellarAssetClient::new(&env, &schedule.token);
        if sac_admin_client
            .try_clawback(&env.current_contract_address(), &0_i128)
            .is_err()
        {
            return Err(VestingError::ClawbackNotSupported);
        }

        if remaining > 0 {
            let token_client = token::Client::new(&env, &schedule.token);
            token_client.transfer(&env.current_contract_address(), &sponsor, &remaining);
        }

        storage::remove_schedule(&env, &recipient);

        events::emit_stream_clawed_back(
            &env,
            &sponsor,
            &recipient,
            &schedule.token,
            remaining,
            &reason,
        );

        Ok(())
    }

    /// Drains an expired stream, returning unclaimed tokens to the original sponsor.
    ///
    /// Callable by **anyone** once `end_ledger + DRAIN_DELAY_LEDGERS` has elapsed.
    ///
    /// # Errors
    /// * `ScheduleNotFound`      – No stream exists for `recipient`.
    /// * `StreamNotExpired`      – `end_ledger` has not yet been reached.
    /// * `DrainDelayNotExpired`  – Drain delay (1 year) has not elapsed since `end_ledger`.
    pub fn drain_expired_stream(
        env: Env,
        caller: Address,
        recipient: Address,
    ) -> Result<(), VestingError> {
        let schedule = storage::get_schedule(&env, &recipient)
            .ok_or(VestingError::ScheduleNotFound)?;

        let current_ledger = env.ledger().sequence();

        if current_ledger < schedule.end_ledger {
            return Err(VestingError::StreamNotExpired);
        }

        let drain_available_at = schedule
            .end_ledger
            .checked_add(DRAIN_DELAY_LEDGERS)
            .ok_or(VestingError::DepositOverflow)?;

        if current_ledger < drain_available_at {
            return Err(VestingError::DrainDelayNotExpired);
        }

        let total_deposited =
            (schedule.end_ledger - schedule.start_ledger) as i128 * schedule.rate_per_ledger;
        let remaining = total_deposited - schedule.claimed_amount;

        let token_client = token::Client::new(&env, &schedule.token);
        let sponsor = schedule.sponsor.clone();

        storage::remove_schedule(&env, &recipient);

        if remaining > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &sponsor,
                &remaining,
            );
        }

        events::emit_stream_drained(
            &env,
            &caller,
            &recipient,
            &sponsor,
            &schedule.token,
            remaining,
        );

        Ok(())
    }

    // ── Admin helpers ─────────────────────────────────────────────────────────

    /// Upgrades a legacy (`version = 0`) schedule to the current schema version.
    ///
    /// # Errors
    /// * `ScheduleNotFound` – No schedule exists for `recipient`.
    pub fn migrate_schedule(
        env: Env,
        admin: Address,
        recipient: Address,
    ) -> Result<(), VestingError> {
        admin.require_auth();

        let mut schedule =
            storage::get_schedule(&env, &recipient).ok_or(VestingError::ScheduleNotFound)?;

        if schedule.version >= 1 {
            return Ok(());
        }

        schedule.version = 1;
        storage::set_schedule(&env, &recipient, &schedule);

        Ok(())
    }

    /// Sets the minimum deposit threshold (admin configuration).
    ///
    /// # Arguments
    /// * `admin`       – Must authorise this call.
    /// * `min_deposit` – New minimum total deposit value (must be > 0).
    pub fn set_min_deposit(
        env: Env,
        admin: Address,
        min_deposit: i128,
    ) -> Result<(), VestingError> {
        admin.require_auth();
        if min_deposit <= 0 {
            return Err(VestingError::InvalidRate);
        }
        storage::set_min_deposit(&env, min_deposit);
        Ok(())
    }

    // ── Read-only views ───────────────────────────────────────────────────────

    /// Returns the full `VestingSchedule` for `recipient`, or `None`.
    pub fn get_schedule(env: Env, recipient: Address) -> Option<VestingSchedule> {
        storage::get_schedule(&env, &recipient)
    }

    /// Returns the full `VariableRateSchedule` for `recipient`, or `None`.
    pub fn get_variable_schedule(env: Env, recipient: Address) -> Option<VariableRateSchedule> {
        storage::get_variable_schedule(&env, &recipient)
    }

    /// Returns the number of tokens currently claimable by `recipient` (fixed-rate stream).
    ///
    /// Returns `0` if the cliff has not been reached or no schedule exists.
    /// Uses the dust-collection formula at `end_ledger`.
    pub fn claimable_amount(env: Env, recipient: Address) -> i128 {
        let Some(schedule) = storage::get_schedule_readonly(&env, &recipient) else {
            return 0;
        };
        let current_ledger = env.ledger().sequence();
        if current_ledger < schedule.cliff_ledger {
            return 0;
        }
        let total_deposited =
            (schedule.end_ledger - schedule.start_ledger) as i128 * schedule.rate_per_ledger;
        if current_ledger >= schedule.end_ledger {
            // Dust collection: return full remainder
            total_deposited - schedule.claimed_amount
        } else {
            let active_end = current_ledger.min(schedule.end_ledger);
            (active_end - schedule.last_claimed_ledger) as i128 * schedule.rate_per_ledger
        }
    }

    /// Returns the number of tokens claimable from a variable-rate stream.
    ///
    /// Returns `0` if the cliff has not been reached or no schedule exists.
    pub fn claimable_variable_amount(env: Env, recipient: Address) -> i128 {
        let Some(schedule) = storage::get_variable_schedule_readonly(&env, &recipient) else {
            return 0;
        };
        let current_ledger = env.ledger().sequence();
        if current_ledger < schedule.cliff_ledger {
            return 0;
        }
        if current_ledger >= schedule.end_ledger {
            return schedule.total_deposited - schedule.claimed_amount;
        }
        compute_variable_claimable(
            &schedule.segments,
            schedule.last_claimed_ledger,
            current_ledger,
            schedule.start_ledger,
        )
    }

    /// Returns `true` if the cliff has been passed for `recipient`.
    pub fn is_cliff_passed(env: Env, recipient: Address) -> bool {
        let Some(schedule) = storage::get_schedule_readonly(&env, &recipient) else {
            return false;
        };
        env.ledger().sequence() >= schedule.cliff_ledger
    }

    /// Returns the current [`StreamStatus`] for `recipient`.
    pub fn get_status(env: Env, recipient: Address) -> Option<StreamStatus> {
        let schedule = storage::get_schedule_readonly(&env, &recipient)?;
        let current = env.ledger().sequence();
        let status = if current < schedule.cliff_ledger {
            StreamStatus::PreCliff
        } else if current < schedule.end_ledger {
            StreamStatus::Active
        } else {
            StreamStatus::Completed
        };
        Some(status)
    }

    /// Returns consolidated statistics for `recipient`'s fixed-rate vesting stream.
    pub fn get_stats(env: Env, recipient: Address) -> Option<StreamStats> {
        let schedule = storage::get_schedule_readonly(&env, &recipient)?;

        let total_duration = (schedule.end_ledger - schedule.start_ledger) as i128;
        let total_deposited = schedule.rate_per_ledger * total_duration;
        let total_claimed = schedule.total_claimed;
        let remaining = total_deposited - total_claimed;

        let claimable_now = {
            let current = env.ledger().sequence();
            if current < schedule.cliff_ledger {
                0
            } else if current >= schedule.end_ledger {
                total_deposited - schedule.claimed_amount
            } else {
                let active_end = current.min(schedule.end_ledger);
                let ledgers = active_end - schedule.last_claimed_ledger;
                ledgers as i128 * schedule.rate_per_ledger
            }
        };

        Some(StreamStats {
            total_deposited,
            total_claimed,
            remaining,
            claimable_now,
        })
    }

    // ── Emergency Drain ───────────────────────────────────────────────────────

    /// Recovers unclaimed tokens from an expired stream after a long safety delay.
    ///
    /// # Errors
    /// * `ScheduleNotFound`     – No stream exists for `recipient`.
    /// * `StreamNotExpired`     – `end_ledger` has not yet been reached.
    /// * `DrainDelayNotExpired` – The 1-year delay after `end_ledger` has not passed.
    pub fn emergency_drain(
        env: Env,
        sponsor: Address,
        recipient: Address,
    ) -> Result<(), VestingError> {
        sponsor.require_auth();

        let schedule =
            storage::get_schedule(&env, &recipient).ok_or(VestingError::ScheduleNotFound)?;

        let current = env.ledger().sequence();

        if current < schedule.end_ledger {
            return Err(VestingError::StreamNotExpired);
        }

        let drain_available_at = schedule.end_ledger.saturating_add(DRAIN_DELAY_LEDGERS);
        if current < drain_available_at {
            return Err(VestingError::DrainDelayNotExpired);
        }

        let total_deposited =
            (schedule.end_ledger - schedule.start_ledger) as i128 * schedule.rate_per_ledger;
        let amount = total_deposited - schedule.claimed_amount;

        if amount > 0 {
            let token_client = token::Client::new(&env, &schedule.token);
            token_client
                .try_transfer(&env.current_contract_address(), &sponsor, &amount)
                .map_err(|_| VestingError::TransferFailed)?;
        }

        storage::remove_schedule(&env, &recipient);
        events::emit_emergency_drain(&env, &recipient, &sponsor, amount);

        Ok(())
    }
}

// ── Free functions ────────────────────────────────────────────────────────────

/// Computes the full deposit for a fixed-rate stream.
///
/// The exact safe boundary is `rate <= i128::MAX / total_duration`; the
/// multiplication overflows immediately above that threshold.
pub fn calculate_total_deposit(rate: i128, total_duration: u32) -> Result<i128, VestingError> {
    rate.checked_mul(total_duration as i128)
        .ok_or(VestingError::DepositOverflow)
}

/// Computes the claimable amount for a variable-rate stream.
///
/// Iterates over `segments`, accumulating tokens from `from_ledger` up to
/// `to_ledger` (which should already be capped at `end_ledger` by the caller).
pub fn compute_variable_claimable(
    segments: &Vec<RateSegment>,
    from_ledger: u32,
    to_ledger: u32,
    start_ledger: u32,
) -> i128 {
    let mut total: i128 = 0;
    let mut seg_start = start_ledger;

    for i in 0..segments.len() {
        let seg = segments.get(i).unwrap();
        let seg_end = seg.end_ledger;

        // Clamp: the portion of this segment that overlaps [from_ledger, to_ledger]
        let overlap_start = from_ledger.max(seg_start);
        let overlap_end = to_ledger.min(seg_end);

        if overlap_end > overlap_start {
            let ledgers = (overlap_end - overlap_start) as i128;
            total += ledgers * seg.rate;
        }

        seg_start = seg_end;
        if seg_start >= to_ledger {
            break;
        }
    }

    total
}
