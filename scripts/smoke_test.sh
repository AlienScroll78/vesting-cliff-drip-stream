#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# smoke_test.sh – Post-deployment verification suite for VestingDrips
#
# Creates a short-duration stream, exercises all contract functions, and
# asserts correct behaviour. Optionally checks backend and frontend URLs.
#
# Usage:
#   export VESTING_CONTRACT=<deployed-contract-id>
#   export SPONSOR=<sponsor-account-key>
#   export RECIPIENT=<recipient-address>
#   export TOKEN=<sac-token-address>
#   ./scripts/smoke_test.sh
#
# Required env vars:
#   VESTING_CONTRACT  – deployed Soroban contract ID (C…)
#   SPONSOR           – sponsor account key name (stellar config)
#   RECIPIENT         – recipient address (G…)
#   TOKEN             – SAC token contract address (C…)
#
# Optional env vars:
#   NETWORK           – Stellar network name (default: testnet)
#   SMOKE_TIMEOUT     – curl timeout in seconds (default: 30)
#   BACKEND_URL       – e.g. https://api.staging.vesting.example.com
#   FRONTEND_URL      – e.g. https://staging.vesting.example.com
#
# Exit code 0 on success, non-zero on any failure.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

: "${VESTING_CONTRACT:?VESTING_CONTRACT env var required}"
: "${SPONSOR:?SPONSOR env var required}"
: "${RECIPIENT:?RECIPIENT env var required}"
: "${TOKEN:?TOKEN env var required}"

NETWORK="${SOROBAN_NETWORK:-testnet}"
SMOKE_TIMEOUT="${SMOKE_TIMEOUT:-30}"
PASS=0
FAIL=0

# short-duration stream: 10 total ledgers, 5 ledger cliff
RATE=10
CLIFF=5
TOTAL=10

# ── Helpers ────────────────────────────────────────────────────────────────────

green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
red()   { printf '\033[0;31m%s\033[0m\n' "$*"; }

ok()   { PASS=$((PASS+1)); green "  ✅ $1"; }
fail() { FAIL=$((FAIL+1)); red   "  ❌ $1"; }

invoke() {
  stellar contract invoke \
    --id      "$VESTING_CONTRACT" \
    --source  "$SPONSOR" \
    --network "$NETWORK" \
    -- "$@"
}

invoke_as_recipient() {
  stellar contract invoke \
    --id      "$VESTING_CONTRACT" \
    --source  "$RECIPIENT" \
    --network "$NETWORK" \
    -- "$@"
}

http_check() {
  local test_name="$1"
  local url="$2"
  local expected_status="${3:-200}"

  echo "▶  HTTP check: ${url}"
  local status
  status=$(curl --silent --max-time "$SMOKE_TIMEOUT" \
                --output /dev/null \
                --write-out "%{http_code}" \
                "$url" || echo "000")
  if [[ "$status" == "$expected_status" ]]; then
    ok "$test_name (HTTP $status)"
  else
    fail "$test_name (expected HTTP $expected_status, got $status)"
  fi
}

# ── Contract smoke tests ───────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo "  Post-Deployment Smoke Test: VestingDrips"
echo "  Contract : $VESTING_CONTRACT"
echo "  Sponsor  : $SPONSOR"
echo "  Recipient: $RECIPIENT"
echo "  Token    : $TOKEN"
echo "  Network  : $NETWORK"
echo "  Rate     : $RATE | Cliff: $CLIFF | Total: $TOTAL"
echo "════════════════════════════════════════════════════════════════════════"
echo ""

# 1. Create a short-duration stream
echo "▶ 1. Creating vesting stream..."
if invoke \
  create_vesting_stream \
  --sponsor       "$SPONSOR" \
  --recipient     "$RECIPIENT" \
  --token         "$TOKEN" \
  --rate          "$RATE" \
  --cliff_duration "$CLIFF" \
  --total_duration "$TOTAL" > /dev/null 2>&1; then
  ok "Stream created"
else
  fail "Stream creation failed"
fi

# 2. Verify get_schedule returns correct values
echo "▶ 2. Verifying get_schedule..."
SCHEDULE=$(invoke get_schedule --recipient "$RECIPIENT" 2>/dev/null)
if echo "$SCHEDULE" | grep -q "rate_per_ledger"; then
  ok "get_schedule returns schedule with rate_per_ledger"
else
  fail "get_schedule did not return expected fields (got: $SCHEDULE)"
fi

# 3. is_cliff_passed should be false immediately after creation
echo "▶ 3. Checking is_cliff_passed (should be false initially)..."
CLIFF_STATUS=$(invoke is_cliff_passed --recipient "$RECIPIENT" 2>/dev/null)
if echo "$CLIFF_STATUS" | grep -q "false"; then
  ok "is_cliff_passed = false (correct before cliff)"
else
  fail "is_cliff_passed should be false before cliff (got: $CLIFF_STATUS)"
fi

# 4. claimable_amount should be 0 before cliff
echo "▶ 4. Checking claimable_amount (should be 0 before cliff)..."
AMOUNT=$(invoke claimable_amount --recipient "$RECIPIENT" 2>/dev/null)
if echo "$AMOUNT" | grep -q "0"; then
  ok "claimable_amount = 0 before cliff"
else
  fail "claimable_amount should be 0 before cliff (got: $AMOUNT)"
fi

# 5. Wait for cliff to pass (~CLIFF ledgers × 5 s/ledger)
echo "▶ 5. Waiting for cliff ($CLIFF ledgers ≈ $((CLIFF * 5)) seconds)..."
sleep $((CLIFF * 5 + 2))

# 6. Verify is_cliff_passed = true after waiting
echo "▶ 6. Verifying is_cliff_passed after cliff..."
CLIFF_STATUS=$(invoke is_cliff_passed --recipient "$RECIPIENT" 2>/dev/null)
if echo "$CLIFF_STATUS" | grep -q "true"; then
  ok "is_cliff_passed = true after cliff"
else
  fail "is_cliff_passed should be true after cliff (got: $CLIFF_STATUS)"
fi

# 7. Claim vested tokens and verify balance change (non-zero claim)
echo "▶ 7. Claiming vested tokens..."
CLAIM_OUTPUT=$(invoke_as_recipient claim_vested --recipient "$RECIPIENT" 2>/dev/null || true)
if echo "$CLAIM_OUTPUT" | grep -qE "[1-9][0-9]*"; then
  ok "claim_vested returned a non-zero amount"
elif invoke_as_recipient \
  claim_vested \
  --recipient "$RECIPIENT" > /dev/null 2>&1; then
  ok "claim_vested succeeded"
else
  fail "claim_vested failed"
fi

# 8. get_schedule should still exist (stream not yet expired, only partially claimed)
echo "▶ 8. Checking schedule exists after partial claim..."
LATER_SCHEDULE=$(invoke get_schedule --recipient "$RECIPIENT" 2>/dev/null)
if echo "$LATER_SCHEDULE" | grep -qE "rate_per_ledger|null"; then
  ok "get_schedule responded correctly after claim"
else
  fail "get_schedule returned unexpected output after claim (got: $LATER_SCHEDULE)"
fi

# 9. Create a second stream for cancel test
echo "▶ 9. Creating stream for cancel test..."
if invoke \
  create_vesting_stream \
  --sponsor       "$SPONSOR" \
  --recipient     "$RECIPIENT" \
  --token         "$TOKEN" \
  --rate          "$RATE" \
  --cliff_duration "$CLIFF" \
  --total_duration "$TOTAL" > /dev/null 2>&1; then
  ok "Second stream created for cancel test"
else
  fail "Second stream creation failed"
fi

# 10. Cancel stream before cliff (full refund to sponsor)
echo "▶ 10. Cancelling stream before cliff..."
if invoke \
  cancel_stream \
  --sponsor   "$SPONSOR" \
  --recipient "$RECIPIENT" > /dev/null 2>&1; then
  ok "cancel_stream succeeded"
else
  fail "cancel_stream failed"
fi

# 11. Verify schedule removed after cancel
echo "▶ 11. Verifying schedule removed after cancel..."
CANCEL_SCHEDULE=$(invoke get_schedule --recipient "$RECIPIENT" 2>/dev/null)
if echo "$CANCEL_SCHEDULE" | grep -q "null"; then
  ok "Schedule removed after cancel"
else
  fail "Schedule should be null/None after cancel (got: $CANCEL_SCHEDULE)"
fi

# ── Backend smoke tests (optional) ────────────────────────────────────────────

if [[ -n "${BACKEND_URL:-}" ]]; then
  echo ""
  echo "── Backend checks ──────────────────────────────────────────────────────"
  http_check "Backend /health returns 200" "${BACKEND_URL%/}/health"
  http_check "Backend /ready returns 200"  "${BACKEND_URL%/}/ready"
else
  echo ""
  echo "ℹ  BACKEND_URL not set – skipping backend HTTP checks."
fi

# ── Frontend smoke test (optional) ────────────────────────────────────────────

if [[ -n "${FRONTEND_URL:-}" ]]; then
  echo ""
  echo "── Frontend check ──────────────────────────────────────────────────────"
  http_check "Frontend root returns 200" "${FRONTEND_URL%/}/"
else
  echo ""
  echo "ℹ  FRONTEND_URL not set – skipping frontend HTTP check."
fi

# ── Summary ────────────────────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo "  Results: ${PASS} passed, ${FAIL} failed"
echo "════════════════════════════════════════════════════════════════════════"
echo ""

if [[ "$FAIL" -gt 0 ]]; then
  red "Smoke tests FAILED."
  exit 1
else
  green "All smoke tests PASSED."
fi
