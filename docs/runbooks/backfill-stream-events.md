# Runbook: Backfill Stream Events

**API endpoint:** `POST /admin/backfill?from_ledger=N&to_ledger=M`  
**Script (legacy):** `backend/scripts/backfill_stream_events.ts`  
**Issue:** [#749](https://github.com/DevNiola/vesting-cliff-drip-stream/issues/749)  
**Last updated:** 2026-10-02

---

## Overview

The backfill service replays historical contract events from Horizon into the
`stream_events` PostgreSQL table. Use it when:

- The event indexer worker was down and missed a contiguous ledger range.
- The `stream_events` table was dropped and needs to be rebuilt from scratch.
- A bug was fixed in the event decoder and existing rows need to be re-ingested.

The script is idempotent: it uses `ON CONFLICT (tx_hash) DO NOTHING`, so
re-running it over an already-populated range is always safe.

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Node 20+ | `node --version` |
| `tsx` | Already in `backend/package.json` |
| `DATABASE_URL` | Writable connection to the target PostgreSQL instance |
| `TESTNET_CONTRACT_ID` or `MAINNET_CONTRACT_ID` | Soroban contract address |
| `HORIZON_URL` | Horizon base URL (defaults to Stellar testnet) |
| Migration 004 applied | `stream_events` table must exist |

Check migration status:

```sql
SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 5;
```

---

## Usage via API (recommended)

The backfill service is available as an authenticated admin API endpoint.
This is the preferred method for production use as it tracks progress in the
`backfill_jobs` table and is resumable after a restart.

### Start a backfill job

```bash
curl -X POST \
  "https://api.example.com/admin/backfill?from_ledger=5000000&to_ledger=5100000" \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

Response `202 Accepted`:

```json
{
  "message": "Backfill job started",
  "job": {
    "id": "a1b2c3d4-...",
    "from_ledger": 5000000,
    "to_ledger": 5100000,
    "status": "running",
    "events_fetched": 0,
    "events_inserted": 0,
    "events_skipped": 0,
    "last_cursor": null,
    "created_at": "2026-10-02T13:00:00Z",
    "started_at": "2026-10-02T13:00:00Z",
    "completed_at": null,
    "error_message": null
  }
}
```

### Check job progress

```bash
curl "https://api.example.com/admin/backfill/a1b2c3d4-..." \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

### List all backfill jobs

```bash
curl "https://api.example.com/admin/backfill" \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

### Notes on the API

- The job runs asynchronously in the background; poll the job endpoint for progress.
- Progress is persisted after every Horizon page via `last_cursor`, enabling
  resumability: if the process restarts, progress is preserved in `backfill_jobs`.
- The upsert uses `ON CONFLICT (tx_hash) DO NOTHING` — safe to call multiple
  times over the same ledger range without creating duplicates.
- The `backfill_events_processed_total` Prometheus metric is incremented for
  every event successfully written.

---

## Usage via script (legacy)

```bash
DATABASE_URL="postgres://..." \
TESTNET_CONTRACT_ID="C..." \
HORIZON_URL="https://horizon.stellar.org" \
tsx backend/scripts/backfill_stream_events.ts
```

### Backfill a specific ledger range

Use `--from-ledger` and `--to-ledger` to restrict the backfill to a window.
Ledger sequence numbers are available from the Horizon ledger endpoint.

```bash
DATABASE_URL="postgres://..." \
TESTNET_CONTRACT_ID="C..." \
tsx backend/scripts/backfill_stream_events.ts \
  --from-ledger 5000000 \
  --to-ledger   5100000
```

### Resume an interrupted backfill

If the script exits mid-run, it prints a resume hint:

```
[backfill] Resume with: BACKFILL_START_CURSOR="<paging_token>"
```

Pass that cursor to restart from where it stopped:

```bash
DATABASE_URL="postgres://..." \
TESTNET_CONTRACT_ID="C..." \
BACKFILL_START_CURSOR="<paging_token>" \
tsx backend/scripts/backfill_stream_events.ts
```

### Dry-run (preview without writing)

```bash
DATABASE_URL="postgres://..." \
TESTNET_CONTRACT_ID="C..." \
tsx backend/scripts/backfill_stream_events.ts \
  --from-ledger 5000000 \
  --to-ledger   5000100 \
  --dry-run
```

The `--dry-run` flag (or `BACKFILL_DRY_RUN=1`) logs each decoded event to
stdout without inserting any rows. Use this to validate the event decoder
output before committing to a full backfill.

---

## Configuration reference

| CLI arg / Env var | Default | Description |
|-------------------|---------|-------------|
| `--from-ledger N` / `BACKFILL_FROM_LEDGER` | (none) | Start ledger sequence, inclusive |
| `--to-ledger N` / `BACKFILL_TO_LEDGER` | (none) | End ledger sequence, inclusive |
| `--dry-run` / `BACKFILL_DRY_RUN=1` | off | Log events without writing to DB |
| `BACKFILL_START_CURSOR` | `""` | Horizon `paging_token` to resume from |
| `BACKFILL_PAGE_LIMIT` | `200` | Records per Horizon page (max 200) |
| `HORIZON_URL` | testnet | Horizon base URL |
| `STELLAR_NETWORK` | `testnet` | `testnet` \| `mainnet` \| `futurenet` |

CLI arguments take priority over environment variables when both are present.

---

## Output & progress bar

The script prints a live progress bar to the terminal (TTY) or periodic
summary lines (CI / non-TTY):

```
[backfill] [████████████░░░░░░░░] page=12 fetched=2400 inserted=2197
```

Final summary line:

```
[backfill] Done. fetched=2400 inserted=2197 skipped=12 dlq=3
```

- **fetched** — total Horizon records retrieved.
- **inserted** — rows written to `stream_events` (duplicates are silently skipped).
- **skipped** — records with an unrecognised event type (not one of `vc_create`, `vc_claim`, `vc_cancel`, `vc_done`, `vc_drain`).
- **dlq** — records that failed decoding; written to `stream_events_dlq` for later inspection.

---

## Dead-letter queue

Events that raise a decoding exception are written to `stream_events_dlq`:

```sql
SELECT horizon_event_id, last_error, attempt_count, created_at
FROM stream_events_dlq
ORDER BY created_at DESC
LIMIT 20;
```

After fixing the decoder, re-run the script over the affected ledger range.
The `ON CONFLICT ... DO UPDATE` on `horizon_event_id` increments `attempt_count`
each time, so you can track retries.

---

## Verifying the backfill

After the script completes, confirm row counts match your expectation:

```sql
-- Total events by type
SELECT event_type, COUNT(*) AS cnt
FROM stream_events
GROUP BY event_type
ORDER BY cnt DESC;

-- Events in the backfilled ledger range
SELECT COUNT(*)
FROM stream_events
WHERE ledger_sequence BETWEEN 5000000 AND 5100000;

-- Check for any DLQ entries from this run
SELECT *
FROM stream_events_dlq
WHERE created_at > NOW() - INTERVAL '1 hour';
```

---

## Operational notes

- **Duration:** Expect roughly 1–2 minutes per 10,000 events at Horizon's
  default rate limits. A full mainnet backfill from genesis may take several
  hours; run it as a background job via `nohup` or a Kubernetes Job.

- **Rate limits:** If Horizon returns HTTP 429, reduce page size:
  `BACKFILL_PAGE_LIMIT=50`. The script exits on a non-OK response and
  prints the resume cursor.

- **Database impact:** The script runs each page in a single transaction. On
  production, consider running during a low-traffic window and monitoring
  `pg_stat_activity` for lock contention.

- **Concurrency:** Do not run two backfill instances against the same ledger
  range simultaneously. The `ON CONFLICT DO NOTHING` guarantee prevents
  duplicates but concurrent writes will cause unnecessary lock contention.

---

## Rollback

The script only appends rows; it never updates or deletes. To roll back
a backfill, delete by ledger range:

```sql
DELETE FROM stream_events
WHERE ledger_sequence BETWEEN 5000000 AND 5100000;
```

Then re-run with `--dry-run` to confirm the data looks correct before
re-inserting.
