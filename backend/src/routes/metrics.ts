/**
 * Issue #570: Metrics routes.
 *
 * Two endpoints are exposed:
 *
 *   GET /metrics
 *     Prometheus text-format scrape endpoint.
 *     Content-Type is set by prom-client (text/plain; version=0.0.4; charset=utf-8).
 *     This endpoint MUST NOT be behind any authentication middleware.
 *
 *   GET /api/v1/metrics
 *     Legacy JSON endpoint kept for backward compatibility.
 *     Returns operational metrics (Redis cache stats).
 *
 * Both handlers are exported individually so callers can mount them at
 * arbitrary paths if needed.
 */

import type { Request, Response } from 'express';
import { registry } from '../metrics.js';

// ---------------------------------------------------------------------------
// Prometheus scrape endpoint  (GET /metrics)
// ---------------------------------------------------------------------------

/**
 * Returns all registered metrics in Prometheus text exposition format.
 *
 * This endpoint should be mounted WITHOUT authentication so that Prometheus
 * can scrape it freely from within the cluster.
 */
export async function prometheusMetricsHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    const output = await registry.metrics();
    res.setHeader('Content-Type', registry.contentType);
    res.status(200).end(output);
  } catch (err) {
    res.status(500).end(String(err));
  }
}

// ---------------------------------------------------------------------------
// Legacy JSON endpoint  (GET /api/v1/metrics)
// ---------------------------------------------------------------------------

interface CacheMetrics {
  hits: number;
  misses: number;
  total: number;
  hitRate: number;
}

/**
 * Retrieve cache metrics from the cache module.
 * Falls back to zeroes when the cache module is not available (e.g. tests).
 * Uses a dynamic import so ESM modules can interop with the CJS cache module.
 */
async function fetchCacheMetrics(): Promise<CacheMetrics> {
  try {
    // Dynamic import supports both CJS interop and ESM
    const mod = await import('../cache.js');
    const fn = (mod as { getCacheMetrics?: () => CacheMetrics }).getCacheMetrics
      ?? (mod as { default?: { getCacheMetrics?: () => CacheMetrics } }).default?.getCacheMetrics;
    if (typeof fn === 'function') return fn();
  } catch {
    // cache module unavailable — return zeroes
  }
  return { hits: 0, misses: 0, total: 0, hitRate: 0 };
}

/**
 * Legacy JSON metrics handler kept for backward compatibility with existing
 * dashboards / clients that consume /api/v1/metrics.
 */
export async function jsonMetricsHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const cacheStats = await fetchCacheMetrics();

  res.setHeader('Content-Type', 'application/json');
  res.status(200).end(
    JSON.stringify({
      service: 'vesting-backend',
      timestamp: new Date().toISOString(),
      cache: {
        hits: cacheStats.hits,
        misses: cacheStats.misses,
        total: cacheStats.total,
        hitRate: cacheStats.hitRate,
      },
    }),
  );
}
