/**
 * Issue #745: GET /api/analytics/summary
 *
 * Returns aggregate statistics across all vesting streams:
 *   - total_streams_created
 *   - active_streams
 *   - total_tokens_locked     { TOKEN: "amount", … }
 *   - total_tokens_claimed    { TOKEN: "amount", … }
 *   - streams_created_last_30d
 *   - unique_sponsors
 *   - unique_recipients
 *
 * Supports optional ?token=<symbol_or_address> filter.
 *
 * Response is cached in Redis with a 5-minute TTL.
 * A background job (see jobs/analyticsSummaryJob.ts) proactively refreshes
 * the cache every 60 seconds so cache hits are always warm.
 */

import type { Request, Response } from "express";
import { createClient } from "redis";
import { pool } from "../db.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CACHE_TTL_SEC = 300; // 5 minutes
export const CACHE_KEY_PREFIX = "analytics:summary";

// ---------------------------------------------------------------------------
// Redis client (lazy connect, fail-open)
// ---------------------------------------------------------------------------

let redis: ReturnType<typeof createClient> | null = null;

export async function getRedis(): Promise<ReturnType<typeof createClient> | null> {
  if (redis) return redis;
  try {
    redis = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379" });
    redis.on("error", () => {
      /* fail-open: cache misses fall through to DB */
    });
    await redis.connect();
    return redis;
  } catch {
    redis = null;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export interface AnalyticsSummary {
  total_streams_created: number;
  active_streams: number;
  total_tokens_locked: Record<string, string>;
  total_tokens_claimed: Record<string, string>;
  streams_created_last_30d: number;
  unique_sponsors: number;
  unique_recipients: number;
}

/**
 * Compute analytics summary from the database.
 * If `tokenFilter` is provided, only that token's data is included.
 */
export async function computeSummary(
  tokenFilter?: string
): Promise<AnalyticsSummary> {
  const params: string[] = [];
  const tokenWhere = tokenFilter
    ? (() => { params.push(tokenFilter); return `AND s.token = $${params.length}`; })()
    : "";

  // ── Aggregate from schedules table ───────────────────────────────────────
  const schedulesResult = await pool.query<{
    total_streams_created: string;
    active_streams: string;
    streams_created_last_30d: string;
    unique_sponsors: string;
    unique_recipients: string;
  }>(
    `SELECT
       COUNT(*)                                                        AS total_streams_created,
       COUNT(*) FILTER (WHERE s.status = 'active')                    AS active_streams,
       COUNT(*) FILTER (WHERE s.created_at >= NOW() - INTERVAL '30 days') AS streams_created_last_30d,
       COUNT(DISTINCT s.sponsor)                                       AS unique_sponsors,
       COUNT(DISTINCT s.recipient)                                     AS unique_recipients
     FROM schedules s
     WHERE 1=1 ${tokenWhere}`,
    params
  );

  const aggRow = schedulesResult.rows[0];

  // ── Locked amounts per token (active streams only) ───────────────────────
  const lockedParams: string[] = [];
  const lockedTokenWhere = tokenFilter
    ? (() => { lockedParams.push(tokenFilter); return `AND token = $${lockedParams.length}`; })()
    : "";

  const lockedResult = await pool.query<{ token: string; total_locked: string }>(
    `SELECT token, COALESCE(SUM(total_deposit), 0)::TEXT AS total_locked
     FROM schedules
     WHERE status = 'active' ${lockedTokenWhere}
     GROUP BY token`,
    lockedParams
  );

  const total_tokens_locked: Record<string, string> = {};
  for (const row of lockedResult.rows) {
    if (row.token) total_tokens_locked[row.token] = row.total_locked;
  }

  // ── Claimed amounts per token (from stream_events) ───────────────────────
  const claimedParams: string[] = [];
  const claimedTokenWhere = tokenFilter
    ? (() => { claimedParams.push(tokenFilter); return `AND token = $${claimedParams.length}`; })()
    : "";

  const claimedResult = await pool.query<{ token: string; total_claimed: string }>(
    `SELECT token, COALESCE(SUM(amount), 0)::TEXT AS total_claimed
     FROM stream_events
     WHERE event_type = 'vc_claim'
       AND token IS NOT NULL
       ${claimedTokenWhere}
     GROUP BY token`,
    claimedParams
  );

  const total_tokens_claimed: Record<string, string> = {};
  for (const row of claimedResult.rows) {
    if (row.token) total_tokens_claimed[row.token] = row.total_claimed;
  }

  return {
    total_streams_created: parseInt(aggRow.total_streams_created, 10),
    active_streams: parseInt(aggRow.active_streams, 10),
    total_tokens_locked,
    total_tokens_claimed,
    streams_created_last_30d: parseInt(aggRow.streams_created_last_30d, 10),
    unique_sponsors: parseInt(aggRow.unique_sponsors, 10),
    unique_recipients: parseInt(aggRow.unique_recipients, 10),
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function analyticsSummaryHandler(
  req: Request,
  res: Response
): Promise<void> {
  const tokenFilter = req.query.token as string | undefined;
  const cacheKey = tokenFilter
    ? `${CACHE_KEY_PREFIX}:token:${tokenFilter}`
    : CACHE_KEY_PREFIX;

  const client = await getRedis();

  // ── Cache read ────────────────────────────────────────────────────────────
  if (client) {
    try {
      const cached = await client.get(cacheKey);
      if (cached) {
        res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SEC}`);
        res.json({ ...JSON.parse(cached), cached: true });
        return;
      }
    } catch {
      /* fail-open: cache miss, fall through to DB */
    }
  }

  // ── DB query ──────────────────────────────────────────────────────────────
  const summary = await computeSummary(tokenFilter);
  const payload = { ...summary, cached: false };

  // ── Cache write (best-effort) ─────────────────────────────────────────────
  if (client) {
    client
      .setEx(cacheKey, CACHE_TTL_SEC, JSON.stringify(summary))
      .catch(() => {});
  }

  res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SEC}`);
  res.json(payload);
}
