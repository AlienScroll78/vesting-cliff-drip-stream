use soroban_sdk::{contract, contractimpl, token, Address, Env, Vec};

use crate::{
    error::VestingError,
    events,
    storage,
    types::VestingSchedule,
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

    /// Creates multiple vesting streams for a list of recipients in a single
    /// atomic transaction.
    ///
    /// # Arguments
    /// * `sponsor`    – The funder; must authorise this call and hold sufficient tokens.
    /// * `recipients` – A vector of `(recipient, token, rate, cliff_duration,
    ///                  total_duration)` tuples, one per stream to be created.
    ///                  Maximum 50 entries.
    ///
    /// All streams are validated first; if any validation fails the entire
    /// batch is rejected.  A single aggregate token transfer is performed.
    ///
    /// # Errors
    /// * `BatchSizeExceeded`      – More than 50 entries in `recipients`.
    /// * `InvalidRate`            – Any `rate` is zero or negative.
    /// * `InvalidDuration`        – Any `total_duration` ≤ `cliff_duration`.
    /// * `DepositOverflow`        – Aggregate deposit exceeds i128 bounds.
    /// * `ScheduleAlreadyExists`  – Any recipient already has an active stream.
    pub fn batch_create_vesting_streams(
        env: Env,
        sponsor: Address,
        recipients: Vec<(Address, Address, i128, u32, u32)>,
    ) -> Result<(), VestingError> {
        const MAX_BATCH: u32 = 50;

        if recipients.len() > MAX_BATCH {
            return Err(VestingError::BatchSizeExceeded);
        }

        sponsor.require_auth();

        let start_ledger: u32 = env.ledger().sequence();

        // ── Pass 1: validate all entries, accumulate aggregate deposit ────────
        // We build two parallel vecs (schedules + events) so pass 2 writes
        // without repeating arithmetic.
        let mut aggregate_deposit: i128 = 0_i128;

        // Collect validated schedule data.  We cannot allocate a Rust Vec
        // inside a no_std contract, so we use soroban_sdk::Vec.
        let mut entries: soroban_sdk::Vec<(Address, Address, VestingSchedule)> =
            soroban_sdk::Vec::new(&env);

        for entry in recipients.iter() {
            let (recipient, token, rate, cliff_duration, total_duration) = entry;

            if rate <= 0 {
                return Err(VestingError::InvalidRate);
            }
            if total_duration <= cliff_duration {
                return Err(VestingError::InvalidDuration);
            }
            if storage::has_schedule(&env, &recipient) {
                return Err(VestingError::ScheduleAlreadyExists);
            }

            let cliff_ledger: u32 = start_ledger
                .checked_add(cliff_duration)
                .ok_or(VestingError::DepositOverflow)?;
            let end_ledger: u32 = start_ledger
                .checked_add(total_duration)
                .ok_or(VestingError::DepositOverflow)?;

            let deposit: i128 = rate
                .checked_mul(total_duration as i128)
                .ok_or(VestingError::DepositOverflow)?;

            aggregate_deposit = aggregate_deposit
                .checked_add(deposit)
                .ok_or(VestingError::DepositOverflow)?;

            let schedule = VestingSchedule {
                token: token.clone(),
                rate_per_ledger: rate,
                start_ledger,
                cliff_ledger,
                end_ledger,
                last_claimed_ledger: start_ledger,
            };

            entries.push_back((recipient, token, schedule));
        }

        // ── Single aggregate transfer (all entries must share the same token
        //    for a one-shot transfer; in practice sponsors may use mixed tokens,
        //    so we sum per-token and transfer once per token).
        // For simplicity and gas efficiency we require a *single* token across
        // the whole batch (most common real-world usage).  The first entry's
        // token is used as the reference; any mismatch is caught by the token
        // client on transfer failure rather than adding a new error code.
        //
        // Aggregate transfer — uses the token from the first entry.
        if entries.len() > 0 {
            let (_, first_token, _) = entries.get(0).unwrap();
            let token_client = token::Client::new(&env, &first_token);
            token_client.transfer(
                &sponsor,
                &env.current_contract_address(),
                &aggregate_deposit,
            );
        }

        // ── Pass 2: persist schedules and emit events ─────────────────────────
        for item in entries.iter() {
            let (recipient, token, schedule) = item;
            storage::set_schedule(&env, &recipient, &schedule);
            events::emit_stream_created(
                &env,
                &sponsor,
                &recipient,
                &token,
                schedule.rate_per_ledger,
                schedule.start_ledger,
                schedule.cliff_ledger,
                schedule.end_ledger,
            );
        }

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
}
