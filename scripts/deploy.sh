#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# deploy.sh – Build, optimize, and deploy VestingDrips to Testnet
# Usage: ./scripts/deploy.sh <SOURCE_ACCOUNT> [TOKEN] [RECIPIENT]
#
# After deployment, runs the smoke test suite to verify all
# contract functions work correctly.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SOURCE_ACCOUNT="${1:-default}"
NETWORK="${SOROBAN_NETWORK:-testnet}"
CONTRACT_NAME="vesting_cliff_drip_stream"
WASM="target/wasm32-unknown-unknown/release/${CONTRACT_NAME}.wasm"
OPTIMIZED="target/${CONTRACT_NAME}.optimized.wasm"

# Token and recipient can be provided as args or set via env
TOKEN="${2:-${TOKEN:-}}"
RECIPIENT="${3:-${RECIPIENT:-}}"

echo "▶  Building contract..."
cargo build --target wasm32-unknown-unknown --release

echo "▶  Optimizing WASM..."
stellar contract optimize --wasm "$WASM" --wasm-out "$OPTIMIZED"

echo "▶  Deploying to ${NETWORK}..."
CONTRACT_ID=$(stellar contract deploy \
  --wasm "$OPTIMIZED" \
  --source "$SOURCE_ACCOUNT" \
  --network "$NETWORK")

echo ""
echo "✅  Contract deployed!"
echo "   Contract ID : $CONTRACT_ID"
echo "   Network     : $NETWORK"
echo ""

# ── Smoke test ─────────────────────────────────────────────────────────────────
if [ -n "$TOKEN" ] && [ -n "$RECIPIENT" ]; then
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
  echo "▶  Skipping smoke tests (provide TOKEN and RECIPIENT to run)"
  echo "   Usage: $0 <SOURCE_ACCOUNT> <TOKEN> <RECIPIENT>"
  echo ""
fi

echo "   Save this ID to interact with the contract:"
echo "   export VESTING_CONTRACT=$CONTRACT_ID"
