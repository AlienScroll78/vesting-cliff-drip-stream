#!/usr/bin/env tsx
/**
 * scripts/backfill_stream_events.ts  (#286)
 *
 * One-shot backfill script that replays historical contract events from
 * Horizon into the `stream_events` table.
 *
 * Usage:
 *   DATABASE_URL=postgres://... HORIZON_URL=https://... \
 *   tsx scripts/backfill_stream_events.ts \
 *     [--from-ledger <n>] [--to-ledger <n>] [--dry-run]
 *
 * Options:
 *   --from-ledger <n>       Backfill events from this ledger sequence (inclusive).
 *                           Overrides BACKFILL_FROM_LEDGER env var.
 *   --to-ledger <n>         Stop after this ledger sequence (inclusive).
 *                           Overrides BACKFILL_TO_LEDGER env var.
 *   --dry-run               Print events without writing to the database.
 *                           Overrides BACKFILL_DRY_RUN=1 env var.
 *
 * Environment variables (used when CLI args are absent):
 *   DATABASE_URL            PostgreSQL connection string (required).
 *   HORIZON_URL             Horizon base URL (default: testnet).
 *   BACKFILL_START_CURSOR   Horizon paging_token to resume from (default: "").
 *   BACKFILL_PAGE_LIMIT     Records per Horizon page (default: 200, max 200).
 *   BACKFILL_DRY_RUN        Set to "1" to log without writing to DB.
 *   BACKFILL_FROM_LEDGER    Start ledger sequence (inclusive).
 *   BACKFILL_TO_LEDGER      End ledger sequence (inclusive).
 *   STELLAR_NETWORK         testnet | mainnet | futurenet (default: testnet).
 */

import pg from "pg";
import { networkConfig } from "../src/config/network.js";

// ── CLI arg parsing ───────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  fromLedger: number | null;
  toLedger: number | null;
  dryRun: boolean;
} {
  let fromLedger: number | null = null;
  let toLedger: number | null = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--from-ledger" && argv[i + 1] !== undefined) {
      const v = parseInt(argv[++i], 10);
      if (!isNaN(v) && v > 0) fromLedger = v;
      else { console.error("[backfill] --from-ledger must be a positive integer"); process.exit(1); }
    } else if (arg === "--to-ledger" && argv[i + 1] !== undefined) {
      const v = parseInt(argv[++i], 10);
      if (!isNaN(v) && v > 0) toLedger = v;
      else { console.error("[backfill] --to-ledger must be a positive integer"); process.exit(1); }
    }
  }

  return { fromLedger, toLedger, dryRun };
}

// node/tsx passes script args starting at index 2
const args = parseArgs(process.argv.slice(2));

// ── Config ────────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;

const HORIZON_URL =
  process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";

// networkConfig.contractId may be an empty string when the env var is unset.
// We allow that here so that test files can import the module without setting
// TESTNET_CONTRACT_ID; the run() function validates it before use.
const CONTRACT_ID: string = networkConfig.contractId || "";

const PAGE_LIMIT = Math.min(
  200,
  parseInt(process.env.BACKFILL_PAGE_LIMIT ?? "200", 10)
);

// CLI args take priority over env vars; env vars fall back to null/default.
const DRY_RUN =
  args.dryRun || process.env.BACKFILL_DRY_RUN === "1";

const FROM_LEDGER: number | null =
  args.fromLedger ??
  (process.env.BACKFILL_FROM_LEDGER
    ? parseInt(process.env.BACKFILL_FROM_LEDGER, 10)
    : null);

const TO_LEDGER: number | null =
  args.toLedger ??
  (process.env.BACKFILL_TO_LEDGER
    ? parseInt(process.env.BACKFILL_TO_LEDGER, 10)
    : null);

// Validate ledger range
if (FROM_LEDGER !== null && TO_LEDGER !== null && FROM_LEDGER > TO_LEDGER) {
  console.error("[backfill] --from-ledger must be ≤ --to-ledger");
  process.exit(1);
}

let startCursor = process.env.BACKFILL_START_CURSOR ?? "";

// ── DB pool ───────────────────────────────────────────────────────────────────

// Pool is lazily created inside run() after validation; exported for tests.
let pool: pg.Pool;

export function createPool(connectionString: string): pg.Pool {
  pool = new pg.Pool({ connectionString, max: 3 });
  return pool;
}

// ── Progress bar ──────────────────────────────────────────────────────────────

/**
 * Renders a simple inline progress bar to stdout.
 * Uses process.stdout.write with a carriage-return so it updates in-place.
 *
 * @param fetched  Total events fetched so far.
 * @param inserted Events actually written to the DB.
 * @param page     Current Horizon page number.
 * @param done     If true, prints a final newline.
 */
export function renderProgress(
  fetched: number,
  inserted: number,
  page: number,
  done = false
): void {
  const barWidth = 20;
  // We don't know the total ahead of time, so show a spinner-style counter.
  const filled = page % (barWidth + 1);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
  const line = `[backfill] [${bar}] page=${page} fetched=${fetched} inserted=${inserted}`;

  if (process.stdout.isTTY) {
    // Overwrite current line in an interactive terminal.
    process.stdout.write(`\r${line}${done ? "\n" : ""}`);
  } else {
    // Non-TTY (CI, redirected output): only print at page boundaries and done.
    if (done || page % 10 === 0) {
      process.stdout.write(line + "\n");
    }
  }
}

// ── Event decoding ────────────────────────────────────────────────────────────

type EventType =
  | "vc_create"
  | "vc_claim"
  | "vc_cancel"
  | "vc_done"
  | "vc_drain";

export interface DecodedEvent {
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

export function decodeSymbol(xdr: string): string {
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

export function decodeAddress(xdr: string): string {
  // Best-effort: XDR Address ScVal is complex; return raw for now.
  // A full decode would use StellarBase.xdr.ScVal.fromXDR().
  return xdr;
}

export function decodeBigInt(xdr: string | undefined): bigint | null {
  if (!xdr) return null;
  try {
    const buf = Buffer.from(xdr, "base64");
    // ScVal I128 / U64 / U32 — read last 8 bytes as signed big-endian
    if (buf.length >= 8) {
      return buf.readBigInt64BE(buf.length - 8);
    }
    return null;
  } catch {
    return null;
  }
}

export function decodeEvent(record: any): DecodedEvent | null {
  try {
    const topics: string[] = record.topic ?? [];
    const rawType = decodeSymbol(topics[0] ?? "");
    const eventType = rawType as EventType;

    if (!KNOWN_EVENT_TYPES.has(eventType)) {
      return null; // Not one of ours
    }

    const recipient = decodeAddress(topics[1] ?? "");
    const txHash: string =
      record.transaction_hash ??
      record.id?.split("-")[0] ??
      record.id ??
      "";

    const ledger: number =
      typeof record.ledger === "number"
        ? record.ledger
        : parseInt(String(record.ledger ?? "0"), 10);

    // If a ledger range is active, skip events outside the window.
    if (FROM_LEDGER !== null && ledger < FROM_LEDGER) return null;
    if (TO_LEDGER !== null && ledger > TO_LEDGER) return null;

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

    return {
      event_type: eventType,
      recipient,
      sponsor,
      token,
      amount,
      ledger_sequence: ledger,
      tx_hash: txHash,
    };
  } catch (err) {
    console.warn("[backfill] decode error:", err);
    return null;
  }
}

// ── DB write ──────────────────────────────────────────────────────────────────

export async function upsertEvents(events: DecodedEvent[]): Promise<number> {
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

// ── Horizon fetch ─────────────────────────────────────────────────────────────

export async function fetchPage(
  cursor: string,
  horizonUrl: string = HORIZON_URL,
  contractId: string = CONTRACT_ID
): Promise<{
  records: any[];
  nextCursor: string | null;
}> {
  const url = new URL(`${horizonUrl}/contracts/${contractId}/events`);
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

// ── Main loop ─────────────────────────────────────────────────────────────────

export async function run(): Promise<void> {
  // Validate required configuration before touching the network or DB.
  if (!DATABASE_URL) {
    console.error("[backfill] DATABASE_URL is required");
    process.exit(1);
  }
  if (!CONTRACT_ID) {
    console.error(
      "[backfill] CONTRACT_ID is not set (check TESTNET_CONTRACT_ID / MAINNET_CONTRACT_ID)"
    );
    process.exit(1);
  }

  // Initialise the pool now that we know DATABASE_URL is set.
  createPool(DATABASE_URL);
  const rangeDesc =
    FROM_LEDGER !== null || TO_LEDGER !== null
      ? ` ledgers=[${FROM_LEDGER ?? "start"}..${TO_LEDGER ?? "end"}]`
      : "";

  console.log(
    `[backfill] Starting. contract=${CONTRACT_ID} horizon=${HORIZON_URL}${rangeDesc}`
  );
  if (DRY_RUN) console.log("[backfill] DRY_RUN — no DB writes");

  let totalFetched = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalDlq = 0;
  let cursor = startCursor;
  let page = 0;
  let pastToLedger = false;

  while (!pastToLedger) {
    page++;

    let records: any[];
    let nextCursor: string | null;

    try {
      ({ records, nextCursor } = await fetchPage(cursor));
    } catch (err) {
      // Flush progress bar before error output
      if (process.stdout.isTTY) process.stdout.write("\n");
      console.error("[backfill] Horizon fetch error:", err);
      console.error(`[backfill] Resume with: BACKFILL_START_CURSOR="${cursor}"`);
      await pool.end();
      process.exit(1);
    }

    if (records.length === 0) {
      break;
    }

    totalFetched += records.length;

    const decoded: DecodedEvent[] = [];
    for (const rec of records) {
      try {
        const ev = decodeEvent(rec);
        if (ev) {
          decoded.push(ev);

          // If we've passed the to-ledger boundary, stop after this page.
          if (TO_LEDGER !== null && ev.ledger_sequence > TO_LEDGER) {
            pastToLedger = true;
          }
        } else {
          totalSkipped++;
        }
      } catch (err) {
        totalDlq++;
        if (!DRY_RUN) {
          await insertDlq(rec, String(err));
        }
      }
    }

    if (DRY_RUN) {
      for (const ev of decoded) {
        console.log(
          `[backfill] [dry-run] ${ev.event_type} ledger=${ev.ledger_sequence} tx=${ev.tx_hash} recipient=${ev.recipient}`
        );
      }
    } else if (decoded.length > 0) {
      const inserted = await upsertEvents(decoded);
      totalInserted += inserted;
    }

    // Render progress bar
    renderProgress(totalFetched, totalInserted, page);

    if (!nextCursor || records.length < PAGE_LIMIT) {
      break; // Reached end of event stream
    }
    cursor = nextCursor;
  }

  // Final progress bar line
  renderProgress(totalFetched, totalInserted, page, true);

  console.log(
    `[backfill] Done. fetched=${totalFetched} inserted=${totalInserted} skipped=${totalSkipped} dlq=${totalDlq}`
  );
  await pool.end();
}

// ── Entry point ───────────────────────────────────────────────────────────────

// Allow importing in tests without auto-running
if (
  process.argv[1] &&
  (process.argv[1].endsWith("backfill_stream_events.ts") ||
    process.argv[1].endsWith("backfill_stream_events.js"))
) {
  run().catch((err) => {
    console.error("[backfill] Fatal:", err);
    process.exit(1);
  });
}
