// `#[contracttype]`/`#[contract]` emit inherent `impl` blocks with no doc
// comments; rustc doesn't propagate item-level `#[allow]` onto
// attribute-macro-generated sibling impls, so the allow has to be module-scoped.
#![allow(missing_docs)]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, BytesN, Env, String, Vec};

use crate::{
    error::VestingError,
    events, storage,
    types::{RateSegment, StreamStatus, VariableRateSchedule, VestingSchedule},
};

/// ~1 year at ~5 s/ledger.
const DRAIN_DELAY_LEDGERS: u32 = 3_153_600;

/// Maximum number of segments allowed in a variable-rate stream.
const MAX_SEGMENTS: usize = 10;

/// Maximum number of milestones allowed in a milestone-based stream.
const MAX_MILESTONES: u32 = 20;

/// Maximum fee in basis points (5 %).
const MAX_FEE_BPS: u32 = 500;

/// Maximum batch size for `batch_create_vesting_streams`.
const MAX_BATCH_SIZE: u32 = 20;

/// Maximum milestones for a milestone stream.
const MAX_MILESTONES: u32 = 20;

/// Consolidated statistics for a vesting stream.
///
/// Returned by [`VestingDrips::get_stats`].
#[allow(missing_docs)]
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
#[allow(missing_docs)]
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

    // ── Admin / Allowlist ─────────────────────────────────────────────────────

    /// Adds `token` to the allowlist of accepted SAC token contracts.
    ///
    /// When the allowlist is non-empty, only listed tokens can be used in
    /// `create_vesting_stream`. An empty allowlist enables permissive mode.
    ///
    /// # Events
    /// Emits `AllowlistUpdated { token, added: true }`.
    pub fn add_allowed_token(
        env: Env,
        admin: Address,
        token: Address,
    ) -> Result<(), VestingError> {
        admin.require_auth();
        storage::add_allowed_token(&env, &token);
        events::emit_allowlist_updated(&env, &admin, &token, true);
        Ok(())
    }

    /// Removes `token` from the allowlist.
    ///
    /// If the resulting allowlist is empty the contract reverts to permissive mode.
    ///
    /// # Events
    /// Emits `AllowlistUpdated { token, added: false }`.
    pub fn remove_allowed_token(
        env: Env,
        admin: Address,
        token: Address,
    ) -> Result<(), VestingError> {
        admin.require_auth();
        storage::remove_allowed_token(&env, &token);
        events::emit_allowlist_updated(&env, &admin, &token, false);
        Ok(())
    }

    /// Returns all currently allowed token addresses.
    ///
    /// An empty `Vec` means permissive mode (all tokens accepted).
    pub fn get_allowed_tokens(env: Env) -> Vec<Address> {
        storage::get_allowed_tokens(&env)
    }

    // ── Stream creation ───────────────────────────────────────────────────────

    /// Creates a new cliff-vesting stream for `recipient`.
    ///
    /// # Errors
    /// * `InvalidRate`            – `rate` is zero or negative.
    /// * `InvalidDuration`        – `total_duration` ≤ `cliff_duration`.
    /// * `DepositOverflow`        – Total deposit exceeds i128 bounds.
    /// * `DepositBelowMinimum`    – Total deposit is below the configured minimum.
    /// * `ScheduleAlreadyExists`  – A stream already exists for `recipient`.
    /// * `TokenNotAllowed`        – Token is not in the allowlist (when enforced).
    pub fn create_vesting_stream(
        env: Env,
        sponsor: Address,
        recipient: Address,
        token: Address,
        rate: i128,
        cliff_duration: u32,
        total_duration: u32,
    ) -> Result<(), VestingError> {
        env.storage().instance().extend_ttl(259_200, 518_400);

        if !storage::is_initialized(&env) {
            return Err(VestingError::NotInitialized);
        }

        // Guard: contract must be initialized before accepting streams.
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
        if total_duration <= cliff_duration {
            return Err(VestingError::InvalidDuration);
        }
        // Validate cliff ratio does not exceed configured max.
        let max_cliff_ratio_bps = storage::get_max_cliff_ratio(&env);
        let cliff_ratio_bps = (cliff_duration as u64 * 10_000 / total_duration as u64) as u32;
        if cliff_ratio_bps > max_cliff_ratio_bps {
            return Err(VestingError::InvalidDuration);
        }
        if sponsor == recipient {
            return Err(VestingError::InvalidRecipient);
        }

        if storage::has_schedule(&env, &recipient) {
            return Err(VestingError::ScheduleAlreadyExists);
        }

        // Validate token is a SAC by probing try_balance
        let token_client = token::Client::new(&env, &token);
        if token_client.try_balance(&sponsor).is_err() {
            return Err(VestingError::InvalidToken);
        }

        // ── Normalise and validate metadata ───────────────────────────────────
        let metadata: Option<soroban_sdk::String> = None;

        sponsor.require_auth();

        let start_ledger: u32 = env.ledger().sequence();
        let cliff_ledger: u32 = start_ledger
            .checked_add(cliff_duration)
            .ok_or(VestingError::DepositOverflow)?;
        let end_ledger: u32 = start_ledger
            .checked_add(total_duration)
            .ok_or(VestingError::DepositOverflow)?;

        // total_deposit uses RATE_DECIMALS-scaled rate then divides back.
        // The actual tokens deposited = rate * total_duration / RATE_DECIMALS.
        let total_deposit: i128 = calculate_total_deposit(rate, total_duration)?;

        let min_deposit = storage::get_min_deposit(&env);
        if total_deposit < min_deposit {
            return Err(VestingError::DepositBelowMinimum);
        }

        token_client
            .try_transfer(&sponsor, &env.current_contract_address(), &total_deposit)
            .map_err(|_| VestingError::TransferFailed)?;

        // ── Collect Protocol Fee ──────────────────────────────────────────────
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
            &None,
        );

        Ok(())
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
    pub fn create_variable_vesting_stream(
        env: Env,
        sponsor: Address,
        recipient: Address,
        token: Address,
        milestones: Vec<(u32, u32)>,
        end_ledger: u32,
        total_deposit: i128,
    ) -> Result<(), VestingError> {
        env.storage()
            .instance()
            .extend_ttl(259_200, 518_400);

        if sponsor == recipient {
            return Err(VestingError::InvalidRecipient);
        }

        if storage::has_milestone_schedule(&env, &recipient) {
            return Err(VestingError::ScheduleAlreadyExists);
        }

        // ── Validate milestones ───────────────────────────────────────────────
        let n = milestones.len();
        if n == 0 || n > MAX_MILESTONES {
            return Err(VestingError::InvalidMilestones);
        }

        sponsor.require_auth();

        let start_ledger: u32 = env.ledger().sequence();
        let cliff_ledger: u32 = start_ledger
            .checked_add(cliff_duration)
            .ok_or(VestingError::DepositOverflow)?;
        let mut prev_end: u32 = start_ledger;
        let mut total_deposit: i128 = 0;
        let mut rate_segments: Vec<RateSegment> = Vec::new(&env);

        for i in 0..n {
            let (seg_end_offset, rate) = segments.get(i).unwrap();
            let seg_end: u32 = seg_end_offset;

            if rate <= 0 {
                return Err(VestingError::InvalidSegments);
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
            .map_err(|_| VestingError::TransferFailed)?;

        schedule.next_milestone_idx = new_idx;
        schedule.total_claimed = schedule
            .total_claimed
            .checked_add(claimable)
            .ok_or(VestingError::DepositOverflow)?;

        let stream_finished = schedule.next_milestone_idx >= n;
        if stream_finished {
            storage::remove_milestone_schedule(&env, &recipient);
            events::emit_stream_completed(&env, &recipient, &schedule.token);
        } else {
            storage::set_milestone_schedule(&env, &recipient, &schedule);
        }

        events::emit_milestone_claimed(&env, &recipient, claimable);

        Ok(claimable)
    }

    // ── Claim (fixed-rate) ────────────────────────────────────────────────────

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
    pub fn claim_vested(env: Env, recipient: Address) -> Result<i128, VestingError> {
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

    // ── Claiming ──────────────────────────────────────────────────────────────

    /// Claims all vested tokens accrued since the last claim.
    ///
    /// The cliff must have been reached before any tokens can be withdrawn.
    ///
    /// When a stream is fully claimed (current_ledger >= end_ledger and all
    /// tokens transferred), the storage entry is **automatically removed** and
    /// a `StreamCompleted` event is emitted, reclaiming rent.
    ///
    /// # Errors
    /// * `ScheduleNotFound` – No stream exists for `recipient`.
    /// * `CliffNotReached`  – Current ledger < `cliff_ledger`.
    /// * `NothingToClaim`   – Claimable amount is zero.
    /// * `VersionOverflow`  – `version` counter is already at `u32::MAX`.
    pub fn claim_vested(env: Env, recipient: Address) -> Result<i128, VestingError> {
        recipient.require_auth();

        // Bump instance storage TTL on every interaction.
        env.storage()
            .instance()
            .extend_ttl(259_200, 518_400);

        let mut schedule =
            storage::get_schedule(&env, &recipient).ok_or(VestingError::ScheduleNotFound)?;

        if schedule.paused_at_ledger.is_some() {
            return Err(VestingError::NothingToClaim);
        }

        let current_ledger = env.ledger().sequence();
        if current_ledger < schedule.cliff_ledger {
            return Err(VestingError::CliffNotReached);
        }

        // Increment version before state mutation (Issue #318).
        schedule.increment_version()?;

        let total_deposited =
            (schedule.end_ledger - schedule.start_ledger) as i128 * schedule.rate_per_ledger;

        // Dust collection: at or past end_ledger return the full remainder.
        let claimable_amount = if current_ledger >= schedule.end_ledger {
            total_deposited - schedule.claimed_amount
        } else {
            let active_end = current_ledger.min(schedule.end_ledger);
            (active_end - schedule.last_claimed_ledger) as i128 * schedule.rate_per_ledger
        };

        if claimable_amount == 0 {
            return Err(VestingError::NothingToClaim);
        }

        // Increment version before state mutation (Issue #318).
        schedule.increment_version()?;

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
        transfer_result.map_err(|_| VestingError::TransferFailed)?;

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

        events::emit_tokens_claimed(&env, &recipient, claim_amount, schedule.last_claimed_ledger);

        Ok(claim_amount)
    }

    // ── Variable-rate stream ──────────────────────────────────────────────────

    /// Creates a variable-rate vesting stream with scheduled rate changes.
    pub fn create_variable_stream(
        env: Env,
        sponsor: Address,
        recipient: Address,
        token: Address,
        cliff_duration: u32,
        segments: Vec<(u32, i128)>,
    ) -> Result<(), VestingError> {
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

    /// Claims all vested tokens from a variable-rate stream.
    pub fn claim_variable_vested(env: Env, recipient: Address) -> Result<i128, VestingError> {
        recipient.require_auth();

        let mut schedule = storage::get_variable_schedule(&env, &recipient)
            .ok_or(VestingError::ScheduleNotFound)?;

        // Paused streams cannot be claimed.
        if schedule.paused_at_ledger.is_some() {
            return Err(VestingError::NothingToClaim);
        }

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

        // Reentrancy guard (Issue #13).
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

    /// Claims the next unlocked milestone from a milestone stream.
    pub fn claim_milestone(env: Env, recipient: Address) -> Result<i128, VestingError> {
        recipient.require_auth();

        let schedule =
            storage::get_schedule(&env, &recipient).ok_or(VestingError::ScheduleNotFound)?;

        let milestones: Vec<(u32, u32)> = env
            .storage()
            .persistent()
            .get(&DataKey::MilestoneSchedule(recipient.clone()))
            .ok_or(VestingError::ScheduleNotFound)?;

        let total_deposited: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::MilestoneTotalDeposit(recipient.clone()))
            .ok_or(VestingError::ScheduleNotFound)?;

        let claimed_bps: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::MilestoneClaimedBps(recipient.clone()))
            .unwrap_or(0);

        let current_ledger = env.ledger().sequence();

        // Sum all reached-but-unclaimed milestones (bps).
        let mut reached_bps: u32 = 0;
        for i in 0..milestones.len() {
            let (ledger, bps) = milestones.get(i).unwrap();
            if current_ledger >= ledger {
                reached_bps += bps;
            }
        }
        let new_claimable_bps = reached_bps.saturating_sub(claimed_bps);

        if new_claimable_bps == 0 {
            return Err(VestingError::NothingToClaim);
        }

        // Convert bps to token amount.
        let claimable_amount = total_deposited
            .checked_mul(new_claimable_bps as i128)
            .ok_or(VestingError::DepositOverflow)?
            / 10_000;

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

        let new_claimed_bps = claimed_bps + new_claimable_bps;
        env.storage()
            .persistent()
            .set(&DataKey::MilestoneClaimedBps(recipient.clone()), &new_claimed_bps);

        // Remove schedule if fully claimed.
        if new_claimed_bps >= 10_000 {
            storage::remove_schedule(&env, &recipient);
            env.storage()
                .persistent()
                .remove(&DataKey::MilestoneSchedule(recipient.clone()));
            env.storage()
                .persistent()
                .remove(&DataKey::MilestoneTotalDeposit(recipient.clone()));
            env.storage()
                .persistent()
                .remove(&DataKey::MilestoneClaimedBps(recipient.clone()));
            events::emit_stream_completed(&env, &recipient, &schedule.token);
        }

        events::emit_tokens_claimed(&env, &recipient, claimable_amount, current_ledger);

        Ok(claimable_amount)
    }

    // ── Cancellation / Clawback ───────────────────────────────────────────────

    /// Allows the original sponsor to cancel an active stream.
    ///
    /// If the cliff has passed, the recipient keeps all accrued tokens;
    /// the sponsor gets the remainder. If the cliff has not passed, the
    /// entire deposit is refunded to the sponsor.
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
            let total_deposited =
                (schedule.end_ledger - schedule.start_ledger) as i128 * schedule.rate_per_ledger;
            let refund = total_deposited - schedule.claimed_amount - earned;
            (earned, refund.max(0))
        } else {
            let total_remaining = (schedule.end_ledger - schedule.last_claimed_ledger) as i128
                * schedule.rate_per_ledger;
            (0_i128, total_remaining)
        };

        if recipient_share > 0 {
            // Reentrancy guard (Issue #13).
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
            r1.map_err(|_| VestingError::TransferFailed)?;
        }
        if sponsor_refund > 0 {
            if storage::is_locked(&env) {
                return Err(VestingError::Reentrancy);
            }
            storage::acquire_lock(&env);
            let r2 = token_client
                .try_transfer(&env.current_contract_address(), &sponsor, &sponsor_refund);
            storage::release_lock(&env);
            r2.map_err(|_| VestingError::TransferFailed)?;
        }

        storage::remove_schedule(&env, &recipient);

        // Emit structured StreamCancelled event (closes #7)
        events::emit_stream_cancelled(
            &env,
            &sponsor,
            &recipient,
            refund_to_sponsor,
            released_to_recipient,
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
    ///
    /// # Errors
    /// * `ScheduleNotFound`       – No stream exists for `current_recipient`.
    /// * `InvalidRecipient`       – Recipients are the same or `new_recipient == sponsor`.
    /// * `ScheduleAlreadyExists`  – `new_recipient` already has an active stream.
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

        // Atomically move: delete old key, write to new key (schedule unchanged).
        storage::remove_schedule(&env, &current_recipient);
        storage::set_schedule(&env, &new_recipient, &schedule);

        // Update sponsor's stream list: old recipient out, new recipient in.
        storage::remove_sponsor_stream(&env, &schedule.sponsor, &current_recipient);
        storage::add_sponsor_stream(&env, &schedule.sponsor, &new_recipient);

        events::emit_recipient_transferred(&env, &current_recipient, &new_recipient);

        Ok(())
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
        if fee_bps > 500 {
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
    /// * `TokenDoesNotSupportClawback` – Token does not have the SAC clawback flag enabled.
    pub fn clawback_stream(
        env: Env,
        sponsor: Address,
        recipient: Address,
        reason: String,
    ) -> Result<(), VestingError> {
        sponsor.require_auth();

        let schedule =
            storage::get_schedule(&env, &recipient).ok_or(VestingError::ScheduleNotFound)?;

        // Verify the caller is the original sponsor of this stream (Issue #584).
        if schedule.sponsor != sponsor {
            return Err(VestingError::Unauthorized);
        }

        // Enforce reason string length ≤ 256 bytes (Issue #584).
        const MAX_REASON_BYTES: u32 = 256;
        if reason.len() > MAX_REASON_BYTES {
            return Err(VestingError::ReasonTooLong);
        }

        // Verify the token supports the SAC clawback flag before transferring
        // tokens (Issue #584). A zero-amount probe call to try_clawback is used
        // to detect flag support without mutating state.
        let sac_admin_client = token::StellarAssetClient::new(&env, &schedule.token);
        if sac_admin_client
            .try_clawback(&env.current_contract_address(), &0_i128)
            .is_err()
        {
            return Err(VestingError::TokenDoesNotSupportClawback);
        }

        let remaining = (schedule.end_ledger - schedule.last_claimed_ledger) as i128
            * schedule.rate_per_ledger;

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

    /// Drains an expired stream after the safety delay, returning tokens to sponsor.
    ///
    /// # Errors
    /// * `ScheduleNotFound`     – No stream exists for `recipient`.
    /// * `StreamNotExpired`     – `end_ledger` has not yet been reached.
    /// * `DrainDelayNotExpired` – Drain delay has not elapsed.
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

        if remaining > 0 {
            token_client.transfer(&env.current_contract_address(), &sponsor, &remaining);
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

    /// Sets a governance configuration value in instance storage.
    ///
    /// Supported keys:
    /// * `"max_cliff_ratio"` — Maximum cliff as a percentage of total duration, in
    ///   basis points (0–10 000). Default 5000 (50 %).
    /// * `"min_rate"` — Minimum allowed `rate_per_ledger` (must be ≥ 1).
    ///
    /// # Errors
    /// * `Unauthorized` – `admin` is not the address set during `initialize`.
    /// * `InvalidRate`  – Provided value is out of range.
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
    ///
    /// Supported keys:
    /// * `"max_cliff_ratio"` — in basis points (default 5000).
    /// * `"min_rate"`        — minimum rate per ledger (default 1).
    ///
    /// Returns `0` for unrecognised keys.
    pub fn get_config(env: Env, key: String) -> i128 {
        if key == String::from_str(&env, "max_cliff_ratio") {
            storage::get_max_cliff_ratio(&env) as i128
        } else if key == String::from_str(&env, "min_rate") {
            storage::get_min_rate(&env)
        } else {
            0
        }
    }

    // ── Read-only views ───────────────────────────────────────────────────────

    /// Claims all vested tokens accrued since the last claim.
    ///
    /// The cliff must have been reached before any tokens can be withdrawn.
    ///
    /// The schedule's `version` counter is incremented on every successful claim.
    ///
    /// The schedule's `version` counter is incremented on every successful claim.
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
        let total_deposited =
            (schedule.end_ledger - schedule.start_ledger) as i128 * schedule.rate_per_ledger;
        if current_ledger >= schedule.end_ledger {
            return total_deposited - schedule.claimed_amount;
        }
        let active_end = current_ledger.min(schedule.end_ledger);
        (active_end - schedule.last_claimed_ledger) as i128 * schedule.rate_per_ledger
    }

    /// Returns the number of tokens claimable right now.
    ///
    /// Returns `0` if the cliff has not been reached or no schedule exists.
    /// Uses fixed-point arithmetic consistent with `claim_vested`.
    pub fn claimable_amount(env: Env, recipient: Address) -> i128 {
        let Some(schedule) = storage::get_schedule_readonly(&env, &recipient) else {
            return 0;
        };
        let current_ledger = env.ledger().sequence();
        if current_ledger < schedule.cliff_ledger {
            return 0;
        }
        compute_claimable(&schedule, current_ledger)
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
        let status = if schedule.paused {
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

    // ── Read-only views ───────────────────────────────────────────────────────

    /// Returns the vesting schedule for `recipient`.
    pub fn get_schedule(env: Env, recipient: Address) -> Option<VestingSchedule> {
        storage::get_schedule_readonly(&env, &recipient)
    }

    /// Returns the variable-rate schedule for `recipient`.
    pub fn get_variable_schedule(
        env: Env,
        recipient: Address,
    ) -> Option<VariableRateSchedule> {
        storage::get_variable_schedule_readonly(&env, &recipient)
    }

    /// Returns the number of tokens currently claimable (fixed-rate stream).
    ///
    /// Returns `0` before the cliff or if no schedule exists.
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

    /// Returns `true` if the cliff has been passed for `recipient`.
    pub fn is_cliff_passed(env: Env, recipient: Address) -> bool {
        let Some(schedule) = storage::get_schedule_readonly(&env, &recipient) else {
            return false;
        };
        env.ledger().sequence() >= schedule.cliff_ledger
    }

    /// Returns the current [`StreamStatus`] for `recipient` (legacy view).
    pub fn get_status(env: Env, recipient: Address) -> Option<StreamStatus> {
        let schedule = storage::get_schedule_readonly(&env, &recipient)?;
        let current = env.ledger().sequence();
        let status = if current < schedule.cliff_ledger {
            StreamStatus::PreCliff
        } else if current < schedule.end_ledger {
            StreamStatus::Active
        } else {
            StreamStatus::Expired
        };
        Some(status)
    }

    /// Returns the typed [`StreamStatus`] for `recipient`.
    ///
    /// Returns `StreamStatus::NotFound` when no schedule exists.
    pub fn stream_status(env: Env, recipient: Address) -> StreamStatus {
        let Some(schedule) = storage::get_schedule_readonly(&env, &recipient) else {
            return StreamStatus::NotFound;
        };
        let current = env.ledger().sequence();
        if current < schedule.cliff_ledger {
            StreamStatus::PreCliff
        } else if current < schedule.end_ledger {
            StreamStatus::Active
        } else {
            StreamStatus::Expired
        }
    }

    /// Returns consolidated statistics for `recipient`'s fixed-rate stream.
    pub fn get_stats(env: Env, recipient: Address) -> Option<StreamStats> {
        let schedule = storage::get_schedule_readonly(&env, &recipient)?;

        let total_duration = (schedule.end_ledger - schedule.start_ledger) as i128;
        let total_deposited = schedule.rate_per_ledger * total_duration;
        let total_claimed = schedule.total_claimed;
        let remaining = total_deposited - total_claimed;

/// Computes the full deposit for a stream.
///
/// With fixed-point rates: `total_deposit = rate * total_duration / RATE_DECIMALS`.
///
/// # Issue #5 — Fixed-point rates
/// `rate` is stored scaled by `RATE_DECIMALS = 10_000_000`. Dividing back
/// by `RATE_DECIMALS` preserves sub-token precision over long streams.
pub fn calculate_total_deposit(rate: i128, total_duration: u32) -> Result<i128, VestingError> {
    let raw = rate
        .checked_mul(total_duration as i128)
        .ok_or(VestingError::DepositOverflow)?;
    Ok(raw / RATE_DECIMALS)
}

/// Computes the claimable amount for a fixed-rate schedule at `current_ledger`.
///
/// Uses fixed-point arithmetic: `claimable = ledgers * rate / RATE_DECIMALS`.
fn compute_claimable(schedule: &VestingSchedule, current_ledger: u32) -> i128 {
    if current_ledger < schedule.cliff_ledger {
        return 0;
    }
    let active_end = current_ledger.min(schedule.end_ledger);

    // Dust collection: at end_ledger, return remaining to avoid locked dust.
    if current_ledger >= schedule.end_ledger {
        let total = calculate_total_deposit(
            schedule.rate_per_ledger,
            schedule.end_ledger - schedule.start_ledger,
        )
        .unwrap_or(0);
        return total.saturating_sub(schedule.total_claimed);
    }

    compute_claimable_from(schedule.last_claimed_ledger, active_end, schedule.rate_per_ledger)
}

/// Computes tokens earned from `from_ledger` to `to_ledger` at `rate`.
///
/// `(to_ledger - from_ledger) * rate / RATE_DECIMALS`
fn compute_claimable_from(from_ledger: u32, to_ledger: u32, rate: i128) -> i128 {
    if to_ledger <= from_ledger {
        return 0;
    }
    let ledgers = (to_ledger - from_ledger) as i128;
    ledgers.saturating_mul(rate) / RATE_DECIMALS
}
