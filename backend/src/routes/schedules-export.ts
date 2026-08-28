/**
 * Issue #297 — CSV and JSON export endpoints for stream data.
 *
 * GET /api/v1/schedules/export?format=csv
 *   Streams a CSV file for all vesting streams owned by the authenticated sponsor.
 *
 * GET /api/v1/schedules/export?format=json
 *   Returns a JSON array of vesting streams for the authenticated sponsor.
 *
 * Query params:
 *   format  — "csv" | "json"  (required, defaults to json)
 *   from    — ISO 8601 date string (optional) — filter streams created on or after
 *   to      — ISO 8601 date string (optional) — filter streams created on or before
 *
 * Authentication:
 *   Requires a valid sponsor JWT in the Authorization header:
 *   Authorization: Bearer <token>
 *
 * Rate limiting:
 *   One export per minute per sponsor address (enforced via Redis).
 *
 * Streaming:
 *   Rows are fetched in pages of BATCH_SIZE and written incrementally so that
 *   large exports (10 k+ rows) do not cause memory spikes.
 */

import { Router, Request, Response } from "express";
// @ts-ignore — CJS interop
import { authMiddleware } from "./auth.js";
import { pool } from "../db.js";
import { createRedisClient } from "../redisClient.js";

const router = Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const EXPORT_RATE_KEY_PREFIX = "export_rate:";
const EXPORT_RATE_TTL_SECONDS = 60;
const BATCH_SIZE = 500;

/** CSV column order matching the issue acceptance criteria. */
const CSV_COLUMNS = [
  "recipient_address",
  "token_address",
  "rate_per_ledger",
  "cliff_ledger",
  "end_ledger",
  "total_deposit",
  "total_claimed",
  "status",
] as const;

type CsvColumn = (typeof CSV_COLUMNS)[number];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Quote a single field value for RFC 4180 CSV output.
 * Wraps the value in double-quotes if it contains commas, quotes, or newlines.
 */
function quoteCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Format a row object as a CSV line (no trailing newline). */
function rowToCsvLine(row: Record<string, unknown>): string {
  return CSV_COLUMNS.map((col) => quoteCsv(row[col])).join(",");
}

/** Parse a query param as an ISO date string, returning null if invalid. */
function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

// ── SQL ────────────────────────────────────────────────────────────────────────

/**
 * Build the export query.
 *
 * total_deposit = rate_per_ledger × (end_ledger − start_ledger)
 * total_claimed = SUM of all claim_events.amount for the stream
 *
 * Uses $2 / $3 as nullable timestamptz parameters so a single prepared
 * statement covers both filtered and unfiltered requests.
 */
const EXPORT_SQL = `
  SELECT
    s.recipient_address,
    s.token_address,
    s.rate_per_ledger,
    s.cliff_ledger,
    s.end_ledger,
    (s.rate_per_ledger * (s.end_ledger - s.start_ledger))::bigint AS total_deposit,
    COALESCE(SUM(c.amount), 0)::bigint                             AS total_claimed,
    s.status
  FROM   vesting_streams s
  LEFT JOIN claim_events c ON c.stream_id = s.id
  WHERE  s.sponsor_address = $1
    AND  ($2::timestamptz IS NULL OR s.created_at >= $2::timestamptz)
    AND  ($3::timestamptz IS NULL OR s.created_at <= $3::timestamptz)
  GROUP  BY s.id, s.recipient_address, s.token_address, s.rate_per_ledger,
            s.start_ledger, s.cliff_ledger, s.end_ledger, s.status, s.created_at
  ORDER  BY s.created_at DESC
  LIMIT  $4 OFFSET $5
`;

// ── Handler ───────────────────────────────────────────────────────────────────

async function exportHandler(req: Request, res: Response): Promise<void> {
  const sponsor: string = (req as any).user?.address ?? "";
  if (!sponsor) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Validate format
  const format = String(req.query.format ?? "json").toLowerCase();
  if (format !== "csv" && format !== "json") {
    res.status(400).json({ error: "format must be 'csv' or 'json'" });
    return;
  }

  // Validate optional date filters
  const fromParam = parseDate(req.query.from);
  const toParam = parseDate(req.query.to);

  if (req.query.from !== undefined && req.query.from !== "" && fromParam === null) {
    res.status(400).json({ error: "from must be a valid ISO 8601 date string" });
    return;
  }
  if (req.query.to !== undefined && req.query.to !== "" && toParam === null) {
    res.status(400).json({ error: "to must be a valid ISO 8601 date string" });
    return;
  }

  // Rate limiting — one export per minute per sponsor
  let redis: Awaited<ReturnType<typeof createRedisClient>> | null = null;
  try {
    redis = await createRedisClient();
    const rateKey = `${EXPORT_RATE_KEY_PREFIX}${sponsor}`;
    const existing = await redis.get(rateKey);
    if (existing) {
      res.status(429).json({
        error: "Rate limit exceeded. Only one export per minute is allowed.",
        retry_after_seconds: EXPORT_RATE_TTL_SECONDS,
      });
      return;
    }
    await redis.set(rateKey, "1", { EX: EXPORT_RATE_TTL_SECONDS });
  } catch {
    // Redis unavailable — allow export but skip rate limiting
  }

  const dateSuffix = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const filename = `streams-export-${dateSuffix}.${format}`;

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Transfer-Encoding", "chunked");

    // Write CSV header row
    res.write(CSV_COLUMNS.join(",") + "\n");
  } else {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Transfer-Encoding", "chunked");
    res.write("[");
  }

  const client = await pool.connect();
  let offset = 0;
  let firstRow = true;
  let dbError: Error | null = null;

  try {
    // Stream rows in batches to avoid loading all rows into memory at once
    while (true) {
      const { rows } = await client.query<Record<string, unknown>>(EXPORT_SQL, [
        sponsor,
        fromParam,
        toParam,
        BATCH_SIZE,
        offset,
      ]);

      if (rows.length === 0) break;

      for (const row of rows) {
        if (format === "csv") {
          res.write(rowToCsvLine(row) + "\n");
        } else {
          if (!firstRow) res.write(",");
          res.write(JSON.stringify(row));
          firstRow = false;
        }
      }

      offset += rows.length;

      // If the batch was smaller than BATCH_SIZE we've reached the last page
      if (rows.length < BATCH_SIZE) break;
    }
  } catch (err) {
    dbError = err instanceof Error ? err : new Error(String(err));
  } finally {
    client.release();
  }

  if (dbError) {
    // Headers already sent — we can't change the status code. Append an error
    // sentinel and close. Clients should detect incomplete JSON/CSV.
    if (format === "json") {
      if (!firstRow) res.write(",");
      res.write(JSON.stringify({ __export_error: dbError.message }));
    }
    res.end();
    return;
  }

  if (format === "json") {
    res.write("]");
  }
  res.end();
}

// ── Route registration ─────────────────────────────────────────────────────────

router.get(
  "/schedules/export",
  authMiddleware as (req: Request, res: Response, next: () => void) => void,
  exportHandler,
);

export { router as schedulesExportRouter, exportHandler };
