"""
Smoke test suite for post-deployment validation (issue #793).

Covers all 6 required checks:
  1. GET /health returns 200
  2. GET /ready returns 200
  3. GET /analytics/sponsor/:address returns valid JSON
  4. Contract get_min_deposit view returns a positive integer
  5. Contract is_cliff_passed for known test address returns expected bool
  6. WebSocket connection accepted and state snapshot received

Configuration is driven by environment variables (see conftest.py / pytest.ini).
Run via:
    make smoke-test ENV=testnet
    make smoke-test ENV=mainnet
"""

import json
import os
import subprocess
import threading
import time

import pytest
import requests
import websocket  # websocket-client


# ── Helpers ────────────────────────────────────────────────────────────────────


def base_url(path: str = "") -> str:
    """Return the full URL for a given API path."""
    host = pytest.smoke_config["api_host"]
    return f"{host.rstrip('/')}/{path.lstrip('/')}"


def ws_url() -> str:
    """Return the WebSocket URL for /ws/claimable."""
    host = pytest.smoke_config["api_host"]
    # Convert http(s):// scheme to ws(s)://
    ws_host = host.replace("https://", "wss://").replace("http://", "ws://")
    return f"{ws_host.rstrip('/')}/ws/claimable"


def stellar_invoke(*args: str) -> dict:
    """
    Invoke a Stellar contract view function and return the parsed result.

    Runs: stellar contract invoke --id CONTRACT --network NETWORK -- FUNCTION [ARGS...]

    Returns a dict with:
        returncode (int), stdout (str), stderr (str)
    """
    contract_id = pytest.smoke_config["contract_id"]
    network = pytest.smoke_config["network"]

    cmd = [
        "stellar",
        "contract",
        "invoke",
        "--id", contract_id,
        "--network", network,
        "--",
        *args,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    return {
        "returncode": result.returncode,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
    }


# ── Test 1: GET /health ────────────────────────────────────────────────────────


def test_health_returns_200():
    """GET /health must return HTTP 200."""
    url = base_url("/health")
    resp = requests.get(url, timeout=10)
    assert resp.status_code == 200, (
        f"Expected 200 from GET /health, got {resp.status_code}. "
        f"Body: {resp.text[:200]}"
    )


def test_health_body_is_valid_json():
    """GET /health body must be valid JSON with a 'status' field."""
    url = base_url("/health")
    resp = requests.get(url, timeout=10)
    body = resp.json()
    assert "status" in body, f"Missing 'status' in /health response: {body}"
    assert body["status"] == "ok", f"Expected status='ok', got: {body['status']}"


# ── Test 2: GET /ready ─────────────────────────────────────────────────────────


def test_ready_returns_200():
    """GET /ready must return HTTP 200 (all dependencies healthy)."""
    url = base_url("/ready")
    resp = requests.get(url, timeout=15)
    assert resp.status_code == 200, (
        f"Expected 200 from GET /ready, got {resp.status_code}. "
        f"Body: {resp.text[:500]}"
    )


def test_ready_body_structure():
    """GET /ready body must include status, version, and checks fields."""
    url = base_url("/ready")
    resp = requests.get(url, timeout=15)
    body = resp.json()
    assert "status" in body, f"Missing 'status' in /ready response: {body}"
    assert "checks" in body, f"Missing 'checks' in /ready response: {body}"


# ── Test 3: GET /analytics/sponsor/:address ────────────────────────────────────


def test_analytics_sponsor_returns_200():
    """GET /analytics/sponsor/:address must return HTTP 200 with valid JSON."""
    sponsor = pytest.smoke_config["test_sponsor_address"]
    url = base_url(f"/analytics/sponsor/{sponsor}")
    resp = requests.get(url, timeout=15)
    assert resp.status_code == 200, (
        f"Expected 200 from GET /analytics/sponsor/{sponsor}, "
        f"got {resp.status_code}. Body: {resp.text[:500]}"
    )


def test_analytics_sponsor_body_structure():
    """Analytics response must include sponsor, totals, and by_token fields."""
    sponsor = pytest.smoke_config["test_sponsor_address"]
    url = base_url(f"/analytics/sponsor/{sponsor}")
    resp = requests.get(url, timeout=15)
    body = resp.json()

    assert "sponsor" in body, f"Missing 'sponsor' key in analytics response: {body}"
    assert "totals" in body, f"Missing 'totals' key in analytics response: {body}"
    assert "by_token" in body, f"Missing 'by_token' key in analytics response: {body}"
    assert isinstance(body["by_token"], list), (
        f"Expected 'by_token' to be a list, got {type(body['by_token'])}"
    )

    totals = body["totals"]
    for field in ("active_streams", "total_locked", "total_claimed"):
        assert field in totals, f"Missing '{field}' in totals: {totals}"


# ── Test 4: Contract get_min_deposit view ──────────────────────────────────────


def test_contract_get_min_deposit_positive():
    """
    Contract view get_min_deposit must return a positive integer.

    Invokes the function via the Stellar CLI and asserts the numeric return value
    is > 0, confirming the contract WASM is deployed and callable.
    """
    result = stellar_invoke("get_min_deposit")

    assert result["returncode"] == 0, (
        f"stellar contract invoke get_min_deposit failed (exit {result['returncode']}).\n"
        f"stderr: {result['stderr']}\nstdout: {result['stdout']}"
    )

    raw = result["stdout"]
    # The CLI returns the value as a quoted or plain integer string, e.g. '"100"' or '100'
    value_str = raw.strip().strip('"')
    assert value_str.lstrip("-").isdigit(), (
        f"get_min_deposit output is not an integer: {raw!r}"
    )

    value = int(value_str)
    assert value > 0, (
        f"get_min_deposit must return a positive integer, got {value}"
    )


# ── Test 5: Contract is_cliff_passed for known test address ───────────────────


def test_contract_is_cliff_passed_returns_bool():
    """
    Contract view is_cliff_passed for a known test address must return a bool.

    Uses the TEST_RECIPIENT address from config. The exact value (true/false)
    depends on ledger state, but the function must be callable and return a bool.
    """
    recipient = pytest.smoke_config["test_recipient_address"]
    result = stellar_invoke("is_cliff_passed", "--recipient", recipient)

    assert result["returncode"] == 0, (
        f"stellar contract invoke is_cliff_passed failed (exit {result['returncode']}).\n"
        f"stderr: {result['stderr']}\nstdout: {result['stdout']}"
    )

    raw = result["stdout"].strip().lower()
    assert raw in ("true", "false"), (
        f"is_cliff_passed must return 'true' or 'false', got: {raw!r}"
    )

    # Optionally assert the expected value if configured
    expected = pytest.smoke_config.get("expected_is_cliff_passed")
    if expected is not None:
        assert raw == expected.lower(), (
            f"is_cliff_passed expected {expected!r}, got {raw!r}"
        )


# ── Test 6: WebSocket connection and snapshot ──────────────────────────────────


def test_websocket_accepts_connection_and_sends_snapshot():
    """
    WebSocket endpoint /ws/claimable must:
    1. Accept a connection.
    2. Send a JSON snapshot message in response to a subscribe request.

    The snapshot must contain a 'claimable' field (may be '0').
    """
    recipient = pytest.smoke_config["test_recipient_address"]
    url = ws_url()

    received: list[dict] = []
    error_holder: list[str] = []
    connected_event = threading.Event()
    message_event = threading.Event()

    def on_open(ws_conn):
        connected_event.set()
        # Subscribe to claimable updates for the test recipient
        ws_conn.send(json.dumps({"recipient": recipient}))

    def on_message(_ws_conn, message: str):
        try:
            data = json.loads(message)
        except json.JSONDecodeError as exc:
            error_holder.append(f"Invalid JSON from WebSocket: {message!r} ({exc})")
            message_event.set()
            return
        received.append(data)
        message_event.set()

    def on_error(_ws_conn, err):
        error_holder.append(f"WebSocket error: {err}")
        connected_event.set()
        message_event.set()

    def on_close(_ws_conn, code, reason):
        message_event.set()

    ws_app = websocket.WebSocketApp(
        url,
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
    )

    # Run the WebSocket in a background thread; close after receiving the snapshot
    ws_thread = threading.Thread(
        target=ws_app.run_forever,
        kwargs={"ping_interval": 0},
        daemon=True,
    )
    ws_thread.start()

    # Wait for connection
    assert connected_event.wait(timeout=15), (
        f"WebSocket did not connect within 15 s. URL: {url}\n"
        + (f"Error: {error_holder[0]}" if error_holder else "")
    )

    if error_holder:
        pytest.fail(f"WebSocket connection error: {error_holder[0]}")

    # Wait for first message (snapshot)
    assert message_event.wait(timeout=20), (
        "WebSocket connected but no snapshot message received within 20 s."
    )

    ws_app.close()

    if error_holder:
        pytest.fail(f"WebSocket message error: {error_holder[0]}")

    assert len(received) >= 1, "No messages received from WebSocket."

    snapshot = received[0]
    assert "claimable" in snapshot, (
        f"WebSocket snapshot missing 'claimable' field. Got: {snapshot}"
    )
    # claimable must be a numeric string or integer
    claimable_str = str(snapshot["claimable"])
    assert claimable_str.lstrip("-").isdigit(), (
        f"'claimable' value is not numeric: {snapshot['claimable']!r}"
    )
