# Chaos Testing – Indexer Resilience

> Issue #787 — Implements the chaos testing framework for the event indexer.

## Overview

The chaos testing framework injects network and database failures into the
Horizon API connection during indexer operation to verify that:

1. The indexer **recovers correctly** after each fault.
2. **No events are lost** or duplicated during failure windows.
3. **Cursor integrity** is maintained across all failure modes.

Failures are injected via [Toxiproxy](https://github.com/Shopify/toxiproxy), a
programmable TCP proxy, so real Horizon infrastructure is never modified.

---

## Failure Scenarios

| # | Scenario | Fault Mechanism | Expected Behaviour |
|---|---|---|---|
| 1 | Horizon 429 for 30 s | Latency toxic (rate-limit simulation) | Indexer backs off exponentially and resumes |
| 2 | Malformed JSON | Limit-data toxic (truncates to 12 bytes) | Indexer logs parse error, skips event, continues |
| 3 | Horizon 503 for 5 min | Timeout toxic (connection reset) | Indexer retries with backoff, resumes correctly |
| 4 | Network timeout mid-response | Limit-data toxic (drops at 64 bytes) | Indexer detects truncation, retries from last cursor |
| 5 | DB connection lost mid-write | Simulated write failure + rollback | Cursor is NOT advanced; retry write succeeds |
| 6 | Cursor corruption | Simulated corrupt cursor value | Indexer detects invalid cursor, resets to checkpoint |

---

## Running Locally

### Prerequisites

- Docker + Docker Compose
- Node.js 20+
- `npm ci` in `backend/`

### Quick start

```bash
# From the repository root:
make chaos-test
```

This will:
1. Start Toxiproxy via `docker-compose.toxiproxy.yml`
2. Create the `horizon` proxy pointing at `horizon.stellar.org:443`
3. Run all 6 scenarios via vitest
4. Write a results report to `docs/chaos/`
5. Tear down Toxiproxy

### Manual run (with existing Toxiproxy)

```bash
export SKIP_DOCKER=1
export TOXIPROXY_HOST=localhost
export TOXIPROXY_PORT=8474
export HORIZON_PROXY_URL=http://localhost:8666
make chaos-test
```

### Direct vitest

```bash
cd backend
npx vitest run tests/resilience/chaos/horizon-chaos.test.ts --reporter=verbose
```

---

## CI / Nightly Schedule

Chaos tests run **nightly at 03:00 UTC** via
[`.github/workflows/chaos.yml`](../../.github/workflows/chaos.yml).

The workflow:
- Spins up Toxiproxy as a GitHub Actions service container.
- Runs all 6 scenarios.
- Uploads the results report as a workflow artifact (retained 30 days).
- Opens a GitHub issue labelled `chaos` if any scenario fails.

To trigger manually: **Actions → Chaos Tests → Run workflow**.

---

## Results Reports

Nightly results are committed to this directory as `latest-results.md`.
Historical results are available as workflow artifacts in GitHub Actions.

See [`latest-results.md`](./latest-results.md) for the most recent run.

---

## Acceptance Criteria (Issue #787)

- [x] All 6 scenarios pass without data loss.
- [x] Chaos tests run in CI nightly (`.github/workflows/chaos.yml`).
- [x] Results report committed to `docs/chaos/`.

---

## Architecture

```
                ┌─────────────────────────────────────┐
                │         Chaos Test Suite              │
                │  backend/tests/resilience/chaos/     │
                │  horizon-chaos.test.ts               │
                └──────────────┬──────────────────────┘
                               │ injects faults
                               ▼
                ┌─────────────────────────────────────┐
                │          Toxiproxy                   │
                │  :8474 (API)  :8666 (horizon proxy)  │
                └──────────────┬──────────────────────┘
                               │ proxies
                               ▼
                ┌─────────────────────────────────────┐
                │        Horizon API                   │
                │  horizon.stellar.org (upstream)      │
                └─────────────────────────────────────┘
```

The `ToxiproxyClient` in `backend/tests/resilience/toxiproxyClient.ts` provides
the API for creating and removing toxics programmatically within tests.
