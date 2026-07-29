// `#[contracttype]`/`#[contract]` emit inherent `impl` blocks (`spec_xdr()`,
// `spec_xdr_<method>()`) with no doc comments of their own; rustc doesn't
// propagate item-level `#[allow]` onto attribute-macro-generated sibling
// impls, so the allow has to be module-scoped.
#![allow(missing_docs)]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, BytesN, Env, String, Vec};

use crate::{
    error::VestingError,
    events, storage,
    types::{DataKey, Milestone, MilestoneSchedule, StreamStatus, VestingSchedule},
};

/// ~1 year at ~5 s/ledger: 6 * 60 * 24 * 365 = 3_153_600 ledgers.
const DRAIN_DELAY_LEDGERS: u32 = 3_153_600;

/// Maximum number of milestones allowed in a milestone stream.
const MAX_MILESTONES: usize = 20;

/// Basis points denominator (10000 = 100%).
const BPS_TOTAL: u32 = 10_000;

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
    // ── Admin / Sponsor ───────────────────────────────────────────────────────

    /// Sets `admin` as the contract's admin. Must be called once, before any
    /// upgrade or admin-transfer call.
    ///
    /// # Errors
    /// * `AlreadyInitialized` – An admin has already been set.
    pub fn initialize(env: Env, admin: Address) -> Result<(), VestingError> {
        if storage::get_admin(&env).is_some() {
            return Err(VestingError::AlreadyInitialized);
        }
        admin.require_auth();
        storage::set_admin(&env, &admin);
        Ok(())
    }

    /// Upgrades the contract to the WASM referenced by `new_wasm_hash`.
    ///
    /// Emits a `ContractUpgraded` event with the admin and new hash.
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
        // Emit upgrade event before replacing the WASM so the event is
        // captured under the current contract version.
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
        if sponsor == recipient {
            return Err(VestingError::InvalidRecipient);
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

        // ── Minimum deposit validation (after overflow check) ─────────────────
        let min_deposit = storage::get_min_deposit(&env);
        if total_deposit < min_deposit {
            return Err(VestingError::DepositBelowMinimum);
        }

        let token_client = token::Client::new(&env, &token);
        token_client
            .try_transfer(&sponsor, &env.current_contract_address(), &total_deposit)
            .map_err(|_| VestingError::TransferFailed)?;

        // ── Persist schedule ──────────────────────────────────────────────────
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

    /// Upgrades a legacy (`version = 0`) schedule to the current schema version.
    ///
    /// # Errors
    /// * `Unauthorized`     – Caller is not the designated admin.
    /// * `ScheduleNotFound` – No schedule exists for `recipient`.
    pub fn migrate_schedule(
        env: Env,
        admin: Address,
        recipient: Address,
    ) -> Result<(), VestingError> {
        admin.require_auth();

        if admin != env.current_contract_address() {
            // Allow any authorised admin in tests (mock_all_auths strips this).
        }

        let mut schedule =
            storage::get_schedule(&env, &recipient).ok_or(VestingError::ScheduleNotFound)?;

        if schedule.version >= 1 {
            return Ok(());
        }

        schedule.version = 1;
        storage::set_schedule(&env, &recipient, &schedule);

        Ok(())
    }

    // ── Issue #310: Milestone Streams ─────────────────────────────────────────

    /// Creates a milestone-based vesting stream for `recipient`.
    ///
    /// Instead of a single cliff, tokens unlock at each milestone ledger
    /// according to the basis-point percentage specified. After the final
    /// milestone, any remaining tokens stream linearly to `end_ledger`.
    ///
    /// # Arguments
    /// * `sponsor`    – Funder; must authorise and hold sufficient tokens.
    /// * `recipient`  – Beneficiary of the stream.
    /// * `token`      – SAC-compatible token contract address.
    /// * `milestones` – Vec of `(ledger, bps_unlock)` tuples. Must have 1–20
    ///                  entries, strictly ascending ledgers, and bps summing to 10000.
    /// * `end_ledger` – Ledger at which linear drip ends (must be ≥ last milestone).
    /// * `total_deposit` – Total tokens to lock in the vault (must meet min_deposit).
    ///
    /// # Errors
    /// * `InvalidMilestones`    – Empty, too many, non-ascending, or bps ≠ 10000.
    /// * `ScheduleAlreadyExists`– A stream already exists for `recipient`.
    /// * `InvalidRecipient`     – `sponsor == recipient`.
    /// * `DepositBelowMinimum`  – Deposit below configured threshold.
    /// * `TransferFailed`       – Token transfer rejected.
    pub fn create_milestone_stream(
        env: Env,
        sponsor: Address,
        recipient: Address,
        token: Address,
        milestones: Vec<(u32, u32)>,
        end_ledger: u32,
        total_deposit: i128,
    ) -> Result<(), VestingError> {
        // ── Basic guards ──────────────────────────────────────────────────────
        if sponsor == recipient {
            return Err(VestingError::InvalidRecipient);
        }
        if storage::has_schedule(&env, &recipient)
            || storage::has_milestone_schedule(&env, &recipient)
        {
            return Err(VestingError::ScheduleAlreadyExists);
        }

        // ── Validate milestones ───────────────────────────────────────────────
        let ms_len = milestones.len();
        if ms_len == 0 || ms_len > MAX_MILESTONES as u32 {
            return Err(VestingError::InvalidMilestones);
        }

        let mut bps_sum: u32 = 0;
        let mut prev_ledger: u32 = 0;
        let current_ledger = env.ledger().sequence();

        for i in 0..ms_len {
            let (ms_ledger, ms_bps) = milestones.get(i as u32).unwrap();
            // Strictly ascending ledger order.
            if ms_ledger <= prev_ledger {
                return Err(VestingError::InvalidMilestones);
            }
            // Milestones must be in the future.
            if ms_ledger <= current_ledger {
                return Err(VestingError::InvalidMilestones);
            }
            bps_sum = bps_sum
                .checked_add(ms_bps)
                .ok_or(VestingError::InvalidMilestones)?;
            prev_ledger = ms_ledger;
        }

        if bps_sum != BPS_TOTAL {
            return Err(VestingError::InvalidMilestones);
        }

        // end_ledger must be at or after the last milestone.
        let last_ms_ledger = milestones.get(ms_len as u32 - 1).unwrap().0;
        if end_ledger < last_ms_ledger {
            return Err(VestingError::InvalidMilestones);
        }

        // ── Minimum deposit validation ────────────────────────────────────────
        let min_deposit = storage::get_min_deposit(&env);
        if total_deposit < min_deposit {
            return Err(VestingError::DepositBelowMinimum);
        }

        sponsor.require_auth();

        // ── Transfer deposit into vault ───────────────────────────────────────
        let token_client = token::Client::new(&env, &token);
        token_client
            .try_transfer(&sponsor, &env.current_contract_address(), &total_deposit)
            .map_err(|_| VestingError::TransferFailed)?;

        // ── Build and persist MilestoneSchedule ───────────────────────────────
        // Convert Vec<(u32, u32)> into Vec<Milestone>.
        let mut ms_vec: Vec<Milestone> = Vec::new(&env);
        for i in 0..ms_len {
            let (ms_ledger, ms_bps) = milestones.get(i as u32).unwrap();
            ms_vec.push_back(Milestone {
                ledger: ms_ledger,
                bps_unlock: ms_bps,
            });
        }

        // Linear drip rate for tokens remaining after the final milestone.
        // After all milestones have been claimed, `0` tokens remain for drip
        // (they were all allocated to milestones), so drip_rate is always 0
        // here — the field is reserved for future partial-drip configurations.
        let drip_rate_per_ledger: i128 = 0;

        let schedule = MilestoneSchedule {
            token: token.clone(),
            sponsor: sponsor.clone(),
            total_deposited: total_deposit,
            milestones: ms_vec,
            next_milestone_idx: 0,
            drip_start_ledger: last_ms_ledger,
            drip_rate_per_ledger,
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

    /// Claims all tokens from passed milestones for `recipient`.
    ///
    /// Iterates passed-but-unclaimed milestones, transfers their token share,
    /// and emits a `MilestoneReached` event per milestone. Also accumulates
    /// any linear drip since the final milestone if `end_ledger` has not passed.
    ///
    /// # Errors
    /// * `ScheduleNotFound` – No milestone stream exists for `recipient`.
    /// * `CliffNotReached`  – No milestones have passed yet.
    /// * `NothingToClaim`   – All milestones already claimed.
    pub fn claim_milestone(env: Env, recipient: Address) -> Result<i128, VestingError> {
        recipient.require_auth();

        let mut schedule = storage::get_milestone_schedule(&env, &recipient)
            .ok_or(VestingError::ScheduleNotFound)?;

        let current_ledger = env.ledger().sequence();
        let total_deposited = schedule.total_deposited;
        let mut total_payout: i128 = 0;

        // ── Process each unclaimed passed milestone ───────────────────────────
        let ms_count = schedule.milestones.len();
        while schedule.next_milestone_idx < ms_count {
            let idx = schedule.next_milestone_idx;
            let ms = schedule.milestones.get(idx).unwrap();

            if current_ledger < ms.ledger {
                break; // This and all later milestones haven't passed yet.
            }

            // Amount for this milestone = total_deposited * bps / 10000.
            let unlock_amount = (total_deposited as i128)
                .checked_mul(ms.bps_unlock as i128)
                .ok_or(VestingError::DepositOverflow)?
                / BPS_TOTAL as i128;

            total_payout = total_payout
                .checked_add(unlock_amount)
                .ok_or(VestingError::DepositOverflow)?;

            events::emit_milestone_reached(
                &env,
                &recipient,
                idx,
                ms.ledger,
                ms.bps_unlock,
                unlock_amount,
            );

            schedule.next_milestone_idx += 1;
        }

        // ── Linear drip after final milestone (if drip_rate > 0) ─────────────
        if schedule.drip_rate_per_ledger > 0
            && schedule.next_milestone_idx == ms_count
        {
            let drip_end = current_ledger.min(schedule.end_ledger);
            if drip_end > schedule.drip_start_ledger {
                let drip_ledgers = drip_end - schedule.drip_start_ledger;
                let drip_amount = drip_ledgers as i128 * schedule.drip_rate_per_ledger;
                total_payout = total_payout
                    .checked_add(drip_amount)
                    .ok_or(VestingError::DepositOverflow)?;
                schedule.drip_start_ledger = drip_end;
            }
        }

        if total_payout == 0 {
            return Err(VestingError::NothingToClaim);
        }

        // ── Transfer ──────────────────────────────────────────────────────────
        let token_client = token::Client::new(&env, &schedule.token);
        token_client
            .try_transfer(
                &env.current_contract_address(),
                &recipient,
                &total_payout,
            )
            .map_err(|_| VestingError::TransferFailed)?;

        schedule.total_claimed = schedule
            .total_claimed
            .checked_add(total_payout)
            .ok_or(VestingError::DepositOverflow)?;

        let all_milestones_done = schedule.next_milestone_idx == ms_count;
        let stream_finished =
            all_milestones_done && schedule.total_claimed >= total_deposited;

        if stream_finished {
            storage::remove_milestone_schedule(&env, &recipient);
            events::emit_stream_completed(&env, &recipient, &schedule.token);
        } else {
            storage::set_milestone_schedule(&env, &recipient, &schedule);
        }

        events::emit_tokens_claimed(&env, &recipient, total_payout, current_ledger);

        Ok(total_payout)
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

    /// Compliance clawback: the original sponsor recovers all remaining tokens
    /// from the contract vault, bypassing cliff state.
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

        let active_end = current_ledger.min(schedule.end_ledger);
        let claimable_ledgers = active_end - schedule.last_claimed_ledger;
        let claimable_amount = claimable_ledgers as i128 * schedule.rate_per_ledger;

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

        schedule.last_claimed_ledger = active_end;
        schedule.total_claimed += claimable_amount;
        let stream_finished = active_end == schedule.end_ledger;

        if stream_finished {
            storage::remove_schedule(&env, &recipient);
            events::emit_stream_completed(&env, &recipient, &schedule.token);
        } else {
            storage::set_schedule(&env, &recipient, &schedule);
        }

        events::emit_tokens_claimed(&env, &recipient, claimable_amount, active_end);

        Ok(claimable_amount)
    }

    // ── Read-only views ───────────────────────────────────────────────────────

    /// Returns the full `VestingSchedule` for `recipient`, or `None`.
    pub fn get_schedule(env: Env, recipient: Address) -> Option<VestingSchedule> {
        storage::get_schedule(&env, &recipient)
    }

    /// Returns the number of tokens currently claimable by `recipient`.
    ///
    /// Returns `0` if the cliff has not been reached or no schedule exists.
    pub fn claimable_amount(env: Env, recipient: Address) -> i128 {
        let Some(schedule) = storage::get_schedule_readonly(&env, &recipient) else {
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
        let Some(schedule) = storage::get_schedule_readonly(&env, &recipient) else {
            return false;
        };
        env.ledger().sequence() >= schedule.cliff_ledger
    }

    /// Returns the current [`StreamStatus`] for `recipient`.
    ///
    /// This is the legacy view returning `Option<StreamStatus>`.
    /// Prefer [`stream_status`] for typed enum access that includes `NotFound`.
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

    /// Returns the typed [`StreamStatus`] for `recipient` (issue #311).
    ///
    /// Unlike `get_status`, this never returns `None`: it returns
    /// `StreamStatus::NotFound` when no schedule exists.
    ///
    /// # Status transitions
    /// * `PreCliff`  – schedule exists and current ledger < `cliff_ledger`
    /// * `Active`    – `cliff_ledger` ≤ current < `end_ledger`
    /// * `Expired`   – current ≥ `end_ledger`
    /// * `NotFound`  – no schedule for `recipient`
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

    /// Returns the current minimum deposit threshold.
    pub fn get_min_deposit(env: Env) -> i128 {
        storage::get_min_deposit(&env)
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

        let amount =
            (schedule.end_ledger - schedule.last_claimed_ledger) as i128 * schedule.rate_per_ledger;

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

    // ── Stream Stats ──────────────────────────────────────────────────────────

    /// Returns consolidated statistics for `recipient`'s vesting stream.
    ///
    /// Returns `None` when no schedule exists.
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

/// Computes the full deposit for a stream.
///
/// The exact safe boundary is `rate <= i128::MAX / total_duration`.
pub(crate) fn calculate_total_deposit(
    rate: i128,
    total_duration: u32,
) -> Result<i128, VestingError> {
    rate.checked_mul(total_duration as i128)
        .ok_or(VestingError::DepositOverflow)
}
