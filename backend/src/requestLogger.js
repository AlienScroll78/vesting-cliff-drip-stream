/**
 * requestLogger.js — HTTP request/response logging middleware.
 *
 * Wraps each request in:
 *   1. A unique request_id (UUID v4) — echoed as X-Request-ID response header.
 *   2. A correlation_id taken from X-Correlation-Id (or same UUID as fallback).
 *   3. A trace_id extracted from the active OpenTelemetry span (if any).
 *   4. An AsyncLocalStorage context so all downstream log calls include the IDs.
 *   5. Structured JSON log lines on request arrival and response completion.
 *
 * Log fields emitted on every line during a request:
 *   request_id     — stable UUID for this HTTP request
 *   trace_id       — W3C traceId from the active OTel span (when tracing is active)
 *   correlation_id — caller-supplied logical correlation (X-Correlation-Id header)
 *
 * Sensitive headers (Authorization, X-Api-Key, cookie) are not logged.
 *
 * Usage (Express):
 *   import { requestLoggerMiddleware } from './requestLogger.js';
 *   app.use(requestLoggerMiddleware);
 *
 * Usage (plain http.Server):
 *   requestLoggerMiddleware(req, res, () => actualHandler(req, res));
 */

import { randomUUID } from 'crypto';
import { logger, runWithIds } from './logger.js';

// Optional: read trace_id from the active OTel span without hard-coupling to
// @opentelemetry/api.  If the package is absent (e.g. unit tests without tracing
// set up) we silently fall back to null.
let otelTrace = null;
try {
  otelTrace = (await import('@opentelemetry/api')).trace;
} catch {
  // tracing not available — proceed without trace_id
}

/** Extract the W3C traceId from the currently active OTel span, if any. */
function getActiveTraceId() {
  if (!otelTrace) return null;
  try {
    const spanCtx = otelTrace.getActiveSpan()?.spanContext();
    return spanCtx?.isValid ? spanCtx.traceId : null;
  } catch {
    return null;
  }
}

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'cookie',
  'x-sponsor-id',
]);

function sanitizeHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}

/**
 * Express-compatible middleware that assigns correlation identifiers to every
 * request and wraps the async chain in an AsyncLocalStorage context so that
 * all log calls made during request handling automatically include the IDs.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @param {Function} next
 */
export function requestLoggerMiddleware(req, res, next) {
  // Generate a fresh UUID for this specific HTTP request.
  const requestId = req.headers['x-request-id'] ?? randomUUID();

  // Honour a caller-supplied logical correlation ID; fall back to requestId.
  const correlationId = req.headers['x-correlation-id'] ?? requestId;

  // Best-effort extraction of the W3C traceId from the OTel span that the
  // HTTP instrumentation has already started for this request.
  const traceId = getActiveTraceId();

  // Echo both identifiers in the response so the caller can correlate.
  res.setHeader('X-Request-ID',    requestId);
  res.setHeader('X-Correlation-Id', correlationId);

  // Propagate all three IDs through the full async chain for this request.
  runWithIds({ requestId, traceId, correlationId }, () => {
    const startNs = process.hrtime.bigint();

    logger.info(
      {
        event:   'request_received',
        method:  req.method,
        path:    req.url,
        headers: sanitizeHeaders(req.headers),
      },
      `${req.method} ${req.url}`,
    );

    // Intercept res.end to capture status + timing.
    const originalEnd = res.end.bind(res);
    res.end = function (...args) {
      const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      logger.info(
        {
          event:      'request_completed',
          method:     req.method,
          path:       req.url,
          status:     res.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
        },
        `${req.method} ${req.url} ${res.statusCode} ${Math.round(durationMs)}ms`,
      );
      return originalEnd(...args);
    };

    next();
  });
}
