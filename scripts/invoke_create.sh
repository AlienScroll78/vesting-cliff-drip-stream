#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# invoke_create.sh – Create a vesting stream via the CLI
#
# Required env vars:
#   VESTING_CONTRACT  – deployed contract ID
#   SPONSOR           – sponsor account key name (stellar config)
#   RECIPIENT         – recipient address (G…)
#   TOKEN             – SAC token contract address (C…)
#   RATE              – tokens per ledger (integer)
#   CLIFF_DURATION    – ledgers until cliff
#   TOTAL_DURATION    – total ledgers the stream runs
# ──────────────────────────────────────────────────────────────
set -euo pipefail

NETWORK="${SOROBAN_NETWORK:-testnet}"

stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$SPONSOR" \
  --network "$NETWORK" \
  -- \
  create_vesting_stream \
  --sponsor "$SPONSOR" \
  --recipient "$RECIPIENT" \
  --token "$TOKEN" \
  --rate "$RATE" \
  --cliff_duration "$CLIFF_DURATION" \
  --total_duration "$TOTAL_DURATION"
