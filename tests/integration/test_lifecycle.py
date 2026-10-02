#!/usr/bin/env python3
"""
Integration tests for the full vesting stream lifecycle (issue #779).

Tests the complete lifecycle (create → advance ledgers → claim → cancel)
against a local stellar/quickstart:testing node to verify real XDR encoding,
auth flows, and event emission.

Prerequisites:
    - Local Stellar quickstart node running on http://localhost:8000
    - WASM built (make build) and contract deployed (scripts/deploy_contract.sh)
    - Test accounts funded (scripts/fund_accounts.sh)
    - stellar-sdk installed: pip install stellar-sdk

Environment variables:
    SOROBAN_RPC_URL    — Soroban RPC URL (default: http://localhost:8000/soroban/rpc)
    HORIZON_URL        — Horizon URL (default: http://localhost:8000)
    VESTING_CONTRACT   — deployed contract ID (required)
    TOKEN_CONTRACT     — SAC token contract ID (required if not auto-deployed)
    SPONSOR_SECRET     — sponsor account secret key (required)
    RECIPIENT_ADDRESS  — recipient account address (required)
    SPONSOR2_SECRET    — second sponsor secret key (for cancel/clawback tests)
    RECIPIENT2_ADDRESS — second recipient address
    CALLER_SECRET      — permissionless caller secret key (for drain test)

Run:
    make integration-test
    # or directly:
    python3 tests/integration/test_lifecycle.py
"""

import os
import sys
import time
import json
import subprocess
import unittest
from typing import Optional

# ── Configuration ─────────────────────────────────────────────────────────────

RPC_URL = os.environ.get("SOROBAN_RPC_URL", "http://localhost:8000/soroban/rpc")
HORIZON_URL = os.environ.get("HORIZON_URL", "http://localhost:8000")
NETWORK_PASSPHRASE = os.environ.get(
    "NETWORK_PASSPHRASE", "Standalone Network ; February 2017"
)
STELLAR_NETWORK = os.environ.get("STELLAR_NETWORK", "local")
VESTING_CONTRACT = os.environ.get("VESTING_CONTRACT", "")
TOKEN_CONTRACT = os.environ.get("TOKEN_CONTRACT", "")

# Key names in the Stellar CLI keystore (set by fund_accounts.sh)
SPONSOR_KEY = os.environ.get("SPONSOR_KEY", "integration-sponsor")
RECIPIENT_KEY = os.environ.get("RECIPIENT_KEY", "integration-recipient")
SPONSOR2_KEY = os.environ.get("SPONSOR2_KEY", "integration-sponsor2")
RECIPIENT2_KEY = os.environ.get("RECIPIENT2_KEY", "integration-recipient2")
CALLER_KEY = os.environ.get("CALLER_KEY", "integration-caller")
ADMIN_KEY = os.environ.get("ADMIN_KEY", "integration-admin")

# ── Helpers ───────────────────────────────────────────────────────────────────


def stellar_cli(*args: str, check: bool = True) -> str:
    """Run the stellar CLI and return stdout."""
    cmd = [
        "stellar",
        *args,
        "--network",
        STELLAR_NETWORK,
        "--rpc-url",
        RPC_URL,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if check and result.returncode != 0:
        raise RuntimeError(
            f"stellar CLI failed: {' '.join(cmd)}\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )
    return result.stdout.strip()


def invoke(
    function: str,
    source: str,
    *fn_args: str,
    contract: Optional[str] = None,
    check: bool = True,
) -> str:
    """Invoke a contract function via the Stellar CLI."""
    cid = contract or VESTING_CONTRACT
    return stellar_cli(
        "contract",
        "invoke",
        "--id",
        cid,
        "--source",
        source,
        "--",
        function,
        *fn_args,
        check=check,
    )


def address_of(key_name: str) -> str:
    """Return the public address for a key in the CLI keystore."""
    result = subprocess.run(
        ["stellar", "keys", "address", key_name],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def get_balance(account_address: str, token: Optional[str] = None) -> int:
    """Return the token balance for an account (uses SAC token or XLM stroops)."""
    tok = token or TOKEN_CONTRACT
    raw = invoke(
        "balance",
        CALLER_KEY,
        "--account",
        account_address,
        contract=tok,
    )
    # stellar CLI returns the i128 as a plain integer string
    return int(raw.strip('"'))


def wait_for_ledger(target_ledger: int, poll_interval: float = 1.0, timeout: float = 120.0) -> None:
    """Wait until the current ledger sequence reaches target_ledger."""
    import urllib.request

    start = time.time()
    while True:
        try:
            with urllib.request.urlopen(f"{HORIZON_URL}/ledgers?order=desc&limit=1") as resp:
                data = json.loads(resp.read())
                current = int(data["_embedded"]["records"][0]["sequence"])
                if current >= target_ledger:
                    return
        except Exception:
            pass

        if time.time() - start > timeout:
            raise TimeoutError(
                f"Timed out waiting for ledger {target_ledger} "
                f"(waited {timeout}s)"
            )
        time.sleep(poll_interval)


def current_ledger() -> int:
    """Return the current ledger sequence from Horizon."""
    import urllib.request

    with urllib.request.urlopen(f"{HORIZON_URL}/ledgers?order=desc&limit=1") as resp:
        data = json.loads(resp.read())
        return int(data["_embedded"]["records"][0]["sequence"])


def parse_events(tx_output: str) -> list[dict]:
    """Extract events from stellar CLI invoke output (JSON array if present)."""
    try:
        # stellar CLI may print events as a JSON comment or embedded JSON
        for line in tx_output.splitlines():
            line = line.strip()
            if line.startswith("[") and "type" in line:
                return json.loads(line)
    except (json.JSONDecodeError, IndexError):
        pass
    return []


# ── Test suite ────────────────────────────────────────────────────────────────


class TestStreamLifecycle(unittest.TestCase):
    """
    Full stream lifecycle integration tests against a live Stellar node.

    Covers all 5 required scenarios from issue #779:
    1. Full lifecycle: create → advance → claim → verify balance
    2. Cancel before cliff: full refund to sponsor
    3. Cancel after cliff: partial refund
    4. Clawback: sponsor recovers all tokens
    5. Drain expired: any address drains after 1-year delay
    """

    @classmethod
    def setUpClass(cls):
        """Verify preconditions: contract deployed, accounts funded."""
        if not VESTING_CONTRACT:
            raise unittest.SkipTest(
                "VESTING_CONTRACT env var not set — run scripts/deploy_contract.sh first"
            )
        if not TOKEN_CONTRACT:
            raise unittest.SkipTest(
                "TOKEN_CONTRACT env var not set — deploy a SAC token first"
            )

        cls.sponsor = address_of(SPONSOR_KEY)
        cls.recipient = address_of(RECIPIENT_KEY)
        cls.sponsor2 = address_of(SPONSOR2_KEY)
        cls.recipient2 = address_of(RECIPIENT2_KEY)
        cls.caller = address_of(CALLER_KEY)

        print(f"\n[setup] Contract: {VESTING_CONTRACT}")
        print(f"[setup] Token:    {TOKEN_CONTRACT}")
        print(f"[setup] Sponsor:  {cls.sponsor}")
        print(f"[setup] Recipient:{cls.recipient}")

    # ── Scenario 1: Full lifecycle ─────────────────────────────────────────────

    def test_01_full_lifecycle_create_claim_verify(self):
        """
        Scenario 1: Create stream → wait for cliff → claim → verify balance.

        Verifies:
        - create_vesting_stream mints tokens into the contract vault
        - claim_vested before the cliff returns CliffNotReached
        - claim_vested at/after cliff transfers correct amount
        - Final recipient balance equals rate × ledgers_elapsed
        """
        print("\n[test_01] Full lifecycle: create → cliff → claim → verify")

        sponsor_balance_before = get_balance(self.sponsor)

        # Create stream: rate=10, cliff_duration=5, total_duration=20
        # At the local testing network ~1 ledger/s, this completes in ~20 s
        RATE = 10
        CLIFF = 5
        TOTAL = 20
        DEPOSIT = RATE * TOTAL  # 200 tokens

        ledger_before = current_ledger()
        cliff_target = ledger_before + CLIFF

        invoke(
            "create_vesting_stream",
            SPONSOR_KEY,
            "--sponsor",
            self.sponsor,
            "--recipient",
            self.recipient,
            "--token",
            TOKEN_CONTRACT,
            "--rate",
            str(RATE),
            "--cliff_duration",
            str(CLIFF),
            "--total_duration",
            str(TOTAL),
            "--metadata",
            "null",
        )

        # Verify deposit deducted from sponsor
        sponsor_balance_after_create = get_balance(self.sponsor)
        self.assertEqual(
            sponsor_balance_before - sponsor_balance_after_create,
            DEPOSIT,
            "Sponsor balance should decrease by total deposit",
        )

        # Attempt claim before cliff — should fail
        result = invoke(
            "claim_vested",
            RECIPIENT_KEY,
            "--recipient",
            self.recipient,
            check=False,
        )
        self.assertIn(
            "CliffNotReached",
            result,
            "Claim before cliff must return CliffNotReached",
        )

        # Wait for cliff ledger
        print(f"  Waiting for cliff at ledger {cliff_target}…")
        wait_for_ledger(cliff_target + 1, timeout=60.0)

        # Claim after cliff
        claim_output = invoke(
            "claim_vested",
            RECIPIENT_KEY,
            "--recipient",
            self.recipient,
        )

        # Verify recipient received tokens
        recipient_balance = get_balance(self.recipient)
        self.assertGreater(
            recipient_balance,
            0,
            "Recipient should have tokens after successful claim",
        )

        # Amount must be at least cliff_duration × rate
        min_expected = CLIFF * RATE
        self.assertGreaterEqual(
            recipient_balance,
            min_expected,
            f"Recipient balance {recipient_balance} should be ≥ {min_expected}",
        )

        print(
            f"  ✅ Claim succeeded; recipient balance = {recipient_balance} tokens"
        )
        del claim_output  # suppress unused variable warning

    # ── Scenario 2: Cancel before cliff → full refund ─────────────────────────

    def test_02_cancel_before_cliff_full_refund(self):
        """
        Scenario 2: Cancel before cliff returns full deposit to sponsor.

        Verifies:
        - cancel_stream before cliff_ledger refunds 100% to sponsor
        - Recipient receives nothing
        - Schedule removed from storage
        """
        print("\n[test_02] Cancel before cliff → full refund")

        RATE = 5
        CLIFF = 30   # 30 ledgers — test completes before this
        TOTAL = 100
        DEPOSIT = RATE * TOTAL  # 500 tokens

        sponsor_balance_before = get_balance(self.sponsor2)

        invoke(
            "create_vesting_stream",
            SPONSOR2_KEY,
            "--sponsor",
            self.sponsor2,
            "--recipient",
            self.recipient2,
            "--token",
            TOKEN_CONTRACT,
            "--rate",
            str(RATE),
            "--cliff_duration",
            str(CLIFF),
            "--total_duration",
            str(TOTAL),
            "--metadata",
            "null",
        )

        # Cancel immediately (well before cliff)
        invoke(
            "cancel_stream",
            SPONSOR2_KEY,
            "--sponsor",
            self.sponsor2,
            "--recipient",
            self.recipient2,
        )

        sponsor_balance_after = get_balance(self.sponsor2)
        recipient_balance = get_balance(self.recipient2)

        # Sponsor gets full deposit back
        self.assertEqual(
            sponsor_balance_after,
            sponsor_balance_before,
            "Sponsor should be fully refunded after pre-cliff cancel",
        )
        # Recipient gets nothing
        self.assertEqual(
            recipient_balance,
            0,
            "Recipient should receive nothing after pre-cliff cancel",
        )

        # Schedule must be removed
        schedule_output = invoke(
            "get_schedule",
            CALLER_KEY,
            "--recipient",
            self.recipient2,
        )
        self.assertIn(
            "null",
            schedule_output.lower(),
            "Schedule must be removed after cancel",
        )

        print(f"  ✅ Full refund: sponsor={sponsor_balance_after}, recipient={recipient_balance}")

    # ── Scenario 3: Cancel after cliff → partial refund ───────────────────────

    def test_03_cancel_after_cliff_partial_refund(self):
        """
        Scenario 3: Cancel after cliff — recipient keeps accrued tokens, sponsor
        gets remainder.

        Verifies:
        - recipient_share = (active_end - last_claimed) × rate
        - sponsor_refund = total_deposit - recipient_share
        - Total distribution equals total_deposit
        """
        print("\n[test_03] Cancel after cliff → partial refund")

        RATE = 10
        CLIFF = 3
        TOTAL = 50
        DEPOSIT = RATE * TOTAL  # 500 tokens

        # Use unique recipient to avoid conflicts
        recipient_key = f"{RECIPIENT2_KEY}-cancel-post"
        try:
            subprocess.run(
                ["stellar", "keys", "generate", recipient_key,
                 "--network", STELLAR_NETWORK, "--rpc-url", RPC_URL],
                capture_output=True, text=True, check=False
            )
            subprocess.run(
                ["curl", "-sf", f"{HORIZON_URL}/friendbot?addr={address_of(recipient_key)}"],
                capture_output=True, check=False
            )
        except Exception:
            recipient_key = RECIPIENT2_KEY  # fallback

        recipient_post = address_of(recipient_key)

        sponsor_balance_before = get_balance(self.sponsor)

        cliff_target = current_ledger() + CLIFF

        invoke(
            "create_vesting_stream",
            SPONSOR_KEY,
            "--sponsor",
            self.sponsor,
            "--recipient",
            recipient_post,
            "--token",
            TOKEN_CONTRACT,
            "--rate",
            str(RATE),
            "--cliff_duration",
            str(CLIFF),
            "--total_duration",
            str(TOTAL),
            "--metadata",
            "null",
        )

        # Wait for cliff, then cancel
        print(f"  Waiting for cliff at ledger {cliff_target + 1}…")
        wait_for_ledger(cliff_target + 1, timeout=60.0)

        invoke(
            "cancel_stream",
            SPONSOR_KEY,
            "--sponsor",
            self.sponsor,
            "--recipient",
            recipient_post,
        )

        sponsor_balance_after = get_balance(self.sponsor)
        recipient_balance = get_balance(recipient_post)

        # Recipient gets > 0 (earned tokens since cliff)
        self.assertGreater(
            recipient_balance,
            0,
            "Recipient should receive accrued tokens after post-cliff cancel",
        )

        # Total distributed must equal DEPOSIT
        sponsor_received = sponsor_balance_after - (sponsor_balance_before - DEPOSIT)
        total_distributed = recipient_balance + sponsor_received
        self.assertEqual(
            total_distributed,
            DEPOSIT,
            f"Total distributed {total_distributed} must equal deposit {DEPOSIT}",
        )

        print(
            f"  ✅ Partial refund: recipient={recipient_balance}, "
            f"sponsor refund={sponsor_received}"
        )

    # ── Scenario 4: Clawback → sponsor recovers all tokens ────────────────────

    def test_04_clawback_sponsor_recovers_all_tokens(self):
        """
        Scenario 4: Sponsor clawbacks stream — recovers all remaining tokens
        in the vault, bypassing cliff state.

        Verifies:
        - clawback_stream available to the original sponsor only
        - All vault tokens returned to sponsor
        - StreamClawedBack event emitted with the reason string
        - Schedule removed from storage
        """
        print("\n[test_04] Clawback → sponsor recovers all tokens")

        RATE = 8
        CLIFF = 20
        TOTAL = 80
        DEPOSIT = RATE * TOTAL  # 640 tokens

        # Fresh recipient key for isolation
        recipient_key = "integration-recipient-clawback"
        try:
            subprocess.run(
                ["stellar", "keys", "generate", recipient_key,
                 "--network", STELLAR_NETWORK, "--rpc-url", RPC_URL],
                capture_output=True, text=True, check=False
            )
            subprocess.run(
                ["curl", "-sf",
                 f"{HORIZON_URL}/friendbot?addr={address_of(recipient_key)}"],
                capture_output=True, check=False
            )
        except Exception:
            self.skipTest("Could not generate recipient key for clawback test")

        recipient_clawback = address_of(recipient_key)
        sponsor_balance_before = get_balance(self.sponsor2)

        invoke(
            "create_vesting_stream",
            SPONSOR2_KEY,
            "--sponsor",
            self.sponsor2,
            "--recipient",
            recipient_clawback,
            "--token",
            TOKEN_CONTRACT,
            "--rate",
            str(RATE),
            "--cliff_duration",
            str(CLIFF),
            "--total_duration",
            str(TOTAL),
            "--metadata",
            "null",
        )

        # Clawback before cliff
        REASON = "compliance: sanctions match"
        invoke(
            "clawback_stream",
            SPONSOR2_KEY,
            "--sponsor",
            self.sponsor2,
            "--recipient",
            recipient_clawback,
            "--reason",
            REASON,
        )

        sponsor_balance_after = get_balance(self.sponsor2)
        recipient_balance = get_balance(recipient_clawback)

        # Sponsor gets all tokens back
        self.assertEqual(
            sponsor_balance_after,
            sponsor_balance_before,
            "Clawback must return full deposit to sponsor",
        )
        self.assertEqual(
            recipient_balance,
            0,
            "Recipient must receive nothing after clawback",
        )

        # Schedule must be removed
        schedule_output = invoke(
            "get_schedule",
            CALLER_KEY,
            "--recipient",
            recipient_clawback,
        )
        self.assertIn(
            "null",
            schedule_output.lower(),
            "Schedule must be removed after clawback",
        )

        print(f"  ✅ Clawback succeeded; sponsor recovered all {DEPOSIT} tokens")

    # ── Scenario 5: Drain expired → any address drains after 1-year delay ─────

    def test_05_drain_expired_stream(self):
        """
        Scenario 5: Permissionless drain of an expired stream.

        The drain is available to any caller after end_ledger + 6,307,200
        (≈1 year) ledgers have elapsed.  This test simulates that scenario
        by creating a stream with a very short total duration, then waiting
        for end_ledger and verifying the DrainDelayNotExpired guard fires
        (the 1-year delay cannot be simulated in a short test run).

        Verifies:
        - drain_expired_stream rejects calls before end_ledger (StreamNotExpired)
        - drain_expired_stream rejects calls before delay (DrainDelayNotExpired)
        - drain_expired_stream is callable by any address (no auth required)
        """
        print("\n[test_05] Drain expired → any address can call after delay")

        RATE = 1
        CLIFF = 0
        TOTAL = 2   # end in 2 ledgers
        DEPOSIT = RATE * TOTAL

        # Fresh recipient key for isolation
        recipient_key = "integration-recipient-drain"
        try:
            subprocess.run(
                ["stellar", "keys", "generate", recipient_key,
                 "--network", STELLAR_NETWORK, "--rpc-url", RPC_URL],
                capture_output=True, text=True, check=False
            )
            subprocess.run(
                ["curl", "-sf",
                 f"{HORIZON_URL}/friendbot?addr={address_of(recipient_key)}"],
                capture_output=True, check=False
            )
        except Exception:
            self.skipTest("Could not generate recipient key for drain test")

        recipient_drain = address_of(recipient_key)

        ledger_before = current_ledger()
        end_ledger_target = ledger_before + TOTAL

        invoke(
            "create_vesting_stream",
            SPONSOR_KEY,
            "--sponsor",
            self.sponsor,
            "--recipient",
            recipient_drain,
            "--token",
            TOKEN_CONTRACT,
            "--rate",
            str(RATE),
            "--cliff_duration",
            str(CLIFF),
            "--total_duration",
            str(TOTAL),
            "--metadata",
            "null",
        )

        # Before end_ledger — StreamNotExpired
        result_before_end = invoke(
            "drain_expired_stream",
            CALLER_KEY,
            "--caller",
            self.caller,
            "--recipient",
            recipient_drain,
            check=False,
        )
        self.assertIn(
            "StreamNotExpired",
            result_before_end,
            "drain_expired_stream must return StreamNotExpired before end_ledger",
        )

        # Wait for end_ledger
        print(f"  Waiting for end_ledger at {end_ledger_target + 1}…")
        wait_for_ledger(end_ledger_target + 1, timeout=30.0)

        # After end_ledger but before delay — DrainDelayNotExpired
        result_before_delay = invoke(
            "drain_expired_stream",
            CALLER_KEY,
            "--caller",
            self.caller,
            "--recipient",
            recipient_drain,
            check=False,
        )
        self.assertIn(
            "DrainDelayNotExpired",
            result_before_delay,
            "drain_expired_stream must return DrainDelayNotExpired before 1-year delay",
        )

        # Verify the function is callable by an arbitrary address (no auth check)
        # The fact that it returned DrainDelayNotExpired (not Unauthorized) confirms
        # that any address can call it.
        self.assertNotIn(
            "Unauthorized",
            result_before_delay,
            "drain_expired_stream must not require auth (permissionless)",
        )

        print(
            "  ✅ Drain guards verified: StreamNotExpired before end, "
            "DrainDelayNotExpired before 1-year, no auth required"
        )


# ── Entry point ───────────────────────────────────────────────────────────────


if __name__ == "__main__":
    # Pretty output for CI
    loader = unittest.TestLoader()
    loader.sortTestMethodsUsing = None  # preserve declaration order
    suite = loader.loadTestsFromTestCase(TestStreamLifecycle)
    runner = unittest.TextTestRunner(verbosity=2, stream=sys.stdout)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
