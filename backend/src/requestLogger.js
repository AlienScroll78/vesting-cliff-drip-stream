"use strict";

/**
 * requestLogger.js — HTTP request/response logging middleware.
 *
 * Wraps each request in:
 *   1. A new correlation ID (X-Correlation-Id header or generated UUID).
 *   2. An AsyncLocalStorage context so downstream log calls include the ID.
 *   3. Structured log lines on request arrival and response completion.
 *
 * Sensitive headers (Authorization, X-Api-Key) are not logged.
 *
 * Usage:
 *   const { requestLoggerMiddleware } = require('./requestLogger');
 *   // In your HTTP createServer handler:
 *   requestLoggerMiddleware(req, res, () => actualHandler(req, res));
 */

const { randomUUID } = require("crypto");
const { logger, runWithCorrelationId } = require("./logger");

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "cookie",
  "x-sponsor-id",
]);

function sanitizeHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? "[REDACTED]" : v;
  }
  return out;
}

/**
 * Middleware that logs each request/response pair with timing.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @param {Function} next - call to continue to the actual handler
 */
function requestLoggerMiddleware(req, res, next) {
  const correlationId = req.headers["x-correlation-id"] ?? randomUUID();

  // Echo the correlation ID back to the client
  res.setHeader("X-Correlation-Id", correlationId);

  runWithCorrelationId(correlationId, () => {
    const startNs = process.hrtime.bigint();

    logger.info(
      {
        event: "request_received",
        method: req.method,
        path: req.url,
        headers: sanitizeHeaders(req.headers),
      },
      `${req.method} ${req.url}`,
    );

    // Intercept res.end to capture status + timing
    const originalEnd = res.end.bind(res);
    res.end = function (...args) {
      const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      logger.info(
        {
          event: "request_completed",
          method: req.method,
          path: req.url,
          status: res.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
        },
        `${req.method} ${req.url} ${res.statusCode} ${Math.round(durationMs)}ms`,
      );
      return originalEnd(...args);
    };

    next();
  });
}

module.exports = { requestLoggerMiddleware };
