//! Security test suite: authentication bypass attempts (closes #783).
//!
//! This module systematically attempts to bypass `require_auth()` on every
//! protected contract entry point. Authentication bugs in smart contracts are
//! catastrophic — a single exploitable bypass can drain all vested funds.
//!
//! # How Soroban auth enforcement works in tests
//!
//! The Soroban host enforces `require_auth()` calls at execution time. In a
//! test environment that has **not** called `mock_all_auths()`, any invocation
//! whose required authoriser has not been explicitly approved causes the host
//! to panic immediately. We exploit this with `#[should_panic]` tests that
//! deliberately omit the auth mock.
//!
//! # Auth requirement matrix
//!
//! | Entry point             | Auth subject | Documented requirement                                        |
//! |-------------------------|--------------|---------------------------------------------------------------|
//! | `create_vesting_stream` | `sponsor`    | Sponsor must sign; they pay the deposit                       |
//! | `cancel_stream`         | `sponsor`    | Only the original stream funder can cancel                    |
//! | `clawback_stream`       | `sponsor`    | Only the original stream funder can clawback; also checks identity |
//! | `set_min_deposit`       | `admin`      | Only the contract admin (set during `initialize`) can update  |
//! | `pause_stream`          | `sponsor`    | Only the original stream funder can pause or resume           |
//! | `pause_stream` (replay) | `sponsor`    | Auth from a previous env is not transferable (replay rejected)|

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, LedgerInfo},
    Address, Env, String as SorobanString,
};

use crate::{
    contract::{VestingDrips, VestingDripsClient},
    tests::token_helper::{create_token, mint_to},
};

// ── Environment helpers ───────────────────────────────────────────────────────

/// Build a Soroban test env with **no** mocked auths.
///
/// `require_auth()` calls in this env will panic, which is exactly the
/// behaviour we want to assert in these security tests.
fn strict_env() -> Env {
    let env = Env::default();
    // Intentionally do NOT call env.mock_all_auths().
    env.ledger().set(LedgerInfo {
        timestamp: 0,
        protocol_version: 22,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 1000,
        max_entry_ttl: 3_110_400,
    });
    env
}

/// Build a Soroban test env with all auths mocked (for setup phases only).
fn mocked_env() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(LedgerInfo {
        timestamp: 0,
        protocol_version: 22,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 1000,
        max_entry_ttl: 3_110_400,
    });
    env
}

// ── Shared stream-creation helper ─────────────────────────────────────────────

/// Creates a stream with mocked auth, then returns a client on the *same* env
/// but with mocking cleared — so all further calls enforce auth strictly.
///
/// Returns `(env, contract_id, sponsor, recipient, token_id)`.
fn create_stream_then_revoke_mock() -> (Env, Address, Address, Address, Address) {
    let env = mocked_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    // Initialize the contract (required before any stream can be created).
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury).unwrap();

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &10, &100, &None)
        .unwrap();

    // Advance past cliff (cliff_ledger = start(100) + cliff_dur(10) = 110).
    env.ledger().set(LedgerInfo {
        timestamp: 0,
        protocol_version: 22,
        sequence_number: 120,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 1000,
        max_entry_ttl: 3_110_400,
    });

    // Revoke all mocked auth so the remaining calls in the test enforce auth.
    env.set_auths(&[]);

    (env, contract_id, sponsor, recipient, token_id)
}

// ══════════════════════════════════════════════════════════════════════════════
// Attack vector 1: create_vesting_stream without sponsor auth
// ══════════════════════════════════════════════════════════════════════════════

/// **Auth requirement**: `create_vesting_stream` calls `sponsor.require_auth()`.
/// The sponsor must explicitly sign the transaction that creates a stream on
/// their behalf.
///
/// **Attack vector**: A third-party attacker calls `create_vesting_stream`
/// without holding the sponsor's private key or granting authorisation.
///
/// **Expected result**: The Soroban host panics because `sponsor.require_auth()`
/// is not satisfied — the stream cannot be created on behalf of an arbitrary
/// address without their consent.
#[test]
#[should_panic]
fn test_auth_security_create_stream_no_sponsor_auth() {
    let env = strict_env(); // no mocked auths
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000);

    // No auth mocked → host panics when sponsor.require_auth() is checked
    // inside create_vesting_stream. The attacker cannot open a drain on the
    // sponsor's token balance.
    let _ = client.create_vesting_stream(
        &sponsor,
        &recipient,
        &token_id,
        &10,
        &10,
        &100,
        &None,
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// Attack vector 2: cancel_stream as non-sponsor
// ══════════════════════════════════════════════════════════════════════════════

/// **Auth requirement**: `cancel_stream` calls `sponsor.require_auth()` and
/// additionally enforces `schedule.sponsor == sponsor`, returning
/// `Unauthorized` on mismatch.
///
/// **Attack vector**: A random third-party attacker attempts to cancel a stream
/// they did not create by passing their own address as `sponsor`.
///
/// **Expected result**: Panics at `sponsor.require_auth()` because the attacker
/// has no auth grant in this strict environment.
#[test]
#[should_panic]
fn test_auth_security_cancel_stream_non_sponsor_panics() {
    let (env, contract_id, _sponsor, recipient, _token_id) = create_stream_then_revoke_mock();
    let client = VestingDripsClient::new(&env, &contract_id);

    // Attacker generates their own address but holds no auth grant.
    let attacker = Address::generate(&env);

    // Panics: attacker.require_auth() is not satisfied.
    let _ = client.cancel_stream(&attacker, &recipient);
}

/// **Auth requirement**: `cancel_stream` checks that the caller is the
/// original stream sponsor, rejecting any other address.
///
/// **Attack vector**: The recipient attempts to cancel their own stream by
/// passing themselves as the `sponsor` argument — hoping to recover more
/// tokens than they are entitled to (e.g., cancelling before vest).
///
/// **Expected result**: Panics because recipient's auth as sponsor is not
/// granted in this strict environment.
#[test]
#[should_panic]
fn test_auth_security_cancel_stream_recipient_as_sponsor_panics() {
    let (env, contract_id, _sponsor, recipient, _token_id) = create_stream_then_revoke_mock();
    let client = VestingDripsClient::new(&env, &contract_id);

    // Recipient passes themselves as sponsor. No auth grant for recipient
    // acting as sponsor → panics.
    let _ = client.cancel_stream(&recipient, &recipient);
}

// ══════════════════════════════════════════════════════════════════════════════
// Attack vector 3: clawback_stream as non-sponsor
// ══════════════════════════════════════════════════════════════════════════════

/// **Auth requirement**: `clawback_stream` calls `sponsor.require_auth()` and
/// checks `schedule.sponsor == sponsor`, returning `Unauthorized` on mismatch.
///
/// **Attack vector**: A random attacker calls `clawback_stream` with their own
/// address as `sponsor`, attempting to drain the vesting vault to themselves
/// under the guise of a "compliance clawback".
///
/// **Expected result**: Panics at `attacker.require_auth()` — the attacker has
/// no auth grant and cannot impersonate the original sponsor.
#[test]
#[should_panic]
fn test_auth_security_clawback_stream_non_sponsor_panics() {
    let env = strict_env(); // no mocked auths
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let attacker = Address::generate(&env);
    let victim_recipient = Address::generate(&env);
    let reason = SorobanString::from_str(&env, "fraudulent clawback attempt");

    // No auth mocked → panics at attacker.require_auth() inside clawback_stream.
    let _ = client.clawback_stream(&attacker, &victim_recipient, &reason);
}

// ══════════════════════════════════════════════════════════════════════════════
// Attack vector 4: set_min_deposit as non-admin
// ══════════════════════════════════════════════════════════════════════════════

/// **Auth requirement**: `set_min_deposit` calls `admin.require_auth()`. Only
/// the address stored as admin during `initialize` may call this function.
///
/// **Attack vector**: An unprivileged caller attempts to lower the minimum
/// deposit threshold, enabling them (or an accomplice) to create micro-streams
/// that would otherwise be rejected, potentially gaming the protocol economics.
///
/// **Expected result**: Panics because `fake_admin.require_auth()` is not
/// satisfied in this strict environment.
#[test]
#[should_panic]
fn test_auth_security_set_min_deposit_non_admin_panics() {
    let env = strict_env(); // no mocked auths
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let fake_admin = Address::generate(&env);

    // No auth mocked → panics at fake_admin.require_auth() inside set_min_deposit.
    let _ = client.set_min_deposit(&fake_admin, &1_i128);
}

// ══════════════════════════════════════════════════════════════════════════════
// Attack vector 5: pause_stream by recipient
// ══════════════════════════════════════════════════════════════════════════════

/// **Auth requirement**: `pause_stream` calls `sponsor.require_auth()` and
/// checks `schedule.sponsor == sponsor` (returns `Unauthorized` on mismatch).
/// Only the original stream funder can pause or resume a stream.
///
/// **Attack vector**: The recipient attempts to pause their own stream by
/// passing themselves as `sponsor` — for example, to extend their vesting
/// window by accumulating pause-time credits that shift the end_ledger.
///
/// **Expected result**: Panics because recipient's auth as sponsor is not
/// granted in this strict environment.
#[test]
#[should_panic]
fn test_auth_security_pause_stream_as_recipient_panics() {
    let env = strict_env(); // no mocked auths
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let recipient = Address::generate(&env);

    // Recipient passes themselves as sponsor. No auth grant → panics.
    let _ = client.pause_stream(&recipient, &recipient);
}

// ══════════════════════════════════════════════════════════════════════════════
// Attack vector 6: replay — stale mocked auth is not transferable
// ══════════════════════════════════════════════════════════════════════════════

/// **Auth requirement**: Soroban auth grants are scoped to individual
/// invocations. `set_auths(&[])` clears all previously mocked auth so that
/// subsequent calls enforce real auth checking.
///
/// **Attack vector**: An attacker hopes that auth granted earlier (during
/// stream creation) persists and can be reused to authorise a later privileged
/// call (e.g., cancellation) without re-signing.
///
/// **Expected result**: Panics because auth was cleared with `set_auths(&[])`
/// after stream creation. The old mock does not carry over — sponsor's
/// `require_auth()` fails on the cancel call, simulating a replay rejection.
#[test]
#[should_panic]
fn test_auth_security_replay_stale_auth_panics() {
    // Phase 1: legitimate stream creation with mocked auth.
    let env = mocked_env();
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &0u32, &treasury).unwrap();

    let sponsor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, _) = create_token(&env, &sponsor);
    mint_to(&env, &token_id, &sponsor, 1_000);

    client
        .create_vesting_stream(&sponsor, &recipient, &token_id, &10, &10, &100, &None)
        .unwrap();

    // Phase 2: revoke the mocked auth — simulates the transaction window closing.
    // Any further auth checks will now be enforced without mocking.
    env.set_auths(&[]);

    // Phase 3 (replay attempt): try to cancel the stream using the now-expired
    // auth grant. The `require_auth()` on sponsor panics because the mock was
    // cleared — proof that auth is not persistent across invocations.
    let _ = client.cancel_stream(&sponsor, &recipient);
}
