#!/usr/bin/env bash
# scripts/deploy_contract.sh
#
# Builds the vesting contract WASM, optimizes it, and deploys it to the
# local Stellar quickstart node. Prints the deployed contract ID.
#
# Usage:
#   source scripts/deploy_contract.sh
#   echo "Contract: $VESTING_CONTRACT"
#
# Environment variables (all optional):
#   STELLAR_NETWORK    — network name (default: local)
#   RPC_URL            — Soroban RPC URL (default: http://localhost:8000/soroban/rpc)
#   HORIZON_URL        — Horizon URL (default: http://localhost:8000)
#   DEPLOYER_KEY       — key name for the deployer account (default: integration-deployer)
#   ADMIN_KEY          — key name for the admin account (default: integration-admin)
#   TREASURY_KEY       — key name for the treasury account (default: integration-treasury)
#   FEE_BPS            — protocol fee in basis points (default: 0)

set -euo pipefail

STELLAR_NETWORK="${STELLAR_NETWORK:-local}"
RPC_URL="${RPC_URL:-http://localhost:8000/soroban/rpc}"
HORIZON_URL="${HORIZON_URL:-http://localhost:8000}"
DEPLOYER_KEY="${DEPLOYER_KEY:-integration-deployer}"
ADMIN_KEY="${ADMIN_KEY:-integration-admin}"
TREASURY_KEY="${TREASURY_KEY:-integration-treasury}"
FEE_BPS="${FEE_BPS:-0}"

WASM_PATH="target/wasm32-unknown-unknown/release/vesting_cliff_drip_stream.wasm"

log() { echo "[deploy] $*" >&2; }

# ── Build & optimize ──────────────────────────────────────────────────────────

log "Building contract WASM..."
cargo build --target wasm32-unknown-unknown --release --quiet

log "Optimizing WASM..."
stellar contract optimize \
  --wasm "$WASM_PATH" \
  --wasm-out target/vesting_cliff_drip_stream.optimized.wasm \
  2>/dev/null || true

DEPLOY_WASM="${DEPLOY_WASM:-${WASM_PATH}}"

# ── Deploy ────────────────────────────────────────────────────────────────────

log "Deploying contract with key '$DEPLOYER_KEY'..."
VESTING_CONTRACT=$(stellar contract deploy \
  --wasm "$DEPLOY_WASM" \
  --source "$DEPLOYER_KEY" \
  --network "$STELLAR_NETWORK" \
  --rpc-url "$RPC_URL" \
  2>/dev/null)

log "Contract deployed: $VESTING_CONTRACT"

# ── Initialize ────────────────────────────────────────────────────────────────

ADMIN_ADDRESS=$(stellar keys address "$ADMIN_KEY" 2>/dev/null)
TREASURY_ADDRESS=$(stellar keys address "$TREASURY_KEY" 2>/dev/null)

log "Initializing contract (admin=$ADMIN_ADDRESS, fee_bps=$FEE_BPS)..."
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$DEPLOYER_KEY" \
  --network "$STELLAR_NETWORK" \
  --rpc-url "$RPC_URL" \
  -- initialize \
  --admin "$ADMIN_ADDRESS" \
  --fee_bps "$FEE_BPS" \
  --treasury "$TREASURY_ADDRESS" \
  2>/dev/null

log "Contract initialized successfully."

export VESTING_CONTRACT
echo "$VESTING_CONTRACT"
