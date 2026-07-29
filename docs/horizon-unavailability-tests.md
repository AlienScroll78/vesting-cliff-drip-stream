# Horizon Unavailability Tests

This repository currently contains the Soroban contract only. There is no
backend service or Horizon client implementation to execute directly in CI.

The Toxiproxy harness in `scripts/run_horizon_toxiproxy_tests.sh` defines the
required backend resilience tests once the backend is added or connected to this
repository.

## Required scenarios

The backend must be configured to call Horizon through the Toxiproxy listener
instead of calling Horizon directly:

```text
HORIZON_URL=http://127.0.0.1:8666
```

The harness covers these failures:

- Connection refused: removes the `horizon` proxy before the backend request.
- Timeout: adds a Toxiproxy `timeout` toxic on the downstream stream.
- Slow response: adds a downstream `latency` toxic above the backend timeout.

For each scenario, the backend must return HTTP `503 Service Unavailable`
without leaking low-level transport errors to the client.

## Circuit breaker expectation

After repeated Horizon failures, the backend circuit breaker must move to an
open state and short-circuit further Horizon calls until the recovery window
expires. The test harness verifies this by querying:

```text
/health/horizon/circuit-breaker
```

The endpoint should return a body containing `open` when the breaker has opened.
If the backend exposes circuit breaker state elsewhere, run the harness with:

```bash
CIRCUIT_BREAKER_PATH=/your/path ./scripts/run_horizon_toxiproxy_tests.sh
```

## Retry policy

Horizon requests should use bounded retries for temporary failures:

- Retry only transient transport errors, HTTP `429`, and HTTP `5xx`.
- Do not retry malformed requests, authentication failures, or HTTP `4xx`
  other than `429`.
- Use exponential backoff with jitter.
- Keep the total retry budget below the backend request timeout so callers
  receive a timely `503`.
- Count final exhausted attempts as circuit breaker failures.

## Running locally

Start Toxiproxy:

```bash
docker compose -f docker-compose.toxiproxy.yml up -d
```

Start the backend with Horizon pointed at the proxy listener, then run:

```bash
BACKEND_BASE_URL=http://127.0.0.1:3000 ./scripts/run_horizon_toxiproxy_tests.sh
```

Override these variables when the backend uses different paths or ports:

- `BACKEND_BASE_URL`
- `TOXIPROXY_URL`
- `HORIZON_UPSTREAM`
- `HORIZON_PROXY`
- `HORIZON_STATUS_PATH`
- `CIRCUIT_BREAKER_PATH`
