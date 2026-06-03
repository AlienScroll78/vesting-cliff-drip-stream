#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# invoke_claim.sh – Claim vested tokens as the recipient
#
# Required env vars:
#   VESTING_CONTRACT  – deployed contract ID
#   RECIPIENT         – recipient account key name (stellar config)
# ──────────────────────────────────────────────────────────────
set -euo pipefail

NETWORK="${SOROBAN_NETWORK:-testnet}"

stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$RECIPIENT" \
  --network "$NETWORK" \
  -- \
  claim_vested \
  --recipient "$RECIPIENT"
