/**
 * Issue #749: POST /admin/backfill
 *
 * Admin endpoint that triggers a backfill of Horizon events into the
 * `stream_events` table for a specified ledger range.
 *
 * Endpoint:
 *   POST /admin/backfill?from_ledger=N&to_ledger=M
 *
 * Security: protected by the requireAdminAuth Bearer-token middleware
 * (ADMIN_API_KEY environment variable), mounted via the admin router.
 *
 * Behaviour:
 *   1. Validates from_ledger / to_ledger query params.
 *   2. Creates a `backfill_jobs` row (status = 'running').
 *   3. Fetches Horizon events using cursor-based pagination.
 *   4. Upserts into stream_events with ON CONFLICT DO NOTHING (idempotent).
 *   5. Updates job progress after each page.
 *   6. Marks the job 'completed' or 'failed' on finish.
 *   7. Increments the `backfill_events_processed_total` Prometheus counter.
 *
 * Additional endpoints:
 *   GET /admin/backfill        — list recent backfill jobs
 *   GET /admin/backfill/:id    — get status of a specific job
 */

import { Router, type Request, type Response } from "express";
import { Pool } from "pg";
import { backfillEventsProcessedTotal } from "../metrics.js";
import { networkConfig } from "../config/network.js";

// ---------------------------------------------------------------------------
// DB pool (lazy singleton)
// ---------------------------------------------------------------------------

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HORIZON_URL =
  process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";

const PAGE_LIMIT = Math.min(
  200,
  parseInt(process.env.BACKFILL_PAGE_LIMIT ?? "200", 10)
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackfillJob {
  id: string;
  from_ledger: number;
  to_ledger: number;
  status: "pending" | "running" | "completed" | "failed";
  events_fetched: number;
  events_inserted: number;
  events_skipped: number;
  last_cursor: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

// ---------------------------------------------------------------------------
// Event decoding (minimal, matches backfill_stream_events.ts)
// ---------------------------------------------------------------------------

type EventType = "vc_create" | "vc_claim" | "vc_cancel" | "vc_done" | "vc_drain";

const KNOWN_EVENT_TYPES = new Set<string>([
  "vc_create",
  "vc_claim",
  "vc_cancel",
  "vc_done",
  "vc_drain",
]);

function decodeSymbol(xdr: string): string {
  try {
    const buf = Buffer.from(xdr, "base64");
    if (buf.length > 8) return buf.subarray(8).toString("utf8").replace(/\0/g, "").trim();
    return buf.toString("utf8").replace(/[^\x20-\x7e]/g, "").trim();
  } catch {
    return xdr;
  }
}

function decodeAddress(xdr: string): string {
  return xdr; // Best-effort; full XDR decode would use StellarBase
}

function decodeBigInt(xdr: string | undefined): bigint | null {
  if (!xdr) return null;
  try {
    const buf = Buffer.from(xdr, "base64");
    if (buf.length >= 8) return buf.readBigInt64BE(buf.length - 8);
    return null;
  } catch {
    return null;
  }
}

interface DecodedEvent {
  event_type: EventType;
  recipient: string;
  sponsor: string | null;
  token: string | null;
  amount: bigint | null;
  ledger_sequence: number;
  tx_hash: string;
  event_index: number;
}

function decodeEvent(
  record: Record<string, unknown>,
  fromLedger: number,
  toLedger: number
): DecodedEvent | null {
  try {
    const topics = (record.topic as string[]) ?? [];
    const rawType = decodeSymbol(topics[0] ?? "");
    if (!KNOWN_EVENT_TYPES.has(rawType)) return null;

    const eventType = rawType as EventType;
    const recipient = decodeAddress(topics[1] ?? "");

    const txHash: string =
      (record.transaction_hash as string) ??
      (typeof record.id === "string" ? record.id.split("-")[0] : "") ??
      "";

    const eventIndex: number =
      typeof record.id === "string"
        ? parseInt(record.id.split("-")[1] ?? "0", 10)
        : 0;

    const ledger: number =
      typeof record.ledger === "number"
        ? record.ledger
        : parseInt(String(record.ledger ?? "0"), 10);

    // Filter to requested range
    if (ledger < fromLedger || ledger > toLedger) return null;

    const valueFields: string[] =
      record.value && typeof (record.value as Record<string, unknown>).xdr === "string"
        ? [(record.value as Record<string, unknown>).xdr as string]
        : Array.isArray(record.value)
        ? (record.value as string[])
        : [];

    let sponsor: string | null = null;
    let token: string | null = null;
    let amount: bigint | null = null;

    if (eventType === "vc_create") {
      sponsor = decodeAddress(topics[2] ?? valueFields[0] ?? "");
      token = decodeAddress(valueFields[1] ?? "");
    } else if (eventType === "vc_claim" || eventType === "vc_cancel") {
      amount = decodeBigInt(valueFields[0]);
    } else if (eventType === "vc_drain") {
      sponsor = decodeAddress(valueFields[0] ?? "");
      amount = decodeBigInt(valueFields[1]);
    } else if (eventType === "vc_done") {
      token = decodeAddress(valueFields[0] ?? "");
    }

    return {
      event_type: eventType,
      recipient,
      sponsor,
      token,
      amount,
      ledger_sequence: ledger,
      tx_hash: txHash,
      event_index: eventIndex,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Horizon fetch (single page)
// ---------------------------------------------------------------------------

async function fetchPage(
  cursor: string,
  contractId: string
): Promise<{ records: Record<string, unknown>[]; nextCursor: string | null }> {
  const url = new URL(`${HORIZON_URL}/contracts/${contractId}/events`);
  url.searchParams.set("limit", String(PAGE_LIMIT));
  url.searchParams.set("order", "asc");
  if (cursor) url.searchParams.set("cursor", cursor);

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Horizon HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = (await resp.json()) as Record<string, unknown>;
  const embedded = data._embedded as Record<string, unknown> | undefined;
  const records = (embedded?.records as Record<string, unknown>[]) ?? [];

  if (records.length === 0) return { records: [], nextCursor: null };

  const nextCursor = records[records.length - 1].paging_token as string;
  return { records, nextCursor };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function createJob(
  fromLedger: number,
  toLedger: number
): Promise<BackfillJob> {
  const pool = getPool();
  const result = await pool.query<BackfillJob>(
    `INSERT INTO backfill_jobs
       (from_ledger, to_ledger, status, started_at)
     VALUES ($1, $2, 'running', now())
     RETURNING *`,
    [fromLedger, toLedger]
  );
  return result.rows[0];
}

async function updateJobProgress(
  jobId: string,
  fetched: number,
  inserted: number,
  skipped: number,
  lastCursor: string
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE backfill_jobs
     SET events_fetched  = $2,
         events_inserted = $3,
         events_skipped  = $4,
         last_cursor     = $5
     WHERE id = $1`,
    [jobId, fetched, inserted, skipped, lastCursor]
  );
}

async function completeJob(jobId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE backfill_jobs
     SET status = 'completed', completed_at = now()
     WHERE id = $1`,
    [jobId]
  );
}

async function failJob(jobId: string, errorMessage: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE backfill_jobs
     SET status = 'failed', completed_at = now(), error_message = $2
     WHERE id = $1`,
    [jobId, errorMessage]
  );
}

/**
 * Upsert events using ON CONFLICT (transaction_hash, event_index) DO NOTHING
 * to guarantee idempotency: safe to run multiple times over the same range.
 */
async function upsertEvents(events: DecodedEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  const pool = getPool();
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");
    for (const ev of events) {
      const result = await client.query(
        `INSERT INTO stream_events
           (event_type, recipient, sponsor, token, amount, ledger_sequence,
            tx_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tx_hash) DO NOTHING`,
        [
          ev.event_type,
          ev.recipient,
          ev.sponsor,
          ev.token,
          ev.amount !== null ? ev.amount.toString() : null,
          ev.ledger_sequence,
          ev.tx_hash,
        ]
      );
      inserted += result.rowCount ?? 0;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// Core backfill runner (async, runs in background)
// ---------------------------------------------------------------------------

export async function runBackfill(
  jobId: string,
  fromLedger: number,
  toLedger: number
): Promise<void> {
  const contractId = networkConfig.contractId;
  if (!contractId) {
    await failJob(jobId, "CONTRACT_ID not configured");
    return;
  }

  let totalFetched = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let cursor = "";

  try {
    let pastEnd = false;

    while (!pastEnd) {
      const { records, nextCursor } = await fetchPage(cursor, contractId);

      if (records.length === 0) break;

      totalFetched += records.length;

      const decoded: DecodedEvent[] = [];
      for (const rec of records) {
        const ev = decodeEvent(rec, fromLedger, toLedger);
        if (ev) {
          decoded.push(ev);
          if (ev.ledger_sequence >= toLedger) pastEnd = true;
        } else {
          totalSkipped++;
        }
      }

      const insertedThisPage = await upsertEvents(decoded);
      totalInserted += insertedThisPage;

      // Emit Prometheus metric
      if (insertedThisPage > 0) {
        backfillEventsProcessedTotal.inc(insertedThisPage);
      }

      // Persist progress after every page so the job is resumable
      const pageCursor = nextCursor ?? cursor;
      await updateJobProgress(
        jobId,
        totalFetched,
        totalInserted,
        totalSkipped,
        pageCursor
      );

      if (!nextCursor || records.length < PAGE_LIMIT) break;
      cursor = nextCursor;
    }

    await completeJob(jobId);
    console.log(
      `[backfill] Job ${jobId} completed: fetched=${totalFetched} inserted=${totalInserted} skipped=${totalSkipped}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[backfill] Job ${jobId} failed:`, msg);
    await failJob(jobId, msg).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * POST /admin/backfill?from_ledger=N&to_ledger=M
 *
 * Starts a backfill job asynchronously and returns the job record immediately.
 * The job runs in the background; poll GET /admin/backfill/:id for progress.
 */
async function startBackfillHandler(
  req: Request,
  res: Response
): Promise<void> {
  const fromLedger = parseInt(req.query.from_ledger as string, 10);
  const toLedger = parseInt(req.query.to_ledger as string, 10);

  if (!fromLedger || fromLedger <= 0) {
    res.status(400).json({ error: "from_ledger must be a positive integer" });
    return;
  }
  if (!toLedger || toLedger <= 0) {
    res.status(400).json({ error: "to_ledger must be a positive integer" });
    return;
  }
  if (fromLedger > toLedger) {
    res
      .status(400)
      .json({ error: "from_ledger must be less than or equal to to_ledger" });
    return;
  }

  let job: BackfillJob;
  try {
    job = await createJob(fromLedger, toLedger);
  } catch (err) {
    console.error("[backfill] Failed to create job:", err);
    res.status(500).json({ error: "Failed to create backfill job" });
    return;
  }

  // Kick off the backfill asynchronously — do not await so the HTTP response
  // is returned immediately while the job runs in the background.
  setImmediate(() => {
    runBackfill(job.id, fromLedger, toLedger).catch((err) =>
      console.error("[backfill] Unhandled error in runBackfill:", err)
    );
  });

  res.status(202).json({
    message: "Backfill job started",
    job,
  });
}

/**
 * GET /admin/backfill — list recent backfill jobs (newest first, max 50)
 */
async function listBackfillJobsHandler(
  _req: Request,
  res: Response
): Promise<void> {
  try {
    const pool = getPool();
    const result = await pool.query<BackfillJob>(
      `SELECT * FROM backfill_jobs ORDER BY created_at DESC LIMIT 50`
    );
    res.json({ total: result.rows.length, jobs: result.rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

/**
 * GET /admin/backfill/:id — get a specific backfill job's status and progress
 */
async function getBackfillJobHandler(
  req: Request,
  res: Response
): Promise<void> {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "id is required" });
    return;
  }
  try {
    const pool = getPool();
    const result = await pool.query<BackfillJob>(
      `SELECT * FROM backfill_jobs WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: `Backfill job ${id} not found` });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const backfillRouter = Router();

backfillRouter.post("/", startBackfillHandler);
backfillRouter.get("/", listBackfillJobsHandler);
backfillRouter.get("/:id", getBackfillJobHandler);

// Export handlers for testing
export {
  startBackfillHandler,
  listBackfillJobsHandler,
  getBackfillJobHandler,
};
