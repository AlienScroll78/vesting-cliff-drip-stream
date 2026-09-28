"""
Smoke test suite for post-deployment validation (issue #793).

Covers all 6 required checks:
  1. GET /health returns 200
  2. GET /ready returns 200
  3. GET /analytics/sponsor/:address returns valid JSON
  4. Contract claimable_amount view returns a non-negative integer, confirming the
     WASM is deployed and callable. (The issue refers to this as "get_min_deposit"
     but that function does not exist on this contract; claimable_amount is the
     correct zero-argument-capable view that proves the contract is live.)
  5. Contract is_cliff_passed for known test address returns expected bool
  6. WebSocket connection accepted and state snapshot received

Configuration is driven by environment variables (see conftest.py / pytest.ini).
Run via:
    make smoke-test ENV=testnet
    make smoke-test ENV=mainnet
"""

import json
import subprocess
import threading

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
    Invoke a Stellar contract view function via the Stellar CLI.

    Runs: stellar contract invoke --id CONTRACT --network NETWORK -- FUNCTION [ARGS...]

    Returns a dict with keys: returncode (int), stdout (str), stderr (str).
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
    """GET /health body must be valid JSON with status='ok'."""
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
    """GET /ready body must include 'status' and 'checks' fields."""
    url = base_url("/ready")
    resp = requests.get(url, timeout=15)
    body = resp.json()
    assert "status" in body, f"Missing 'status' in /ready response: {body}"
    assert "checks" in body, f"Missing 'checks' in /ready response: {body}"


# ── Test 3: GET /analytics/sponsor/:address ────────────────────────────────────
#
# The issue spec refers to this as "GET /api/analytics/summary".
# The actual backend route is GET /analytics/sponsor/:address (no /api prefix,
# requires a sponsor address path param). This test hits the real endpoint.


def test_analytics_summary_returns_200():
    """GET /analytics/sponsor/:address must return HTTP 200 with valid JSON."""
    sponsor = pytest.smoke_config["test_sponsor_address"]
    url = base_url(f"/analytics/sponsor/{sponsor}")
    resp = requests.get(url, timeout=15)
    assert resp.status_code == 200, (
        f"Expected 200 from GET /analytics/sponsor/{sponsor}, "
        f"got {resp.status_code}. Body: {resp.text[:500]}"
    )


def test_analytics_summary_body_structure():
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


# ── Test 4: Contract view — claimable_amount ───────────────────────────────────
#
# The issue spec describes this check as "get_min_deposit view returns a positive
# integer". That function does not exist on this contract. The equivalent check
# that proves the deployed WASM is live and callable is claimable_amount, which:
#   - requires no sponsor auth
#   - returns 0 (not an error) when called with any address with no schedule
#   - returns a positive i128 when called with an address that has an active stream
#
# For a valid smoke test we assert the call succeeds (exit 0) and returns a
# non-negative integer, confirming the contract is reachable and executing.


def test_contract_view_returns_integer():
    """
    Contract view claimable_amount must succeed and return a non-negative integer.

    This confirms the correct WASM is deployed and the contract is callable on
    the target network.
    """
    recipient = pytest.smoke_config["test_recipient_address"]
    result = stellar_invoke("claimable_amount", "--recipient", recipient)

    assert result["returncode"] == 0, (
        f"stellar contract invoke claimable_amount failed "
        f"(exit {result['returncode']}).\n"
        f"stderr: {result['stderr']}\nstdout: {result['stdout']}"
    )

    raw = result["stdout"].strip().strip('"')
    assert raw.lstrip("-").isdigit(), (
        f"claimable_amount output is not an integer: {result['stdout']!r}"
    )

    value = int(raw)
    assert value >= 0, (
        f"claimable_amount must return a non-negative integer, got {value}"
    )


# ── Test 5: Contract is_cliff_passed for known test address ───────────────────


def test_contract_is_cliff_passed_returns_bool():
    """
    Contract view is_cliff_passed for a known test address must return a bool.

    Uses SMOKE_RECIPIENT_ADDRESS from config. The function returns false (not an
    error) when no schedule exists for the address, so this check is always safe
    to run against a live network.

    If SMOKE_EXPECTED_CLIFF is set to "true" or "false", the exact value is also
    asserted.
    """
    recipient = pytest.smoke_config["test_recipient_address"]
    result = stellar_invoke("is_cliff_passed", "--recipient", recipient)

    assert result["returncode"] == 0, (
        f"stellar contract invoke is_cliff_passed failed "
        f"(exit {result['returncode']}).\n"
        f"stderr: {result['stderr']}\nstdout: {result['stdout']}"
    )

    raw = result["stdout"].strip().lower()
    assert raw in ("true", "false"), (
        f"is_cliff_passed must return 'true' or 'false', got: {raw!r}"
    )

    # Optionally assert the expected value when configured
    expected = pytest.smoke_config.get("expected_is_cliff_passed")
    if expected is not None:
        assert raw == expected.lower(), (
            f"is_cliff_passed expected {expected!r}, got {raw!r}"
        )


# ── Test 6: WebSocket connection and state snapshot ───────────────────────────


def test_websocket_accepts_connection_and_sends_snapshot():
    """
    WebSocket endpoint /ws/claimable must:
      1. Accept a connection.
      2. Return a JSON snapshot with a 'claimable' field after subscribing.

    The snapshot is sent immediately when the client sends
    {"recipient": "<address>"}.  The 'claimable' value may be "0" for an
    address with no active stream.
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

    def on_close(_ws_conn, _code, _reason):
        message_event.set()

    ws_app = websocket.WebSocketApp(
        url,
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
    )

    ws_thread = threading.Thread(
        target=ws_app.run_forever,
        kwargs={"ping_interval": 0},
        daemon=True,
    )
    ws_thread.start()

    # Wait for the connection to be established
    assert connected_event.wait(timeout=15), (
        f"WebSocket did not connect within 15 s. URL: {url}\n"
        + (f"Error: {error_holder[0]}" if error_holder else "No error detail available.")
    )

    if error_holder:
        pytest.fail(f"WebSocket connection error: {error_holder[0]}")

    # Wait for the immediate snapshot message
    assert message_event.wait(timeout=20), (
        "WebSocket connected but no snapshot message received within 20 s."
    )

    ws_app.close()

    if error_holder:
        pytest.fail(f"WebSocket message error: {error_holder[0]}")

    assert len(received) >= 1, "No messages received from WebSocket after subscribing."

    snapshot = received[0]
    assert "claimable" in snapshot, (
        f"WebSocket snapshot missing 'claimable' field. Got: {snapshot}"
    )

    # 'claimable' must be a numeric string or integer (may be "0")
    claimable_str = str(snapshot["claimable"])
    assert claimable_str.lstrip("-").isdigit(), (
        f"'claimable' value is not numeric: {snapshot['claimable']!r}"
    )
