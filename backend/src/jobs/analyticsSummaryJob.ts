/**
 * Issue #745: Analytics summary cache refresh job
 *
 * Runs every 60 seconds and proactively populates the Redis cache for
 * GET /api/analytics/summary so that cache hits are always warm and
 * response times stay well under 100 ms.
 *
 * The job is intentionally simple: it calls computeSummary() and writes
 * the result to Redis with the standard 5-minute TTL.  If Redis is
 * unavailable the job fails silently — the endpoint will fall through to
 * the database on the next request.
 */

import cron from "node-cron";
import { computeSummary, getRedis, CACHE_KEY_PREFIX, CACHE_TTL_SEC } from "../routes/analyticsSummary.js";

// ---------------------------------------------------------------------------
// Core refresh logic (exported so admin API can trigger it manually)
// ---------------------------------------------------------------------------

export interface RefreshResult {
  ok: boolean;
  durationMs: number;
  error?: string;
}

export async function refreshAnalyticsSummaryCache(): Promise<RefreshResult> {
  const start = Date.now();
  try {
    const summary = await computeSummary();
    const client = await getRedis();
    if (client) {
      await client.setEx(CACHE_KEY_PREFIX, CACHE_TTL_SEC, JSON.stringify(summary));
    }
    const durationMs = Date.now() - start;
    console.log(`[analytics-job] Cache refreshed in ${durationMs}ms`);
    return { ok: true, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    console.error("[analytics-job] Cache refresh failed:", error);
    return { ok: false, durationMs, error };
  }
}

// ---------------------------------------------------------------------------
// Scheduler — runs every 60 seconds
// ---------------------------------------------------------------------------

export function scheduleAnalyticsSummaryJob(): void {
  // Every 60 seconds
  cron.schedule("* * * * *", () => {
    refreshAnalyticsSummaryCache().catch((err) =>
      console.error("[analytics-job] Unexpected error:", err)
    );
  });
  console.log("[analytics-job] Scheduled analytics summary cache refresh (every 60s)");
}
