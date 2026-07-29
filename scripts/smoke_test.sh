#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# smoke_test.sh – Staging smoke tests for VestingDrips
#
# Validates:
#   1. Contract is reachable and callable on Stellar testnet
#   2. claimable_amount view function responds
#   3. get_schedule view function responds
#   4. is_cliff_passed view function responds
#   5. Backend /health endpoint is up (when BACKEND_URL is set)
#   6. Backend /ready endpoint is up (when BACKEND_URL is set)
#   7. Frontend URL responds with HTTP 200 (when FRONTEND_URL is set)
#
# Required env vars:
#   VESTING_CONTRACT  – deployed Soroban contract ID (C…)
#
# Optional env vars:
#   BACKEND_URL       – e.g. https://api.staging.vesting.example.com
#   FRONTEND_URL      – e.g. https://staging.vesting.example.com
#   NETWORK           – Stellar network name (default: testnet)
#   SMOKE_TIMEOUT     – curl timeout in seconds (default: 30)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

: "${VESTING_CONTRACT:?VESTING_CONTRACT env var required}"

NETWORK="${NETWORK:-testnet}"
SMOKE_TIMEOUT="${SMOKE_TIMEOUT:-30}"

# A valid but unused Stellar public key used as a placeholder recipient.
# This account has no vesting schedule, so view calls safely return defaults.
DUMMY_RECIPIENT="GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"

PASS=0
FAIL=0

# ── helpers ──────────────────────────────────────────────────────────────────

green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
red()   { printf '\033[0;31m%s\033[0m\n' "$*"; }

pass() {
  green "✅ PASS: $*"
  PASS=$(( PASS + 1 ))
}

fail() {
  red "❌ FAIL: $*"
  FAIL=$(( FAIL + 1 ))
}

run_contract_test() {
  local test_name="$1"
  local fn_name="$2"
  shift 2
  local extra_args=("$@")

  echo "▶  Testing ${fn_name}…"
  if stellar contract invoke \
       --id    "$VESTING_CONTRACT" \
       --network "$NETWORK" \
       -- "$fn_name" "${extra_args[@]}" 2>&1; then
    pass "$test_name"
  else
    fail "$test_name"
  fi
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
    pass "$test_name (HTTP $status)"
  else
    fail "$test_name (expected HTTP $expected_status, got $status)"
  fi
}

# ── contract smoke tests ──────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo "  Staging smoke tests"
echo "  Contract : $VESTING_CONTRACT"
echo "  Network  : $NETWORK"
echo "════════════════════════════════════════════════════════════════════════"
echo ""

# 1. claimable_amount – returns 0 for unknown recipient (not an error)
run_contract_test \
  "claimable_amount view is callable" \
  "claimable_amount" \
  --recipient "$DUMMY_RECIPIENT"

# 2. get_schedule – returns None/null for unknown recipient (not an error)
run_contract_test \
  "get_schedule view is callable" \
  "get_schedule" \
  --recipient "$DUMMY_RECIPIENT"

# 3. is_cliff_passed – returns false for unknown recipient (not an error)
run_contract_test \
  "is_cliff_passed view is callable" \
  "is_cliff_passed" \
  --recipient "$DUMMY_RECIPIENT"

# ── backend smoke tests (optional) ───────────────────────────────────────────

if [[ -n "${BACKEND_URL:-}" ]]; then
  echo ""
  echo "── Backend checks ──────────────────────────────────────────────────────"

  http_check "Backend /health returns 200"  "${BACKEND_URL%/}/health"
  http_check "Backend /ready returns 200"   "${BACKEND_URL%/}/ready"
else
  echo ""
  echo "ℹ  BACKEND_URL not set – skipping backend HTTP checks."
fi

# ── frontend smoke test (optional) ───────────────────────────────────────────

if [[ -n "${FRONTEND_URL:-}" ]]; then
  echo ""
  echo "── Frontend check ──────────────────────────────────────────────────────"

  http_check "Frontend root returns 200" "${FRONTEND_URL%/}/"
else
  echo ""
  echo "ℹ  FRONTEND_URL not set – skipping frontend HTTP check."
fi

# ── summary ──────────────────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo "  Results: ${PASS} passed, ${FAIL} failed"
echo "════════════════════════════════════════════════════════════════════════"

if [[ "$FAIL" -gt 0 ]]; then
  red "Smoke tests FAILED."
  exit 1
else
  green "All smoke tests PASSED."
fi
