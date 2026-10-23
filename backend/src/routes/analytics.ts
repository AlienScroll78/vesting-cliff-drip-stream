/**
 * Issue #34 / #752: Analytics endpoints
 *
 * GET /analytics/sponsor/:address — aggregate stats for a sponsor by token
 * GET /analytics/summary          — global aggregate stats across all streams
 *
 * All params validated centrally via validate() middleware.
 * Responses are cached in Redis for 60 seconds.
 *
 * Response 200 for /analytics/sponsor/:address:
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
 *
 * Response 200 for /analytics/summary:
 * {
 *   "total_streams": 1247,
 *   "active_streams": 892,
 *   "total_value_locked": "9876543210000",
 *   "total_claimed": "1234567890000",
 *   "unique_sponsors": 143,
 *   "unique_recipients": 892,
 *   "by_status": { "active": 600, "pre_cliff": 292, ... }
 * }
 */

import { Router, type Request, type Response } from "express";
import { createClient } from "redis";
import { pool } from "../db.js";
import { validate } from "../middleware/validate.js";
import { AddressParamsSchema } from "../validation.js";

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
// Sponsor analytics handler
// ---------------------------------------------------------------------------

export async function sponsorAnalyticsHandler(req: Request, res: Response): Promise<void> {
  // params already validated by validate() middleware — use directly
  const { address } = req.params as { address: string };

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

  // DB query — aggregate by token for this sponsor.
  // Issue #741: optimised to use idx_streams_sponsor_status (V4 migration)
  // and idx_claims_recipient_token (V5 migration) to avoid full-table scans.
  // The sub-query is rewritten as a lateral join so it can use the composite
  // covering index on claims(recipient, token) rather than a full GROUP-BY
  // pass over the entire table.
  const byTokenRows = await pool.query<{
    token: string;
    active_streams: string;
    total_locked: string;
    total_claimed: string;
  }>(
    `SELECT
       s.token,
       COUNT(*)::TEXT                                    AS active_streams,
       COALESCE(SUM(s.total_deposit), 0)::TEXT          AS total_locked,
       COALESCE(SUM(c.claimed), 0)::TEXT                AS total_claimed
     FROM schedules s
     LEFT JOIN LATERAL (
       SELECT SUM(amount) AS claimed
       FROM claims
       WHERE recipient = s.recipient
         AND token     = s.token
     ) c ON true
     WHERE s.sponsor = $1
       AND s.status  = 'active'
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
  } catch (err: any) {
    console.error("[analytics] sponsor query error:", err?.message ?? err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ---------------------------------------------------------------------------
// Global summary handler  (GET /analytics/summary)
// ---------------------------------------------------------------------------

export async function analyticsSummaryHandler(_req: Request, res: Response): Promise<void> {
  const cacheKey = `analytics:summary:v1`;
  const client = await getRedis();

  // Cache read
  if (client) {
    const cached = await client.get(cacheKey);
    if (cached) {
      res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SEC}`);
      res.json(JSON.parse(cached));
      return;
    }
  }

  try {
    const [countRow, statusRow, valueRow] = await Promise.all([
      // Total / unique counts
      pool.query<{
        total_streams: string;
        unique_sponsors: string;
        unique_recipients: string;
      }>(`
        SELECT
          COUNT(*)::TEXT                              AS total_streams,
          COUNT(DISTINCT sponsor_address)::TEXT       AS unique_sponsors,
          COUNT(DISTINCT recipient_address)::TEXT     AS unique_recipients
        FROM vesting_streams
      `),
      // Breakdown by status
      pool.query<{ status: string; count: string }>(`
        SELECT status, COUNT(*)::TEXT AS count
        FROM vesting_streams
        GROUP BY status
      `),
      // Aggregate value
      pool.query<{
        active_streams: string;
        total_value_locked: string;
        total_claimed: string;
      }>(`
        SELECT
          COUNT(CASE WHEN vs.status IN ('active', 'pre_cliff') THEN 1 END)::TEXT AS active_streams,
          COALESCE(
            SUM(
              CASE WHEN vs.status IN ('active', 'pre_cliff')
              THEN (vs.end_ledger - vs.last_claimed_ledger) * vs.rate_per_ledger
              ELSE 0 END
            ),
            0
          )::TEXT AS total_value_locked,
          COALESCE(
            SUM(vs.last_claimed_ledger * vs.rate_per_ledger),
            0
          )::TEXT AS total_claimed
        FROM vesting_streams vs
      `),
    ]);

    const counts = countRow.rows[0];
    const values = valueRow.rows[0];

    const byStatus: Record<string, number> = {};
    for (const row of statusRow.rows) {
      byStatus[row.status] = parseInt(row.count, 10);
    }

    const payload = {
      total_streams: parseInt(counts?.total_streams ?? "0", 10),
      active_streams: parseInt(values?.active_streams ?? "0", 10),
      total_value_locked: values?.total_value_locked ?? "0",
      total_claimed: values?.total_claimed ?? "0",
      unique_sponsors: parseInt(counts?.unique_sponsors ?? "0", 10),
      unique_recipients: parseInt(counts?.unique_recipients ?? "0", 10),
      by_status: byStatus,
    };

    if (client) {
      await client.setEx(cacheKey, CACHE_TTL_SEC, JSON.stringify(payload)).catch(() => {});
    }

    res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SEC}`);
    res.json(payload);
  } catch (err: any) {
    console.error("[analytics] summary query error:", err?.message ?? err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const analyticsRouter = Router();

/**
 * GET /analytics/sponsor/:address
 * Returns aggregate stats for a sponsor address.
 */
analyticsRouter.get(
  "/sponsor/:address",
  validate({ params: AddressParamsSchema }),
  sponsorAnalyticsHandler,
);

/**
 * GET /analytics/summary
 * Returns global aggregate stats across all streams.
 */
analyticsRouter.get("/summary", analyticsSummaryHandler);

export { analyticsRouter };
