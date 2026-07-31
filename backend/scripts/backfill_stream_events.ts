#!/usr/bin/env tsx
/**
 * scripts/backfill_stream_events.ts  (#286)
 *
 * One-shot backfill script that replays all historical contract events from
 * Horizon into the `stream_events` table.
 *
 * Usage:
 *   DATABASE_URL=postgres://... HORIZON_URL=https://... \
 *   TESTNET_CONTRACT_ID=C...    tsx scripts/backfill_stream_events.ts
 *
 * Options (env vars):
 *   BACKFILL_START_CURSOR   Horizon paging_token to resume from (default: "")
 *   BACKFILL_PAGE_LIMIT     Records per Horizon page (default: 200, max 200)
 *   BACKFILL_DRY_RUN        Set to "1" to log without writing to DB
 *   STELLAR_NETWORK         testnet | mainnet | futurenet (default: testnet)
 */

import pg from "pg";
import { networkConfig } from "../src/config/network.js";

// ── Config ────────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[backfill] DATABASE_URL is required");
  process.exit(1);
}

const HORIZON_URL =
  process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const CONTRACT_ID = networkConfig.contractId;
if (!CONTRACT_ID) {
  console.error("[backfill] CONTRACT_ID is not set (check TESTNET_CONTRACT_ID / MAINNET_CONTRACT_ID)");
  process.exit(1);
}

const PAGE_LIMIT = Math.min(
  200,
  parseInt(process.env.BACKFILL_PAGE_LIMIT ?? "200", 10)
);
const DRY_RUN = process.env.BACKFILL_DRY_RUN === "1";
let startCursor = process.env.BACKFILL_START_CURSOR ?? "";

// ── DB pool ───────────────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });

// ── Event decoding ────────────────────────────────────────────────────────────

type EventType = "vc_create" | "vc_claim" | "vc_cancel" | "vc_done" | "vc_drain";

interface DecodedEvent {
  event_type: EventType;
  recipient: string;
  sponsor: string | null;
  token: string | null;
  amount: bigint | null;
  ledger_sequence: number;
  tx_hash: string;
}

const KNOWN_EVENT_TYPES = new Set<EventType>([
  "vc_create",
  "vc_claim",
  "vc_cancel",
  "vc_done",
  "vc_drain",
]);

function decodeSymbol(xdr: string): string {
  try {
    const buf = Buffer.from(xdr, "base64");
    // XDR ScSymbol: 4-byte tag (0x00000006) + 4-byte length + bytes
    if (buf.length > 8) {
      return buf.subarray(8).toString("utf8").replace(/\0/g, "").trim();
    }
    return buf.toString("utf8").replace(/[^\x20-\x7e]/g, "").trim();
  } catch {
    return xdr;
  }
}

function decodeAddress(xdr: string): string {
  // Best-effort: XDR Address ScVal is complex; return raw for now.
  // A full decode would use StellarBase.xdr.ScVal.fromXDR().
  return xdr;
}

function decodeBigInt(xdr: string | undefined): bigint | null {
  if (!xdr) return null;
  try {
    const buf = Buffer.from(xdr, "base64");
    // ScVal I128 / U64 / U32 — read last 8 bytes as unsigned big-endian
    if (buf.length >= 8) {
      return buf.readBigInt64BE(buf.length - 8);
    }
    return null;
  } catch {
    return null;
  }
}

function decodeEvent(record: any): DecodedEvent | null {
  try {
    const topics: string[] = record.topic ?? [];
    const rawType = decodeSymbol(topics[0] ?? "");
    const eventType = rawType as EventType;

    if (!KNOWN_EVENT_TYPES.has(eventType)) {
      return null; // Not one of ours
    }

    const recipient = decodeAddress(topics[1] ?? "");
    const txHash: string =
      record.transaction_hash ?? record.id?.split("-")[0] ?? record.id ?? "";

    const ledger: number =
      typeof record.ledger === "number"
        ? record.ledger
        : parseInt(String(record.ledger ?? "0"), 10);

    const valueFields: string[] = record.value?.xdr
      ? [record.value.xdr]
      : Array.isArray(record.value)
      ? record.value
      : [];

    let sponsor: string | null = null;
    let token: string | null = null;
    let amount: bigint | null = null;

    if (eventType === "vc_create") {
      // Data tuple: (sponsor, token, rate, start_ledger, cliff_ledger, end_ledger)
      sponsor = decodeAddress(topics[2] ?? valueFields[0] ?? "");
      token = decodeAddress(valueFields[1] ?? "");
    } else if (eventType === "vc_claim") {
      // Data: (amount, ledger_claimed_through)
      amount = decodeBigInt(valueFields[0]);
    } else if (eventType === "vc_cancel") {
      // Data: refunded_amount
      amount = decodeBigInt(valueFields[0]);
    } else if (eventType === "vc_drain") {
      // Data: (sponsor, amount)
      sponsor = decodeAddress(valueFields[0] ?? "");
      amount = decodeBigInt(valueFields[1]);
    }

    return { event_type: eventType, recipient, sponsor, token, amount, ledger_sequence: ledger, tx_hash: txHash };
  } catch (err) {
    console.warn("[backfill] decode error:", err);
    return null;
  }
}

// ── DB write ──────────────────────────────────────────────────────────────────

async function upsertEvents(events: DecodedEvent[]): Promise<number> {
  if (events.length === 0) return 0;

  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");
    for (const ev of events) {
      const result = await client.query(
        `INSERT INTO stream_events
           (event_type, recipient, sponsor, token, amount, ledger_sequence, tx_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
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

async function insertDlq(record: any, error: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO stream_events_dlq (horizon_event_id, raw_payload, last_error)
       VALUES ($1, $2, $3)
       ON CONFLICT (horizon_event_id)
       DO UPDATE SET
         attempt_count = stream_events_dlq.attempt_count + 1,
         last_error = EXCLUDED.last_error,
         updated_at = now()`,
      [record.id ?? "", JSON.stringify(record), error]
    );
  } finally {
    client.release();
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function fetchPage(cursor: string): Promise<{
  records: any[];
  nextCursor: string | null;
}> {
  const url = new URL(`${HORIZON_URL}/contracts/${CONTRACT_ID}/events`);
  url.searchParams.set("limit", String(PAGE_LIMIT));
  url.searchParams.set("order", "asc");
  if (cursor) url.searchParams.set("cursor", cursor);

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    throw new Error(`Horizon HTTP ${resp.status}: ${await resp.text()}`);
  }

  const data: any = await resp.json();
  const records: any[] = data._embedded?.records ?? [];
  const nextCursor =
    records.length > 0
      ? (records[records.length - 1].paging_token as string)
      : null;

  return { records, nextCursor };
}

async function run(): Promise<void> {
  console.log(`[backfill] Starting. contract=${CONTRACT_ID} horizon=${HORIZON_URL}`);
  if (DRY_RUN) console.log("[backfill] DRY_RUN=1 — no DB writes");

  let totalFetched = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalDlq = 0;
  let cursor = startCursor;
  let page = 0;

  while (true) {
    page++;
    console.log(`[backfill] Fetching page ${page}, cursor="${cursor}"`);

    let records: any[];
    let nextCursor: string | null;

    try {
      ({ records, nextCursor } = await fetchPage(cursor));
    } catch (err) {
      console.error("[backfill] Horizon fetch error:", err);
      console.error(`[backfill] Resume with: BACKFILL_START_CURSOR="${cursor}"`);
      process.exit(1);
    }

    if (records.length === 0) {
      console.log("[backfill] No more records.");
      break;
    }

    totalFetched += records.length;

    const decoded: DecodedEvent[] = [];
    for (const rec of records) {
      try {
        const ev = decodeEvent(rec);
        if (ev) {
          decoded.push(ev);
        } else {
          totalSkipped++;
        }
      } catch (err) {
        totalDlq++;
        if (!DRY_RUN) {
          await insertDlq(rec, String(err));
        }
        console.warn(`[backfill] Failed to decode event ${rec.id}, sent to DLQ`);
      }
    }

    if (!DRY_RUN && decoded.length > 0) {
      const inserted = await upsertEvents(decoded);
      totalInserted += inserted;
      console.log(
        `[backfill] Page ${page}: fetched=${records.length} decoded=${decoded.length} inserted=${inserted}`
      );
    } else {
      console.log(
        `[backfill] Page ${page}: fetched=${records.length} decoded=${decoded.length} (dry-run)`
      );
    }

    if (!nextCursor || records.length < PAGE_LIMIT) {
      break; // Reached end of event stream
    }
    cursor = nextCursor;
  }

  console.log(
    `[backfill] Done. fetched=${totalFetched} inserted=${totalInserted} skipped=${totalSkipped} dlq=${totalDlq}`
  );
  await pool.end();
}

run().catch((err) => {
  console.error("[backfill] Fatal:", err);
  process.exit(1);
});
