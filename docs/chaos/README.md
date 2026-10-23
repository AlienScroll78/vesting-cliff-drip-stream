# Chaos Testing – Indexer Resilience

> Issue #787 — Chaos testing framework for the event indexer.
> Issue #1066 — Indexer downtime & recovery scenarios.

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

### Downtime & Recovery Scenarios (Issue #1066)

These drive the real `StreamIndexer` end-to-end against a **mocked Horizon**
(`fetch`) and a **mocked PostgreSQL pool**, so they need no Toxiproxy and assert
the resulting database state after recovery.

| # | Scenario | Fault Mechanism | Expected Behaviour |
|---|---|---|---|
| D1 | Indexer stopped for 100 ledgers | Indexer halted, chain advances 100 ledgers | Restart resumes from persisted cursor; contiguous, gap-free catch-up |
| D2 | DB connection lost mid-insert | Insert throws `ECONNRESET` after `BEGIN` | Transaction rolled back; cursor not advanced; event retried on restart |
| D3 | Horizon returns 429 | Rate-limit responses for consecutive ticks | Exponential back-off; deferred event persisted exactly once on retry |
| D4 | Cursor row missing | `indexer_cursors` row absent | Falls back to configurable `INDEXER_DEFAULT_START_LEDGER` |

File: [`backend/tests/resilience/chaos/downtime-recovery-chaos.test.ts`](../../backend/tests/resilience/chaos/downtime-recovery-chaos.test.ts)

Scenario D4 is backed by a real production fallback in `StreamIndexer.tick()`
(`backend/src/indexer/StreamIndexer.ts`). When `readCursor()` returns an empty
string and `INDEXER_DEFAULT_START_LEDGER` is set, the indexer uses that value as
the paging cursor, making a re-index deterministic after a corrupted or missing
cursor row.

```bash
cd backend
npx vitest run \
  --config vitest.resilience.config.ts \
  tests/resilience/chaos/downtime-recovery-chaos.test.ts --reporter=verbose
```

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
3. Run the 6 network-fault scenarios, then the 4 downtime/recovery scenarios
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
npx vitest run \
  --config vitest.resilience.config.ts \
  tests/resilience/chaos/horizon-chaos.test.ts --reporter=verbose
```

---

## CI / Nightly Schedule

Chaos tests run **nightly at 03:00 UTC** via
[`.github/workflows/chaos.yml`](../../.github/workflows/chaos.yml).

The workflow:
- Spins up Toxiproxy as a GitHub Actions service container.
- Runs the 6 network-fault scenarios, then the 4 downtime/recovery scenarios.
- Uploads the results report as a workflow artifact (retained 30 days).
- Opens a GitHub issue labelled `chaos` if any scenario fails.

To trigger manually: **Actions → Chaos Tests → Run workflow**.

---

## Results Reports

Nightly results are committed to this directory as `latest-results.md`.
Historical results are available as workflow artifacts in GitHub Actions.

See [`latest-results.md`](./latest-results.md) for the most recent run.

---

## Acceptance Criteria

### Issue #787

- [x] All 6 scenarios pass without data loss.
- [x] Chaos tests run in CI nightly (`.github/workflows/chaos.yml`).
- [x] Results report committed to `docs/chaos/`.

### Issue #1066

- [x] D1 — Indexer stopped for 100 ledgers, restarted; catches up without gaps.
- [x] D2 — DB connection lost mid-insert; transaction rolled back, event retried on restart.
- [x] D3 — Horizon returns 429; indexer backs off and retries.
- [x] D4 — Cursor table row missing; indexer falls back to a configurable default start ledger.
- [x] All four verified with DB state assertions after recovery.

---

## Achieved Recovery Point Objective (RPO)

**RPO = 0 events (no data loss) under every tested failure mode.**

The indexer's recovery guarantees derive from two invariants:

1. **The cursor is written only after the event batch commits.** In
   `StreamIndexer.tick()` the event upsert commits *before* `writeCursor` runs,
   so a crash, restart, or dropped DB connection leaves the cursor pointing at
   the last fully-committed ledger. On restart the indexer re-fetches from that
   cursor and re-processes the interrupted batch.
2. **Event inserts are idempotent.** `stream_events` upserts use
   `ON CONFLICT (transaction_hash) DO NOTHING`, so re-processing a batch after a
   restart never creates duplicates.

| Failure mode | Achieved RPO | Mechanism |
|---|---|---|
| Downtime (up to 100+ ledgers) | **0 events** | Resume from persisted cursor; Horizon replays everything after it |
| DB connection lost mid-insert | **0 events** | `ROLLBACK` + cursor unchanged → batch retried on restart |
| Horizon 429 rate-limiting | **0 events** | Exponential back-off, deferred batch persisted exactly once |
| Cursor row missing/corrupted | **0 events*** | Fallback to `INDEXER_DEFAULT_START_LEDGER` |

\* The missing-cursor case guarantees **no gap** from the configured start ledger
onward. Events *before* `INDEXER_DEFAULT_START_LEDGER` cannot be recovered — the
operator chooses that bound. Set it to your contract's deployment ledger to keep
the gap empty in practice.

**Recovery time** is bounded by one poll interval plus back-off (capped at
`INDEXER_MAX_BACKOFF_MS`, default 60 s) for transient faults, and one process
restart for downtime.

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

The downtime/recovery suite bypasses Toxiproxy entirely, stubbing `fetch` and a
fake PostgreSQL pool in-process to exercise the real `StreamIndexer`.
