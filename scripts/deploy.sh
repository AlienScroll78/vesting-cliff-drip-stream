#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# deploy.sh – Build, optimize, and deploy VestingDrips to Testnet
# Usage: ./scripts/deploy.sh <SOURCE_ACCOUNT>
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SOURCE_ACCOUNT="${1:-default}"
NETWORK="${SOROBAN_NETWORK:-testnet}"
CONTRACT_NAME="vesting_cliff_drip_stream"
WASM="target/wasm32-unknown-unknown/release/${CONTRACT_NAME}.wasm"
OPTIMIZED="target/${CONTRACT_NAME}.optimized.wasm"

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
echo "   Save this ID to interact with the contract:"
echo "   export VESTING_CONTRACT=$CONTRACT_ID"
