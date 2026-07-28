#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# smoke_test.sh – Post-deployment verification for VestingDrips
#
# Creates a short-duration stream, exercises all contract
# functions, and asserts correct behaviour.
#
# Usage:
#   export VESTING_CONTRACT=<deployed-contract-id>
#   export SPONSOR=<sponsor-account-key>
#   export RECIPIENT=<recipient-address>
#   export TOKEN=<sac-token-address>
#   ./scripts/smoke_test.sh
#
# Exit code 0 on success, non-zero on any failure.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

: "${VESTING_CONTRACT:?VESTING_CONTRACT env var required}"
: "${SPONSOR:?SPONSOR env var required}"
: "${RECIPIENT:?RECIPIENT env var required}"
: "${TOKEN:?TOKEN env var required}"

NETWORK="${SOROBAN_NETWORK:-testnet}"
PASS=0
FAIL=0

# short-duration stream: 10 total, 5 cliff
RATE=10
CLIFF=5
TOTAL=10

# ── Helpers ────────────────────────────────────────────────────────────────────

ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL+1)); echo "  ❌ $1"; }

invoke() {
  stellar contract invoke \
    --id "$VESTING_CONTRACT" \
    --source "$SPONSOR" \
    --network "$NETWORK" \
    -- "$@"
}

invoke_as_recipient() {
  stellar contract invoke \
    --id "$VESTING_CONTRACT" \
    --source "$RECIPIENT" \
    --network "$NETWORK" \
    -- "$@"
}

# ── 1. Create stream ───────────────────────────────────────────────────────────

echo ""
echo "═══ Smoke Test: VestingDrips ═══"
echo "  Contract : $VESTING_CONTRACT"
echo "  Sponsor  : $SPONSOR"
echo "  Recipient: $RECIPIENT"
echo "  Token    : $TOKEN"
echo "  Rate     : $RATE | Cliff: $CLIFF | Total: $TOTAL"
echo ""

echo "▶ 1. Creating vesting stream..."
if invoke \
  create_vesting_stream \
  --sponsor "$SPONSOR" \
  --recipient "$RECIPIENT" \
  --token "$TOKEN" \
  --rate "$RATE" \
  --cliff_duration "$CLIFF" \
  --total_duration "$TOTAL" > /dev/null 2>&1; then
  ok "Stream created"
else
  fail "Stream creation failed"
fi

# ── 2. Verify get_schedule ─────────────────────────────────────────────────────

echo "▶ 2. Verifying get_schedule..."
SCHEDULE=$(invoke get_schedule --recipient "$RECIPIENT" 2>/dev/null)
if echo "$SCHEDULE" | grep -q "rate_per_ledger"; then
  ok "get_schedule returns schedule with rate_per_ledger"
else
  fail "get_schedule did not return expected fields"
fi

# ── 3. is_cliff_passed should be false initially ───────────────────────────────

echo "▶ 3. Checking is_cliff_passed (should be false initially)..."
CLIFF_STATUS=$(invoke is_cliff_passed --recipient "$RECIPIENT" 2>/dev/null)
if echo "$CLIFF_STATUS" | grep -q "false"; then
  ok "is_cliff_passed = false (correct before cliff)"
else
  fail "is_cliff_passed should be false before cliff"
fi

# ── 4. claimable_amount should be 0 before cliff ───────────────────────────────

echo "▶ 4. Checking claimable_amount (should be 0 before cliff)..."
AMOUNT=$(invoke claimable_amount --recipient "$RECIPIENT" 2>/dev/null)
if echo "$AMOUNT" | grep -q "0"; then
  ok "claimable_amount = 0 before cliff"
else
  fail "claimable_amount should be 0 before cliff"
fi

# ── 5. Wait for cliff ──────────────────────────────────────────────────────────

echo "▶ 5. Waiting for cliff ($CLIFF ledgers ≈ $((CLIFF * 5)) seconds)..."
sleep $((CLIFF * 5 + 2))

echo "▶ 6. Verifying is_cliff_passed after waiting..."
CLIFF_STATUS=$(invoke is_cliff_passed --recipient "$RECIPIENT" 2>/dev/null)
if echo "$CLIFF_STATUS" | grep -q "true"; then
  ok "is_cliff_passed = true after cliff"
else
  fail "is_cliff_passed should be true after cliff"
fi

# ── 7. Claim tokens ────────────────────────────────────────────────────────────

echo "▶ 7. Claiming vested tokens..."
if invoke_as_recipient \
  claim_vested \
  --recipient "$RECIPIENT" > /dev/null 2>&1; then
  ok "claim_vested succeeded"
else
  fail "claim_vested failed"
fi

# ── 8. get_schedule should return None (stream completed) ──────────────────────

echo "▶ 8. Checking schedule removed after full claim..."
LATER_SCHEDULE=$(invoke get_schedule --recipient "$RECIPIENT" 2>/dev/null)
if echo "$LATER_SCHEDULE" | grep -q "null"; then
  ok "Schedule removed after full claim"
else
  fail "Schedule should be null/None after full claim"
fi

# ── 9. Create another stream for cancel test ───────────────────────────────────

echo "▶ 9. Creating stream for cancel test..."
invoke \
  create_vesting_stream \
  --sponsor "$SPONSOR" \
  --recipient "$RECIPIENT" \
  --token "$TOKEN" \
  --rate "$RATE" \
  --cliff_duration "$CLIFF" \
  --total_duration "$TOTAL" > /dev/null 2>&1

# Cancel immediately (before cliff)
echo "▶ 10. Cancelling stream before cliff..."
if invoke \
  cancel_stream \
  --sponsor "$SPONSOR" \
  --recipient "$RECIPIENT" > /dev/null 2>&1; then
  ok "cancel_stream succeeded"
else
  fail "cancel_stream failed"
fi

# ── 11. Verify schedule removed after cancel ───────────────────────────────────

echo "▶ 11. Verifying schedule removed after cancel..."
CANCEL_SCHEDULE=$(invoke get_schedule --recipient "$RECIPIENT" 2>/dev/null)
if echo "$CANCEL_SCHEDULE" | grep -q "null"; then
  ok "Schedule removed after cancel"
else
  fail "Schedule should be null/None after cancel"
fi

# ── Summary ────────────────────────────────────────────────────────────────────

echo ""
echo "═══ Results: $PASS passed, $FAIL failed ═══"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
