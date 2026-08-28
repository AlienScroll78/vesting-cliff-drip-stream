// `#[contracttype]`/`#[contract]` emit inherent `impl` blocks (`spec_xdr()`,
// `spec_xdr_<method>()`) with no doc comments of their own; rustc doesn't
// propagate item-level `#[allow]` onto attribute-macro-generated sibling
// impls, so the allow has to be module-scoped.
#![allow(missing_docs)]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, BytesN, Env, String, Vec};

use crate::{
    error::VestingError,
    events, storage,
    types::{DataKey, Milestone, MilestoneSchedule, RateSegment, StreamStatus, VariableRateSchedule, VestingSchedule},
};

/// ~1 year at ~5 s/ledger.
const DRAIN_DELAY_LEDGERS: u32 = 3_153_600;

/// Maximum number of segments allowed in a variable-rate stream.
const MAX_SEGMENTS: u32 = 10;

/// Maximum number of milestones allowed in a milestone-based stream.
const MAX_MILESTONES: u32 = 20;

/// Maximum fee in basis points (5 %).
const MAX_FEE_BPS: u32 = 500;

/// Consolidated statistics for a vesting stream.
///
/// Returned by [`VestingDrips::get_stats`].
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
#[allow(missing_docs)]
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
#[allow(missing_docs)]
pub struct VestingDrips;

#[contractimpl]
impl VestingDrips {
    // ── Initialization ────────────────────────────────────────────────────────

    /// Configures the contract with admin, fee, and treasury settings.
    ///
    /// Must be called **once** immediately after deployment. Subsequent calls
    /// are rejected with `AlreadyInitialized`.
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
    /// * `MetadataTooLong`        – `metadata` exceeds 256 bytes.
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
        Self::create_vesting_stream_with_metadata(
            env,
            sponsor,
            recipient,
            token,
            rate,
            cliff_duration,
            total_duration,
            None,
        )
    }

    /// Creates a new cliff-vesting stream for `recipient` with optional metadata.
    ///
    /// # Errors
    /// Same as `create_vesting_stream` plus:
    /// * `MetadataTooLong` – `metadata` exceeds 256 bytes.
    pub fn create_vesting_stream_with_metadata(
        env: Env,
        sponsor: Address,
        recipient: Address,
        token: Address,
        rate: i128,
        cliff_duration: u32,
        total_duration: u32,
        metadata: Option<String>,
    ) -> Result<(), VestingError> {
        // Bump instance storage TTL on every interaction.
        env.storage()
            .instance()
            .extend_ttl(259_200, 518_400);

        // ── Validation ────────────────────────────────────────────────────────
        if sponsor == recipient {
            return Err(VestingError::InvalidRecipient);
        }
        if rate <= 0 {
            return Err(VestingError::InvalidRate);
        }
        if total_duration <= cliff_duration {
            return Err(VestingError::InvalidDuration);
        }
        if storage::has_schedule(&env, &recipient) {
            return Err(VestingError::ScheduleAlreadyExists);
        }

        // ── Allowlist check ───────────────────────────────────────────────────
        if !storage::is_token_allowed(&env, &token) {
            return Err(VestingError::TokenNotAllowed);
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

        let token_client = token::Client::new(&env, &token);
        token_client
            .try_transfer(&sponsor, &env.current_contract_address(), &total_deposit)
            .map_err(|_| VestingError::TransferFailed)?;

        // ── Collect Protocol Fee (if configured) ──────────────────────────────
        let (fee_bps, treasury_opt) = storage::get_fee(&env);
        if fee_bps > 0 {
            let treasury = treasury_opt.ok_or(VestingError::Unauthorized)?;
            let fee_amount = total_deposit
                .checked_mul(fee_bps as i128)
                .ok_or(VestingError::DepositOverflow)?
                / 10_000;

            if fee_amount > 0 {
                token_client
                    .try_transfer(&sponsor, &treasury, &fee_amount)
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
            dust: 0,
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
            &metadata,
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
    /// * `InvalidRecipient`      – `sponsor == recipient`.
    /// * `ScheduleAlreadyExists` – A milestone schedule already exists for `recipient`.
    /// * `InvalidMilestones`     – Milestones are empty, out-of-order, or bps ≠ 10000.
    /// * `DepositBelowMinimum`   – `total_deposit` is below the configured minimum.
    /// * `TransferFailed`        – Token transfer failed.
    pub fn create_milestone_stream(
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

        let mut total_bps: u32 = 0;
        let mut prev_ledger: u32 = 0;
        let mut milestone_vec: Vec<Milestone> = Vec::new(&env);

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

        let mut schedule =
            storage::get_schedule(&env, &recipient).ok_or(VestingError::ScheduleNotFound)?;

        // Paused streams cannot be claimed.
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

        let mut schedule =
            storage::get_schedule(&env, &recipient).ok_or(VestingError::ScheduleNotFound)?;

        // Increment version before any state mutation (Issue #318).
        schedule.increment_version()?;

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

    /// Pauses an active stream, halting token accrual at current ledger.
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

        if new_recipient == schedule.sponsor {
            return Err(VestingError::InvalidRecipient);
        }

        if storage::has_schedule(&env, &new_recipient) {
            return Err(VestingError::ScheduleAlreadyExists);
        }

        storage::remove_schedule(&env, &current_recipient);
        storage::set_schedule(&env, &new_recipient, &schedule);
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

        let total_deposited =
            (schedule.end_ledger - schedule.start_ledger) as i128 * schedule.rate_per_ledger;
        let remaining = total_deposited - schedule.claimed_amount;

        // Test that clawback is supported by attempting a zero-value clawback.
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
    /// * `ScheduleNotFound`     – No stream exists for `recipient`.
    /// * `StreamNotExpired`     – `end_ledger` has not yet been reached.
    /// * `DrainDelayNotExpired` – Drain delay has not elapsed since `end_ledger`.
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

    // ── Read-only views ───────────────────────────────────────────────────────

    /// Returns the vesting schedule for `recipient`, or `None`.
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

    /// Returns the number of tokens claimable from a variable-rate stream.
    ///
    /// Returns `0` if the cliff has not been reached or no schedule exists.
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

    /// Returns the current [`StreamStatus`] for `recipient`.
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

    /// Returns the version string for the contract.
    pub fn get_version(_env: Env) -> soroban_sdk::String {
        soroban_sdk::String::from_str(&_env, env!("CARGO_PKG_VERSION"))
    }
}

// ── Free functions ────────────────────────────────────────────────────────────

/// Computes the full deposit for a stream.
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
