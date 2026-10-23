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
import { createWriteStream, readFileSync } from 'fs';
import { format } from 'util';
import { createHash } from 'crypto';
import pg from 'pg';
import pino from 'pino';

// Lazily resolve the OTel API so this module loads even when the SDK has not
// been initialised (e.g. during unit tests that don't boot tracing.ts).
let _otelApi = null;
function getOtelApi() {
  if (_otelApi !== null) return _otelApi;
  try {
    _otelApi = require("@opentelemetry/api");
  } catch {
    _otelApi = undefined; // package not available
  }
  return _otelApi;
}

/**
 * Return the active trace_id and span_id strings, or null if there is no
 * active span or the OTel API is unavailable.
 */
function getTraceContext() {
  const api = getOtelApi();
  if (!api) return null;
  try {
    const span = api.trace.getActiveSpan();
    if (!span) return null;
    const ctx = span.spanContext();
    if (!api.trace.isSpanContextValid(ctx)) return null;
    return { trace_id: ctx.traceId, span_id: ctx.spanId };
  } catch {
    return null;
  }
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
const VALID_LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);
let currentLogLevel = VALID_LOG_LEVELS.has(process.env.LOG_LEVEL) ? process.env.LOG_LEVEL : 'info';
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
  const outputStreams = [process.stdout];
  if (process.env.LOG_FILE_PATH) {
    outputStreams.push(createWriteStream(process.env.LOG_FILE_PATH, { flags: 'a' }));
  }

  if (!pino) {
    // Minimal fallback using console
    const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];
    const fallback = {};
    levels.forEach((lvl, idx) => {
      fallback[lvl] = (msgOrObj, msg) => {
        const minLevel = levels.indexOf(currentLogLevel);
        if (idx < minLevel) return;
        const entry = typeof msgOrObj === 'string'
          ? { message: msgOrObj }
          : { ...msgOrObj, message: msg ?? msgOrObj.message };
        const traceCtx = getTraceContext();
        const line = JSON.stringify({
            timestamp: new Date().toISOString(),
            level:     lvl,
            service:   SERVICE_NAME,
            version:   SERVICE_VERSION,
            correlation_id: correlationStorage.getStore()?.correlationId ?? null,
            duration_ms: entry.duration_ms ?? entry.durationMs ?? 0,
            ...buildCorrelationFields(),
            ...(traceCtx ?? {}),
            ...entry,
          }) + '\n';
        for (const stream of outputStreams) stream.write(line);
      };
    });
    fallback.child = () => fallback;
    return fallback;
  }

  const transport = LOG_PRETTY
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined;
  const streams = outputStreams.map((stream) => ({ stream }));
  const destination = streams.length > 1 ? pino.multistream(streams) : undefined;

  const instance = pino(
    {
      level: currentLogLevel,
      messageKey: 'message',
      base: { service: SERVICE_NAME, version: SERVICE_VERSION },
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
      formatters: {
        level(label) { return { level: label }; },
        log(obj) {
          // Inject all three correlation IDs from AsyncLocalStorage on every log call.
          return {
            correlation_id: correlationStorage.getStore()?.correlationId ?? null,
            duration_ms: obj.duration_ms ?? obj.durationMs ?? 0,
            ...buildCorrelationFields(),
            ...obj,
          };
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
    transport ? pino.transport(transport) : destination,
  );

  return instance;
}

export const logger = buildPinoLogger();

const clientPrototype = pg.Client.prototype;
const queryLogPatch = Symbol.for('vesting.structured-query-logging');
if (!clientPrototype[queryLogPatch]) {
  const originalQuery = clientPrototype.query;
  clientPrototype.query = function (...args) {
    const config = args[0];
    const queryText = typeof config === 'string' ? config : config?.text ?? '';
    const queryHash = createHash('sha256').update(queryText.replace(/\s+/g, ' ').trim()).digest('hex');
    const startedAt = process.hrtime.bigint();
    const logResult = (error, result) => {
      const fields = {
        event: error ? 'db_query_error' : 'db_query',
        query_hash: queryHash,
        rows_affected: result?.rowCount ?? 0,
        duration_ms: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e4) / 100,
      };
      if (error) logger.error({ ...fields, err: error }, 'Database query failed');
      else logger.info(fields, 'Database query');
    };

    const callbackIndex = args.findIndex((arg) => typeof arg === 'function');
    if (callbackIndex !== -1) {
      const callback = args[callbackIndex];
      args[callbackIndex] = function (error, result) {
        logResult(error, result);
        return callback.apply(this, arguments);
      };
      return originalQuery.apply(this, args);
    }

    const result = originalQuery.apply(this, args);
    if (result && typeof result.then === 'function') {
      return result.then(
        (value) => { logResult(null, value); return value; },
        (error) => { logResult(error); throw error; },
      );
    }
    return result;
  };
  Object.defineProperty(clientPrototype, queryLogPatch, { value: true });
}

for (const [consoleMethod, logMethod] of Object.entries({
  debug: 'debug',
  info: 'info',
  log: 'info',
  warn: 'warn',
  error: 'error',
})) {
  console[consoleMethod] = (...args) => logger[logMethod](format(...args));
}

function reloadLogLevel() {
  let requested = process.env.LOG_LEVEL;
  if (process.env.LOG_LEVEL_FILE) {
    try {
      requested = readFileSync(process.env.LOG_LEVEL_FILE, 'utf8').trim();
    } catch (error) {
      logger.error({ event: 'log_level_reload_failed', err: error }, 'Unable to read LOG_LEVEL_FILE');
      return;
    }
  }
  if (!VALID_LOG_LEVELS.has(requested)) {
    logger.warn({ event: 'invalid_log_level', requested_level: requested }, 'Ignoring invalid LOG_LEVEL');
    return;
  }
  currentLogLevel = requested;
  logger.level = currentLogLevel;
  logger.info({ event: 'log_level_changed', level: currentLogLevel }, 'Log level reloaded');
}

if (process.platform !== 'win32') process.on('SIGHUP', reloadLogLevel);
