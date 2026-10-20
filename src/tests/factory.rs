//! # Test Data Factory
//!
//! Provides reproducible, named stream scenarios for use across all test files.
//! Each factory function returns a `(TestStream, Addresses)` pair describing
//! the contract state and the participating actors at the point of return.
//!
//! ## Default Stream Parameters
//!
//! All factories default to the following canonical stream unless overridden
//! through the builder:
//!
//! | Parameter        | Value | Derived               |
//! |------------------|-------|-----------------------|
//! | `rate_per_ledger`| 10    |                       |
//! | `cliff_duration` | 50    | cliff at ledger 150   |
//! | `total_duration` | 200   | end   at ledger 300   |
//! | `deposit`        | 2 000 | rate × total_duration |
//! | `start_ledger`   | 100   | env initial sequence  |
//!
//! ## Usage
//!
//! ```rust,ignore
//! use crate::tests::factory;
//!
//! #[test]
//! fn my_test() {
//!     let env = setup_env();
//!     let (stream, addrs) = factory::pre_cliff_stream(&env);
//!     // stream.client.claim_vested(&addrs.recipient).unwrap_err();
//! }
//! ```

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    tests::{advance_ledger, setup_env},
};
use super::token_helper::{create_token, mint_to};

// ── Public types ──────────────────────────────────────────────────────────────

/// A fully initialised test contract together with its client.
pub struct TestStream<'env> {
    /// The on-chain contract address.
    pub contract_id: Address,
    /// A pre-wired client bound to `contract_id`.
    pub client: VestingDripsClient<'env>,
    /// The SAC token address used in this stream.
    pub token: Address,
    /// Immutable parameters the stream was created with.
    pub params: StreamParams,
}

/// The key participants in a test stream.
pub struct Addresses {
    /// The funder who created (and can cancel) the stream.
    pub sponsor: Address,
    /// The beneficiary who claims vested tokens.
    pub recipient: Address,
}

/// Snapshot of the parameters used when the stream was created.
#[derive(Clone, Debug)]
pub struct StreamParams {
    pub rate: i128,
    pub cliff_duration: u32,
    pub total_duration: u32,
    /// Total tokens deposited: `rate × total_duration`.
    pub deposit: i128,
    /// Ledger at which the stream was created (`start_ledger`).
    pub start_ledger: u32,
    /// Absolute cliff ledger: `start_ledger + cliff_duration`.
    pub cliff_ledger: u32,
    /// Absolute end ledger: `start_ledger + total_duration`.
    pub end_ledger: u32,
}

// ── Builder ───────────────────────────────────────────────────────────────────

/// Fluent builder for customising stream parameters before creation.
///
/// ```rust,ignore
/// let (stream, addrs) = StreamBuilder::default()
///     .rate(20)
///     .cliff_duration(100)
///     .total_duration(400)
///     .build(&env);
/// ```
pub struct StreamBuilder {
    rate: i128,
    cliff_duration: u32,
    total_duration: u32,
}

impl Default for StreamBuilder {
    fn default() -> Self {
        Self {
            rate: 10,
            cliff_duration: 50,
            total_duration: 200,
        }
    }
}

impl StreamBuilder {
    /// Override the tokens-per-ledger rate.
    pub fn rate(mut self, rate: i128) -> Self {
        self.rate = rate;
        self
    }

    /// Override the cliff duration (in ledgers from stream start).
    pub fn cliff_duration(mut self, ledgers: u32) -> Self {
        self.cliff_duration = ledgers;
        self
    }

    /// Override the total stream duration (in ledgers from stream start).
    pub fn total_duration(mut self, ledgers: u32) -> Self {
        self.total_duration = ledgers;
        self
    }

    /// Register the contract, create a stream, and return the test handles.
    ///
    /// The `env` is assumed to already be positioned at the desired start ledger
    /// (i.e., already have `mock_all_auths()` called and the right sequence set).
    pub fn build<'env>(self, env: &'env Env) -> (TestStream<'env>, Addresses) {
        let contract_id = env.register(VestingDrips, ());
        let client = VestingDripsClient::new(env, &contract_id);

        let sponsor = Address::generate(env);
        let recipient = Address::generate(env);
        let (token, _token_client) = create_token(env, &sponsor);

        let deposit = self.rate * self.total_duration as i128;
        mint_to(env, &token, &sponsor, deposit);

        // Capture start_ledger *before* creation so it matches what the contract stores.
        let start_ledger = env.ledger().sequence();

        client
            .create_vesting_stream(
                &sponsor,
                &recipient,
                &token,
                &self.rate,
                &self.cliff_duration,
                &self.total_duration,
            )
            .unwrap();
        let params = StreamParams {
            rate: self.rate,
            cliff_duration: self.cliff_duration,
            total_duration: self.total_duration,
            deposit,
            start_ledger,
            cliff_ledger: start_ledger + self.cliff_duration,
            end_ledger: start_ledger + self.total_duration,
        };

        let stream = TestStream {
            contract_id,
            client,
            token,
            params,
        };
        let addrs = Addresses { sponsor, recipient };
        (stream, addrs)
    }
}

// ── Named scenario factories ──────────────────────────────────────────────────

/// Returns a stream that has just been created at ledger 100 with the cursor
/// still **before the cliff** (ledger 120, cliff at 150).
///
/// ## Invariants
/// - Current ledger: 120
/// - Cliff ledger:   150  (not yet reached)
/// - `claim_vested` will return `CliffNotReached`
/// - `claimable_amount` returns `0`
/// - `is_cliff_passed` returns `false`
pub fn pre_cliff_stream(env: &Env) -> (TestStream<'_>, Addresses) {
    let result = StreamBuilder::default().build(env);
    // Advance 20 ledgers – still 30 ledgers before the cliff.
    advance_ledger(env, 20);
    result
}

/// Returns a stream positioned **exactly at the cliff** (ledger 150).
///
/// ## Invariants
/// - Current ledger: 150 (== cliff_ledger)
/// - All tokens accrued from start → cliff (50 ledgers × 10 = 500) are claimable
/// - `is_cliff_passed` returns `true`
pub fn at_cliff_stream(env: &Env) -> (TestStream<'_>, Addresses) {
    let result = StreamBuilder::default().build(env);
    // Advance exactly to the cliff (50 ledgers).
    advance_ledger(env, 50);
    result
}

/// Returns a stream with the cursor `ledgers_past_cliff` ledgers **beyond the cliff**.
///
/// ## Invariants (with `ledgers_past_cliff` = L)
/// - Current ledger:  150 + L
/// - Accrued amount:  (50 + L) × 10  (all ledgers since start, unclaimed)
/// - `is_cliff_passed` returns `true`
///
/// # Panics
/// Panics if `ledgers_past_cliff` would move the cursor past the end ledger (ledger 300).
pub fn post_cliff_stream(env: &Env, ledgers_past_cliff: u32) -> (TestStream<'_>, Addresses) {
    assert!(
        ledgers_past_cliff <= 150,
        "ledgers_past_cliff ({ledgers_past_cliff}) would push past end_ledger 300"
    );
    let result = StreamBuilder::default().build(env);
    // Advance cliff_duration + extra to land past the cliff.
    advance_ledger(env, 50 + ledgers_past_cliff);
    result
}

/// Returns a stream where the recipient has **already claimed all vested tokens**
/// past the end ledger (ledger 300+).
///
/// ## Invariants
/// - Current ledger: 600 (well past end_ledger 300)
/// - `claim_vested` has been called; recipient holds 2 000 tokens
/// - Schedule is removed from storage (`get_schedule` → `None`)
/// - Calling `claim_vested` again returns `ScheduleNotFound`
pub fn fully_claimed_stream<'env>(env: &'env Env) -> (TestStream<'env>, Addresses) {
    let (stream, addrs) = StreamBuilder::default().build(env);
    // Jump well past the end ledger so the full deposit is claimable.
    advance_ledger(env, 500);
    stream.client.claim_vested(&addrs.recipient).unwrap();
    (stream, addrs)
}

/// Returns a stream that has been **cancelled by the sponsor** before the cliff
/// (at ledger 120, cliff at 150).
///
/// ## Invariants
/// - Current ledger: 120 (before cliff)
/// - Full deposit (2 000) refunded to sponsor
/// - Schedule removed (`get_schedule` → `None`)
/// - `claim_vested` returns `ScheduleNotFound`
pub fn cancelled_stream<'env>(env: &'env Env) -> (TestStream<'env>, Addresses) {
    let (stream, addrs) = StreamBuilder::default().build(env);
    // Cancel before the cliff – full refund path.
    advance_ledger(env, 20);
    stream.client.cancel_stream(&addrs.sponsor, &addrs.recipient).unwrap();
    (stream, addrs)
}

/// Returns a stream that has **expired** (current ledger is well past `end_ledger`)
/// but was never claimed – all tokens are still held in the contract vault.
///
/// ## Invariants
/// - Current ledger: 600 (past end_ledger 300)
/// - Schedule still active in storage (no claim made)
/// - `claimable_amount` == 2 000 (full deposit claimable)
/// - A single `claim_vested` call will drain the vault completely
pub fn expired_stream<'env>(env: &'env Env) -> (TestStream<'env>, Addresses) {
    let (stream, addrs) = StreamBuilder::default().build(env);
    // Jump way past the end without claiming.
    advance_ledger(env, 500);
    (stream, addrs)
}

// ── Unit tests for the factory itself ────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pre_cliff_stream_invariants() {
        let env = setup_env();
        let (stream, addrs) = pre_cliff_stream(&env);

        // Still before cliff.
        assert!(!stream.client.is_cliff_passed(&addrs.recipient));
        assert_eq!(stream.client.claimable_amount(&addrs.recipient), 0);
    }

    #[test]
    fn test_at_cliff_stream_invariants() {
        let env = setup_env();
        let (stream, addrs) = at_cliff_stream(&env);

        // Exactly at cliff.
        assert!(stream.client.is_cliff_passed(&addrs.recipient));
        // 50 ledgers × rate 10 = 500
        assert_eq!(stream.client.claimable_amount(&addrs.recipient), 500);
    }

    #[test]
    fn test_post_cliff_stream_invariants() {
        let env = setup_env();
        let (stream, addrs) = post_cliff_stream(&env, 50);

        // 100 ledgers past start × 10 = 1000
        assert_eq!(stream.client.claimable_amount(&addrs.recipient), 1_000);
    }

    #[test]
    fn test_fully_claimed_stream_invariants() {
        let env = setup_env();
        let (stream, addrs) = fully_claimed_stream(&env);

        // Schedule removed after full claim.
        assert!(stream.client.get_schedule(&addrs.recipient).is_none());
    }

    #[test]
    fn test_cancelled_stream_invariants() {
        let env = setup_env();
        let (stream, addrs) = cancelled_stream(&env);

        // Schedule removed after cancel.
        assert!(stream.client.get_schedule(&addrs.recipient).is_none());
    }

    #[test]
    fn test_expired_stream_invariants() {
        let env = setup_env();
        let (stream, addrs) = expired_stream(&env);

        // Full deposit still claimable.
        assert_eq!(stream.client.claimable_amount(&addrs.recipient), 2_000);
    }

    #[test]
    fn test_builder_custom_params() {
        let env = setup_env();
        let (stream, addrs) = StreamBuilder::default()
            .rate(5)
            .cliff_duration(20)
            .total_duration(100)
            .build(&env);

        let schedule = stream.client.get_schedule(&addrs.recipient).unwrap();
        assert_eq!(schedule.rate_per_ledger, 5);
        assert_eq!(schedule.cliff_ledger, 120); // 100 + 20
        assert_eq!(schedule.end_ledger, 200);   // 100 + 100
    }
}
