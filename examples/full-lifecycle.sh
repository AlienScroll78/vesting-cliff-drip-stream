#!/usr/bin/env bash
# Full lifecycle demo: create → wait cliff → claim → cancel
# Expected output: stream created, cliff passed, tokens claimed, stream cancelled
# Requires: VESTING_CONTRACT, SPONSOR, RECIPIENT, TOKEN env vars
set -euo pipefail

: "${VESTING_CONTRACT:?}" "${SPONSOR:?}" "${RECIPIENT:?}" "${TOKEN:?}"
NETWORK=testnet
RATE=10
CLIFF_DURATION=100
TOTAL_DURATION=1000

echo "==> Creating stream..."
stellar contract invoke --id "$VESTING_CONTRACT" --network $NETWORK --source "$SPONSOR" \
  -- create_vesting_stream \
  --sponsor "$SPONSOR" --recipient "$RECIPIENT" --token "$TOKEN" \
  --rate $RATE --cliff_duration $CLIFF_DURATION --total_duration $TOTAL_DURATION

echo "==> Waiting for cliff (~cliff_duration ledgers)..."
echo "    Run this script again after ledger $CLIFF_DURATION has passed."

echo "==> Claiming vested tokens..."
stellar contract invoke --id "$VESTING_CONTRACT" --network $NETWORK --source "$RECIPIENT" \
  -- claim_vested --recipient "$RECIPIENT"

echo "==> Cancelling stream..."
stellar contract invoke --id "$VESTING_CONTRACT" --network $NETWORK --source "$SPONSOR" \
  -- cancel_stream --sponsor "$SPONSOR" --recipient "$RECIPIENT"

echo "==> Done."
