/**
 * Request ID middleware — closes #36
 *
 * Attaches X-Request-ID to every request (reads from header or generates
 * a UUID v4 if absent).  Also stores the request_id in the shared
 * AsyncLocalStorage context from logger.js so that all pino log calls
 * made during the request automatically include the request_id field.
 *
 * A convenience req.log object (bound to the pino logger) is still exposed
 * for route handlers that log directly via req.log.
 */

import { randomUUID } from 'crypto';
import { logger, runWithIds, correlationStorage } from '../logger.js';

/** @type {RegExp} — matches Stellar secret keys (S...) and Bearer tokens */
const REDACT_RE = /\b(S[A-Z2-7]{55}|Bearer\s+\S+)\b/g;

function redact(str) {
  return typeof str === 'string' ? str.replace(REDACT_RE, '[REDACTED]') : str;
}

/**
 * Create a thin logger façade that delegates to pino and ensures every call
 * is made within the active request context (so request_id is injected).
 *
 * @param {string} requestId
 */
export function createLogger(requestId) {
  // Return a façade; the actual request_id injection is handled by pino's
  // log formatter reading from AsyncLocalStorage — we just need to make sure
  // the store is populated (done in requestIdMiddleware via runWithIds).
  return {
    debug: (msg, extra = {}) => logger.debug({ ...extra, message: redact(String(msg)) }),
    info:  (msg, extra = {}) => logger.info({ ...extra, message: redact(String(msg)) }),
    warn:  (msg, extra = {}) => logger.warn({ ...extra, message: redact(String(msg)) }),
    error: (msg, extra = {}) => logger.error({ ...extra, message: redact(String(msg)) }),
  };
}

/**
 * Express-compatible middleware.
 * Sets req.requestId, req.log, and echoes X-Request-ID in the response.
 * Merges with any existing correlation/trace IDs already in the store
 * (e.g. set by requestLoggerMiddleware upstream).
 */
export function requestIdMiddleware(req, res, next) {
  const requestId = req.headers['x-request-id'] || randomUUID();

  // Preserve any IDs already propagated by a parent context (e.g. traceId
  // set by requestLoggerMiddleware).  If this middleware runs first, start
  // a fresh context; otherwise extend the existing one.
  const existing = correlationStorage.getStore() ?? {};

  req.requestId = requestId;
  req.log = createLogger(requestId);

  // Always ensure X-Request-ID is in the response.
  res.setHeader('X-Request-ID', requestId);

  runWithIds(
    {
      requestId,
      traceId:       existing.traceId       ?? null,
      correlationId: existing.correlationId ?? req.headers['x-correlation-id'] ?? requestId,
    },
    () => {
      logger.info({ event: 'request_received', method: req.method, path: req.url },
        `${req.method} ${req.url}`);
      next();
    },
  );
}

/** Bare http.IncomingMessage adapter (for non-Express handlers). */
export function attachRequestId(req, res) {
  const requestId = req.headers['x-request-id'] || randomUUID();
  req.requestId = requestId;
  req.log = createLogger(requestId);
  if (res) res.setHeader('X-Request-ID', requestId);
  return requestId;
}
