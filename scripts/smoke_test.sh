#!/usr/bin/env bash
set -euo pipefail

: "${VESTING_CONTRACT:?VESTING_CONTRACT env var required}"

DUMMY_RECIPIENT="GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"

echo "▶ Smoke test: claimable_amount on $VESTING_CONTRACT"
if stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network testnet \
  -- claimable_amount \
  --recipient "$DUMMY_RECIPIENT" 2>&1; then
  echo "✅ PASS: contract is callable"
else
  echo "❌ FAIL: contract invocation failed"
  exit 1
fi
