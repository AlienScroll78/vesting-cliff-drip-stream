/**
 * Issue #34: GET /analytics/sponsor/:address
 *
 * Returns aggregate stats for a sponsor, grouped by token.
 * Response is cached in Redis for 60 seconds.
 *
 * Response 200:
 * {
 *   "sponsor": "G...",
 *   "totals": {
 *     "active_streams": 2,
 *     "total_locked": "28350000",
 *     "total_claimed": "5000000"
 *   },
 *   "by_token": [
 *     {
 *       "token": "C...",
 *       "active_streams": 2,
 *       "total_locked": "28350000",
 *       "total_claimed": "5000000"
 *     }
 *   ],
 *   "cached": false
 * }
 */

import type { Request, Response } from "express";
import { createClient } from "redis";
import { pool } from "../db.js";

const CACHE_TTL_SEC = 60;

// ---------------------------------------------------------------------------
// Redis cache (lazy connect, fail-open)
// ---------------------------------------------------------------------------

let redis: ReturnType<typeof createClient> | null = null;

async function getRedis(): Promise<ReturnType<typeof createClient> | null> {
  if (redis) return redis;
  try {
    redis = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379" });
    redis.on("error", () => { /* fail-open */ });
    await redis.connect();
    return redis;
  } catch {
    redis = null;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function sponsorAnalyticsHandler(req: Request, res: Response): Promise<void> {
  const { address } = req.params;

  if (!address) {
    res.status(400).json({ error: "address required" });
    return;
  }

  const cacheKey = `analytics:sponsor:${address}`;
  const client = await getRedis();

  // Cache read
  if (client) {
    const cached = await client.get(cacheKey);
    if (cached) {
      res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SEC}`);
      res.json({ ...JSON.parse(cached), cached: true });
      return;
    }
  }

  // DB query — aggregate by token for this sponsor
  const byTokenRows = await pool.query<{
    token: string;
    active_streams: string;
    total_locked: string;
    total_claimed: string;
  }>(
    `SELECT
       s.token,
       COUNT(*)                                          AS active_streams,
       COALESCE(SUM(s.total_deposit), 0)::TEXT          AS total_locked,
       COALESCE(SUM(c.claimed), 0)::TEXT                AS total_claimed
     FROM schedules s
     LEFT JOIN (
       SELECT token, recipient, SUM(amount) AS claimed
       FROM claims
       GROUP BY token, recipient
     ) c ON c.recipient = s.recipient AND c.token = s.token
     WHERE s.sponsor = $1 AND s.status = 'active'
     GROUP BY s.token`,
    [address]
  );

  const by_token = byTokenRows.rows;

  const totals = by_token.reduce(
    (acc, row) => ({
      active_streams: acc.active_streams + parseInt(row.active_streams, 10),
      total_locked: (BigInt(acc.total_locked) + BigInt(row.total_locked)).toString(),
      total_claimed: (BigInt(acc.total_claimed) + BigInt(row.total_claimed)).toString(),
    }),
    { active_streams: 0, total_locked: "0", total_claimed: "0" }
  );

  const payload = { sponsor: address, totals, by_token, cached: false };

  // Cache write (best-effort)
  if (client) {
    await client.setEx(cacheKey, CACHE_TTL_SEC, JSON.stringify(payload)).catch(() => {});
  }

  res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SEC}`);
  res.json(payload);
}
