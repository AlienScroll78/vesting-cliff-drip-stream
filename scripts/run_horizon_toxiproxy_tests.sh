#!/usr/bin/env sh
set -eu

BACKEND_BASE_URL="${BACKEND_BASE_URL:-http://127.0.0.1:3000}"
TOXIPROXY_URL="${TOXIPROXY_URL:-http://127.0.0.1:8474}"
HORIZON_UPSTREAM="${HORIZON_UPSTREAM:-horizon-testnet.stellar.org:443}"
HORIZON_PROXY="${HORIZON_PROXY:-127.0.0.1:8666}"
HORIZON_STATUS_PATH="${HORIZON_STATUS_PATH:-/health/horizon}"
CIRCUIT_BREAKER_PATH="${CIRCUIT_BREAKER_PATH:-/health/horizon/circuit-breaker}"

request_backend() {
  curl -sS -o /tmp/horizon-test-response -w "%{http_code}" \
    "$BACKEND_BASE_URL$HORIZON_STATUS_PATH"
}

assert_503() {
  status="$(request_backend || true)"
  if [ "$status" != "503" ]; then
    echo "expected backend to return 503, got $status"
    cat /tmp/horizon-test-response 2>/dev/null || true
    exit 1
  fi
}

reset_proxy() {
  curl -sS -X DELETE "$TOXIPROXY_URL/proxies/horizon" >/dev/null 2>&1 || true
  curl -sS -X POST "$TOXIPROXY_URL/proxies" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"horizon\",\"listen\":\"$HORIZON_PROXY\",\"upstream\":\"$HORIZON_UPSTREAM\"}" \
    >/dev/null
}

add_toxic() {
  curl -sS -X POST "$TOXIPROXY_URL/proxies/horizon/toxics" \
    -H "Content-Type: application/json" \
    -d "$1" >/dev/null
}

verify_circuit_breaker_open() {
  body="$(curl -sS "$BACKEND_BASE_URL$CIRCUIT_BREAKER_PATH")"
  echo "$body" | grep -qi "open"
}

reset_proxy

curl -sS -X DELETE "$TOXIPROXY_URL/proxies/horizon" >/dev/null
assert_503

reset_proxy
add_toxic '{"name":"timeout","type":"timeout","stream":"downstream","toxicity":1,"attributes":{"timeout":0}}'
assert_503

reset_proxy
add_toxic '{"name":"slow_response","type":"latency","stream":"downstream","toxicity":1,"attributes":{"latency":30000,"jitter":0}}'
assert_503

verify_circuit_breaker_open
