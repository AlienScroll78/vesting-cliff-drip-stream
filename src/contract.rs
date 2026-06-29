use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

use crate::{
    error::VestingError,
    events,
    storage,
    types::{StreamStatus, VestingSchedule},
};

/// ~1 year at ~5 s/ledger: 6 * 60 * 24 * 365 = 3_153_600 ledgers.
const DRAIN_DELAY_LEDGERS: u32 = 3_153_600;

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

#[contract]
pub struct VestingDrips;

#[contractimpl]
impl VestingDrips {
    // ── Admin / Sponsor ───────────────────────────────────────────────────────

    /// Creates a new cliff-vesting stream for `recipient`.
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
    /// * `InvalidRate`            – `rate` is zero or negative.
    /// * `InvalidDuration`        – `total_duration` ≤ `cliff_duration`.
    /// * `DepositOverflow`        – Total deposit exceeds i128 bounds.
    /// * `ScheduleAlreadyExists`  – A stream already exists for `recipient`.
    pub fn create_vesting_stream(
        env: Env,
        sponsor: Address,
        recipient: Address,
        token: Address,
        rate: i128,
        cliff_duration: u32,
        total_duration: u32,
    ) -> Result<(), VestingError> {
        // ── Validation ────────────────────────────────────────────────────────
        if rate <= 0 {
            return Err(VestingError::InvalidRate);
        }
        if total_duration <= cliff_duration {
            return Err(VestingError::InvalidDuration);
        }
        if storage::has_schedule(&env, &recipient) {
            return Err(VestingError::ScheduleAlreadyExists);
        }

        sponsor.require_auth();

        // ── Derive ledger heights ─────────────────────────────────────────────
        let start_ledger: u32 = env.ledger().sequence();
        let cliff_ledger: u32 = start_ledger
            .checked_add(cliff_duration)
            .ok_or(VestingError::DepositOverflow)?;
        let end_ledger: u32 = start_ledger
            .checked_add(total_duration)
            .ok_or(VestingError::DepositOverflow)?;

        // ── Calculate and transfer total deposit ──────────────────────────────
        let total_deposit: i128 = calculate_total_deposit(rate, total_duration)?;

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(
            &sponsor,
            &env.current_contract_address(),
            &total_deposit,
        );

        // ── Persist schedule ──────────────────────────────────────────────────
        let schedule = VestingSchedule {
            token: token.clone(),
            rate_per_ledger: rate,
            start_ledger,
            cliff_ledger,
            end_ledger,
            last_claimed_ledger: start_ledger,
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

        let schedule = storage::get_schedule(&env, &recipient)
            .ok_or(VestingError::ScheduleNotFound)?;

        let current_ledger = env.ledger().sequence();
        let token_client = token::Client::new(&env, &schedule.token);

        // Determine how much has already been earned (if cliff passed).
        let (recipient_share, sponsor_refund) =
            if current_ledger >= schedule.cliff_ledger {
                let active_end = current_ledger.min(schedule.end_ledger);
                let earned_ledgers = active_end - schedule.last_claimed_ledger;
                let earned = earned_ledgers as i128 * schedule.rate_per_ledger;

                // Remaining tokens not yet accrued go back to sponsor.
                let unclaimed_from_end = (schedule.end_ledger - active_end) as i128
                    * schedule.rate_per_ledger;
                (earned, unclaimed_from_end)
            } else {
                // Cliff not passed – full refund to sponsor.
                let total_remaining =
                    (schedule.end_ledger - schedule.last_claimed_ledger) as i128
                        * schedule.rate_per_ledger;
                (0_i128, total_remaining)
            };

        storage::remove_schedule(&env, &recipient);

        if recipient_share > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &recipient,
                &recipient_share,
            );
        }
        if sponsor_refund > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &sponsor,
                &sponsor_refund,
            );
        }

        events::emit_stream_cancelled(&env, &recipient, sponsor_refund);

        Ok(())
    }

    // ── Recipient ─────────────────────────────────────────────────────────────

    /// Claims all vested tokens accrued since the last claim.
    ///
    /// The cliff must have been reached before any tokens can be withdrawn.
    /// On first claim after the cliff, all tokens accrued from `start_ledger`
    /// are released in a single transfer, then streaming continues linearly.
    ///
    /// # Errors
    /// * `ScheduleNotFound` – No stream exists for `recipient`.
    /// * `CliffNotReached`  – Current ledger < `cliff_ledger`.
    /// * `NothingToClaim`   – Claimable amount is zero.
    pub fn claim_vested(env: Env, recipient: Address) -> Result<i128, VestingError> {
        recipient.require_auth();

        let mut schedule = storage::get_schedule(&env, &recipient)
            .ok_or(VestingError::ScheduleNotFound)?;

        let current_ledger = env.ledger().sequence();

        if current_ledger < schedule.cliff_ledger {
            return Err(VestingError::CliffNotReached);
        }

        // Cap at the stream's end ledger to avoid over-paying.
        let active_end = current_ledger.min(schedule.end_ledger);
        let claimable_ledgers = active_end - schedule.last_claimed_ledger;
        let claimable_amount = claimable_ledgers as i128 * schedule.rate_per_ledger;

        if claimable_amount == 0 {
            return Err(VestingError::NothingToClaim);
        }

        // Update or remove the schedule.
        schedule.last_claimed_ledger = active_end;
        let stream_finished = active_end == schedule.end_ledger;

        if stream_finished {
            storage::remove_schedule(&env, &recipient);
            events::emit_stream_completed(&env, &recipient, &schedule.token);
        } else {
            storage::set_schedule(&env, &recipient, &schedule);
        }

        // Transfer tokens to recipient.
        let token_client = token::Client::new(&env, &schedule.token);
        token_client.transfer(
            &env.current_contract_address(),
            &recipient,
            &claimable_amount,
        );

        events::emit_tokens_claimed(&env, &recipient, claimable_amount, active_end);

        Ok(claimable_amount)
    }

    // ── Read-only views ───────────────────────────────────────────────────────

    /// Returns the full `VestingSchedule` for `recipient`, or `None`.
    pub fn get_schedule(
        env: Env,
        recipient: Address,
    ) -> Option<VestingSchedule> {
        storage::get_schedule(&env, &recipient)
    }

    /// Returns the number of tokens currently claimable by `recipient`.
    ///
    /// Returns `0` if the cliff has not been reached or no schedule exists.
    pub fn claimable_amount(env: Env, recipient: Address) -> i128 {
        let Some(schedule) = storage::get_schedule(&env, &recipient) else {
            return 0;
        };
        let current_ledger = env.ledger().sequence();
        if current_ledger < schedule.cliff_ledger {
            return 0;
        }
        let active_end = current_ledger.min(schedule.end_ledger);
        let claimable_ledgers = active_end - schedule.last_claimed_ledger;
        claimable_ledgers as i128 * schedule.rate_per_ledger
    }

    /// Returns `true` if the cliff has been passed for `recipient`.
    pub fn is_cliff_passed(env: Env, recipient: Address) -> bool {
        let Some(schedule) = storage::get_schedule(&env, &recipient) else {
            return false;
        };
        env.ledger().sequence() >= schedule.cliff_ledger
    }

    /// Returns the current [`StreamStatus`] for `recipient`.
    ///
    /// Returns `None` when no schedule exists (stream was never created
    /// or has already been cancelled/completed and removed from storage).
    /// Use the returned variant to drive badge colour in UI components.
    pub fn get_status(env: Env, recipient: Address) -> Option<StreamStatus> {
        let schedule = storage::get_schedule(&env, &recipient)?;
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

    // ── Emergency Drain (Issue #22) ───────────────────────────────────────────

    /// Recovers unclaimed tokens from an expired stream after a long safety delay.
    ///
    /// If a recipient's keys are permanently lost, tokens would otherwise be locked
    /// forever once `end_ledger` is reached. This function lets the original sponsor
    /// reclaim those tokens, but only after `end_ledger + DRAIN_DELAY_LEDGERS`
    /// (~1 year) has elapsed to prevent abuse.
    ///
    /// # Errors
    /// * `ScheduleNotFound`    – No stream exists for `recipient`.
    /// * `StreamNotExpired`    – `end_ledger` has not yet been reached.
    /// * `DrainDelayNotExpired`– The 1-year delay after `end_ledger` has not passed.
    pub fn emergency_drain(
        env: Env,
        sponsor: Address,
        recipient: Address,
    ) -> Result<(), VestingError> {
        sponsor.require_auth();

        let schedule = storage::get_schedule(&env, &recipient)
            .ok_or(VestingError::ScheduleNotFound)?;

        let current = env.ledger().sequence();

        if current < schedule.end_ledger {
            return Err(VestingError::StreamNotExpired);
        }

        let drain_available_at = schedule
            .end_ledger
            .saturating_add(DRAIN_DELAY_LEDGERS);
        if current < drain_available_at {
            return Err(VestingError::DrainDelayNotExpired);
        }

        // Any unclaimed remainder: full remaining balance from last_claimed_ledger.
        let amount = (schedule.end_ledger - schedule.last_claimed_ledger) as i128
            * schedule.rate_per_ledger;

        storage::remove_schedule(&env, &recipient);

        if amount > 0 {
            let token_client = token::Client::new(&env, &schedule.token);
            token_client.transfer(&env.current_contract_address(), &sponsor, &amount);
        }

        events::emit_emergency_drain(&env, &recipient, &sponsor, amount);

        Ok(())
    }

    // ── Stream Stats (Issue #24) ──────────────────────────────────────────────

    /// Returns consolidated statistics for `recipient`'s vesting stream.
    ///
    /// All four fields are mathematically consistent: `total_deposited ==
    /// total_claimed + remaining`, and `claimable_now <= remaining`.
    ///
    /// Returns `None` when no schedule exists.
    pub fn get_stats(env: Env, recipient: Address) -> Option<StreamStats> {
        let schedule = storage::get_schedule(&env, &recipient)?;

        let total_duration =
            (schedule.end_ledger - schedule.start_ledger) as i128;
        let total_deposited = schedule.rate_per_ledger * total_duration;

        let claimed_ledgers =
            (schedule.last_claimed_ledger - schedule.start_ledger) as i128;
        let total_claimed = schedule.rate_per_ledger * claimed_ledgers;

        let remaining = total_deposited - total_claimed;

        let claimable_now = {
            let current = env.ledger().sequence();
            if current < schedule.cliff_ledger {
                0
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
}
}
/// Computes the full deposit for a stream.
///
/// The exact safe boundary is `rate <= i128::MAX / total_duration`; the
/// multiplication overflows immediately above that threshold.
pub(crate) fn calculate_total_deposit(
    rate: i128,
    total_duration: u32,
) -> Result<i128, VestingError> {
    rate.checked_mul(total_duration as i128)
        .ok_or(VestingError::DepositOverflow)
}
