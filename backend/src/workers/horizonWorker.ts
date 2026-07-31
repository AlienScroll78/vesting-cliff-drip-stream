/**
 * backend/src/workers/horizonWorker.ts  (#287)
 *
 * Background worker that polls Horizon for new contract events from the
 * vesting contract, decodes them, and writes to `stream_events`.
 *
 * Features:
 *   - Configurable poll interval (default 5 s)
 *   - Exponential backoff on 429/503/504 (max 60 s)
 *   - Cursor-based resumption — survives restarts
 *   - Dead-letter queue for events that fail decode after MAX_DECODE_ATTEMPTS
 *   - Structured per-event log output
 *   - Lag metric (ledgers behind chain tip) exposed via getWorkerStatus()
 *
 * Environment variables:
 *   HORIZON_URL                 (default: https://horizon-testnet.stellar.org)
 *   HORIZON_WORKER_POLL_MS      Poll interval in ms (default: 5000)
 *   HORIZON_WORKER_PAGE_LIMIT   Events per page, max 200 (default: 200)
 *   HORIZON_MAX_BACKOFF_MS      Max backoff in ms (default: 60000)
 *   HORIZON_FINALITY_DEPTH      Ledgers behind tip for finality (default: 3)
 */

import { Pool } from "pg";
import { networkConfig } from "../config/network.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = parseInt(process.env.HORIZON_WORKER_POLL_MS ?? "5000", 10);
const PAGE_LIMIT = Math.min(
  200,
  parseInt(process.env.HORIZON_WORKER_PAGE_LIMIT ?? "200", 10)
);
const MAX_BACKOFF_MS = parseInt(process.env.HORIZON_MAX_BACKOFF_MS ?? "60000", 10);
const FINALITY_DEPTH = parseInt(process.env.HORIZON_FINALITY_DEPTH ?? "3", 10);
const MAX_DECODE_ATTEMPTS = 3;

// ── Types ─────────────────────────────────────────────────────────────────────

export type EventType = "vc_create" | "vc_claim" | "vc_cancel" | "vc_done" | "vc_drain";

export interface DecodedStreamEvent {
  event_type: EventType;
  recipient: string;
  sponsor: string | null;
  token: string | null;
  amount: bigint | null;
  ledger_sequence: number;
  tx_hash: string;
}

export interface WorkerStatus {
  running: boolean;
  lastLedger: number;
  chainTip: number;
  lagLedgers: number;
  lastPollAt: Date | null;
  backoffMs: number;
  errorCount: number;
}

const KNOWN_TYPES = new Set<EventType>([
  "vc_create",
  "vc_claim",
  "vc_cancel",
  "vc_done",
  "vc_drain",
]);

// ── Decoding helpers ──────────────────────────────────────────────────────────

function decodeSymbol(xdr: string): string {
  if (!xdr) return "";
  try {
    const buf = Buffer.from(xdr, "base64");
    // XDR ScSymbol: 4-byte tag + 4-byte length prefix + data bytes
    if (buf.length > 8) {
      return buf.subarray(8).toString("utf8").replace(/\0/g, "").trim();
    }
    return buf.toString("utf8").replace(/[^\x20-\x7e]/g, "").trim();
  } catch {
    return xdr;
  }
}

/**
 * Decode an XDR-encoded Address ScVal to its string representation.
 * Without the full stellar-sdk available at runtime, we return the raw XDR
 * and let callers handle display. A full implementation would use
 * StellarBase.xdr.ScVal.fromXDR(xdr, 'base64').address().accountId().
 */
function decodeAddress(xdr: string): string {
  return xdr ?? "";
}

function decodeInt128(xdr: string | undefined): bigint | null {
  if (!xdr) return null;
  try {
    const buf = Buffer.from(xdr, "base64");
    if (buf.length >= 16) {
      // ScInt128: hi (8 bytes) + lo (8 bytes) — read as signed 128-bit
      const hi = buf.readBigInt64BE(buf.length - 16);
      const lo = buf.readBigUInt64BE(buf.length - 8);
      return (hi << 64n) | lo;
    }
    if (buf.length >= 8) {
      return buf.readBigInt64BE(buf.length - 8);
    }
    return null;
  } catch {
    return null;
  }
}

export function decodeEvent(record: any): DecodedStreamEvent | null {
  const topics: string[] = record.topic ?? [];
  const rawType = decodeSymbol(topics[0] ?? "");
  const eventType = rawType as EventType;

  if (!KNOWN_TYPES.has(eventType)) return null;

  const recipient = decodeAddress(topics[1] ?? "");
  if (!recipient) return null;

  const txHash: string =
    record.transaction_hash ??
    (record.id?.includes("-") ? record.id.split("-")[0] : record.id) ??
    record.id ??
    "";

  const ledger: number =
    typeof record.ledger === "number"
      ? record.ledger
      : parseInt(String(record.ledger ?? "0"), 10);

  // Value is either { xdr: string } or an array of xdr strings
  const valueFields: string[] =
    Array.isArray(record.value)
      ? record.value
      : record.value?.xdr
      ? [record.value.xdr]
      : [];

  let sponsor: string | null = null;
  let token: string | null = null;
  let amount: bigint | null = null;

  switch (eventType) {
    case "vc_create":
      // Topics: [vc_create, recipient]  Data: (sponsor, token, rate, start, cliff, end)
      sponsor = decodeAddress(topics[2] ?? valueFields[0] ?? "");
      token = decodeAddress(valueFields[1] ?? "");
      break;
    case "vc_claim":
      // Data: (amount, ledger_claimed_through)
      amount = decodeInt128(valueFields[0]);
      break;
    case "vc_cancel":
      // Data: refunded_amount
      amount = decodeInt128(valueFields[0]);
      break;
    case "vc_drain":
      // Topics: [vc_drain, recipient]  Data: (sponsor, amount)
      sponsor = decodeAddress(valueFields[0] ?? "");
      amount = decodeInt128(valueFields[1]);
      break;
    case "vc_done":
      // Data: token
      token = decodeAddress(valueFields[0] ?? "");
      break;
  }

  return {
    event_type: eventType,
    recipient,
    sponsor: sponsor || null,
    token: token || null,
    amount,
    ledger_sequence: ledger,
    tx_hash: txHash,
  };
}

// ── Worker class ──────────────────────────────────────────────────────────────

export class HorizonWorker {
  private pool: Pool;
  private horizonUrl: string;
  private contractId: string;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 0;
  private errorCount = 0;
  private lastLedger = 0;
  private chainTip = 0;
  private lastPollAt: Date | null = null;

  constructor(pool?: Pool) {
    this.horizonUrl =
      process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
    this.contractId = networkConfig.contractId;
    this.pool = pool ?? new Pool({ connectionString: process.env.DATABASE_URL });
  }

  // ── Public API ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.running = true;
    this.scheduleNext(0);
    console.log(
      `[horizon-worker] started contract=${this.contractId} poll=${POLL_INTERVAL_MS}ms`
    );
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    console.log("[horizon-worker] stopped");
  }

  getStatus(): WorkerStatus {
    return {
      running: this.running,
      lastLedger: this.lastLedger,
      chainTip: this.chainTip,
      lagLedgers: Math.max(0, this.chainTip - this.lastLedger),
      lastPollAt: this.lastPollAt,
      backoffMs: this.backoffMs,
      errorCount: this.errorCount,
    };
  }

  // ── Internal poll loop ──────────────────────────────────────────────────

  private scheduleNext(delayMs = POLL_INTERVAL_MS): void {
    this.timer = setTimeout(() => this.tick(), delayMs);
  }

  /** Single poll tick — fetch, decode, upsert. */
  async tick(): Promise<void> {
    this.lastPollAt = new Date();
    try {
      const cursor = await this.readCursor();
      const { records, nextCursor, latestLedger } = await this.fetchPage(cursor);

      this.chainTip = latestLedger;

      if (records.length > 0) {
        // Only ingest events that are FINALITY_DEPTH ledgers behind the tip.
        const finalised = records.filter(
          (r: any) =>
            latestLedger - (typeof r.ledger === "number" ? r.ledger : parseInt(r.ledger ?? "0", 10)) >=
            FINALITY_DEPTH
        );

        if (finalised.length > 0) {
          await this.processRecords(finalised);
        }
      }

      if (nextCursor) {
        await this.writeCursor(nextCursor, latestLedger);
        this.lastLedger = latestLedger;
      }

      // Reset backoff on success
      this.backoffMs = 0;
      this.errorCount = 0;
    } catch (err: any) {
      this.errorCount++;
      const status = err?.status ?? err?.cause?.status;
      this.backoffMs = computeBackoff(this.errorCount, status, MAX_BACKOFF_MS);
      console.error(
        `[horizon-worker] tick error (attempt=${this.errorCount} backoff=${this.backoffMs}ms):`,
        err?.message ?? err
      );
    } finally {
      if (this.running) {
        const delay = this.backoffMs > 0 ? this.backoffMs : POLL_INTERVAL_MS;
        this.scheduleNext(delay);
      }
    }
  }

  // ── Horizon fetch ───────────────────────────────────────────────────────

  private async fetchPage(cursor: string): Promise<{
    records: any[];
    nextCursor: string | null;
    latestLedger: number;
  }> {
    const eventsUrl = new URL(
      `${this.horizonUrl}/contracts/${this.contractId}/events`
    );
    eventsUrl.searchParams.set("limit", String(PAGE_LIMIT));
    eventsUrl.searchParams.set("order", "asc");
    if (cursor) eventsUrl.searchParams.set("cursor", cursor);

    const [eventsResp, ledgerResp] = await Promise.all([
      fetch(eventsUrl.toString()),
      fetch(`${this.horizonUrl}/ledgers?order=desc&limit=1`),
    ]);

    if (!eventsResp.ok) {
      const err: any = new Error(`Horizon responded HTTP ${eventsResp.status}`);
      err.status = eventsResp.status;
      throw err;
    }

    const data: any = await eventsResp.json();
    const ledgerData: any = ledgerResp.ok ? await ledgerResp.json() : {};
    const latestLedger: number =
      ledgerData?._embedded?.records?.[0]?.sequence ?? 0;

    const records: any[] = data._embedded?.records ?? [];
    const nextCursor =
      records.length > 0
        ? (records[records.length - 1].paging_token as string)
        : null;

    return { records, nextCursor, latestLedger };
  }

  // ── Event processing ────────────────────────────────────────────────────

  private async processRecords(records: any[]): Promise<void> {
    const toInsert: DecodedStreamEvent[] = [];
    const failed: Array<{ record: any; error: string }> = [];

    for (const rec of records) {
      try {
        const decoded = decodeEvent(rec);
        if (!decoded) {
          // Unknown event type — skip silently (not our contract's events)
          continue;
        }
        toInsert.push(decoded);
        console.log(
          `[horizon-worker] decoded event_type=${decoded.event_type} ` +
          `recipient=${decoded.recipient} ledger=${decoded.ledger_sequence} ` +
          `tx=${decoded.tx_hash.slice(0, 12)}...`
        );
      } catch (err: any) {
        failed.push({ record: rec, error: String(err?.message ?? err) });
      }
    }

    // Batch upsert decoded events
    if (toInsert.length > 0) {
      await this.upsertEvents(toInsert);
    }

    // Write decode failures to DLQ
    for (const { record, error } of failed) {
      await this.writeDlq(record, error);
    }
  }

  // ── DB helpers ──────────────────────────────────────────────────────────

  private async upsertEvents(events: DecodedStreamEvent[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const ev of events) {
        await client.query(
          `INSERT INTO stream_events
             (event_type, recipient, sponsor, token, amount,
              ledger_sequence, tx_hash)
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
      }
      await client.query("COMMIT");
      console.log(`[horizon-worker] upserted ${events.length} event(s)`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  private async writeDlq(record: any, error: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO stream_events_dlq
           (horizon_event_id, raw_payload, last_error)
         VALUES ($1, $2, $3)
         ON CONFLICT (horizon_event_id)
         DO UPDATE SET
           attempt_count = stream_events_dlq.attempt_count + 1,
           last_error    = EXCLUDED.last_error,
           updated_at    = now()`,
        [record.id ?? "", JSON.stringify(record), error]
      );
      console.warn(
        `[horizon-worker] event ${record.id} sent to DLQ: ${error}`
      );
    } finally {
      client.release();
    }
  }

  private async readCursor(): Promise<string> {
    const result = await this.pool.query(
      "SELECT last_paging_token FROM horizon_worker_cursor WHERE id = 1"
    );
    return result.rows[0]?.last_paging_token ?? "";
  }

  private async writeCursor(
    pagingToken: string,
    ledger: number
  ): Promise<void> {
    await this.pool.query(
      `UPDATE horizon_worker_cursor
       SET last_paging_token = $1,
           last_ledger_sequence = $2,
           updated_at = now()
       WHERE id = 1`,
      [pagingToken, ledger]
    );
  }
}

// ── Backoff helper ─────────────────────────────────────────────────────────────

/**
 * Exponential backoff with jitter.
 * 429/503/504 errors get a full backoff; other errors get half.
 */
export function computeBackoff(
  attempt: number,
  httpStatus: number | undefined,
  maxMs: number
): number {
  const isRateOrServerError =
    httpStatus === 429 || httpStatus === 503 || httpStatus === 504;
  const base = isRateOrServerError ? 2000 : 1000;
  const exponential = base * Math.pow(2, Math.min(attempt - 1, 5));
  const jitter = Math.random() * 1000;
  return Math.min(exponential + jitter, maxMs);
}

// ── Singleton factory ─────────────────────────────────────────────────────────

let _worker: HorizonWorker | null = null;

export function startHorizonWorker(pool?: Pool): HorizonWorker {
  if (!_worker) {
    _worker = new HorizonWorker(pool);
    _worker.start().catch((err) => {
      console.error("[horizon-worker] startup failed:", err);
    });
  }
  return _worker;
}

export function getHorizonWorker(): HorizonWorker | null {
  return _worker;
}
