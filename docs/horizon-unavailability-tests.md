# Horizon Unavailability Resilience Tests

This document describes the resilience test scenarios implemented in
`backend/tests/resilience/` that validate backend behaviour when
downstream services (Horizon, Redis, Postgres, Webhooks) fail.

All tests use [Toxiproxy](https://github.com/Shopify/toxiproxy) to inject
controlled network faults without modifying application code.

---

## Running the tests

```bash
# Start the required infrastructure
docker-compose -f docker-compose.toxiproxy.yml up -d

# Run the resilience suite
npm run test:resilience

# Or use the all-in-one runner script
./scripts/run_horizon_toxiproxy_tests.sh
```

---

## Infrastructure topology

```
Test runner
    │
    ├─► Toxiproxy :18080 ─► WireMock (Horizon mock) :1080
    ├─► Toxiproxy :15432 ─► PostgreSQL :5432
    ├─► Toxiproxy :16379 ─► Redis :6379
    └─► Toxiproxy :19000 ─► WireMock (webhook target) :9000

Toxiproxy control API: :8474
```

Each arrow represents a proxy that the test suite can manipulate via the
Toxiproxy REST API to inject latency, timeouts, bandwidth limits, or
connection resets.

---

## Scenarios

### 1. Horizon Timeout → Exponential Backoff → Eventual Success
**File**: `horizon-timeout.test.ts`

The Toxiproxy `timeout` toxic is applied to the Horizon proxy so that
connections hang.  The client fires requests with a short per-request
timeout and exponential back-off between retries.  The toxic is removed
mid-sequence to simulate Horizon recovering; the test asserts that the
final request succeeds and that at least 3 attempts were made.

Also validates that when Horizon *never* recovers, all retry attempts
are exhausted and an error is thrown.

| Toxic | Type | Parameter |
|-------|------|-----------|
| horizon timeout | `timeout` | `timeout: 5000 ms` |

---

### 2. Horizon 503 → Circuit Breaker Opens → Fallback Response
**File**: `circuit-breaker.test.ts`

A `reset_peer` toxic forces all Horizon connections to close immediately.
A `CircuitBreaker` (threshold = 3, half-open after 500 ms) tracks
consecutive failures.  After 3 failures the circuit opens and subsequent
calls return a fallback value without hitting the network.

Also validates the half-open → closed transition once the toxic is removed.

| Toxic | Type | Parameter |
|-------|------|-----------|
| horizon reset | `reset_peer` | `timeout: 100 ms` |

---

### 3. Redis Unavailable → Cache-Miss Path Executes Correctly
**File**: `redis-unavailable.test.ts`

The Redis proxy is disabled entirely.  The cache layer catches the
connection error and falls through to the origin (DB / API).  The test
asserts the correct value is returned and that the origin function was
called.

Also tests a latency toxic (2 s) that exceeds the 1 s socket timeout,
confirming the same fall-through behaviour.

Finally, verifies that once Redis is available, subsequent reads are served
from cache (cache-hit path).

| Toxic | Type | Parameter |
|-------|------|-----------|
| redis down | proxy disabled | — |
| redis latency | `latency` | `latency: 2000 ms` |

---

### 4. DB Connection Lost Mid-Request → 503 Returned, Connection Recycled
**File**: `db-connection-lost.test.ts`

A `reset_peer` toxic (50 ms timeout) kills the Postgres connection while a
query is in-flight.  The service layer wraps the `pg` call and returns HTTP
503 on error.  After removing the toxic the pool establishes a fresh
connection and the next query succeeds.

| Toxic | Type | Parameter |
|-------|------|-----------|
| postgres reset | `reset_peer` | `timeout: 50 ms` |

---

### 5. Webhook Delivery Failure → Retry Queue Populated
**File**: `webhook-retry.test.ts`

The webhook proxy is disabled (target unreachable).  The dispatcher
catches the delivery failure and pushes the event onto an in-memory retry
queue.  The test asserts the queue contains 1 item.

When the proxy is re-enabled, `retryQueue.drain()` is called and the
delivery succeeds.  Also validates that events are dropped after
`maxAttempts` exhausted failures.

| Toxic | Type | Parameter |
|-------|------|-----------|
| webhook down | proxy disabled | — |
| webhook latency | `latency` | `latency: 5000 ms` |

---

## Adding new scenarios

1. Create a new file `backend/tests/resilience/<scenario>.test.ts`.
2. Import `ToxiproxyClient` from `./toxiproxyClient`.
3. Use `tp.getProxy('<name>')` to obtain a handle to the relevant proxy.
4. Add toxics before your assertions and call `proxy.removeAllToxics()` in
   `afterEach`.
5. Run with `npm run test:resilience`.
