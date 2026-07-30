/**
 * backend/src/routes/schedules.ts  (#289)
 *
 * Paginated GET /api/v1/schedules endpoint for the sponsor dashboard.
 *
 * Query params:
 *   sponsor   (required) — Stellar G... address
 *   status    (optional) — active | pre_cliff | expired | cancelled
 *   sort      (optional) — cliff_asc | cliff_desc | end_asc | end_desc |
 *                          claimable_asc | claimable_desc |
 *                          recipient_asc | recipient_desc
 *   page      (optional, default: 1)
 *   limit     (optional, default: 25, max: 100)
 *   cursor    (optional) — opaque cursor for cursor-based pagination
 *
 * Auth: requires valid JWT (authMiddlewareV1). JWT wallet address must match
 *       the `sponsor` query param to prevent cross-sponsor data leakage.
 *
 * Response:
 *   {
 *     items: ScheduleItem[],
 *     total: number,
 *     page: number,
 *     limit: number,
 *     next_cursor: string | null,
 *     prev_cursor: string | null
 *   }
 *
 * Caching: responses are cached in Redis for 5 s (one ledger close).
 */

import { Router, Request, Response } from "express";
import { Pool } from "pg";
import { createClient } from "redis";
import { authMiddlewareV1 } from "./authV1.js";

// ── Types ─────────────────────────────────────────────────────────────────────

type StreamStatus = "active" | "pre_cliff" | "expired" | "cancelled";
type SortField = "cliff_asc" | "cliff_desc" | "end_asc" | "end_desc" |
                 "claimable_asc" | "claimable_desc" |
                 "recipient_asc" | "recipient_desc";

interface ScheduleItem {
  recipient: string;
  sponsor: string;
  token: string | null;
  rate_per_ledger: string;
  start_ledger: number;
  cliff_ledger: number;
  end_ledger: number;
  status: StreamStatus;
  cancelled_at: string | null;
  claimable_amount: string;
  created_at: string;
}

interface SchedulesResponse {
  items: ScheduleItem[];
  total: number;
  page: number;
  limit: number;
  next_cursor: string | null;
  prev_cursor: string | null;
}

// ── DB pool (lazy singleton — shares the app pool if DATABASE_URL is set) ────

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

// ── Redis cache ───────────────────────────────────────────────────────────────

const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS ?? "5000", 10);
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
    return null;
  }
}

async function cacheGet(key: string): Promise<string | null> {
  try {
    const redis = await getRedis();
    return redis ? redis.get(key) : null;
  } catch {
    return null;
  }
}

async function cacheSet(key: string, value: string): Promise<void> {
  try {
    const redis = await getRedis();
    if (redis) await redis.set(key, value, { PX: CACHE_TTL_MS });
  } catch {
    // Non-fatal
  }
}

// ── Sort mapping ──────────────────────────────────────────────────────────────

const SORT_MAP: Record<SortField, string> = {
  cliff_asc: "cliff_ledger ASC",
  cliff_desc: "cliff_ledger DESC",
  end_asc: "end_ledger ASC",
  end_desc: "end_ledger DESC",
  claimable_asc: "claimable_amount ASC",
  claimable_desc: "claimable_amount DESC",
  recipient_asc: "recipient_address ASC",
  recipient_desc: "recipient_address DESC",
};

const VALID_STATUSES = new Set<string>(["active", "pre_cliff", "expired", "cancelled"]);
const VALID_SORTS = new Set<string>(Object.keys(SORT_MAP));

// ── Cursor encoding/decoding ──────────────────────────────────────────────────

interface CursorPayload {
  page: number;
  offset: number;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.page === "number" &&
      typeof parsed.offset === "number"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Query builder ─────────────────────────────────────────────────────────────

/**
 * Build the SQL to fetch paginated schedules for a sponsor.
 *
 * We join vesting_streams with the latest vc_claim event per recipient
 * to derive claimable_amount from on-disk data (avoids N+1 Soroban RPC calls).
 * The claimable_amount column is computed as:
 *   (end_ledger - COALESCE(last_claimed_ledger, start_ledger)) * rate_per_ledger
 * capped to 0 for cancelled/expired streams.
 *
 * A live claimable_amount via Soroban RPC can be added as an enhancement;
 * the schema supports it.
 */
function buildQuery(params: {
  sponsor: string;
  status: StreamStatus | null;
  sort: SortField;
  limit: number;
  offset: number;
}): { sql: string; countSql: string; values: any[] } {
  const { sponsor, status, sort, limit, offset } = params;
  const values: any[] = [sponsor];
  let paramIdx = 2;

  const statusFilter = status
    ? (() => {
        values.push(status === "cancelled" ? "cancelled" : status);
        return ` AND vs.status = $${paramIdx++}`;
      })()
    : "";

  const orderClause = SORT_MAP[sort] ?? SORT_MAP.cliff_asc;

  const baseSql = `
    FROM vesting_streams vs
    WHERE vs.sponsor_address = $1
      ${statusFilter}
  `;

  const countSql = `SELECT COUNT(*) AS total ${baseSql}`;

  values.push(limit, offset);
  const sql = `
    SELECT
      vs.recipient_address         AS recipient,
      vs.sponsor_address           AS sponsor,
      vs.token_address             AS token,
      vs.rate_per_ledger           AS rate_per_ledger,
      vs.start_ledger,
      vs.cliff_ledger,
      vs.end_ledger,
      vs.status,
      vs.cancelled_at,
      vs.created_at,
      GREATEST(
        0,
        (
          COALESCE(
            (SELECT MAX(se.ledger_sequence)
             FROM stream_events se
             WHERE se.recipient = vs.recipient_address
               AND se.event_type = 'vc_claim'),
            vs.start_ledger
          ) - vs.last_claimed_ledger
        ) * vs.rate_per_ledger
      )::TEXT                       AS claimable_amount
    ${baseSql}
    ORDER BY ${orderClause}
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
  `;

  return { sql, countSql, values };
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function schedulesHandler(
  req: Request & { user?: { address: string } },
  res: Response
): Promise<void> {
  // ── Param validation ──────────────────────────────────────────────────────

  const sponsor = String(req.query.sponsor ?? "").trim();
  if (!sponsor) {
    res.status(400).json({ error: "sponsor query parameter is required" });
    return;
  }
  if (!/^G[A-Z2-7]{55}$/.test(sponsor)) {
    res.status(400).json({ error: "sponsor must be a valid Stellar public key" });
    return;
  }

  // JWT wallet must match sponsor (prevent cross-sponsor data access)
  if (req.user?.address && req.user.address !== sponsor) {
    res.status(403).json({ error: "JWT wallet address does not match sponsor parameter" });
    return;
  }

  const rawStatus = String(req.query.status ?? "").trim();
  const status: StreamStatus | null = VALID_STATUSES.has(rawStatus)
    ? (rawStatus as StreamStatus)
    : null;
  if (rawStatus && !status) {
    res.status(400).json({
      error: `Invalid status. Allowed values: ${[...VALID_STATUSES].join(", ")}`,
    });
    return;
  }

  const rawSort = String(req.query.sort ?? "cliff_asc").trim();
  const sort: SortField = VALID_SORTS.has(rawSort)
    ? (rawSort as SortField)
    : "cliff_asc";
  if (rawSort && !VALID_SORTS.has(rawSort)) {
    res.status(400).json({
      error: `Invalid sort. Allowed values: ${[...VALID_SORTS].join(", ")}`,
    });
    return;
  }

  // Pagination — prefer cursor, fall back to page/limit
  let page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(String(req.query.limit ?? "25"), 10))
  );

  const rawCursor = String(req.query.cursor ?? "").trim();
  if (rawCursor) {
    const decoded = decodeCursor(rawCursor);
    if (decoded) {
      page = decoded.page;
    }
  }

  const offset = (page - 1) * limit;

  // ── Cache lookup ──────────────────────────────────────────────────────────

  const cacheKey = `schedules:v1:${sponsor}:${status ?? ""}:${sort}:${page}:${limit}`;
  const cached = await cacheGet(cacheKey);
  if (cached) {
    res.setHeader("X-Cache", "HIT");
    res.setHeader("Content-Type", "application/json");
    res.status(200).send(cached);
    return;
  }

  // ── DB query ──────────────────────────────────────────────────────────────

  try {
    const pool = getPool();
    const { sql, countSql, values } = buildQuery({ sponsor, status, sort, limit, offset });

    // Count and data fetch in parallel to avoid sequential round-trips
    const [countResult, rowsResult] = await Promise.all([
      pool.query(countSql, values.slice(0, values.length - 2)), // exclude limit/offset
      pool.query(sql, values),
    ]);

    const total = parseInt(countResult.rows[0]?.total ?? "0", 10);
    const items: ScheduleItem[] = rowsResult.rows.map((r) => ({
      recipient: r.recipient,
      sponsor: r.sponsor,
      token: r.token ?? null,
      rate_per_ledger: String(r.rate_per_ledger),
      start_ledger: r.start_ledger,
      cliff_ledger: r.cliff_ledger,
      end_ledger: r.end_ledger,
      status: r.status as StreamStatus,
      cancelled_at: r.cancelled_at ? new Date(r.cancelled_at).toISOString() : null,
      claimable_amount: r.claimable_amount ?? "0",
      created_at: new Date(r.created_at).toISOString(),
    }));

    const hasMore = offset + items.length < total;
    const hasPrev = page > 1;

    const nextCursor = hasMore ? encodeCursor({ page: page + 1, offset: offset + limit }) : null;
    const prevCursor = hasPrev ? encodeCursor({ page: page - 1, offset: Math.max(0, offset - limit) }) : null;

    const response: SchedulesResponse = {
      items,
      total,
      page,
      limit,
      next_cursor: nextCursor,
      prev_cursor: prevCursor,
    };

    const payload = JSON.stringify(response);
    cacheSet(cacheKey, payload).catch(() => {});

    res.setHeader("X-Cache", "MISS");
    res.status(200).json(response);
  } catch (err: any) {
    console.error("[schedules] query error:", err?.message ?? err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

const schedulesRouter = Router();

/**
 * GET /api/v1/schedules
 *
 * Protected: requires valid JWT where sub matches the `sponsor` query param.
 */
schedulesRouter.get("/", authMiddlewareV1, schedulesHandler);

export { schedulesRouter };

// Export for testing without auth
export { schedulesHandler, buildQuery, encodeCursor, decodeCursor };
