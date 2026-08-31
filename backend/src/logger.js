/**
 * logger.js — structured JSON logger using pino.
 *
 * Features:
 *   - JSON output with standard fields: timestamp, level, message,
 *     request_id, trace_id, correlation_id, service, version
 *   - All three correlation identifiers injected per-request via AsyncLocalStorage
 *   - Log level configurable via LOG_LEVEL env var (default: info)
 *   - Sensitive fields redacted (addresses truncated, no key material)
 *   - Pretty-print in development (LOG_PRETTY=true)
 *
 * Correlation ID fields:
 *   request_id     — UUID generated per HTTP request (X-Request-ID header)
 *   trace_id       — W3C trace ID from the active OpenTelemetry span
 *   correlation_id — Caller-supplied logical correlation (X-Correlation-Id header)
 */

import { AsyncLocalStorage } from 'async_hooks';

let pino;
try {
  pino = (await import('pino')).default;
} catch {
  // Fallback logger if pino is not installed (e.g. in minimal test envs)
  pino = null;
}

// ---------------------------------------------------------------------------
// Correlation storage — carries all three IDs through async chains
// ---------------------------------------------------------------------------
export const correlationStorage = new AsyncLocalStorage();

/** @returns {string|null} */
export function getRequestId() {
  return correlationStorage.getStore()?.requestId ?? null;
}

/** @returns {string|null} */
export function getTraceId() {
  return correlationStorage.getStore()?.traceId ?? null;
}

/**
 * @deprecated Use getRequestId() / getTraceId() directly.
 * Kept for backwards compatibility with callers that used getCorrelationId().
 * @returns {string|null}
 */
export function getCorrelationId() {
  return correlationStorage.getStore()?.correlationId ?? null;
}

/**
 * Run `fn` within an async context that carries all correlation identifiers.
 *
 * @param {{ requestId?: string, traceId?: string, correlationId?: string }} ids
 * @param {Function} fn
 */
export function runWithIds(ids, fn) {
  return correlationStorage.run(
    {
      requestId:     ids.requestId     ?? null,
      traceId:       ids.traceId       ?? null,
      correlationId: ids.correlationId ?? null,
    },
    fn,
  );
}

/**
 * @deprecated Prefer runWithIds({ correlationId }, fn).
 * Kept for backwards compatibility.
 */
export function runWithCorrelationId(correlationId, fn) {
  const existing = correlationStorage.getStore() ?? {};
  return correlationStorage.run({ ...existing, correlationId }, fn);
}

// ---------------------------------------------------------------------------
// Pino instance
// ---------------------------------------------------------------------------
const SERVICE_NAME    = process.env.SERVICE_NAME    ?? 'vesting-backend';
const SERVICE_VERSION = process.env.SERVICE_VERSION ?? 'unknown';
const LOG_LEVEL       = process.env.LOG_LEVEL       ?? 'info';
const LOG_PRETTY      = process.env.LOG_PRETTY      === 'true';

/** Redact a Stellar address — keep first 4 and last 4 chars. */
export function redactAddress(addr) {
  if (typeof addr !== 'string' || addr.length < 10) return '[redacted]';
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

/**
 * Walk an object and redact known sensitive keys in-place on a shallow copy.
 * Keys redacted: secretKey, secret, SPONSOR_SECRET_KEY, authorization
 */
export function redactSensitive(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const REDACTED_KEYS = new Set([
    'secretKey', 'secret_key', 'secret', 'SPONSOR_SECRET_KEY',
    'authorization', 'Authorization', 'password', 'token',
  ]);
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    if (REDACTED_KEYS.has(key)) {
      result[key] = '[REDACTED]';
    } else if (
      typeof result[key] === 'string' &&
      (result[key].startsWith('S') || result[key].startsWith('G')) &&
      result[key].length === 56
    ) {
      // Looks like a Stellar keypair — truncate
      result[key] = redactAddress(result[key]);
    }
  }
  return result;
}

/**
 * Inject the three correlation IDs into every log record.
 * Undefined/null values are omitted to keep logs lean.
 */
function buildCorrelationFields() {
  const store = correlationStorage.getStore();
  if (!store) return {};
  const fields = {};
  if (store.requestId)     fields.request_id     = store.requestId;
  if (store.traceId)       fields.trace_id       = store.traceId;
  if (store.correlationId) fields.correlation_id = store.correlationId;
  return fields;
}

function buildPinoLogger() {
  if (!pino) {
    // Minimal fallback using console
    const levels = ['debug', 'info', 'warn', 'error'];
    const minLevel = levels.indexOf(LOG_LEVEL);
    const fallback = {};
    levels.forEach((lvl, idx) => {
      fallback[lvl] = (msgOrObj, msg) => {
        if (idx < minLevel) return;
        const entry = typeof msgOrObj === 'string'
          ? { message: msgOrObj }
          : { ...msgOrObj, message: msg ?? msgOrObj.message };
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level:     lvl,
            service:   SERVICE_NAME,
            version:   SERVICE_VERSION,
            ...buildCorrelationFields(),
            ...entry,
          }) + '\n',
        );
      };
    });
    fallback.child = () => fallback;
    return fallback;
  }

  const transport = LOG_PRETTY
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined;

  const instance = pino(
    {
      level: LOG_LEVEL,
      base: { service: SERVICE_NAME, version: SERVICE_VERSION },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(label) { return { level: label }; },
        log(obj) {
          // Inject all three correlation IDs from AsyncLocalStorage on every log call.
          return { ...buildCorrelationFields(), ...obj };
        },
      },
      redact: {
        paths: ['*.secret', '*.secretKey', '*.authorization', '*.password', '*.token'],
        censor: '[REDACTED]',
      },
      serializers: {
        err:   pino.stdSerializers.err,
        error: pino.stdSerializers.err,
      },
    },
    transport ? pino.transport(transport) : undefined,
  );

  return instance;
}

export const logger = buildPinoLogger();
