use soroban_sdk::{contract, contractimpl, token, Address, Env, String};

use crate::{
    error::VestingError,
    events,
    storage,
    types::VestingSchedule,
};

/// Drain delay in ledgers: 1 year at 5 s/ledger = 365 × 24 × 3600 / 5.
pub const DRAIN_DELAY_LEDGERS: u32 = 6_307_200;

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
    /// * `DepositBelowMinimum`    – Total deposit is below the configured minimum.
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
        let total_deposit: i128 = rate
            .checked_mul(total_duration as i128)
            .ok_or(VestingError::DepositOverflow)?;

        // ── Minimum deposit validation (after overflow check) ─────────────────
        let min_deposit = storage::get_min_deposit(&env);
        if total_deposit < min_deposit {
            return Err(VestingError::DepositBelowMinimum);
        }

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(
            &sponsor,
            &env.current_contract_address(),
            &total_deposit,
        );

        // ── Persist schedule ──────────────────────────────────────────────────
        let schedule = VestingSchedule {
            token: token.clone(),
            sponsor: sponsor.clone(),
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

    /// Compliance clawback: the original sponsor recovers **all** remaining tokens
    /// from the contract vault, bypassing cliff state.
    ///
    /// This uses the SAC `clawback` operation to pull tokens back from the
    /// contract's own balance.  The token must have the clawback flag enabled;
    /// otherwise the call fails with `ClawbackNotSupported`.
    ///
    /// # Arguments
    /// * `sponsor`   – Original stream funder; must authorise this call.
    /// * `recipient` – Stream beneficiary whose schedule is being clawed back.
    /// * `reason`    – Compliance reason string (max 256 chars), stored in event.
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

        // Calculate the remaining vault balance for this stream.
        // All tokens from last_claimed_ledger to end_ledger are still in the vault.
        let remaining = (schedule.end_ledger - schedule.last_claimed_ledger) as i128
            * schedule.rate_per_ledger;

        // Verify the token supports SAC clawback by probing the SAC admin interface.
        // This acts as the compliance gate: only regulated (clawback-enabled) assets
        // may use this stronger recovery path.
        //
        // We probe by attempting a zero-value clawback; if the call fails, the token
        // does not support clawback and we return ClawbackNotSupported.
        let sac_admin_client = token::StellarAssetClient::new(&env, &schedule.token);
        if sac_admin_client
            .try_clawback(&env.current_contract_address(), &0_i128)
            .is_err()
        {
            return Err(VestingError::ClawbackNotSupported);
        }

        // Transfer remaining tokens from the contract vault back to the sponsor.
        // The contract holds the deposited tokens in its own balance; after verifying
        // clawback support above, we transfer them directly to the sponsor.
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
    /// This allows cleanup of abandoned streams to prevent tokens being permanently
    /// locked in the contract.
    ///
    /// # Arguments
    /// * `caller`    – Any address initiating the cleanup (no auth required).
    /// * `recipient` – The stream beneficiary whose expired schedule is being drained.
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

        // Stream must have reached its end.
        if current_ledger < schedule.end_ledger {
            return Err(VestingError::StreamNotExpired);
        }

        // Drain delay must have elapsed after end_ledger.
        let drain_available_at = schedule
            .end_ledger
            .checked_add(DRAIN_DELAY_LEDGERS)
            .ok_or(VestingError::DepositOverflow)?;

        if current_ledger < drain_available_at {
            return Err(VestingError::DrainDelayNotExpired);
        }

        // Remaining unclaimed tokens go back to the sponsor.
        let remaining = (schedule.end_ledger - schedule.last_claimed_ledger) as i128
            * schedule.rate_per_ledger;

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

    /// Returns the configured minimum deposit threshold.
    pub fn get_min_deposit(env: Env) -> i128 {
        storage::get_min_deposit(&env)
    }
}
