#!/usr/bin/env bash
# scripts/run_horizon_toxiproxy_tests.sh
#
# Spin up the resilience docker-compose stack, wait for services to be healthy,
# initialise Toxiproxy proxies, and then run the resilience test suite.
#
# Usage:
#   ./scripts/run_horizon_toxiproxy_tests.sh [--keep-up]
#
# Options:
#   --keep-up   Do not tear down containers after the run (useful for debugging)
#
# Exit code mirrors the Jest exit code.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.toxiproxy.yml"
KEEP_UP=false

for arg in "$@"; do
  if [[ "$arg" == "--keep-up" ]]; then
    KEEP_UP=true
  fi
done

# ── Helpers ───────────────────────────────────────────────────────────────────

log() { echo "[toxiproxy-runner] $*"; }

wait_for_port() {
  local host=$1 port=$2 label=$3 retries=30
  log "Waiting for ${label} (${host}:${port})…"
  while ! nc -z "${host}" "${port}" 2>/dev/null; do
    retries=$((retries - 1))
    if [[ $retries -le 0 ]]; then
      log "ERROR: ${label} did not become available in time."
      exit 1
    fi
    sleep 1
  done
  log "${label} is up."
}

toxiproxy_create_proxy() {
  local name=$1 listen=$2 upstream=$3
  curl -sf -X POST http://localhost:8474/proxies \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"${name}\",\"listen\":\"0.0.0.0:${listen}\",\"upstream\":\"${upstream}\"}" \
    > /dev/null || true   # tolerate "already exists" on reruns
}

# ── Start stack ───────────────────────────────────────────────────────────────

log "Starting docker-compose stack…"
docker compose -f "${COMPOSE_FILE}" up -d

# ── Wait for infrastructure ───────────────────────────────────────────────────

wait_for_port localhost 8474   "Toxiproxy control API"
wait_for_port localhost 5432   "Postgres (direct)"   || true  # may not be exposed
wait_for_port localhost 6379   "Redis (direct)"       || true
wait_for_port localhost 1080   "Mock Horizon"         || true
wait_for_port localhost 9000   "Mock Webhook target"  || true

# Give WireMock an extra moment to initialise stub mappings.
sleep 2

# ── Configure Toxiproxy proxies ───────────────────────────────────────────────

log "Registering Toxiproxy proxies…"

toxiproxy_create_proxy "horizon"       18080 "horizon:1080"
toxiproxy_create_proxy "postgres"      15432 "postgres:5432"
toxiproxy_create_proxy "redis"         16379 "redis:6379"
toxiproxy_create_proxy "webhook"       19000 "webhook-target:9000"

log "All proxies registered."

# ── Run tests ─────────────────────────────────────────────────────────────────

cd "${REPO_ROOT}/backend"

TOXIPROXY_HOST=localhost \
TOXIPROXY_PORT=8474 \
HORIZON_URL="http://localhost:18080" \
DATABASE_URL="postgres://vesting:vesting@localhost:15432/vesting_test" \
REDIS_URL="redis://localhost:16379" \
WEBHOOK_TARGET_URL="http://localhost:19000/webhook" \
  npx jest --testPathPattern=resilience --runInBand --forceExit

TEST_EXIT_CODE=$?

# ── Tear down ─────────────────────────────────────────────────────────────────

if [[ "$KEEP_UP" == "false" ]]; then
  log "Tearing down docker-compose stack…"
  docker compose -f "${COMPOSE_FILE}" down -v
fi

exit ${TEST_EXIT_CODE}
