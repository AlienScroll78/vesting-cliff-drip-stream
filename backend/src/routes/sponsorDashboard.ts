/**
 * backend/src/routes/sponsorDashboard.ts  (#1011)
 *
 * GET /sponsors/:address/streams
 *
 * Returns all streams a sponsor has created, grouped by status, with
 * aggregate statistics.
 *
 * Response 200:
 * {
 *   "sponsor": "G...",
 *   "active_streams": [ ... ],
 *   "cancelled_streams": [ ... ],
 *   "terminal_streams": [ ... ],   // expired, drained, clawedback
 *   "total_deposited": "9876543210",
 *   "total_claimed": "1234567890",
 *   "total_remaining": "8641975320",
 *   "next_cursor": "..." | null
 * }
 *
 * Response 404:
 * { "error": "no streams found for sponsor" }
 *
 * Acceptance criteria:
 *   - Address validated as a valid Stellar public key
 *   - Paginated (cursor-based) for sponsors with many streams
 *   - Response cached for 10 seconds
 *   - Returns 404 if sponsor address has no streams
 */

import { Router, type Request, type Response } from "express";
import { Pool } from "pg";
import { createClient } from "redis";
import { validate } from "../middleware/validate.js";
import { AddressParamsSchema, PaginationQuerySchema } from "../validation.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const CACHE_TTL_SEC = 10;

// ── Types ─────────────────────────────────────────────────────────────────────

interface SponsorStreamItem {
  recipient: string;
  sponsor: string;
  token: string;
  rate_per_ledger: string;
  start_ledger: number;
  cliff_ledger: number;
  end_ledger: number;
  status: string;
  created_at: string;
}

interface SponsorDashboardResponse {
  sponsor: string;
  active_streams: SponsorStreamItem[];
  cancelled_streams: SponsorStreamItem[];
  terminal_streams: SponsorStreamItem[];
  total_deposited: string;
  total_claimed: string;
  total_remaining: string;
  next_cursor: string | null;
}

interface StreamCursor {
  address: string;
  id: string;
  created_at: string;
}

// ── DB pool (lazy singleton) ───────────────────────────────────────────────────

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

// ── Redis cache (lazy connect, fail-open) ─────────────────────────────────────

let _redis: ReturnType<typeof createClient> | null = null;

async function getRedis(): Promise<ReturnType<typeof createClient> | null> {
  if (!process.env.REDIS_URL) return null;
  if (_redis?.isOpen) return _redis;
  try {
    _redis = createClient({ url: process.env.REDIS_URL });
    _redis.on("error", () => {});
    await _redis.connect();
    return _redis;
  } catch {
    _redis = null;
    return null;
  }
}

// ── Cursor encoding/decoding ──────────────────────────────────────────────────

function encodeCursor(cursor: StreamCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string, address: string): StreamCursor | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (
      typeof parsed.address === "string" &&
      parsed.address === address &&
      typeof parsed.id === "string" &&
      typeof parsed.created_at === "string" &&
      Number.isFinite(Date.parse(parsed.created_at))
    ) {
      return parsed as StreamCursor;
    }
  } catch {
    // Invalid cursor — rejected by the route
  }
  return null;
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * GET /sponsors/:address/streams
 *
 * Returns all streams for a sponsor grouped by status with aggregate stats.
 */
async function sponsorStreamsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { address } = req.params as { address: string };
  const { limit, cursor } = req.query as { limit: number; cursor?: string };

  // ── Validate cursor ──────────────────────────────────────────────────────
  const decodedCursor = cursor ? decodeCursor(cursor, address) : null;
  if (cursor && !decodedCursor) {
    res.status(400).json({ error: "Invalid cursor for this sponsor" });
    return;
  }

  // ── Cache lookup ─────────────────────────────────────────────────────────
  const cacheKey = `sponsor-dashboard:${address}:${limit}:${cursor ?? ""}`;
  const client = await getRedis();

  if (client) {
    try {
      const cached = await client.get(cacheKey);
      if (cached) {
        res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SEC}`);
        res.setHeader("X-Cache", "HIT");
        res.status(200).json(JSON.parse(cached));
        return;
      }
    } catch {
      // fail-open
    }
  }

  try {
    const pool = getPool();

    // ── Build query ───────────────────────────────────────────────────────
    const values: unknown[] = [address];
    let cursorFilter = "";

    if (decodedCursor) {
      values.push(decodedCursor.created_at, decodedCursor.id);
      cursorFilter = ` AND (created_at, id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`;
    }

    values.push(limit + 1); // fetch one extra to check hasMore
    const limitParam = `$${values.length}`;

    // ── Fetch streams ──────────────────────────────────────────────────────
    const streamResult = await pool.query(
      `SELECT
         id,
         recipient_address AS recipient,
         sponsor_address   AS sponsor,
         token_address     AS token,
         rate_per_ledger::text AS rate_per_ledger,
         start_ledger,
         cliff_ledger,
         end_ledger,
         status::text       AS status,
         created_at
       FROM vesting_streams
       WHERE sponsor_address = $1${cursorFilter}
       ORDER BY created_at DESC, id DESC
       LIMIT ${limitParam}`,
      values,
    );

    // ── 404: no streams for this sponsor ────────────────────────────────────
    if (streamResult.rows.length === 0 && !cursor) {
      res.status(404).json({ error: "no streams found for sponsor" });
      return;
    }

    const hasMore = streamResult.rows.length > limit;
    const streams = streamResult.rows.slice(0, limit) as SponsorStreamItem[];

    // ── Group by status ────────────────────────────────────────────────────
    const activeStreams: SponsorStreamItem[] = [];
    const cancelledStreams: SponsorStreamItem[] = [];
    const terminalStreams: SponsorStreamItem[] = [];

    for (const stream of streams) {
      const { id: _id, ...item } = stream as any;
      if (stream.status === "active" || stream.status === "pre_cliff") {
        activeStreams.push(item);
      } else if (stream.status === "cancelled") {
        cancelledStreams.push(item);
      } else {
        // expired, drained, clawedback → terminal
        terminalStreams.push(item);
      }
    }

    // ── Aggregate statistics ───────────────────────────────────────────────
    // total_deposited = SUM(rate_per_ledger * (end_ledger - start_ledger))
    // total_claimed   = SUM of all vc_claim events for this sponsor's streams
    // total_remaining  = total_deposited - total_claimed
    const statsResult = await pool.query<{
      total_deposited: string;
      total_claimed: string;
    }>(
      `SELECT
         COALESCE(
           SUM((vs.end_ledger - vs.start_ledger) * vs.rate_per_ledger), 0
         )::text AS total_deposited,
         COALESCE(
           (SELECT SUM(amount::numeric)
            FROM stream_events se
            WHERE se.event_type = 'TokensClaimed'
              AND se.recipient IN (
                SELECT recipient_address FROM vesting_streams WHERE sponsor_address = $1
              )),
           0
         )::text AS total_claimed
       FROM vesting_streams vs
       WHERE vs.sponsor_address = $1`,
      [address],
    );

    const statsRow = statsResult.rows[0] ?? { total_deposited: "0", total_claimed: "0" };
    const totalDeposited = BigInt(statsRow.total_deposited ?? "0");
    const totalClaimed = BigInt(statsRow.total_claimed ?? "0");
    const totalRemaining = totalDeposited - totalClaimed;

    // ── Build next cursor ──────────────────────────────────────────────────
    const last = streams.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            address,
            id: (last as any).id,
            created_at: new Date((last as any).created_at).toISOString(),
          })
        : null;

    // ── Build response ─────────────────────────────────────────────────────
    const response: SponsorDashboardResponse = {
      sponsor: address,
      active_streams: activeStreams,
      cancelled_streams: cancelledStreams,
      terminal_streams: terminalStreams,
      total_deposited: totalDeposited.toString(),
      total_claimed: totalClaimed.toString(),
      total_remaining: totalRemaining.toString(),
      next_cursor: nextCursor,
    };

    // ── Cache write (best-effort) ──────────────────────────────────────────
    if (client) {
      try {
        await client.setEx(cacheKey, CACHE_TTL_SEC, JSON.stringify(response));
      } catch {
        // non-fatal
      }
    }

    res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SEC}`);
    res.setHeader("X-Cache", "MISS");
    res.status(200).json(response);
  } catch (err: any) {
    console.error("[sponsor-dashboard] query error:", err?.message ?? err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

const sponsorDashboardRouter = Router();

/**
 * GET /sponsors/:address/streams
 *
 * Returns all streams for a sponsor grouped by status with aggregate stats.
 * Address validated as a valid Stellar public key.
 * Paginated (cursor-based) for sponsors with many streams.
 * Response cached for 10 seconds.
 */
sponsorDashboardRouter.get(
  "/sponsors/:address/streams",
  validate({
    params: AddressParamsSchema,
    query: PaginationQuerySchema,
  }),
  sponsorStreamsHandler,
);

export { sponsorDashboardRouter, sponsorStreamsHandler, encodeCursor, decodeCursor };
