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
import { getTraceId, logger, runWithIds } from './logger.js';
import { trace as otelTrace } from '@opentelemetry/api';

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
  // Keep a request ID for compatibility and establish one trusted correlation ID.
  const requestId = req.headers['x-request-id'] ?? randomUUID();
  const incomingCorrelationId = req.headers['x-correlation-id'];
  const correlationId = typeof incomingCorrelationId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(incomingCorrelationId)
    ? incomingCorrelationId
    : randomUUID();

  // Best-effort extraction of the W3C traceId from the OTel span that the
  // HTTP instrumentation has already started for this request.
  const traceId = getActiveTraceId();

  // Echo both identifiers in the response so the caller can correlate.
  res.setHeader('X-Request-ID',    requestId);
  res.setHeader('X-Correlation-ID', correlationId);
  req.requestId = requestId;
  req.correlationId = correlationId;

  // Propagate all three IDs through the full async chain for this request.
  runWithIds({ requestId, traceId, correlationId }, () => {
    const startNs = process.hrtime.bigint();

    const traceIdOnReceive = getTraceId();
    logger.info(
      {
        event:   'request_received',
        method:  req.method,
        path:    req.url,
        headers: sanitizeHeaders(req.headers),
        ...(traceIdOnReceive ? { trace_id: traceIdOnReceive } : {}),
      },
      `${req.method} ${req.url}`,
    );

    // Intercept res.end to capture status + timing.
    const originalEnd = res.end.bind(res);
    res.end = function (...args) {
      const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      const traceIdOnComplete = getTraceId();
      logger.info(
        {
          event:      'request_completed',
          method:     req.method,
          path:       req.url,
          status:     res.statusCode,
          duration_ms: Math.round(durationMs * 100) / 100,
          ...(traceIdOnComplete ? { trace_id: traceIdOnComplete } : {}),
        },
        `${req.method} ${req.url} ${res.statusCode} ${Math.round(durationMs)}ms`,
      );
      return originalEnd(...args);
    };

    next();
  });
}
