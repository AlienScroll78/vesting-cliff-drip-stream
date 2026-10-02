/**
 * Issue #570: HTTP metrics middleware.
 *
 * Intercepts every request to record:
 *   - http_requests_total          labelled with method, normalised path, and
 *                                  HTTP status code (captured after response)
 *   - http_request_duration_seconds labelled with method and normalised path
 *
 * Path normalisation replaces dynamic segments (UUIDs, Stellar addresses, and
 * pure numeric/alphanumeric IDs) with ":id" so the cardinality of the metric
 * stays manageable.
 *
 * The middleware monkey-patches `res.end` so it can observe the status code
 * and the elapsed duration before the response is sent to the client.
 */

import type { Request, Response, NextFunction } from 'express';
import { httpRequestsTotal, httpRequestDurationSeconds } from '../metrics.js';

// ---------------------------------------------------------------------------
// Path normalisation
// ---------------------------------------------------------------------------

/**
 * Replace dynamic path segments with a stable ":id" placeholder.
 *
 * Patterns replaced:
 *   - UUIDs  (8-4-4-4-12 hex)
 *   - Stellar public keys (G…, 56 chars)
 *   - Numeric IDs
 *   - Long hex strings (≥ 16 chars)
 */
export function normalisePath(rawPath: string): string {
  return rawPath
    // UUID
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    // Stellar public key (G followed by 55 alphanumeric chars)
    .replace(/G[A-Z2-7]{55}/g, ':id')
    // Pure numeric segment
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    // Long hex string (≥ 16 hex chars)
    .replace(/[0-9a-f]{16,}/gi, ':id');
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Express middleware that records HTTP request metrics.
 * Register this early in the middleware chain (after body parsing, before routes).
 *
 * It does NOT touch the /metrics endpoint itself to avoid circular recording
 * noise, but that is a product decision — remove the guard if preferred.
 */
export function metricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startNs = process.hrtime.bigint();
  const method = req.method;
  const path = normalisePath(req.path);

  // Capture the original `end` so we can wrap it.
  const originalEnd = res.end.bind(res) as typeof res.end;

  // Override res.end — called by Express for all response types
  // (res.json, res.send, res.sendFile, etc.).
  (res.end as unknown) = function (
    this: Response,
    ...args: Parameters<typeof res.end>
  ): ReturnType<typeof res.end> {
    const durationSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
    const status = String(res.statusCode);

    httpRequestsTotal.labels(method, path, status).inc();
    httpRequestDurationSeconds.labels(method, path).observe(durationSeconds);

    // Restore and call the original end so the response is actually sent.
    res.end = originalEnd;
    return originalEnd(...args);
  };

  next();
}
