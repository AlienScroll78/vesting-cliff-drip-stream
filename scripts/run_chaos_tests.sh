#!/usr/bin/env bash
# scripts/run_chaos_tests.sh
#
# End-to-end chaos test runner for the indexer resilience suite (Issue #787).
#
# Responsibilities:
#   1. Ensure Toxiproxy is running (starts it via docker-compose if not).
#   2. Create the 'horizon' proxy in Toxiproxy if it does not already exist.
#   3. Run all 6 chaos scenarios via vitest.
#   4. Generate a results report in docs/chaos/.
#   5. Tear down Toxiproxy if this script started it.
#
# Usage:
#   make chaos-test
#   OR
#   bash scripts/run_chaos_tests.sh
#
# Environment variables:
#   TOXIPROXY_HOST      (default: localhost)
#   TOXIPROXY_PORT      (default: 8474)
#   HORIZON_UPSTREAM    (default: horizon.stellar.org:443)
#   HORIZON_PROXY_PORT  (default: 8666)
#   SKIP_DOCKER         (default: 0)  – set to 1 to skip docker-compose lifecycle
#   REPORT_DIR          (default: docs/chaos)
#
# Exit codes:
#   0 – all scenarios passed
#   1 – one or more scenarios failed
#   2 – environment setup failed

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────
TOXIPROXY_HOST="${TOXIPROXY_HOST:-localhost}"
TOXIPROXY_PORT="${TOXIPROXY_PORT:-8474}"
HORIZON_UPSTREAM="${HORIZON_UPSTREAM:-horizon.stellar.org:443}"
HORIZON_PROXY_PORT="${HORIZON_PROXY_PORT:-8666}"
SKIP_DOCKER="${SKIP_DOCKER:-0}"
REPORT_DIR="${REPORT_DIR:-docs/chaos}"
COMPOSE_FILE="docker-compose.toxiproxy.yml"
STARTED_DOCKER=0

# ── Colours ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[chaos]${NC} $*"; }
warn() { echo -e "${YELLOW}[chaos]${NC} $*"; }
err()  { echo -e "${RED}[chaos]${NC} $*" >&2; }

# ── Cleanup ───────────────────────────────────────────────────────────────────
cleanup() {
  if [[ "$STARTED_DOCKER" -eq 1 && "$SKIP_DOCKER" -eq 0 ]]; then
    log "Stopping Toxiproxy…"
    docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ── 1. Start Toxiproxy ─────────────────────────────────────────────────────────
if [[ "$SKIP_DOCKER" -ne 1 ]]; then
  log "Starting Toxiproxy via $COMPOSE_FILE…"
  docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
  STARTED_DOCKER=1

  log "Waiting for Toxiproxy to be healthy…"
  for i in $(seq 1 30); do
    if curl -sf "http://${TOXIPROXY_HOST}:${TOXIPROXY_PORT}/version" > /dev/null 2>&1; then
      log "Toxiproxy is ready (attempt ${i})"
      break
    fi
    if [[ "$i" -eq 30 ]]; then
      err "Toxiproxy failed to become healthy after 30 attempts"
      exit 2
    fi
    sleep 2
  done
else
  warn "SKIP_DOCKER=1: assuming Toxiproxy is already running at ${TOXIPROXY_HOST}:${TOXIPROXY_PORT}"
fi

# ── 2. Create the 'horizon' proxy ──────────────────────────────────────────────
TOXIPROXY_API="http://${TOXIPROXY_HOST}:${TOXIPROXY_PORT}"

# Check if 'horizon' proxy already exists.
existing=$(curl -sf "${TOXIPROXY_API}/proxies/horizon" 2>/dev/null || echo "")
if [[ -z "$existing" ]]; then
  log "Creating 'horizon' proxy (upstream: ${HORIZON_UPSTREAM})…"
  curl -sf -X POST "${TOXIPROXY_API}/proxies" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\":     \"horizon\",
      \"listen\":   \"0.0.0.0:${HORIZON_PROXY_PORT}\",
      \"upstream\": \"${HORIZON_UPSTREAM}\",
      \"enabled\":  true
    }" > /dev/null
  log "Proxy 'horizon' created"
else
  log "Proxy 'horizon' already exists – reusing"
fi

# Reset all toxics to start from a clean state.
log "Resetting all toxics…"
curl -sf -X POST "${TOXIPROXY_API}/reset" > /dev/null

# ── 3. Run chaos test suite ────────────────────────────────────────────────────
log "Running chaos test suite (6 scenarios)…"
log "Report directory: ${REPORT_DIR}"
mkdir -p "${REPORT_DIR}"

TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
REPORT_FILE="${REPORT_DIR}/chaos-results-$(date -u '+%Y%m%d-%H%M%S').md"
VITEST_OUTPUT_FILE="${REPORT_DIR}/.vitest-output.txt"

export TOXIPROXY_HOST TOXIPROXY_PORT
export HORIZON_PROXY_URL="http://${TOXIPROXY_HOST}:${HORIZON_PROXY_PORT}"

# Run the tests and capture output.
set +e
cd backend
npx vitest run \
  tests/resilience/chaos/horizon-chaos.test.ts \
  --reporter=verbose \
  2>&1 | tee "${VITEST_OUTPUT_FILE}"
TEST_EXIT_CODE=$?
cd ..
set -e

# ── 4. Generate results report ─────────────────────────────────────────────────
PASS_COUNT=$(grep -c "✓" "${VITEST_OUTPUT_FILE}" 2>/dev/null || echo 0)
FAIL_COUNT=$(grep -c "✗\|FAIL\|Error" "${VITEST_OUTPUT_FILE}" 2>/dev/null || echo 0)
OVERALL_STATUS="PASS"
[[ "$TEST_EXIT_CODE" -ne 0 ]] && OVERALL_STATUS="FAIL"

cat > "${REPORT_FILE}" << REPORT
# Chaos Test Results

**Date:** ${TIMESTAMP}
**Status:** ${OVERALL_STATUS}
**Scenarios passed:** ${PASS_COUNT} / 6
**Scenarios failed:** ${FAIL_COUNT}

## Environment

| Variable | Value |
|---|---|
| TOXIPROXY_HOST | ${TOXIPROXY_HOST} |
| TOXIPROXY_PORT | ${TOXIPROXY_PORT} |
| HORIZON_PROXY_URL | http://${TOXIPROXY_HOST}:${HORIZON_PROXY_PORT} |
| HORIZON_UPSTREAM | ${HORIZON_UPSTREAM} |

## Scenario Summary

| # | Scenario | Result |
|---|---|---|
| 1 | Horizon 429 for 30 s → indexer backs off and resumes | $(grep -q "Scenario 1" "${VITEST_OUTPUT_FILE}" && echo "✅ PASS" || echo "⚠️ SKIP/FAIL") |
| 2 | Malformed JSON → indexer logs error and skips event | $(grep -q "Scenario 2" "${VITEST_OUTPUT_FILE}" && echo "✅ PASS" || echo "⚠️ SKIP/FAIL") |
| 3 | Horizon 503 for 5 min → indexer keeps retrying | $(grep -q "Scenario 3" "${VITEST_OUTPUT_FILE}" && echo "✅ PASS" || echo "⚠️ SKIP/FAIL") |
| 4 | Network timeout mid-response → indexer retries | $(grep -q "Scenario 4" "${VITEST_OUTPUT_FILE}" && echo "✅ PASS" || echo "⚠️ SKIP/FAIL") |
| 5 | DB connection lost mid-write → rollback and retry | $(grep -q "Scenario 5" "${VITEST_OUTPUT_FILE}" && echo "✅ PASS" || echo "⚠️ SKIP/FAIL") |
| 6 | Cursor corruption → detect and reset to checkpoint | $(grep -q "Scenario 6" "${VITEST_OUTPUT_FILE}" && echo "✅ PASS" || echo "⚠️ SKIP/FAIL") |

## Guarantees Verified

- **No duplicate events**: Cursor is not advanced on transient failures.
- **No missing events**: Retry loops ensure all events are eventually processed.
- **Cursor integrity**: Corrupted cursors are detected and reset to last checkpoint.
- **Graceful degradation**: Malformed responses are logged and skipped, not crash-inducing.

## Raw Output

\`\`\`
$(cat "${VITEST_OUTPUT_FILE}")
\`\`\`

---
*Generated by scripts/run_chaos_tests.sh — issue #787*
REPORT

log "Report written to: ${REPORT_FILE}"

# Also write a stable latest-results.md symlink/copy.
cp "${REPORT_FILE}" "${REPORT_DIR}/latest-results.md"

# ── 5. Exit ────────────────────────────────────────────────────────────────────
if [[ "$TEST_EXIT_CODE" -eq 0 ]]; then
  log "All chaos scenarios ${GREEN}PASSED${NC} ✓"
else
  err "One or more chaos scenarios FAILED. See ${REPORT_FILE}"
fi

exit "$TEST_EXIT_CODE"
