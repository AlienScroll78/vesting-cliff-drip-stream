"""
conftest.py — Smoke test configuration (issue #793).

Environment variables (all required unless marked optional):

  SMOKE_API_HOST          Base URL of the deployed API, e.g. https://api.testnet.example.com
  VESTING_CONTRACT        Deployed contract ID (Cxxx...)
  SMOKE_NETWORK           Stellar network name: testnet | mainnet  (default: testnet)
  SMOKE_SPONSOR_ADDRESS   Stellar address (G...) of a known testnet sponsor for analytics test
  SMOKE_RECIPIENT_ADDRESS Stellar address (G...) of a known recipient for contract view tests
  SMOKE_EXPECTED_CLIFF    Optional: "true" or "false" — expected is_cliff_passed result

These are exported by the Makefile smoke-test target automatically when ENV=testnet|mainnet.
"""

import os
import sys

import pytest


# ── Required config keys → env var names ──────────────────────────────────────

_ENV_MAP = {
    "api_host":              "SMOKE_API_HOST",
    "contract_id":           "VESTING_CONTRACT",
    "network":               "SMOKE_NETWORK",
    "test_sponsor_address":  "SMOKE_SPONSOR_ADDRESS",
    "test_recipient_address": "SMOKE_RECIPIENT_ADDRESS",
}

_OPTIONAL_ENV_MAP = {
    "expected_is_cliff_passed": "SMOKE_EXPECTED_CLIFF",
}

# Well-known testnet defaults (used when no override is set)
_TESTNET_DEFAULTS = {
    "network":               "testnet",
    "test_sponsor_address":  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "test_recipient_address": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
}

_MAINNET_DEFAULTS: dict[str, str] = {}


def pytest_configure(config: pytest.Config) -> None:
    """Load smoke config from env and attach it to pytest namespace."""
    env = os.environ.get("SMOKE_NETWORK", os.environ.get("ENV", "testnet")).lower()
    defaults = _TESTNET_DEFAULTS if env == "testnet" else _MAINNET_DEFAULTS

    smoke_cfg: dict[str, str | None] = {}
    missing: list[str] = []

    for key, var in _ENV_MAP.items():
        value = os.environ.get(var) or defaults.get(key)
        if not value:
            missing.append(f"  {var}  (config key: {key})")
        smoke_cfg[key] = value or ""

    for key, var in _OPTIONAL_ENV_MAP.items():
        smoke_cfg[key] = os.environ.get(var)

    if missing:
        print(
            "\n[smoke] ERROR: Missing required environment variables:\n"
            + "\n".join(missing)
            + "\n\nSet them directly or run via: make smoke-test ENV=testnet\n",
            file=sys.stderr,
        )
        pytest.exit("Missing required smoke-test configuration.", returncode=1)

    # Attach to pytest namespace so test modules can read via pytest.smoke_config
    pytest.smoke_config = smoke_cfg  # type: ignore[attr-defined]


def pytest_report_header(config: pytest.Config) -> str:
    """Show smoke config summary at the start of the test run."""
    cfg = getattr(pytest, "smoke_config", {})
    return (
        f"smoke-test target : {cfg.get('api_host', '?')}\n"
        f"network           : {cfg.get('network', '?')}\n"
        f"contract          : {cfg.get('contract_id', '?')}"
    )
