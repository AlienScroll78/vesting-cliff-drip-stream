"use strict";

/**
 * Request ID middleware — closes #36
 *
 * Attaches X-Request-ID to every request (generates UUID v4 if absent).
 * Also exposes a structured logger bound to the request_id.
 */

const { randomUUID } = require("crypto");

/** Redact patterns: Stellar secret keys (S...), Bearer tokens */
const REDACT_RE = /\b(S[A-Z2-7]{55}|Bearer\s+\S+)\b/g;

function redact(str) {
  return typeof str === "string" ? str.replace(REDACT_RE, "[REDACTED]") : str;
}

/** Build a structured log line as JSON. */
function buildLogLine(level, requestId, message, extra = {}) {
  return JSON.stringify({
    level,
    timestamp: new Date().toISOString(),
    request_id: requestId,
    message: redact(String(message)),
    ...extra,
  });
}

/** Create a logger bound to a specific request_id. */
function createLogger(requestId) {
  const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  const minLevel = levels[LOG_LEVEL] ?? 1;

  function log(level, message, extra) {
    if ((levels[level] ?? 0) >= minLevel) {
      const out = buildLogLine(level, requestId, message, extra);
      if (level === "error" || level === "warn") {
        process.stderr.write(out + "\n");
      } else {
        process.stdout.write(out + "\n");
      }
    }
  }

  return {
    debug: (msg, extra) => log("debug", msg, extra),
    info:  (msg, extra) => log("info",  msg, extra),
    warn:  (msg, extra) => log("warn",  msg, extra),
    error: (msg, extra) => log("error", msg, extra),
  };
}

/**
 * Express-compatible middleware.
 * Sets req.requestId, req.log, and echoes X-Request-ID in the response.
 */
function requestIdMiddleware(req, res, next) {
  const requestId = req.headers["x-request-id"] || randomUUID();
  req.requestId = requestId;
  req.log = createLogger(requestId);
  res.setHeader("X-Request-ID", requestId);
  req.log.info(`${req.method} ${req.url}`);
  next();
}

/** Bare http.IncomingMessage adapter (for non-Express handlers). */
function attachRequestId(req, res) {
  const requestId = req.headers["x-request-id"] || randomUUID();
  req.requestId = requestId;
  req.log = createLogger(requestId);
  if (res) res.setHeader("X-Request-ID", requestId);
  return requestId;
}

module.exports = { requestIdMiddleware, attachRequestId, createLogger };
