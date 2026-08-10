#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# deploy.sh – Build, optimize, deploy, and initialize VestingDrips on Testnet
#
# Usage: ./scripts/deploy.sh <SOURCE_ACCOUNT> [FEE_BPS] [TREASURY_ADDRESS] [TOKEN] [RECIPIENT]
#
# Arguments:
#   SOURCE_ACCOUNT    – stellar key name used to sign (required)
#   FEE_BPS           – protocol fee in basis points 0–500 (optional, default: 0)
#   TREASURY_ADDRESS  – address that collects fees (optional; defaults to SOURCE_ACCOUNT)
#   TOKEN             – SAC token address for smoke tests (optional)
#   RECIPIENT         – recipient address for smoke tests (optional)
#
# After deployment and initialization, runs the smoke test suite when
# both TOKEN and RECIPIENT are provided.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SOURCE_ACCOUNT="${1:-default}"
FEE_BPS="${2:-0}"
NETWORK="${SOROBAN_NETWORK:-testnet}"
CONTRACT_NAME="vesting_cliff_drip_stream"
WASM="target/wasm32-unknown-unknown/release/${CONTRACT_NAME}.wasm"
OPTIMIZED="target/${CONTRACT_NAME}.optimized.wasm"

# Token and recipient are optional — only needed to run smoke tests
TOKEN="${4:-${TOKEN:-}}"
RECIPIENT="${5:-${RECIPIENT:-}}"

echo "▶  Building contract..."
cargo build --target wasm32-unknown-unknown --release

echo "▶  Optimizing WASM..."
stellar contract optimize --wasm "$WASM" --wasm-out "$OPTIMIZED"

echo "▶  Deploying to ${NETWORK}..."
CONTRACT_ID=$(stellar contract deploy \
  --wasm "$OPTIMIZED" \
  --source "$SOURCE_ACCOUNT" \
  --network "$NETWORK")

echo "   Contract ID : $CONTRACT_ID"

# Resolve admin/treasury address from key name
ADMIN_ADDRESS=$(stellar keys address "$SOURCE_ACCOUNT" --network "$NETWORK")
TREASURY_ADDRESS="${3:-$ADMIN_ADDRESS}"

echo ""
echo "▶  Initializing contract..."
echo "   Admin    : $ADMIN_ADDRESS"
echo "   Fee BPS  : $FEE_BPS"
echo "   Treasury : $TREASURY_ADDRESS"

stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$SOURCE_ACCOUNT" \
  --network "$NETWORK" \
  -- \
  initialize \
  --admin "$ADMIN_ADDRESS" \
  --fee_bps "$FEE_BPS" \
  --treasury "$TREASURY_ADDRESS"

echo ""
echo "✅  Contract deployed and initialized!"
echo "   Contract ID : $CONTRACT_ID"
echo "   Network     : $NETWORK"
echo ""

# ── Smoke test ─────────────────────────────────────────────────────────────────
if [[ -n "$TOKEN" ]] && [[ -n "$RECIPIENT" ]]; then
  echo "▶  Running smoke tests..."

  export VESTING_CONTRACT="$CONTRACT_ID"
  export SPONSOR="$SOURCE_ACCOUNT"
  export RECIPIENT
  export TOKEN

  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  if "$SCRIPT_DIR/smoke_test.sh"; then
    echo ""
    echo "✅  Smoke tests passed!"
  else
    echo ""
    echo "❌  Smoke tests FAILED!"
    exit 1
  fi
else
  echo "▶  Skipping smoke tests (provide TOKEN and RECIPIENT as args 4 & 5, or set env vars)"
  echo "   Usage: $0 <SOURCE_ACCOUNT> [FEE_BPS] [TREASURY_ADDRESS] <TOKEN> <RECIPIENT>"
  echo ""
fi

echo "   Save this ID to interact with the contract:"
echo "   export VESTING_CONTRACT=$CONTRACT_ID"
