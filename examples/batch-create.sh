#!/usr/bin/env bash
# Batch creation demo: create streams for multiple recipients
# Expected output: one stream created per recipient in RECIPIENTS array
# Requires: VESTING_CONTRACT, SPONSOR, TOKEN env vars
set -euo pipefail

: "${VESTING_CONTRACT:?}" "${SPONSOR:?}" "${TOKEN:?}"
NETWORK=testnet
RATE=10
CLIFF_DURATION=17280
TOTAL_DURATION=172800

# Space-separated list of recipient addresses
RECIPIENTS=("${RECIPIENTS:?}")

for RECIPIENT in "${RECIPIENTS[@]}"; do
  echo "==> Creating stream for $RECIPIENT..."
  stellar contract invoke --id "$VESTING_CONTRACT" --network $NETWORK --source "$SPONSOR" \
    -- create_vesting_stream \
    --sponsor "$SPONSOR" --recipient "$RECIPIENT" --token "$TOKEN" \
    --rate $RATE --cliff_duration $CLIFF_DURATION --total_duration $TOTAL_DURATION
done

echo "==> Batch complete: ${#RECIPIENTS[@]} streams created."
