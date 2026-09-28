#!/usr/bin/env bash
# scripts/smoke_test.sh — Post-deployment smoke test entry point (issue #793).
#
# This script delegates to the pytest-based smoke suite in tests/smoke/.
# It is kept for backward compatibility and is called by the CI staging workflow.
#
# Required environment variables:
#   VESTING_CONTRACT        Deployed contract ID (Cxxx...)
#   SMOKE_API_HOST          Base URL of the deployed API (https://...)
#
# Optional:
#   SMOKE_NETWORK           testnet | mainnet  (default: testnet)
#   SMOKE_SPONSOR_ADDRESS   Stellar G... for analytics test
#   SMOKE_RECIPIENT_ADDRESS Stellar G... for contract view tests
#   SMOKE_EXPECTED_CLIFF    "true" | "false"
#
# Exit codes:
#   0  All 6 smoke tests passed
#   1  One or more tests failed (details printed to stdout/stderr)

set -euo pipefail

: "${VESTING_CONTRACT:?VESTING_CONTRACT env var required}"
: "${SMOKE_API_HOST:?SMOKE_API_HOST env var required}"

SMOKE_NETWORK="${SMOKE_NETWORK:-testnet}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "▶ Installing smoke test Python dependencies..."
pip install --quiet -r "$REPO_ROOT/tests/smoke/requirements.txt"

echo "▶ Running smoke tests (network: $SMOKE_NETWORK, contract: $VESTING_CONTRACT)..."
SMOKE_NETWORK="$SMOKE_NETWORK" \
  pytest "$REPO_ROOT/tests/smoke/" \
    --tb=short \
    -v \
    --timeout=60

echo "✅ All smoke tests passed."
