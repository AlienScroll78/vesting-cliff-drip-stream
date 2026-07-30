use soroban_sdk::{contract, contractimpl, token, Address, Env};

use crate::{
    error::VestingError,
    events,
    storage::{self, ContractConfig},
    types::{StreamInfo, VestingSchedule},
};

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

        // Guard against zero, negative values, and i128::MIN (which would pass
        // a simple `<= 0` check after negation in some overflow scenarios).
        if rate <= 0 || rate == i128::MIN {
            return Err(VestingError::InvalidRate);
        }
        if total_duration <= cliff_duration {
            return Err(VestingError::InvalidDuration);
        }
        // Duplicate check before auth so we fail cheaply before any storage read
        // that could be used to probe schedule existence without paying auth.
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
        let total_deposit: i128 = rate
            .checked_mul(total_duration as i128)
            .ok_or(VestingError::DepositOverflow)?;

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
            total_deposit,
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

        // Emit enriched cancel event that includes sponsor identity and both
        // split amounts so off-chain monitors can reconstruct the full picture.
        events::emit_stream_cancelled(
            &env,
            &sponsor,
            &recipient,
            sponsor_refund,
            recipient_share,
        );

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

    /// Returns a detailed analytics snapshot for `recipient`'s stream.
    ///
    /// Includes total deposit, amount claimed, amount claimable now, remaining
    /// locked tokens, vested percentage in basis points, and status flags.
    ///
    /// Returns `None` if no active schedule exists for `recipient`.
    pub fn get_stream_info(env: Env, recipient: Address) -> Option<StreamInfo> {
        let schedule = storage::get_schedule(&env, &recipient)?;

        let current_ledger = env.ledger().sequence();
        let stream_duration = schedule.end_ledger - schedule.start_ledger;
        let total_deposit = schedule.rate_per_ledger * stream_duration as i128;

        let claimed_so_far =
            schedule.rate_per_ledger * (schedule.last_claimed_ledger - schedule.start_ledger) as i128;

        let cliff_reached = current_ledger >= schedule.cliff_ledger;
        let stream_ended = current_ledger >= schedule.end_ledger;

        let claimable_now = if cliff_reached {
            let active_end = current_ledger.min(schedule.end_ledger);
            let ledgers = active_end - schedule.last_claimed_ledger;
            ledgers as i128 * schedule.rate_per_ledger
        } else {
            0
        };

        let remaining_locked = total_deposit - claimed_so_far - claimable_now;

        // Basis points: (claimed_so_far * 10_000) / total_deposit.
        // Guard against zero total_deposit (should never happen with valid rate).
        let percent_vested_bps = if total_deposit > 0 {
            ((claimed_so_far * 10_000) / total_deposit) as u32
        } else {
            0
        };

        Some(StreamInfo {
            total_deposit,
            claimed_so_far,
            claimable_now,
            remaining_locked,
            percent_vested_bps,
            cliff_reached,
            stream_ended,
        })
    }

    /// Returns the compiled-in contract configuration (TTL thresholds).
    ///
    /// Useful for off-chain tooling that needs to know storage expiry parameters
    /// without reading the source code or WASM binary.
    pub fn get_config(_env: Env) -> ContractConfig {
        storage::get_config()
    }
}
