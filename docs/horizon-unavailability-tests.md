# Horizon Unavailability Tests

This document defines all network resilience scenarios that the backend must
handle when communicating with Horizon. Tests use **Toxiproxy** to inject
network faults between the backend and Horizon.

## Prerequisites

```bash
# Start Toxiproxy
docker compose -f docker-compose.toxiproxy.yml up -d

# Start the backend with Horizon pointed at the Toxiproxy listener
export HORIZON_URL=http://127.0.0.1:8666

# Run the shell test suite
./scripts/run_horizon_toxiproxy_tests.sh
```

## Test scenarios

### S1 — 2s network latency

**Fault:** 2000ms latency added on the downstream (response) stream.
**Expected:** Request succeeds within the backend timeout.

```bash
add_toxic '{"name":"latency_2s","type":"latency","stream":"downstream","toxicity":1,"attributes":{"latency":2000,"jitter":0}}'
assert_status 200
```

### S2 — 100% packet loss

**Fault:** All packets dropped on the downstream stream (timeout toxic with 0ms).
**Expected:** After 3 failed requests, the circuit breaker opens.

```bash
add_toxic '{"name":"packet_loss","type":"timeout","stream":"downstream","toxicity":1,"attributes":{"timeout":0}}'
for i in 1 2 3 4 5; do request_backend; done
verify_circuit_breaker_open
```

### S3 — Connection reset mid-response

**Fault:** TCP RST injected on the downstream stream.
**Expected:** Backend retries with a fresh connection and the retry succeeds.

```bash
add_toxic '{"name":"reset_peer","type":"reset_peer","stream":"downstream","toxicity":1,"attributes":{"timeout":0}}'
request_backend
remove_toxics
assert_status 200
```

### S4 — Horizon 429 Too Many Requests

**Fault:** Horizon returns HTTP 429.
**Expected:** Backend applies exponential backoff and retries. After exhausting
retries, returns 503 to the caller.

```bash
# Simulated by making Horizon unreachable — the backend retries then fails
add_toxic '{"name":"timeout","type":"timeout","stream":"downstream","toxicity":1,"attributes":{"timeout":0}}'
request_backend
verify_circuit_breaker_open || assert_status 503
```

### S5 — Horizon 503 for 30s

**Fault:** Horizon returns HTTP 503 continuously for 30 seconds.
**Expected:** After exhausting retries against the primary endpoint, the
backend falls back to the configured secondary Horizon endpoint.

```bash
add_toxic '{"name":"timeout","type":"timeout","stream":"downstream","toxicity":1,"attributes":{"timeout":0}}'
request_backend
assert_status 503
```

### S6 — Connection refused (no proxy)

**Fault:** The horizon proxy is deleted — upstream connection is refused.
**Expected:** Backend returns 503 Service Unavailable.

```bash
curl -sS -X DELETE "$TOXIPROXY_URL/proxies/horizon"
assert_status 503
```

## Running via Vitest

The same scenarios are also implemented as a Vitest test suite:

```bash
npm run test:resilience
```

These tests are skipped by default (`describe.skip`) because they require
Toxiproxy to be running. Remove `.skip` to run them locally.

## Circuit breaker verification

After repeated Horizon failures, the circuit breaker must move to an **open**
state and short-circuit further calls.  The test script checks this via:

```text
GET /health/horizon/circuit-breaker
```

Expected response body contains `open` or `half-open`.

## Retry policy

Horizon requests should use bounded retries for temporary failures:

- Retry only transient transport errors, HTTP 429, and HTTP 5xx.
- Do not retry malformed requests, authentication failures, or HTTP 4xx
  other than 429.
- Use exponential backoff with jitter.
- Keep the total retry budget below the backend request timeout so callers
  receive a timely 503.
- Count final exhausted attempts as circuit breaker failures.
