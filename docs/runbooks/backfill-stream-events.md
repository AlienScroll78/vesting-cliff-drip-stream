# Runbook: Backfill Stream Events

**Script:** `backend/scripts/backfill_stream_events.ts` (`npm run backfill`)  
**API endpoint:** `POST /admin/backfill?from_ledger=N&to_ledger=M`  
**Issue:** [#749](https://github.com/DevNiola/vesting-cliff-drip-stream/issues/749), [#1014](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/1014)  
**Last updated:** 2026-10-21

---

## Overview

The backfill service replays historical contract events from Horizon into the
`stream_events` PostgreSQL table. Use it when:

- The event indexer worker was down and missed a contiguous ledger range.
- The `stream_events` table was dropped and needs to be rebuilt from scratch.
- A bug was fixed in the event decoder and existing rows need to be re-ingested.

The script is idempotent: it upserts on the unique `tx_hash` column
(`ON CONFLICT (tx_hash) DO UPDATE`), so re-running it over an already-populated
range **updates** existing rows in place instead of duplicating them. This is
what makes a decoder-fix backfill useful — stale decoded values are replaced
with the corrected ones rather than being silently ignored.

Every non-dry-run invocation also runs a **post-backfill reconciliation job**
automatically (see [Reconciliation](#reconciliation)); pass `--no-reconcile`
to skip it.

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
- The upsert matches **script** semantics: `ON CONFLICT (tx_hash) DO UPDATE`, so
  re-running over the same ledger range repairs existing rows instead of
  silently leaving stale decoded values behind.
- The `backfill_events_processed_total` Prometheus metric is incremented for
  every event successfully written.

---

## Usage via script (recommended for decoder fixes)

The script is invoked through the `backfill` npm script:

```bash
cd backend

DATABASE_URL="postgres://..." \
TESTNET_CONTRACT_ID="C..." \
HORIZON_URL="https://horizon.stellar.org" \
npm run backfill -- --start-ledger 5000000 --end-ledger 5100000
```

### Backfill a specific ledger range

`--start-ledger` and `--end-ledger` are both inclusive and both required
unless supplied via `BACKFILL_FROM_LEDGER` / `BACKFILL_TO_LEDGER`. Ledger
sequence numbers are available from the Horizon ledger endpoint.

```bash
npm run backfill -- --start-ledger 5000000 --end-ledger 5100000
```

The legacy spellings `--from-ledger` / `--to-ledger` are accepted as aliases.

### Limit the run to one event type

`--event-type` restricts the backfill to a single decoded event type. This is
the intended mode for a decoder fix that only affects one event shape — it
avoids re-writing unrelated rows.

```bash
npm run backfill -- \
  --start-ledger 5000000 \
  --end-ledger   5100000 \
  --event-type   vc_claim
```

- Accepted values: `vc_create`, `vc_claim`, `vc_cancel`, `vc_done`, `vc_drain`.
- The flag is repeatable and accepts comma-separated values:
  `--event-type vc_claim,vc_cancel`.
- Records that do not match are counted in the `skipped` total.
- Default (flag absent): every recognised event type is backfilled.

### Dry-run (preview without writing)

```bash
npm run backfill -- \
  --start-ledger 5000000 \
  --end-ledger   5000100 \
  --dry-run
```

The `--dry-run` flag (or `BACKFILL_DRY_RUN=1`) logs each decoded event to
stdout without writing any rows, and skips the reconciliation job. Use this to
validate the event decoder output before committing to a full backfill.

### Resume an interrupted backfill

If the script exits mid-run, it prints a resume hint:

```
[backfill] Resume with: BACKFILL_START_CURSOR="<paging_token>"
```

Pass that cursor to restart from where it stopped:

```bash
BACKFILL_START_CURSOR="<paging_token>" \
npm run backfill -- --start-ledger 5000000 --end-ledger 5100000
```

### Horizon retention window

Horizon only keeps a bounded window of history. If the requested range begins
before the oldest ledger Horizon still serves, the script cannot replay the
missing ledgers and says so instead of reporting a clean run:

```
[backfill] WARNING: Horizon did not serve ledgers before ~4200000; the requested
range starts at 5000000. Horizon has a bounded retention window — see
docs/runbooks/backfill-stream-events.md for the archive operator flow.
```

The run summary sets `truncated: true` in this case. To cover ledgers that
Horizon has already evicted, ingest the historical contract events from
Stellar's public history archives (`stellar-core` / `horizon` database
snapshots) into `stream_events` directly, then run this script over the
overlapping range that Horizon still serves. The `ON CONFLICT ... DO UPDATE`
upsert makes that overlap safe — rows loaded from the archive are corrected by
any richer decode the script produces.

---

## Configuration reference

| CLI arg / Env var | Default | Description |
|-------------------|---------|-------------|
| `--start-ledger N` / `BACKFILL_FROM_LEDGER` | (none) | Start ledger sequence, inclusive. Alias: `--from-ledger` |
| `--end-ledger N` / `BACKFILL_TO_LEDGER` | (none) | End ledger sequence, inclusive. Alias: `--to-ledger` |
| `--event-type <type>` / `BACKFILL_EVENT_TYPES` | all types | Limit the run to one or more event types (repeatable / comma-separated) |
| `--dry-run` / `BACKFILL_DRY_RUN=1` | off | Log events without writing to the DB |
| `--no-reconcile` / `BACKFILL_SKIP_RECONCILE=1` | off | Skip the post-backfill reconciliation job |
| `BACKFILL_START_CURSOR` | `""` | Horizon `paging_token` to resume from |
| `BACKFILL_PAGE_LIMIT` | `200` | Records per Horizon page (max 200) |
| `HORIZON_URL` | testnet | Horizon base URL |
| `STELLAR_NETWORK` | `testnet` | `testnet` \| `mainnet` \| `futurenet` |

CLI arguments take priority over environment variables when both are present.

---

## Output & progress bar

The script prints a live, range-aware progress bar to the terminal (TTY) or
periodic summary lines (CI / non-TTY):

```
[████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░]  30.0%  ledger=5,030,000  fetched=2400  ins=2197  upd=0  skip=12
```

Final summary line:

```
[backfill] Done. fetched=2400 inserted=2197 updated=0 skipped=12 dlq=3
```

- **fetched** — total Horizon records retrieved.
- **inserted** — new rows written to `stream_events`.
- **updated** — rows that already existed for that `tx_hash` and were re-written
  with the freshly decoded values. On a decoder-fix backfill this is the number
  that matters: it is how many stale rows were repaired.
- **skipped** — records filtered out, either because the event type is not
  recognised (`vc_create`, `vc_claim`, `vc_cancel`, `vc_done`, `vc_drain`) or
  because `--event-type` excluded them.
- **dlq** — records that failed decoding; written to `stream_events_dlq` for later inspection.

---

## Reconciliation

Every non-dry-run invocation ends with an automatic reconciliation job, which
confirms the backfilled range is internally consistent before you walk away:

```
[backfill] ── Reconciliation ──────────────────────────────
[backfill] ledger range : [5000000..5100000]
[backfill] rows in range: 2197
[backfill]   vc_create : 412
[backfill]   vc_claim  : 1785
[backfill] status       : OK
[backfill] ───────────────────────────────────────────────
```

The job reports:

- the number of `stream_events` rows now present in the range, broken down by
  event type;
- any ledger sequences inside the range that have no rows (up to 50 are listed);
- the number of `stream_events_dlq` entries created in the last hour;
- an overall status of `OK` or `NEEDS ATTENTION`.

Status is `NEEDS ATTENTION` when nothing was written for the range or when the
DLQ received entries during the run. Ledger gaps alone do not fail the run —
quiet ledgers legitimately contain no contract events.

Skip it with `--no-reconcile` (or `BACKFILL_SKIP_RECONCILE=1`) when running a
large partitioned backfill where you intend to reconcile once at the end.

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

The reconciliation job run at the end of every backfill already performs these
checks automatically. Re-run them by hand if you need to double-check a range
later:

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

-- Confirm a decoder fix actually landed: the amount for a known tx_hash
-- should match the corrected decode, not the old value.
SELECT tx_hash, event_type, amount, ledger_sequence
FROM stream_events
WHERE tx_hash = '<tx_hash>';

-- Check for any DLQ entries from this run
SELECT *
FROM stream_events_dlq
WHERE created_at > NOW() - INTERVAL '1 hour';
```

A quick way to confirm the upsert did not duplicate anything is to assert that
`tx_hash` remains unique across the range:

```sql
SELECT tx_hash, COUNT(*)
FROM stream_events
WHERE ledger_sequence BETWEEN 5000000 AND 5100000
GROUP BY tx_hash
HAVING COUNT(*) > 1;
```

This must return zero rows — `tx_hash` carries a unique constraint, so any
duplicate would mean the constraint is missing.

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
  range simultaneously. The `ON CONFLICT (tx_hash) DO UPDATE` guarantee
  prevents duplicates but concurrent writes will cause unnecessary lock
  contention and can make the `inserted` / `updated` split misleading.

---

## Rollback

The script only writes `stream_events` (it never deletes), and it upserts rather
than blindly appending. To roll back a backfill, delete by ledger range:

```sql
DELETE FROM stream_events
WHERE ledger_sequence BETWEEN 5000000 AND 5100000;
```

Then re-run with `--dry-run` to confirm the data looks correct before
re-ingesting.

> **Note on decoder-fix rollbacks:** if the backfill *repaired* rows that the
> live indexer had previously written with the buggy decoder, deleting the range
> removes those rows entirely. Re-run the backfill (or the indexer) to reinsert
> them; there is no undo that restores the pre-fix values, and you would not want
> one.
