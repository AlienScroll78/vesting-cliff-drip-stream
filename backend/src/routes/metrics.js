"use strict";

/**
 * routes/metrics.js
 *
 * GET /api/v1/metrics — exposes operational metrics including Redis cache
 * hit/miss ratio.  This is intentionally a lightweight endpoint; hook into
 * a Prometheus scraper or CloudWatch custom metrics as needed.
 */

const { getCacheMetrics } = require("../cache");

async function metricsHandler(req, res) {
  const cacheStats = getCacheMetrics();

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      service: "vesting-backend",
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

module.exports = { metricsHandler };
