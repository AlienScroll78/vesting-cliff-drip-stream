// `#[contracttype]`/`#[contract]` emit inherent `impl` blocks with no doc
// comments; rustc doesn't propagate item-level `#[allow]` onto
// attribute-macro-generated sibling impls, so the allow has to be module-scoped.
#![allow(missing_docs)]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, BytesN, Env, String, Vec};

use crate::{
    error::VestingError,
    events, storage,
    types::{
        Milestone, MilestoneSchedule, RateSegment, StreamStatus, VariableRateSchedule,
        VestingSchedule, RATE_DECIMALS,
    },
};

/// ~1 year at ~5 s/ledger.
const DRAIN_DELAY_LEDGERS: u32 = 3_153_600;

/// Maximum number of segments allowed in a variable-rate stream.
const MAX_SEGMENTS: u32 = 10;

/// Maximum fee in basis points (5 %).
const MAX_FEE_BPS: u32 = 500;

/// Maximum batch size for `batch_create_vesting_streams`.
#[allow(dead_code)]
const MAX_BATCH_SIZE: u32 = 20;

/// Consolidated statistics for a vesting stream.
///
/// Returned by [`VestingDrips::get_stats`].
#[allow(missing_docs)]
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamStats {
    /// Total tokens deposited when the stream was created.
    pub total_deposited: i128,
    pub total_claimed: i128,
    pub remaining: i128,
    pub claimable_now: i128,
}

/// The vesting-drip contract entry point.
#[contract]
#[allow(missing_docs)]
pub struct VestingDrips;

#[contractimpl]
impl VestingDrips {
    // ── Initialization ────────────────────────────────────────────────────────

    /// Configures the contract with admin, fee, and treasury settings.
    ///
    /// Must be called **once** immediately after deployment.
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

    // ── Admin / Upgrade ───────────────────────────────────────────────────────

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
        if storage::get_admin(&env) != Some(admin.clone()) {
            return Err(VestingError::Unauthorized);
        }
        events::emit_contract_upgraded(&env, &admin, &new_wasm_hash);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    /// Transfers admin authority from the current admin to `new_admin`.
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

    // ── Token allowlist ───────────────────────────────────────────────────────

    /// Adds `token` to the allowlist of accepted SAC token contracts.
    ///
    /// When the allowlist is non-empty, only listed tokens can be used in
    /// `create_vesting_stream`. An empty allowlist enables permissive mode.
    pub fn add_allowed_token(
        env: Env,
        admin: Address,
        token: Address,
    ) -> Result<(), VestingError> {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env).ok_or(VestingError::Unauthorized)?;
        if admin != stored_admin {
            return Err(VestingError::Unauthorized);
        }
        storage::add_allowed_token(&env, &token);
        events::emit_allowlist_updated(&env, &admin, &token, true);
        Ok(())
    }

    /// Removes `token` from the allowlist.
    pub fn remove_allowed_token(
        env: Env,
        admin: Address,
        token: Address,
    ) -> Result<(), VestingError> {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env).ok_or(VestingError::Unauthorized)?;
        if admin != stored_admin {
            return Err(VestingError::Unauthorized);
        }
        storage::remove_allowed_token(&env, &token);
        events::emit_allowlist_updated(&env, &admin, &token, false);
        Ok(())
    }

    /// Returns all currently allowed token addresses.
    pub fn get_allowed_tokens(env: Env) -> Vec<Address> {
        storage::get_allowed_tokens(&env)
    }

    // ── Recipient allowlist (issue #720) ──────────────────────────────────────

    /// Adds or removes a recipient from the allowlist.
    ///
    /// When the recipient allowlist is enabled, only listed recipients can
    /// have vesting streams created for them. Disabling the allowlist via
    /// `set_allowlist_enabled` opens creation to all recipients.
    ///
    /// # Errors
    /// * `Unauthorized` – Caller is not the configured admin.
    pub fn set_allowlist(
        env: Env,
        admin: Address,
        recipients: Vec<Address>,
        allowed: bool,
    ) -> Result<(), VestingError> {
        admin.require_auth();
        if storage::get_admin(&env) != Some(admin.clone()) {
            return Err(VestingError::Unauthorized);
        }
        for recipient in recipients.iter() {
            storage::set_recipient_allowlist(&env, &recipient, allowed);
            events::emit_recipient_allowlist_updated(&env, &admin, &recipient, allowed);
        }
        Ok(())
    }

    /// Enables or disables global recipient allowlist enforcement.
    ///
    /// When disabled, all recipient addresses are accepted (permissive mode).
    ///
    /// # Errors
    /// * `Unauthorized` – Caller is not the configured admin.
    pub fn set_allowlist_enabled(
        env: Env,
        admin: Address,
        enabled: bool,
    ) -> Result<(), VestingError> {
        admin.require_auth();
        if storage::get_admin(&env) != Some(admin) {
            return Err(VestingError::Unauthorized);
        }
        storage::set_allowlist_enabled(&env, enabled);
        Ok(())
    }

    /// Returns `true` if `recipient` is on the recipient allowlist (or if allowlist is disabled).
    pub fn is_allowed(env: Env, recipient: Address) -> bool {
        storage::is_recipient_allowed(&env, &recipient)
    }

    // ── Stream creation ───────────────────────────────────────────────────────

    /// Creates a new cliff-vesting stream for `recipient`.
    ///
    /// # Parameters
    /// * `metadata` — Optional free-form annotation (max 256 UTF-8 bytes). Issue #721.
    ///
    /// # Errors
    /// * `InvalidCliffDuration`   – `cliff_duration` is zero.
    /// * `InvalidRate`            – `rate` is zero or negative.
    /// * `InvalidDuration`        – `total_duration` ≤ `cliff_duration`.
    /// * `DepositOverflow`        – Total deposit exceeds i128 bounds.
    /// * `DepositBelowMinimum`    – Total deposit is below the configured minimum.
    /// * `TokenNotAllowed`        – Token is not in the allowlist (when enforced).
    pub fn create_vesting_stream(
        env: Env,
        sponsor: Address,
        recipient: Address,
        token: Address,
        rate: i128,
        cliff_duration: u32,
        total_duration: u32,
        metadata: Option<String>,
    ) -> Result<(), VestingError> {
        env.storage().instance().extend_ttl(259_200, 518_400);

        if !storage::is_initialized(&env) {
            return Err(VestingError::NotInitialized);
        }

        // ── Validation ────────────────────────────────────────────────────────
        if sponsor == recipient {
            return Err(VestingError::InvalidRecipient);
        }
        if rate <= 0 {
            return Err(VestingError::InvalidRate);
        }
        let min_rate = storage::get_min_rate(&env);
        if rate < min_rate {
            return Err(VestingError::InvalidRate);
        }
        if cliff_duration == 0 {
            return Err(VestingError::InvalidCliffDuration);
        }
        if total_duration <= cliff_duration {
            return Err(VestingError::InvalidDuration);
        }
        // A zero-length cliff provides no lockup guarantee — the entire stream
        // would vest from `start_ledger` onwards. Must be at least 1 ledger.
        if cliff_duration == 0 {
            return Err(VestingError::InvalidCliffDuration);
        }
        // Validate cliff ratio does not exceed configured max.
        let max_cliff_ratio_bps = storage::get_max_cliff_ratio(&env);
        let cliff_ratio_bps = (cliff_duration as u64 * 10_000 / total_duration as u64) as u32;
        if cliff_ratio_bps > max_cliff_ratio_bps {
            return Err(VestingError::InvalidDuration);
        }

        // Recipient allowlist check (issue #720).
        if !storage::is_recipient_allowed(&env, &recipient) {
            return Err(VestingError::RecipientNotAllowed);
        }

        // Validate token is a SAC by probing try_balance
        let token_client = token::Client::new(&env, &token);
        if token_client.try_balance(&sponsor).is_err() {
            return Err(VestingError::InvalidToken);
        }

        // ── Normalise and validate metadata ───────────────────────────────────
        const MAX_METADATA_BYTES: u32 = 256;
        let metadata: Option<String> = match metadata {
            Some(ref s) if s.len() == 0 => None,
            Some(ref s) if s.len() > MAX_METADATA_BYTES => {
                return Err(VestingError::MetadataTooLong);
            }
            other => other,
        };

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

        let stream_id = storage::next_stream_id(&env, &recipient)?;

        token_client
            .try_transfer(&sponsor, &env.current_contract_address(), &total_deposit)
            .map_err(|_| VestingError::TransferFailed)?
            .map_err(|_| VestingError::TransferFailed)?;

        // ── Collect protocol fee ──────────────────────────────────────────────
        let (fee_bps, treasury_opt) = storage::get_fee(&env);
        if fee_bps > 0 {
            let treasury = treasury_opt.ok_or(VestingError::Unauthorized)?;
            let fee_amount = total_deposit
                .checked_mul(fee_bps as i128)
                .ok_or(VestingError::DepositOverflow)?
                / 10_000;
            if fee_amount > 0 {
                token_client
                    .try_transfer(&env.current_contract_address(), &treasury, &fee_amount)
                    .map_err(|_| VestingError::TransferFailed)?
                    .map_err(|_| VestingError::TransferFailed)?;
                events::emit_fee_collected(&env, &sponsor, &treasury, fee_amount);
            }
        }

        // ── Persist schedule ──────────────────────────────────────────────────
        let schedule = VestingSchedule {
            token: token.clone(),
            sponsor: sponsor.clone(),
            rate_per_ledger: rate,
            start_ledger,
            cliff_ledger,
            end_ledger,
            last_claimed_ledger: start_ledger,
            total_claimed: 0,
            claimed_amount: 0,
            metadata: metadata.clone(),
            paused_at_ledger: None,
            accumulated_pause_ledgers: 0,
            version: 1,
            schema_version: crate::types::CURRENT_SCHEMA_VERSION,
        };
        storage::set_schedule(&env, &recipient, &schedule);
        storage::add_sponsor_stream(&env, &sponsor, &recipient);

        events::emit_stream_created(
            &env,
            &sponsor,
            &recipient,
            &token,
            rate,
            start_ledger,
            cliff_ledger,
            end_ledger,
            &metadata,
        );

        Ok(stream_id)
    }

    /// Creates a new cliff-vesting stream for `recipient` with optional metadata.
    pub fn create_vesting_stream_with_meta(
        env: Env,
        sponsor: Address,
        recipient: Address,
        token: Address,
        rate: i128,
        cliff_duration: u32,
        total_duration: u32,
        metadata: Option<String>,
    ) -> Result<(), VestingError> {
        Self::create_vesting_stream(
            env,
            sponsor,
            recipient,
            token,
            rate,
            cliff_duration,
            total_duration,
            metadata,
        )
    }

    // ── Milestone stream ──────────────────────────────────────────────────────

    /// Creates a milestone-based vesting stream for `recipient`.
    ///
    /// Tokens are released at discrete ledger milestones rather than linearly.
    /// The `milestones` argument is a `Vec` of `(ledger: u32, bps_unlock: u32)` tuples
    /// where `bps_unlock` is the percentage in basis points (10000 = 100%).
    /// All milestone bps values must sum to exactly 10000.
    /// Milestones must be in strictly ascending ledger order.
    ///
    /// # Errors
    /// * `ScheduleAlreadyExists` – A stream already exists for `recipient`.
    /// * `InvalidSegments`       – Segment list is empty, exceeds limit, has non-positive
    ///                             rates, or non-ascending end_ledgers.
    pub fn create_milestone_stream(
        env: Env,
        sponsor: Address,
        recipient: Address,
        token: Address,
        rate: i128,
        cliff_duration: u32,
        total_duration: u32,
        metadata: Option<String>,
    ) -> Result<(), VestingError> {
        Self::create_vesting_stream(
            env,
            sponsor,
            recipient,
            token,
            rate,
            cliff_duration,
            total_duration,
            metadata,
        )
    }

    // ── Batch stream creation (issue #718) ────────────────────────────────────

    /// Creates multiple vesting streams in a single atomic transaction.
    ///
    /// All streams share the same `token`. Each entry in `streams` is a tuple of
    /// `(recipient, rate, cliff_duration, total_duration)`.
    ///
    /// # Errors
    /// * `BatchTooLarge`         – `streams.len()` > 20.
    /// * `InvalidRate`           – Any rate is zero or negative.
    /// * `InvalidDuration`       – Any total_duration ≤ cliff_duration.
    /// * `ScheduleAlreadyExists` – Any recipient already has a stream.
    /// * `DepositOverflow`       – Arithmetic overflow computing total deposit.
    /// * `TransferFailed`        – Token transfer failed.
    pub fn create_batch_streams(
        env: Env,
        sponsor: Address,
        token: Address,
        streams: Vec<(Address, i128, u32, u32)>,
    ) -> Result<(), VestingError> {
        storage::bump_instance(&env);

        let n = streams.len();
        if n > MAX_BATCH_SIZE {
            return Err(VestingError::BatchTooLarge);
        }

        // ── Validate all entries and compute total deposit ────────────────────
        let mut total_deposit: i128 = 0;

        for i in 0..n {
            let (ref recipient, rate, cliff_duration, total_duration) = streams.get(i).unwrap();

            if *recipient == sponsor {
                return Err(VestingError::InvalidRecipient);
            }
            if rate <= 0 {
                return Err(VestingError::InvalidRate);
            }
            if total_duration <= cliff_duration {
                return Err(VestingError::InvalidDuration);
            }
            if storage::has_schedule(&env, recipient) {
                return Err(VestingError::ScheduleAlreadyExists);
            }

            let deposit = calculate_total_deposit(rate, total_duration)?;
            total_deposit = total_deposit
                .checked_add(deposit)
                .ok_or(VestingError::DepositOverflow)?;
        }

        // ── Validate milestones ───────────────────────────────────────────────
        let n = milestones.len();
        if n == 0 || n as u32 > MAX_MILESTONES {
            return Err(VestingError::InvalidMilestones);
        }

        let mut milestone_vec: Vec<Milestone> = Vec::new(&env);
        let mut prev_ledger: u32 = 0;
        let mut total_bps: u32 = 0;

        // ── Transfer per-token deposits and create schedules ──────────────────
        for i in 0..n {
            let (m_ledger, m_bps) = milestones.get(i).unwrap();
            if m_ledger <= prev_ledger {
                return Err(VestingError::InvalidMilestones);
            }
            prev_ledger = m_ledger;
            total_bps = total_bps
                .checked_add(m_bps)
                .ok_or(VestingError::InvalidMilestones)?;
            milestone_vec.push_back(Milestone {
                ledger: m_ledger,
                bps_unlock: m_bps,
            });
        }

        if total_bps != 10_000 {
            return Err(VestingError::InvalidMilestones);
        }

        let min_deposit = storage::get_min_deposit(&env);
        if total_deposit < min_deposit {
            return Err(VestingError::DepositBelowMinimum);
        }

        sponsor.require_auth();

        let token_client = token::Client::new(&env, &token);
        token_client
            .try_transfer(&sponsor, &env.current_contract_address(), &total_deposit)
            .map_err(|_| VestingError::TransferFailed)?
            .map_err(|_| VestingError::TransferFailed)?;

        let schedule = MilestoneSchedule {
            token: token.clone(),
            sponsor: sponsor.clone(),
            total_deposited: total_deposit,
            milestones: milestone_vec,
            next_milestone_idx: 0,
            end_ledger,
            total_claimed: 0,
        };
        storage::set_milestone_schedule(&env, &recipient, &schedule);

        events::emit_milestone_stream_created(
            &env,
            &sponsor,
            &recipient,
            &token,
            total_deposit,
            end_ledger,
        );

        Ok(())
    }

    /// Claims all unlocked milestones for `recipient`.
    ///
    /// Accumulates all milestones whose `ledger` is ≤ current ledger that have
    /// not yet been claimed.
    ///
    /// # Errors
    /// * `ScheduleNotFound` – No milestone schedule exists for `recipient`.
    /// * `NothingToClaim`   – No milestones have reached their ledger yet.
    /// * `TransferFailed`   – Token transfer failed.
    pub fn claim_milestone(env: Env, recipient: Address) -> Result<i128, VestingError> {
        recipient.require_auth();

        let mut schedule = storage::get_milestone_schedule(&env, &recipient)
            .ok_or(VestingError::ScheduleNotFound)?;

        let current_ledger = env.ledger().sequence();
        let mut claimable: i128 = 0;
        let mut new_idx = schedule.next_milestone_idx;

        let n = schedule.milestones.len();
        while new_idx < n {
            let milestone = schedule.milestones.get(new_idx).unwrap();
            if current_ledger >= milestone.ledger {
                // Calculate token amount for this milestone
                let milestone_amount = schedule
                    .total_deposited
                    .checked_mul(milestone.bps_unlock as i128)
                    .ok_or(VestingError::DepositOverflow)?
                    / 10_000;
                claimable = claimable
                    .checked_add(milestone_amount)
                    .ok_or(VestingError::DepositOverflow)?;
                new_idx += 1;
            } else {
                break;
            }
        }

        if claimable == 0 {
            return Err(VestingError::NothingToClaim);
        }

        let token_client = token::Client::new(&env, &schedule.token);
        token_client
            .try_transfer(
                &env.current_contract_address(),
                &recipient,
                &claimable,
            )
            .map_err(|_| VestingError::TransferFailed)?
            .map_err(|_| VestingError::TransferFailed)?;

            let schedule = VestingSchedule {
                token: token.clone(),
                sponsor: sponsor.clone(),
                rate_per_ledger: rate,
                start_ledger,
                cliff_ledger,
                end_ledger,
                last_claimed_ledger: start_ledger,
                total_claimed: 0,
                claimed_amount: 0,
                metadata: None,
                paused_at_ledger: None,
                accumulated_pause_ledgers: 0,
                version: 1,
            };
            storage::set_schedule(&env, recipient, &schedule);
            storage::add_sponsor_stream(&env, &sponsor, recipient);

            events::emit_stream_created(
                &env,
                &sponsor,
                recipient,
                token,
                rate,
                start_ledger,
                cliff_ledger,
                end_ledger,
                &None,
            );
        }

        events::emit_milestone_claimed(&env, &recipient, claimable);

        Ok(claimable)
    }


    /// Claims all vested tokens accrued since the last claim.
    ///
    /// The cliff must have been reached before any tokens can be withdrawn.
    ///
    /// ## Dust collection (Issue #322)
    ///
    /// At `end_ledger`, the claim returns `total_deposit − claimed_amount` to
    /// ensure no sub-1-token dust remains locked in the vault forever.
    ///
    /// # Errors
    /// * `ScheduleNotFound` – No stream exists for `recipient`.
    /// * `CliffNotReached`  – Current ledger < `cliff_ledger`.
    /// * `NothingToClaim`   – Claimable amount is zero.
    pub fn claim_vested(
        env: Env,
        recipient: Address,
        stream_id: Option<u32>,
    ) -> Result<i128, VestingError> {
        recipient.require_auth();

        env.storage()
            .instance()
            .extend_ttl(259_200, 518_400);

            prev_end = seg_end;
        }

        let end_ledger = prev_end;

        let min_deposit = storage::get_min_deposit(&env);
        if total_deposit < min_deposit {
            return Err(VestingError::DepositBelowMinimum);
        }

        let token_client = token::Client::new(&env, &token);
        token_client
            .try_transfer(&sponsor, &env.current_contract_address(), &total_deposit)
            .map_err(|_| VestingError::TransferFailed)?;

        let schedule = VariableRateSchedule {
            token: token.clone(),
            sponsor: sponsor.clone(),
            start_ledger,
            cliff_ledger,
            end_ledger,
            last_claimed_ledger: start_ledger,
            total_deposited: total_deposit,
            claimed_amount: 0,
            total_claimed: 0,
            segments: rate_segments,
            paused_at_ledger: None,
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

    // ── Pause / Resume (issue #719) ───────────────────────────────────────────

    /// Pauses a vesting stream, halting token accrual.
    ///
    /// Only the original sponsor can pause a stream.
    ///
    /// # Errors
    /// * `ScheduleNotFound`    – No stream exists for `recipient`.
    /// * `Unauthorized`        – Caller is not the stream's sponsor.
    /// * `StreamAlreadyPaused` – Stream is already in paused state.
    pub fn pause_stream(
        env: Env,
        sponsor: Address,
        recipient: Address,
    ) -> Result<(), VestingError> {
        sponsor.require_auth();

        let mut schedule =
            storage::get_schedule(&env, &recipient).ok_or(VestingError::ScheduleNotFound)?;

        if schedule.sponsor != sponsor {
            return Err(VestingError::Unauthorized);
        }
        if schedule.paused_at_ledger.is_some() {
            return Err(VestingError::StreamAlreadyPaused);
        }

        let current_ledger = env.ledger().sequence();
        schedule.paused_at_ledger = Some(current_ledger);

        storage::set_schedule(&env, &recipient, &schedule);
        events::emit_stream_paused(&env, &recipient, &sponsor, current_ledger);

        Ok(())
    }

    /// Resumes a paused stream, extending end_ledger and cliff_ledger by the pause duration.
    ///
    /// Only the original sponsor can resume a stream.
    ///
    /// # Errors
    /// * `ScheduleNotFound` – No stream exists for `recipient`.
    /// * `Unauthorized`     – Caller is not the stream's sponsor.
    /// * `StreamNotPaused`  – Stream is not currently paused.
    pub fn resume_stream(
        env: Env,
        sponsor: Address,
        recipient: Address,
    ) -> Result<(), VestingError> {
        sponsor.require_auth();

        let mut schedule =
            storage::get_schedule(&env, &recipient).ok_or(VestingError::ScheduleNotFound)?;

        if schedule.sponsor != sponsor {
            return Err(VestingError::Unauthorized);
        }

        let paused_at = schedule.paused_at_ledger.ok_or(VestingError::StreamNotPaused)?;

        let current_ledger = env.ledger().sequence();
        let paused_duration = current_ledger.saturating_sub(paused_at);

        // Shift all ledger milestones forward by pause duration.
        schedule.accumulated_pause_ledgers = schedule
            .accumulated_pause_ledgers
            .saturating_add(paused_duration);
        schedule.start_ledger = schedule.start_ledger.saturating_add(paused_duration);
        schedule.cliff_ledger = schedule.cliff_ledger.saturating_add(paused_duration);
        schedule.end_ledger = schedule.end_ledger.saturating_add(paused_duration);
        schedule.last_claimed_ledger = schedule.last_claimed_ledger.saturating_add(paused_duration);
        schedule.paused_at_ledger = None;

        storage::set_schedule(&env, &recipient, &schedule);
        events::emit_stream_resumed(&env, &recipient, &sponsor, schedule.end_ledger);

        Ok(())
    }

    // ── Claiming ──────────────────────────────────────────────────────────────

    /// Claims all vested tokens accrued since the last claim.
    ///
    /// The cliff must have been reached before any tokens can be withdrawn.
    ///
    /// # Errors
    /// * `ScheduleNotFound` – No stream exists for `recipient`.
    /// * `CliffNotReached`  – Current ledger < `cliff_ledger`.
    /// * `StreamPaused`     – Stream is currently paused.
    /// * `NothingToClaim`   – Claimable amount is zero.
    /// * `VersionOverflow`  – `version` counter is already at `u32::MAX`.
    pub fn claim_vested(env: Env, recipient: Address) -> Result<i128, VestingError> {
        recipient.require_auth();

        storage::bump_instance(&env);

        let mut stream_ids = Vec::new(&env);
        if let Some(stream_id) = stream_id {
            stream_ids.push_back(stream_id);
        } else {
            stream_ids = storage::get_stream_ids(&env, &recipient);
        }
        if stream_ids.is_empty() {
            return Err(VestingError::ScheduleNotFound);
        }

        let current_ledger = env.ledger().sequence();
        let specific_stream = stream_id.is_some();
        let mut total_claimed = 0_i128;

        for stream_id in stream_ids.iter() {
            let Some(mut schedule) = storage::get_schedule_by_id(&env, &recipient, stream_id) else {
                if specific_stream {
                    return Err(VestingError::ScheduleNotFound);
                }
                continue;
            };
            if schedule.paused_at_ledger.is_some() {
                if specific_stream {
                    return Err(VestingError::NothingToClaim);
                }
                continue;
            }
            if current_ledger < schedule.cliff_ledger {
                if specific_stream {
                    return Err(VestingError::CliffNotReached);
                }
                continue;
            }

            schedule.increment_version()?;
            let total_deposited =
                (schedule.end_ledger - schedule.start_ledger) as i128 * schedule.rate_per_ledger;
            let claimable_amount = if current_ledger >= schedule.end_ledger {
                total_deposited - schedule.claimed_amount
            } else {
                let active_end = current_ledger.min(schedule.end_ledger);
                (active_end - schedule.last_claimed_ledger) as i128 * schedule.rate_per_ledger
            };
            if claimable_amount == 0 {
                if specific_stream {
                    return Err(VestingError::NothingToClaim);
                }
                continue;
            }

            schedule.increment_version()?;
            if storage::is_locked(&env) {
                return Err(VestingError::Reentrancy);
            }
            storage::acquire_lock(&env);
            let token_client = token::Client::new(&env, &schedule.token);
            let transfer_result = token_client.try_transfer(
                &env.current_contract_address(),
                &recipient,
                &claimable_amount,
            );
            storage::release_lock(&env);
            transfer_result.map_err(|_| VestingError::TransferFailed)?;

            let active_end = current_ledger.min(schedule.end_ledger);
            schedule.last_claimed_ledger = active_end;
            schedule.total_claimed += claimable_amount;
            schedule.claimed_amount += claimable_amount;

            if schedule.claimed_amount >= total_deposited {
                storage::remove_schedule_by_id(&env, &recipient, stream_id);
                events::emit_stream_completed(&env, &recipient, &schedule.token);
            } else {
                storage::set_schedule_by_id(&env, &recipient, stream_id, &schedule);
            }

            events::emit_tokens_claimed(&env, &recipient, claimable_amount, active_end);
            total_claimed = total_claimed
                .checked_add(claimable_amount)
                .ok_or(VestingError::DepositOverflow)?;
        }

        if total_claimed == 0 {
            return Err(VestingError::NothingToClaim);
        }

        // Reentrancy guard: acquire lock before the outbound token transfer
        // and release immediately after (Issue #13).
        if storage::is_locked(&env) {
            return Err(VestingError::Reentrancy);
        }
        storage::acquire_lock(&env);
        let token_client = token::Client::new(&env, &schedule.token);
        let transfer_result = token_client.try_transfer(
            &env.current_contract_address(),
            &recipient,
            &claimable_amount,
        );
        storage::release_lock(&env);
        transfer_result
            .map_err(|_| VestingError::TransferFailed)?
            .map_err(|_| VestingError::TransferFailed)?;

        let active_end = current_ledger.min(schedule.end_ledger);
        schedule.last_claimed_ledger = active_end;
        schedule.total_claimed += claimable_amount;
        schedule.claimed_amount += claimable_amount;

        // Auto-cleanup: if the stream is fully claimed, remove the storage
        // entry to reclaim rent (Issue #12).
        let stream_finished = schedule.claimed_amount >= total_deposited;

        if stream_finished {
            storage::remove_schedule(&env, &recipient);
            events::emit_stream_completed(&env, &recipient, &schedule.token);
        } else {
            storage::set_schedule(&env, &recipient, &schedule);
        }

        events::emit_tokens_claimed(&env, &recipient, claimable_amount, schedule.last_claimed_ledger);

        Ok(claimable_amount)
    }

    // ── Variable-rate stream ──────────────────────────────────────────────────

    /// Creates a variable-rate vesting stream with scheduled rate changes.
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

        let n = segments.len();
        if n == 0 || n > MAX_SEGMENTS {
            return Err(VestingError::InvalidSegments);
        }

        let start_ledger: u32 = env.ledger().sequence();
        let cliff_ledger: u32 = start_ledger
            .checked_add(cliff_duration)
            .ok_or(VestingError::DepositOverflow)?;

        let mut prev_end: u32 = start_ledger;
        let mut total_deposit: i128 = 0;
        let mut rate_segments: Vec<RateSegment> = Vec::new(&env);
        let mut end_ledger: u32 = start_ledger;

        for i in 0..n {
            let (seg_end, rate) = segments.get(i).unwrap();

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

            end_ledger = seg_end;
            prev_end = seg_end;
        }

        sponsor.require_auth();

        let token_client = token::Client::new(&env, &token);
        token_client
            .try_transfer(&sponsor, &env.current_contract_address(), &total_deposit)
            .map_err(|_| VestingError::TransferFailed)?
            .map_err(|_| VestingError::TransferFailed)?;

        let schedule = VariableRateSchedule {
            token: token.clone(),
            sponsor: sponsor.clone(),
            segments: rate_segments,
            start_ledger,
            cliff_ledger,
            end_ledger,
            total_deposited: total_deposit,
            last_claimed_ledger: start_ledger,
            claimed_amount: 0,
            total_claimed: 0,
            paused_at_ledger: None,
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

    /// Alias for [`Self::create_variable_rate_stream`].
    pub fn create_variable_stream(
        env: Env,
        sponsor: Address,
        recipient: Address,
        token: Address,
        cliff_duration: u32,
        segments: Vec<(u32, i128)>,
    ) -> Result<(), VestingError> {
        Self::create_variable_rate_stream(env, sponsor, recipient, token, cliff_duration, segments)
    }

    /// Claims all vested tokens from a variable-rate stream.
    pub fn claim_variable_vested(env: Env, recipient: Address) -> Result<i128, VestingError> {
        recipient.require_auth();

        let mut schedule = storage::get_variable_schedule(&env, &recipient)
            .ok_or(VestingError::ScheduleNotFound)?;

        if schedule.paused_at_ledger.is_some() {
            return Err(VestingError::StreamPaused);
        }

        let current_ledger = env.ledger().sequence();

        if current_ledger < schedule.cliff_ledger {
            return Err(VestingError::CliffNotReached);
        }

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

        if storage::is_locked(&env) {
            return Err(VestingError::Reentrancy);
        }
        storage::acquire_lock(&env);
        let token_client = token::Client::new(&env, &schedule.token);
        let transfer_result = token_client.try_transfer(
            &env.current_contract_address(),
            &recipient,
            &claimable_amount,
        );
        storage::release_lock(&env);
        transfer_result
            .map_err(|_| VestingError::TransferFailed)?
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
    pub fn cancel_stream(
        env: Env,
        sponsor: Address,
        recipient: Address,
        stream_id: u32,
    ) -> Result<(), VestingError> {
        sponsor.require_auth();

        let schedule =
            storage::get_schedule_by_id(&env, &recipient, stream_id)
                .ok_or(VestingError::ScheduleNotFound)?;

        if schedule.sponsor != sponsor {
            return Err(VestingError::Unauthorized);
        }

        if schedule.sponsor != sponsor {
            return Err(VestingError::Unauthorized);
        }

        let current_ledger = env.ledger().sequence();
        let token_client = token::Client::new(&env, &schedule.token);
        let total_deposited =
            (schedule.end_ledger - schedule.start_ledger) as i128 * schedule.rate_per_ledger;

        // Compute effective current ledger accounting for pause state.
        // If the stream is paused, use paused_at_ledger as the effective current ledger.
        let effective_ledger = if let Some(paused_at) = schedule.paused_at_ledger {
            paused_at
        } else {
            current_ledger
        };

        let (recipient_share, sponsor_refund) = if effective_ledger >= schedule.cliff_ledger {
            let active_end = effective_ledger.min(schedule.end_ledger);
            let earned_ledgers = active_end - schedule.last_claimed_ledger;
            let earned = earned_ledgers as i128 * schedule.rate_per_ledger;
            let refund = total_deposited - schedule.claimed_amount - earned;
            (earned, refund.max(0))
        } else {
            let refund = total_deposited - schedule.claimed_amount;
            (0_i128, refund.max(0))
        };

        if recipient_share > 0 {
            if storage::is_locked(&env) {
                return Err(VestingError::Reentrancy);
            }
            storage::acquire_lock(&env);
            let r1 = token_client.try_transfer(
                &env.current_contract_address(),
                &recipient,
                &recipient_share,
            );
            storage::release_lock(&env);
            r1.map_err(|_| VestingError::TransferFailed)?
                .map_err(|_| VestingError::TransferFailed)?;
        }
        if sponsor_refund > 0 {
            if storage::is_locked(&env) {
                return Err(VestingError::Reentrancy);
            }
            storage::acquire_lock(&env);
            let r2 = token_client
                .try_transfer(&env.current_contract_address(), &sponsor, &sponsor_refund);
            storage::release_lock(&env);
            r2.map_err(|_| VestingError::TransferFailed)?
                .map_err(|_| VestingError::TransferFailed)?;
        }

        storage::remove_schedule(&env, &recipient);
        storage::remove_sponsor_stream(&env, &sponsor, &recipient);

        // Emit structured StreamCancelled event (closes #7)
        events::emit_stream_cancelled(
            &env,
            &sponsor,
            &recipient,
            sponsor_refund,
            recipient_share,
        );

        Ok(())
    }

    // ── Stream transfer ───────────────────────────────────────────────────────

    /// Transfers an active vesting stream from `current_recipient` to `new_recipient`.
    ///
    /// # Errors
    /// * `ScheduleNotFound`    – No stream exists for `recipient`.
    /// * `Unauthorized`        – Caller is not the stream's sponsor.
    /// * `StreamAlreadyPaused` – Stream is already in paused state.
    pub fn pause_stream(
        env: Env,
        sponsor: Address,
        recipient: Address,
    ) -> Result<(), VestingError> {
        sponsor.require_auth();

        let mut schedule =
            storage::get_schedule(&env, &recipient).ok_or(VestingError::ScheduleNotFound)?;

        if schedule.sponsor != sponsor {
            return Err(VestingError::Unauthorized);
        }
        if schedule.paused_at_ledger.is_some() {
            return Err(VestingError::StreamAlreadyPaused);
        }

        let current_ledger = env.ledger().sequence();
        schedule.paused_at_ledger = Some(current_ledger);

        storage::set_schedule(&env, &recipient, &schedule);
        events::emit_stream_paused(&env, &recipient, &sponsor, current_ledger);

        Ok(())
    }

    /// Resumes a paused stream, shifting end_ledger and cliff_ledger by the paused duration.
    ///
    /// # Errors
    /// * `ScheduleNotFound` – No stream exists for `recipient`.
    /// * `Unauthorized`     – Caller is not the stream's sponsor.
    /// * `StreamNotPaused`  – Stream is not currently paused.
    pub fn resume_stream(
        env: Env,
        sponsor: Address,
        recipient: Address,
    ) -> Result<(), VestingError> {
        sponsor.require_auth();

        let mut schedule =
            storage::get_schedule(&env, &recipient).ok_or(VestingError::ScheduleNotFound)?;

        if schedule.sponsor != sponsor {
            return Err(VestingError::Unauthorized);
        }

        let paused_at = schedule.paused_at_ledger.ok_or(VestingError::StreamNotPaused)?;

        let current_ledger = env.ledger().sequence();
        let paused_duration = current_ledger.saturating_sub(paused_at);

        schedule.accumulated_pause_ledgers = schedule
            .accumulated_pause_ledgers
            .saturating_add(paused_duration);
        schedule.end_ledger = schedule.end_ledger.saturating_add(paused_duration);
        schedule.cliff_ledger = schedule.cliff_ledger.saturating_add(paused_duration);
        schedule.paused_at_ledger = None;

        storage::set_schedule(&env, &recipient, &schedule);
        events::emit_stream_resumed(&env, &recipient, &sponsor, schedule.end_ledger);

        Ok(())
    }

    /// Reassigns an active vesting stream from `current_recipient` to `new_recipient`.
    pub fn transfer_recipient(
        env: Env,
        current_recipient: Address,
        new_recipient: Address,
    ) -> Result<(), VestingError> {
        current_recipient.require_auth();

        if current_recipient == new_recipient {
            return Err(VestingError::InvalidRecipient);
        }

        let schedule = storage::get_schedule(&env, &current_recipient)
            .ok_or(VestingError::ScheduleNotFound)?;

        if storage::has_schedule(&env, &new_recipient) {
            return Err(VestingError::ScheduleAlreadyExists);
        }

        storage::remove_schedule(&env, &current_recipient);
        storage::set_schedule(&env, &new_recipient, &schedule);

        storage::remove_sponsor_stream(&env, &schedule.sponsor, &current_recipient);
        storage::add_sponsor_stream(&env, &schedule.sponsor, &new_recipient);

        events::emit_recipient_transferred(&env, &current_recipient, &new_recipient);

        Ok(())
    }

    /// Alias for `transfer_recipient`.
    pub fn transfer_stream(
        env: Env,
        current_recipient: Address,
        new_recipient: Address,
    ) -> Result<(), VestingError> {
        Self::transfer_recipient(env, current_recipient, new_recipient)
    }

    /// Configures protocol fee basis points (0-500) and treasury address.
    ///
    /// # Errors
    /// * `Unauthorized` – Caller is not the configured admin.
    /// * `InvalidRate`  – `fee_bps` exceeds 500.
    pub fn set_fee(
        env: Env,
        admin: Address,
        fee_bps: u32,
        treasury: Address,
    ) -> Result<(), VestingError> {
        admin.require_auth();

        let stored_admin = storage::get_admin(&env).ok_or(VestingError::Unauthorized)?;
        if admin != stored_admin {
            return Err(VestingError::Unauthorized);
        }
        if fee_bps > MAX_FEE_BPS {
            return Err(VestingError::InvalidRate);
        }

        storage::set_fee(&env, fee_bps, &treasury);
        Ok(())
    }

    /// Compliance clawback: the original sponsor recovers **all** remaining tokens.
    ///
    /// # Required checks (Issue #584)
    /// 1. The `sponsor` must be the same address that created the stream.
    /// 2. The `reason` string must be ≤ 256 bytes (UTF-8).
    /// 3. The token must support the SAC clawback flag (`AUTH_CLAWBACK_ENABLED_FLAG`).
    ///
    /// # Errors
    /// * `ScheduleNotFound`            – No stream exists for `recipient`.
    /// * `Unauthorized`                – `sponsor` is not the stream's original funder.
    /// * `ReasonTooLong`               – `reason` exceeds 256 bytes.
    /// * `ClawbackNotSupported` – Token does not have the SAC clawback flag enabled.
    pub fn clawback_stream(
        env: Env,
        sponsor: Address,
        recipient: Address,
        stream_id: u32,
        reason: String,
    ) -> Result<(), VestingError> {
        sponsor.require_auth();

        let schedule = storage::get_schedule_by_id(&env, &recipient, stream_id)
            .ok_or(VestingError::ScheduleNotFound)?;

        if schedule.sponsor != sponsor {
            return Err(VestingError::Unauthorized);
        }

        const MAX_REASON_BYTES: u32 = 256;
        if reason.len() > MAX_REASON_BYTES {
            return Err(VestingError::ReasonTooLong);
        }

        let sac_admin_client = token::StellarAssetClient::new(&env, &schedule.token);
        if sac_admin_client
            .try_clawback(&env.current_contract_address(), &0_i128)
            .is_err()
        {
            return Err(VestingError::ClawbackNotSupported);
        }

        let remaining = (schedule.end_ledger - schedule.last_claimed_ledger) as i128
            * schedule.rate_per_ledger;

        if remaining > 0 {
            let token_client = token::Client::new(&env, &schedule.token);
            token_client
                .try_transfer(&env.current_contract_address(), &sponsor, &remaining)
                .map_err(|_| VestingError::TransferFailed)?
                .map_err(|_| VestingError::TransferFailed)?;
        }

        storage::remove_schedule(&env, &recipient);
        storage::remove_sponsor_stream(&env, &sponsor, &recipient);

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

    /// Drains an expired stream after the safety delay, returning tokens to sponsor.
    pub fn drain_expired_stream(
        env: Env,
        caller: Address,
        recipient: Address,
    ) -> Result<(), VestingError> {
        let schedule =
            storage::get_schedule(&env, &recipient).ok_or(VestingError::ScheduleNotFound)?;

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

        let total_deposit = calculate_total_deposit(
            schedule.rate_per_ledger,
            schedule.end_ledger - schedule.start_ledger,
        )
        .unwrap_or(0);
        let remaining = total_deposit.saturating_sub(schedule.total_claimed);

        let token_client = token::Client::new(&env, &schedule.token);
        let sponsor = schedule.sponsor.clone();

        storage::remove_schedule(&env, &recipient);
        storage::remove_sponsor_stream(&env, &sponsor, &recipient);

        if remaining > 0 {
            token_client
                .try_transfer(&env.current_contract_address(), &sponsor, &remaining)
                .map_err(|_| VestingError::TransferFailed)?
                .map_err(|_| VestingError::TransferFailed)?;
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

    /// Recovers unclaimed tokens from an expired stream after a long safety delay.
    pub fn emergency_drain(
        env: Env,
        sponsor: Address,
        recipient: Address,
    ) -> Result<(), VestingError> {
        sponsor.require_auth();

        let schedule =
            storage::get_schedule(&env, &recipient).ok_or(VestingError::ScheduleNotFound)?;

        if schedule.sponsor != sponsor {
            return Err(VestingError::Unauthorized);
        }

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
        storage::remove_sponsor_stream(&env, &sponsor, &recipient);
        events::emit_emergency_drain(&env, &recipient, &sponsor, amount);

        Ok(())
    }

    // ── Admin helpers ─────────────────────────────────────────────────────────

    /// Sets the minimum deposit threshold (admin configuration).
    pub fn set_min_deposit(
        env: Env,
        admin: Address,
        min_deposit: i128,
    ) -> Result<(), VestingError> {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env).ok_or(VestingError::Unauthorized)?;
        if admin != stored_admin {
            return Err(VestingError::Unauthorized);
        }
        if min_deposit <= 0 {
            return Err(VestingError::InvalidRate);
        }
        storage::set_min_deposit(&env, min_deposit);
        Ok(())
    }

    /// Permissionless TTL refresh for a fixed-rate vesting stream (Issue #727).
    ///
    /// Any address may call this to extend the persistent storage TTL of a
    /// recipient's schedule entry so it survives beyond the standard ~60-day
    /// passive bump window. This is critical for multi-year streams that may
    /// have extended periods of inactivity between claims.
    ///
    /// The TTL is extended to cover at least `end_ledger + TTL_BUFFER_LEDGERS`
    /// (capped at Soroban's maximum, `PERSISTENT_BUMP_AMOUNT`). Schedule state
    /// is **not modified** — this function is purely a storage maintenance call.
    ///
    /// Off-chain keepers should call this function periodically for any stream
    /// whose `end_ledger` is more than `PERSISTENT_BUMP_AMOUNT` ledgers away
    /// from the current ledger.
    ///
    /// # Errors
    /// * `ScheduleNotFound` – No active fixed-rate schedule exists for `recipient`.
    pub fn keeper_bump(env: Env, recipient: Address) -> Result<(), VestingError> {
        // Read without modifying — ensure_ttl_for_stream is called inside
        // get_schedule_readonly to set the proactive TTL based on end_ledger.
        storage::get_schedule_readonly(&env, &recipient)
            .ok_or(VestingError::ScheduleNotFound)?;

        // Bump instance storage as well so it stays in sync.
        storage::bump_instance(&env);

        Ok(())
    }

    /// Permissionless TTL refresh for a variable-rate vesting stream (Issue #727).
    ///
    /// Equivalent to `keeper_bump` but operates on variable-rate (`create_variable_stream`)
    /// schedules. Any address may call this to extend persistent storage TTL for
    /// the recipient's variable-rate schedule without modifying schedule state.
    ///
    /// # Errors
    /// * `ScheduleNotFound` – No active variable-rate schedule exists for `recipient`.
    pub fn keeper_bump_variable(env: Env, recipient: Address) -> Result<(), VestingError> {
        let schedule = storage::get_variable_schedule_readonly(&env, &recipient)
            .ok_or(VestingError::ScheduleNotFound)?;

        // Proactively extend the variable schedule's persistent TTL.
        let key = crate::types::DataKey::VariableSchedule(recipient.clone());
        if env.storage().persistent().has(&key) {
            let ttl = storage::compute_stream_ttl(&env, schedule.end_ledger);
            env.storage().persistent().extend_ttl(
                &key,
                storage::PERSISTENT_LEDGER_THRESHOLD,
                ttl.max(storage::PERSISTENT_BUMP_AMOUNT),
            );
        }
        storage::bump_instance(&env);

        Ok(())
    }

    /// Sets a governance configuration value in instance storage.
    pub fn set_config(
        env: Env,
        admin: Address,
        key: String,
        value: i128,
    ) -> Result<(), VestingError> {
        admin.require_auth();
        if storage::get_admin(&env) != Some(admin.clone()) {
            return Err(VestingError::Unauthorized);
        }
        if key == String::from_str(&env, "max_cliff_ratio") {
            if value < 0 || value > 10_000 {
                return Err(VestingError::InvalidRate);
            }
            storage::set_max_cliff_ratio(&env, value as u32);
        } else if key == String::from_str(&env, "min_rate") {
            if value < 1 {
                return Err(VestingError::InvalidRate);
            }
            storage::set_min_rate(&env, value);
        } else {
            return Err(VestingError::InvalidRate);
        }
        Ok(())
    }

    /// Returns a governance configuration value from instance storage.
    pub fn get_config(env: Env, key: String) -> i128 {
        if key == String::from_str(&env, "max_cliff_ratio") {
            storage::get_max_cliff_ratio(&env) as i128
        } else if key == String::from_str(&env, "min_rate") {
            storage::get_min_rate(&env)
        } else {
            0
        }
    }

    /// Upgrades a legacy schedule to the current schema version.
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
                .map_err(|_| VestingError::TransferFailed)?
                .map_err(|_| VestingError::TransferFailed)?;
        }

        storage::remove_schedule(&env, &recipient);
        events::emit_emergency_drain(&env, &recipient, &sponsor, amount);

        Ok(())
    }

    // ── Read-only views ───────────────────────────────────────────────────────

    /// Returns the vesting schedule for `recipient`, if any.
    pub fn get_schedule(env: Env, recipient: Address) -> Option<VestingSchedule> {
        storage::get_schedule_readonly(&env, &recipient)
    }

    /// Returns the number of tokens claimable right now for `recipient`.
    ///
    /// Returns `0` if the cliff has not been reached or no schedule exists.
    pub fn claimable_amount(env: Env, recipient: Address) -> i128 {
        let Some(schedule) = storage::get_schedule_readonly(&env, &recipient) else {
            return 0;
        };
        if schedule.paused_at_ledger.is_some() {
            return 0;
        }
        let current_ledger = env.ledger().sequence();
        if current_ledger < schedule.cliff_ledger {
            return 0;
        }
        compute_claimable(&schedule, current_ledger)
    }

    /// Returns claimable amounts for `recipients` in input order.
    ///
    /// Recipients without a schedule, before their cliff, or with a paused
    /// schedule have a claimable amount of `0`.
    pub fn get_claimable_batch(
        env: Env,
        recipients: Vec<Address>,
    ) -> Result<Vec<(Address, i128)>, VestingError> {
        if recipients.len() > MAX_BATCH_SIZE {
            return Err(VestingError::BatchTooLarge);
        }

        let current_ledger = env.ledger().sequence();
        let mut results = Vec::new(&env);
        for recipient in recipients.iter() {
            let amount = match storage::get_schedule_readonly(&env, &recipient) {
                Some(schedule)
                    if schedule.paused_at_ledger.is_none()
                        && current_ledger >= schedule.cliff_ledger =>
                {
                    compute_claimable(&schedule, current_ledger)
                }
                _ => 0,
            };
            results.push_back((recipient, amount));
        }

        Ok(results)
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
        let status = if schedule.paused_at_ledger.is_some() {
            StreamStatus::Paused
        } else if current < schedule.cliff_ledger {
            StreamStatus::PreCliff
        } else if current < schedule.end_ledger {
            StreamStatus::Active
        } else {
            StreamStatus::Expired
        };
        Some(status)
    }

    /// Returns the full lifecycle [`StreamStatus`] for `recipient` (issue #583).
    ///
    /// Unlike `get_status`, this function:
    /// - Returns `StreamStatus::NotFound` instead of `None` when no schedule exists.
    /// - Handles the `Paused` state when the sponsor has paused the stream.
    /// - Returns all 6 possible states: `PreCliff`, `Active`, `Expired`, `Cancelled`,
    ///   `Paused`, and `NotFound`.
    ///
    /// This is the recommended view for client-side lifecycle state management.
    pub fn stream_status(env: Env, recipient: Address) -> StreamStatus {
        let Some(schedule) = storage::get_schedule_readonly(&env, &recipient) else {
            return StreamStatus::NotFound;
        };

        // Check paused state first — a paused stream may be in PreCliff or Active
        // territory but should always report Paused until resumed.
        if schedule.paused_at_ledger.is_some() {
            return StreamStatus::Paused;
        }

        let current = env.ledger().sequence();
        if current < schedule.cliff_ledger {
            StreamStatus::PreCliff
        } else if current < schedule.end_ledger {
            StreamStatus::Active
        } else {
            StreamStatus::Expired
        }
    }

    /// Returns consolidated statistics for `recipient`'s fixed-rate vesting stream.
    pub fn get_stats(env: Env, recipient: Address) -> Option<StreamStats> {
        let schedule = storage::get_schedule_readonly(&env, &recipient)?;

        let total_deposited = calculate_total_deposit(
            schedule.rate_per_ledger,
            schedule.end_ledger - schedule.start_ledger,
        )
        .unwrap_or(0);
        let total_claimed = schedule.total_claimed;
        let remaining = total_deposited.saturating_sub(total_claimed);

        let claimable_now = {
            let current = env.ledger().sequence();
            if current < schedule.cliff_ledger || schedule.paused_at_ledger.is_some() {
                0
            } else {
                compute_claimable(&schedule, current)
            }
        };

        Some(StreamStats {
            total_deposited,
            total_claimed,
            remaining,
            claimable_now,
        })
    }

    /// Returns the list of active recipient addresses for `sponsor`.
    ///
    /// Returns an empty `Vec` (not an error) when the sponsor has no active streams.
    /// TTL is bumped on read alongside the main schedule storage.
    pub fn get_streams_for_sponsor(env: Env, sponsor: Address) -> soroban_sdk::Vec<Address> {
        storage::get_sponsor_streams(&env, &sponsor)
    }

    // ── Emergency Drain ───────────────────────────────────────────────────────

    /// Recovers unclaimed tokens from an expired stream after a long safety delay.
    ///
    /// Returns `0` if no schedule exists for `recipient` (i.e. the stream
    /// has not been created, or has been fully claimed and the schedule
    /// was removed).
    ///
    /// The value persists in the schedule until the stream is fully consumed.
    /// For a fully consumed stream the final total is reflected in the
    /// `claim_vested` return value before the schedule is removed.
    pub fn get_total_claimed(env: Env, recipient: Address) -> i128 {
        storage::get_schedule_readonly(&env, &recipient)
            .map(|s| s.total_claimed)
            .unwrap_or(0)
    }

    /// Returns the configured minimum deposit.
    pub fn get_min_deposit(env: Env) -> i128 {
        storage::get_min_deposit(&env)
    }

    /// Returns the variable-rate schedule for `recipient`.
    pub fn get_variable_schedule(
        env: Env,
        recipient: Address,
    ) -> Option<VariableRateSchedule> {
        storage::get_variable_schedule_readonly(&env, &recipient)
    }

    /// Returns the number of tokens claimable right now for `recipient`.
    ///
    /// Returns `0` if the cliff has not been reached, stream is paused, or no schedule exists.
    pub fn claimable_amount(env: Env, recipient: Address) -> i128 {
        let Some(schedule) = storage::get_schedule_readonly(&env, &recipient) else {
            return 0;
        };
        // Return 0 while paused (issue #719).
        if schedule.paused_at_ledger.is_some() {
            return 0;
        }
        let current_ledger = env.ledger().sequence();
        if current_ledger < schedule.cliff_ledger {
            return 0;
        }
        let total_deposited =
            (schedule.end_ledger - schedule.start_ledger) as i128 * schedule.rate_per_ledger;
        if current_ledger >= schedule.end_ledger {
            return total_deposited - schedule.claimed_amount;
        }
        let active_end = current_ledger.min(schedule.end_ledger);
        (active_end - schedule.last_claimed_ledger) as i128 * schedule.rate_per_ledger
    }

    /// Returns the number of tokens claimable from a variable-rate stream.
    pub fn claimable_variable_amount(env: Env, recipient: Address) -> i128 {
        let Some(schedule) = storage::get_variable_schedule_readonly(&env, &recipient) else {
            return 0;
        };
        if schedule.paused_at_ledger.is_some() {
            return 0;
        }
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

/// Computes the full deposit for a stream.
///
/// Uses fixed-point: `total_deposit = rate * total_duration / RATE_DECIMALS`.
pub fn calculate_total_deposit(rate: i128, total_duration: u32) -> Result<i128, VestingError> {
    let raw = rate
        .checked_mul(total_duration as i128)
        .ok_or(VestingError::DepositOverflow)?;
    Ok(raw / RATE_DECIMALS)
}

/// Computes tokens claimable from a variable-rate stream between two ledgers.
fn compute_variable_claimable(
    segments: &Vec<RateSegment>,
    from_ledger: u32,
    to_ledger: u32,
    _start_ledger: u32,
) -> i128 {
    let mut claimable: i128 = 0;
    let mut prev_end = from_ledger;

    for i in 0..segments.len() {
        let seg = segments.get(i).unwrap();
        if seg.end_ledger <= from_ledger {
            prev_end = seg.end_ledger;
            continue;
        }
        let seg_start = prev_end.max(from_ledger);
        let seg_end = seg.end_ledger.min(to_ledger);
        if seg_end > seg_start {
            let duration = (seg_end - seg_start) as i128;
            claimable = claimable.saturating_add(duration.saturating_mul(seg.rate));
        }
        prev_end = seg.end_ledger;
        if seg.end_ledger >= to_ledger {
            break;
        }
    }

    claimable
}

// Issue #718: create_batch_streams and batch_create_vesting_streams are
// implemented above. Max batch: 20 (BatchTooLarge) / 50 (BatchSizeExceeded).
