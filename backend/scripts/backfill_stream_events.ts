#!/usr/bin/env tsx
/**
 * scripts/backfill_stream_events.ts
 *
 * Replays historical contract events from Horizon into the `stream_events`
 * table. Used when:
 *   - the indexer worker was down and missed a contiguous ledger range, or
 *   - a decoder bug was fixed and existing rows must be re-ingested.
 *
 * Usage (via the `backfill` npm script):
 *   npm run backfill -- --start-ledger 5000000 --end-ledger 5100000
 *   npm run backfill -- --start-ledger 5000000 --end-ledger 5100000 --event-type vc_claim
 *   npm run backfill -- --start-ledger 5000000 --end-ledger 5100000 --dry-run
 *
 * Options:
 *   --start-ledger, --from-ledger <n>   First ledger to include (inclusive).
 *   --end-ledger,   --to-ledger   <n>   Last ledger to include (inclusive).
 *   --event-type <type>                 Limit the run to one event type.
 *                                       Repeatable and/or comma-separated.
 *                                       One of: vc_create, vc_claim,
 *                                       vc_cancel, vc_done, vc_drain.
 *   --dry-run                           Decode + preview without writing.
 *   --no-reconcile                      Skip the post-backfill reconciliation.
 *   --help, -h                          Show usage.
 *
 * Environment variables (used when the CLI flag is absent):
 *   DATABASE_URL                PostgreSQL connection string (required unless --dry-run).
 *   HORIZON_URL                 Horizon base URL (default: testnet).
 *   STELLAR_NETWORK             testnet | mainnet | futurenet (default: testnet).
 *   TESTNET_CONTRACT_ID         Contract ID (or MAINNET_CONTRACT_ID etc.).
 *   BACKFILL_START_CURSOR       Horizon paging_token to resume from.
 *   BACKFILL_PAGE_LIMIT         Records per Horizon page (default/max 200).
 *   BACKFILL_DRY_RUN            Set to "1" to log without writing.
 *   BACKFILL_FROM_LEDGER        Start ledger (inclusive).
 *   BACKFILL_TO_LEDGER          End ledger (inclusive).
 *   BACKFILL_EVENT_TYPES        Comma-separated event types to limit the run.
 *   BACKFILL_SKIP_RECONCILE     Set to "1" to skip reconciliation.
 *
 * Idempotency (issue #1014):
 *   Rows are written with an UPSERT keyed on `tx_hash`:
 *
 *     ON CONFLICT (tx_hash) DO UPDATE SET event_type = EXCLUDED.event_type, ...
 *
 *   Re-running over an already-populated range therefore *repairs* existing
 *   rows (which is the point of a decoder-fix backfill) instead of either
 *   duplicating them or leaving the stale decoded values in place. The
 *   `updated_at`-style bookkeeping is reported as `updated` in the summary.
 *
 * Horizon retention:
 *   Horizon only retains a bounded window of history. When the requested range
 *   predates that window the run stops, prints how many ledgers were served,
 *   and points at the archive operator flow described in the runbook instead
 *   of silently reporting success over a partial range.
 */

import { networkConfig } from "../src/config/network.js";

// ── Event types ───────────────────────────────────────────────────────────────

export type EventType =
  | "vc_create"
  | "vc_claim"
  | "vc_cancel"
  | "vc_done"
  | "vc_drain";

export const KNOWN_EVENT_TYPES: readonly EventType[] = [
  "vc_create",
  "vc_claim",
  "vc_cancel",
  "vc_done",
  "vc_drain",
];

const KNOWN_EVENT_TYPE_SET = new Set<string>(KNOWN_EVENT_TYPES);

export interface DecodedEvent {
  event_type: EventType;
  recipient: string;
  sponsor: string | null;
  token: string | null;
  amount: bigint | null;
  ledger_sequence: number;
  tx_hash: string;
}

// ── CLI parsing ───────────────────────────────────────────────────────────────

export interface CliOptions {
  fromLedger: number | null;
  toLedger: number | null;
  eventTypes: Set<EventType>;
  dryRun: boolean;
  reconcile: boolean;
  help: boolean;
}

function fatal(message: string): never {
  console.error(`[backfill] ${message}`);
  process.exit(1);
}

/**
 * Parse a ledger number from a CLI flag value.
 * Ledger 0 is not a valid Soroban ledger, so values are required to be >= 1.
 */
function parseLedger(flag: string, raw: string | undefined): number {
  const value = parseInt(raw ?? "", 10);
  if (raw === undefined || Number.isNaN(value) || value <= 0) {
    fatal(`${flag} must be a positive integer, got: ${raw ?? "(missing)"}`);
  }
  return value;
}

/** Collapse repeated/comma-separated --event-type values into a validated set. */
export function parseEventTypes(rawValues: string[]): Set<EventType> {
  const requested = rawValues
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const invalid = requested.filter((value) => !KNOWN_EVENT_TYPE_SET.has(value));
  if (invalid.length > 0) {
    fatal(
      `--event-type must be one of ${KNOWN_EVENT_TYPES.join(", ")}; got: ${invalid.join(", ")}`
    );
  }

  return new Set(requested as EventType[]);
}

export function printUsage(): void {
  console.log(
    `
Usage:
  npm run backfill -- --start-ledger <n> --end-ledger <n> [options]

Required:
  --start-ledger <n>    First ledger to include (inclusive)
                        (alias: --from-ledger)
  --end-ledger   <n>    Last ledger to include (inclusive)
                        (alias: --to-ledger)

Optional:
  --event-type <type>   Limit to one event type (repeatable / comma-separated)
                        ${KNOWN_EVENT_TYPES.join(" | ")}
  --dry-run             Decode and print events; do not write to the DB
  --no-reconcile        Skip the post-backfill reconciliation job
  --help                Show this message

Environment:
  DATABASE_URL          PostgreSQL connection string (not required with --dry-run)
  HORIZON_URL           Horizon base URL
  STELLAR_NETWORK       testnet | mainnet | futurenet
  TESTNET_CONTRACT_ID   Contract ID on testnet (or MAINNET_CONTRACT_ID etc.)
  BACKFILL_PAGE_LIMIT   Horizon page size (default: 200, max: 200)
`.trim()
  );
}

export function parseArgs(argv: string[]): CliOptions {
  let fromLedger: number | null = null;
  let toLedger: number | null = null;
  const eventTypeValues: string[] = [];
  let dryRun = false;
  let reconcile = true;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--start-ledger" || arg === "--from-ledger" || arg === "--from_ledger") {
      fromLedger = parseLedger(arg, argv[++i]);
    } else if (arg === "--end-ledger" || arg === "--to-ledger" || arg === "--to_ledger") {
      toLedger = parseLedger(arg, argv[++i]);
    } else if (arg === "--event-type" || arg === "--event_type") {
      if (argv[i + 1] === undefined) fatal("--event-type requires a value");
      eventTypeValues.push(argv[++i]);
    } else if (arg === "--dry-run" || arg === "--dry_run") {
      dryRun = true;
    } else if (arg === "--no-reconcile" || arg === "--no_reconcile") {
      reconcile = false;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    }
  }

  if (help) return { fromLedger, toLedger, eventTypes: new Set(), dryRun, reconcile, help };

  // Range validation is deferred to resolveOptions(), which layers env-var
  // fallbacks underneath the flags before deciding whether the range is
  // actually complete. parseArgs() stays usable standalone (tests rely on it).
  return {
    fromLedger,
    toLedger,
    eventTypes: parseEventTypes(eventTypeValues),
    dryRun,
    reconcile,
    help,
  };
}

/** Layer env-var configuration underneath the parsed CLI options. */
export function resolveOptions(
  argv: string[],
  env: NodeJS.ProcessEnv
): CliOptions {
  const cli = parseArgs(argv);

  if (cli.help) return cli;

  let fromLedger = cli.fromLedger;
  let toLedger = cli.toLedger;

  if (fromLedger === null && env.BACKFILL_FROM_LEDGER) {
    const parsed = parseInt(env.BACKFILL_FROM_LEDGER, 10);
    if (!Number.isNaN(parsed) && parsed > 0) fromLedger = parsed;
  }
  if (toLedger === null && env.BACKFILL_TO_LEDGER) {
    const parsed = parseInt(env.BACKFILL_TO_LEDGER, 10);
    if (!Number.isNaN(parsed) && parsed > 0) toLedger = parsed;
  }

  if (fromLedger === null) fatal("--start-ledger is required (or set BACKFILL_FROM_LEDGER)");
  if (toLedger === null) fatal("--end-ledger is required (or set BACKFILL_TO_LEDGER)");
  if (fromLedger > toLedger) {
    fatal(`--start-ledger (${fromLedger}) must be <= --end-ledger (${toLedger})`);
  }

  const eventTypes =
    cli.eventTypes.size > 0
      ? cli.eventTypes
      : env.BACKFILL_EVENT_TYPES
        ? parseEventTypes([env.BACKFILL_EVENT_TYPES])
        : new Set<EventType>();

  return {
    ...cli,
    fromLedger,
    toLedger,
    eventTypes,
    dryRun: cli.dryRun || env.BACKFILL_DRY_RUN === "1",
    reconcile: cli.reconcile && env.BACKFILL_SKIP_RECONCILE !== "1",
  };
}

// ── Decoders ──────────────────────────────────────────────────────────────────

export function decodeSymbol(xdr: string): string {
  try {
    const buf = Buffer.from(xdr, "base64");
    if (buf.length > 8) return buf.subarray(8).toString("utf8").replace(/\0/g, "").trim();
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

export interface DecodeContext {
  fromLedger?: number | null;
  toLedger?: number | null;
  eventTypes?: Set<EventType>;
}

/**
 * Decode a single Horizon contract-event record.
 *
 * Returns `null` when the record should be skipped — i.e. an unrecognised
 * event type, an event the caller filtered out via --event-type, or an event
 * outside the requested ledger range.
 */
export function decodeEvent(record: any, ctx: DecodeContext = {}): DecodedEvent | null {
  const { fromLedger = null, toLedger = null, eventTypes } = ctx;
  try {
    const topics: string[] = record.topic ?? [];
    const rawType = decodeSymbol(topics[0] ?? "");
    const eventType = rawType as EventType;
    if (!KNOWN_EVENT_TYPE_SET.has(eventType)) return null;
    if (eventTypes && eventTypes.size > 0 && !eventTypes.has(eventType)) return null;

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
    if (fromLedger !== null && ledger < fromLedger) return null;
    if (toLedger !== null && ledger > toLedger) return null;

    const valueFields: string[] = record.value?.xdr
      ? [record.value.xdr]
      : Array.isArray(record.value)
        ? record.value
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
    };
  } catch (err) {
    console.warn("[backfill] decode error:", err);
    return null;
  }
}

// ── Progress bar ──────────────────────────────────────────────────────────────

/**
 * Render a simple inline progress bar to stdout.
 *
 * Uses a carriage return so it updates in place on a TTY; on a non-TTY
 * (CI, redirected output) it only prints at page boundaries and when done.
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
    process.stdout.write(`\r${line}${done ? "\n" : ""}`);
  } else if (done || page % 10 === 0) {
    process.stdout.write(line + "\n");
  }
}

/**
 * Render a ledger-range progress bar, used once the range is known.
 *
 * @param currentLedger Highest ledger reached so far.
 * @param fromLedger    First ledger of the requested range.
 * @param toLedger      Last ledger of the requested range.
 * @param stats         Running counters.
 */
export function renderRangeProgress(
  currentLedger: number,
  fromLedger: number,
  toLedger: number,
  stats: { fetched: number; inserted: number; updated: number; skipped: number }
): void {
  const barWidth = 40;
  const total = Math.max(1, toLedger - fromLedger);
  const pct = Math.min(1, Math.max(0, (currentLedger - fromLedger) / total));
  const filled = Math.round(pct * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
  const pctStr = (pct * 100).toFixed(1).padStart(5);

  const line =
    `\r[${bar}] ${pctStr}%  ` +
    `ledger=${currentLedger.toLocaleString()}  ` +
    `fetched=${stats.fetched.toLocaleString()}  ` +
    `ins=${stats.inserted.toLocaleString()}  ` +
    `upd=${stats.updated.toLocaleString()}  ` +
    `skip=${stats.skipped.toLocaleString()}`;

  if (process.stdout.isTTY) {
    process.stdout.write(line);
  } else if (pct >= 1) {
    process.stdout.write(`${line}\n`);
  }
}

// ── Horizon fetch ─────────────────────────────────────────────────────────────

export interface FetchPageResult {
  records: any[];
  nextCursor: string | null;
}

/**
 * Fetch one page of contract events from Horizon.
 *
 * @param cursor      Horizon paging_token to resume from ("" for the first page).
 * @param horizonUrl  Horizon base URL.
 * @param contractId  Soroban contract ID to read events for.
 * @param pageLimit   Records per page (Horizon max is 200).
 */
export async function fetchPage(
  cursor: string,
  horizonUrl: string,
  contractId: string,
  pageLimit = 200
): Promise<FetchPageResult> {
  const url = new URL(`${horizonUrl}/contracts/${contractId}/events`);
  url.searchParams.set("limit", String(Math.min(200, pageLimit)));
  url.searchParams.set("order", "asc");
  if (cursor) url.searchParams.set("cursor", cursor);

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Horizon HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data: any = await resp.json();
  const records: any[] = data._embedded?.records ?? [];

  if (records.length === 0) return { records: [], nextCursor: null };

  const nextCursor = records[records.length - 1].paging_token as string;
  return { records, nextCursor };
}

// ── DB writes ─────────────────────────────────────────────────────────────────

type PoolLike = {
  connect: () => Promise<{
    query: (text: string, values?: unknown[]) => Promise<{ rowCount: number | null; rows?: any[] }>;
    release: () => void;
  }>;
  query: (text: string, values?: unknown[]) => Promise<{ rowCount: number | null; rows?: any[] }>;
  end: () => Promise<void>;
};

let _pool: PoolLike | null = null;

/** Create (or replace) the lazily-created connection pool. Exported for tests. */
export function createPool(connectionString: string): PoolLike {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg");
  _pool = new Pool({ connectionString, max: 3 }) as PoolLike;
  return _pool;
}

function getPool(): PoolLike {
  if (!_pool) fatal("Database pool not initialised (call createPool first)");
  return _pool;
}

/** Reset the module-level pool. Exported so tests can isolate runs. */
export function resetPool(): void {
  _pool = null;
}

export interface UpsertResult {
  inserted: number;
  updated: number;
}

/**
 * Upsert decoded events into `stream_events`.
 *
 * The conflict target is the unique `tx_hash` column. Existing rows are
 * UPDATED rather than ignored, so a decoder-fix backfill actually replaces
 * stale decoded values instead of silently leaving them behind.
 *
 * `xmax = 0` distinguishes a fresh INSERT from an UPDATE in PostgreSQL's
 * MVCC bookkeeping, which is how we report the two counts separately.
 */
export async function upsertEvents(
  events: DecodedEvent[],
  pool: PoolLike = getPool()
): Promise<UpsertResult> {
  if (events.length === 0) return { inserted: 0, updated: 0 };

  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;

  try {
    await client.query("BEGIN");
    for (const ev of events) {
      if (!ev.tx_hash) continue; // nothing to dedupe on — skip rather than crash
      const result = await client.query(
        `INSERT INTO stream_events
           (event_type, recipient, sponsor, token, amount, ledger_sequence, tx_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tx_hash) DO UPDATE SET
           event_type      = EXCLUDED.event_type,
           recipient       = EXCLUDED.recipient,
           sponsor         = EXCLUDED.sponsor,
           token           = EXCLUDED.token,
           amount          = EXCLUDED.amount,
           ledger_sequence = EXCLUDED.ledger_sequence
         RETURNING (xmax = 0) AS was_inserted`,
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

      const row = result.rows?.[0];
      if (row && row.was_inserted === false) updated++;
      else if (row) inserted++;
      else inserted += result.rowCount ?? 0;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { inserted, updated };
}

/** Record a decode failure in the dead-letter queue for later inspection. */
export async function insertDlq(
  record: any,
  error: string,
  pool: PoolLike = getPool()
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO stream_events_dlq (horizon_event_id, raw_payload, last_error)
       VALUES ($1,$2,$3)
       ON CONFLICT (horizon_event_id) DO UPDATE SET
         attempt_count = stream_events_dlq.attempt_count + 1,
         last_error    = EXCLUDED.last_error,
         updated_at    = now()`,
      [record.id ?? "", JSON.stringify(record), error]
    );
  } finally {
    client.release();
  }
}

// ── Reconciliation ────────────────────────────────────────────────────────────

export interface ReconciliationReport {
  ledgerRange: { from: number; to: number };
  dbRowCount: number;
  eventTypeCounts: Record<string, number>;
  dlqOpen: number;
  gaps: number[];
  ok: boolean;
}

/**
 * Post-backfill reconciliation job.
 *
 * Confirms the backfilled range is internally consistent before the operator
 * walks away: it re-counts the rows that now exist for the range, breaks them
 * down by event type, checks for ledger gaps, and reports any DLQ entries that
 * are still waiting. Runs automatically at the end of every non-dry-run
 * backfill unless `--no-reconcile` is passed.
 */
export async function reconcile(
  fromLedger: number,
  toLedger: number,
  pool: PoolLike = getPool()
): Promise<ReconciliationReport> {
  const counts = await pool.query(
    `SELECT event_type, COUNT(*)::int AS cnt, MIN(ledger_sequence)::int AS min_ledger
       FROM stream_events
      WHERE ledger_sequence BETWEEN $1 AND $2
      GROUP BY event_type`,
    [fromLedger, toLedger]
  );

  const eventTypeCounts: Record<string, number> = {};
  let dbRowCount = 0;
  let minLedger = Number.POSITIVE_INFINITY;
  for (const row of counts.rows ?? []) {
    eventTypeCounts[String(row.event_type)] = Number(row.cnt);
    dbRowCount += Number(row.cnt);
    minLedger = Math.min(minLedger, Number(row.min_ledger));
  }

  const dlq = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM stream_events_dlq
      WHERE created_at > NOW() - INTERVAL '1 hour'`
  );
  const dlqOpen = Number(dlq.rows?.[0]?.cnt ?? 0);

  // Detect missing ledger sequences inside the range that actually has data.
  // A fully-empty range is reported via dbRowCount === 0 instead of a huge gap
  // list, since that usually means Horizon served nothing for the window.
  const gaps: number[] = [];
  if (dbRowCount > 0 && Number.isFinite(minLedger)) {
    const rows = await pool.query(
      `SELECT DISTINCT ledger_sequence::int AS ledger
         FROM stream_events
        WHERE ledger_sequence BETWEEN $1 AND $2
        ORDER BY ledger`,
      [fromLedger, toLedger]
    );
    const present = new Set<number>((rows.rows ?? []).map((r: any) => Number(r.ledger)));
    for (let ledger = Math.max(minLedger, fromLedger); ledger <= toLedger; ledger++) {
      if (!present.has(ledger)) gaps.push(ledger);
      if (gaps.length >= 50) break;
    }
  }

  return {
    ledgerRange: { from: fromLedger, to: toLedger },
    dbRowCount,
    eventTypeCounts,
    dlqOpen,
    gaps,
    ok: dbRowCount > 0 && dlqOpen === 0,
  };
}

// ── Main loop ─────────────────────────────────────────────────────────────────

const HORIZON_URL_DEFAULT = "https://horizon-testnet.stellar.org";

export interface RunSummary {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  dlq: number;
  pages: number;
  truncated: boolean;
  resumeCursor: string | null;
  lastLedger: number | null;
}

/**
 * Main backfill loop. Exported so the flow can be driven from tests.
 */
export async function run(
  options: CliOptions,
  deps: {
    pool?: PoolLike;
    horizonUrl?: string;
    contractId?: string;
    pageLimit?: number;
    databaseUrl?: string;
    log?: (line: string) => void;
    warn?: (line: string) => void;
  } = {}
): Promise<RunSummary> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const warn = deps.warn ?? ((line: string) => console.warn(line));

  const { fromLedger, toLedger, eventTypes, dryRun, reconcile: shouldReconcile } = options;
  if (fromLedger === null || toLedger === null) {
    fatal("--start-ledger and --end-ledger are required");
  }

  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL;
  const horizonUrl = deps.horizonUrl ?? process.env.HORIZON_URL ?? HORIZON_URL_DEFAULT;
  const contractId = deps.contractId ?? networkConfig.contractId ?? "";
  const pageLimit = Math.min(
    200,
    deps.pageLimit ?? parseInt(process.env.BACKFILL_PAGE_LIMIT ?? "200", 10)
  );

  if (!dryRun && !databaseUrl) {
    fatal("DATABASE_URL is required (or pass --dry-run to skip DB writes)");
  }
  if (!contractId) {
    fatal("CONTRACT_ID is not set (check TESTNET_CONTRACT_ID / MAINNET_CONTRACT_ID)");
  }

  const pool = deps.pool ?? (dryRun ? null : createPool(databaseUrl as string));

  log("[backfill] ─────────────────────────────────────────────");
  log(`[backfill] contract    : ${contractId}`);
  log(`[backfill] horizon     : ${horizonUrl}`);
  log(`[backfill] from-ledger : ${fromLedger.toLocaleString()}`);
  log(`[backfill] to-ledger   : ${toLedger.toLocaleString()}`);
  log(
    `[backfill] event-type  : ${eventTypes.size > 0 ? [...eventTypes].join(",") : "(all)"}`
  );
  log(`[backfill] dry-run     : ${dryRun}`);
  log("[backfill] ─────────────────────────────────────────────");

  let cursor = process.env.BACKFILL_START_CURSOR ?? "";
  let pages = 0;
  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let dlq = 0;
  let lastLedger: number | null = null;
  let pastToLedger = false;
  let stoppedEarly = false;

  while (!pastToLedger) {
    pages++;

    let records: any[];
    let nextCursor: string | null;

    try {
      ({ records, nextCursor } = await fetchPage(cursor, horizonUrl, contractId, pageLimit));
    } catch (err) {
      warn(`[backfill] Horizon fetch error: ${err}`);
      warn(`[backfill] Resume with: BACKFILL_START_CURSOR="${cursor}"`);
      if (pool) await pool.end();
      throw err;
    }

    if (records.length === 0) break;

    fetched += records.length;

    const decoded: DecodedEvent[] = [];
    for (const rec of records) {
      try {
        const ev = decodeEvent(rec, { fromLedger, toLedger, eventTypes });
        if (ev) {
          decoded.push(ev);
          lastLedger = lastLedger === null ? ev.ledger_sequence : Math.max(lastLedger, ev.ledger_sequence);
          if (ev.ledger_sequence > toLedger) pastToLedger = true;
        } else {
          skipped++;
        }
      } catch (err) {
        dlq++;
        if (!dryRun && pool) {
          await insertDlq(rec, String(err), pool).catch((e) =>
            warn(`[backfill] DLQ write failed: ${e}`)
          );
        }
      }
    }

    if (dryRun) {
      for (const ev of decoded) {
        log(
          `[backfill] [dry-run] ${ev.event_type} ledger=${ev.ledger_sequence} tx=${ev.tx_hash} recipient=${ev.recipient}`
        );
      }
    } else if (decoded.length > 0 && pool) {
      const result = await upsertEvents(decoded, pool);
      inserted += result.inserted;
      updated += result.updated;
    }

    if (lastLedger !== null) {
      renderRangeProgress(lastLedger, fromLedger, toLedger, { fetched, inserted, updated, skipped });
    }

    // Horizon retention window: the first page of a range that starts before
    // the epoch Horizon still serves comes back with records whose ledger is
    // already well past from-ledger, and we never see anything at/below it.
    // Flag that instead of reporting a clean run over a partial range.
    if (pages === 1 && records.length > 0) {
      const firstLedger = Number(records[0].ledger ?? 0);
      if (firstLedger > fromLedger) stoppedEarly = true;
    }

    if (records.length < pageLimit) {
      // Short page: Horizon has no more records to give us for this cursor.
      break;
    }
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  if (process.stdout.isTTY) process.stdout.write("\n");

  const resumeCursor = pastToLedger ? null : cursor || null;

  log(
    `[backfill] Done. fetched=${fetched} inserted=${inserted} updated=${updated} skipped=${skipped} dlq=${dlq}`
  );

  if (stoppedEarly) {
    warn(
      `[backfill] WARNING: Horizon did not serve ledgers before ~${lastLedger ?? "?"}; ` +
        `the requested range starts at ${fromLedger}. Horizon has a bounded retention ` +
        `window — see docs/runbooks/backfill-stream-events.md for the archive operator flow.`
    );
  }

  if (!dryRun && shouldReconcile && pool) {
    const report = await reconcile(fromLedger, toLedger, pool);
    await runReconciliationJob(report, log, warn);
  }

  if (pool) await pool.end();
  if (dryRun) resetPool();

  return {
    fetched,
    inserted,
    updated,
    skipped,
    dlq,
    pages,
    truncated: stoppedEarly,
    resumeCursor,
    lastLedger,
  };
}

/**
 * Emit the reconciliation report. Kept separate from `reconcile()` so the
 * reporting format can be asserted in tests without touching the DB.
 */
export async function runReconciliationJob(
  report: ReconciliationReport,
  log: (line: string) => void = console.log,
  warn: (line: string) => void = console.warn
): Promise<void> {
  log("[backfill] ── Reconciliation ──────────────────────────────");
  log(
    `[backfill] ledger range : [${report.ledgerRange.from}..${report.ledgerRange.to}]`
  );
  log(`[backfill] rows in range: ${report.dbRowCount}`);
  for (const [type, count] of Object.entries(report.eventTypeCounts)) {
    log(`[backfill]   ${type.padEnd(10)}: ${count}`);
  }
  if (report.gaps.length > 0) {
    warn(
      `[backfill] ledger gaps  : ${report.gaps.slice(0, 10).join(", ")}` +
        (report.gaps.length > 10 ? ` (+${report.gaps.length - 10} more)` : "")
    );
  }
  if (report.dlqOpen > 0) {
    warn(`[backfill] DLQ entries from the last hour: ${report.dlqOpen}`);
  }
  log(`[backfill] status       : ${report.ok ? "OK" : "NEEDS ATTENTION"}`);
  log("[backfill] ───────────────────────────────────────────────");
}

// ── Entry point ───────────────────────────────────────────────────────────────

const isDirectInvocation =
  process.argv[1] !== undefined &&
  /backfill_stream_events\.(ts|js)$/.test(process.argv[1]);

if (isDirectInvocation) {
  const options = resolveOptions(process.argv.slice(2), process.env);
  if (options.help) {
    printUsage();
    process.exit(0);
  }
  run(options).catch((err) => {
    console.error("[backfill] Fatal:", err);
    process.exit(1);
  });
}
