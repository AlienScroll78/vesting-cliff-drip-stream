"use strict";

/**
 * logger.js — structured JSON logger using pino.
 *
 * Features:
 *   - JSON output with standard fields: timestamp, level, message,
 *     correlationId, service, version
 *   - Correlation ID injected per-request via AsyncLocalStorage
 *   - Log level configurable via LOG_LEVEL env var (default: info)
 *   - Sensitive fields redacted (addresses truncated, no key material)
 *   - Pretty-print in development (LOG_PRETTY=true)
 */

const { AsyncLocalStorage } = require("async_hooks");

let pino;
try {
  pino = require("pino");
} catch {
  // Fallback logger if pino is not installed (e.g. in minimal test envs)
  pino = null;
}

// ---------------------------------------------------------------------------
// Correlation ID storage
// ---------------------------------------------------------------------------
const correlationStorage = new AsyncLocalStorage();

function getCorrelationId() {
  return correlationStorage.getStore()?.correlationId ?? null;
}

function runWithCorrelationId(correlationId, fn) {
  return correlationStorage.run({ correlationId }, fn);
}

// ---------------------------------------------------------------------------
// Pino instance
// ---------------------------------------------------------------------------
const SERVICE_NAME = process.env.SERVICE_NAME ?? "vesting-backend";
const SERVICE_VERSION = process.env.SERVICE_VERSION ?? "unknown";
const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
const LOG_PRETTY = process.env.LOG_PRETTY === "true";

/** Redact a Stellar address — keep first 4 and last 4 chars. */
function redactAddress(addr) {
  if (typeof addr !== "string" || addr.length < 10) return "[redacted]";
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

/**
 * Walk an object and redact known sensitive keys in-place on a shallow copy.
 * Keys redacted: secretKey, secret, SPONSOR_SECRET_KEY, authorization
 */
function redactSensitive(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const REDACTED_KEYS = new Set([
    "secretKey", "secret_key", "secret", "SPONSOR_SECRET_KEY",
    "authorization", "Authorization", "password", "token",
  ]);
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    if (REDACTED_KEYS.has(key)) {
      result[key] = "[REDACTED]";
    } else if (typeof result[key] === "string" &&
               (result[key].startsWith("S") || result[key].startsWith("G")) &&
               result[key].length === 56) {
      // Looks like a Stellar keypair — truncate
      result[key] = redactAddress(result[key]);
    }
  }
  return result;
}

function buildPinoLogger() {
  if (!pino) {
    // Minimal fallback using console
    const levels = ["debug", "info", "warn", "error"];
    const minLevel = levels.indexOf(LOG_LEVEL);
    const fallback = {};
    levels.forEach((lvl, idx) => {
      fallback[lvl] = (msgOrObj, msg) => {
        if (idx < minLevel) return;
        const entry = typeof msgOrObj === "string"
          ? { message: msgOrObj }
          : { ...msgOrObj, message: msg ?? msgOrObj.message };
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: lvl,
            service: SERVICE_NAME,
            version: SERVICE_VERSION,
            correlationId: getCorrelationId(),
            ...entry,
          }) + "\n",
        );
      };
    });
    fallback.child = () => fallback;
    return fallback;
  }

  const transport = LOG_PRETTY
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined;

  const instance = pino(
    {
      level: LOG_LEVEL,
      base: { service: SERVICE_NAME, version: SERVICE_VERSION },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(label) { return { level: label }; },
        log(obj) {
          // Inject correlation ID from AsyncLocalStorage on every log call
          const correlationId = getCorrelationId();
          return correlationId ? { correlationId, ...obj } : obj;
        },
      },
      redact: {
        paths: ["*.secret", "*.secretKey", "*.authorization", "*.password", "*.token"],
        censor: "[REDACTED]",
      },
      serializers: {
        err: pino.stdSerializers.err,
        error: pino.stdSerializers.err,
      },
    },
    transport ? pino.transport(transport) : undefined,
  );

  return instance;
}

const logger = buildPinoLogger();

module.exports = {
  logger,
  getCorrelationId,
  runWithCorrelationId,
  redactAddress,
  redactSensitive,
};
