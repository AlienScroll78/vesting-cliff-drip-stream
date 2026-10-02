/**
 * OpenTelemetry distributed tracing initialisation.
 *
 * MUST be imported/required **before** any other application module so that
 * instrumentation patches are applied before the patched libraries are loaded.
 *
 * Usage (entry-point):
 *   // index.ts – first line
 *   import './tracing';
 *   import express from 'express';
 *   // …
 *
 * Configuration is driven entirely by environment variables:
 *
 *   OTEL_EXPORTER_OTLP_ENDPOINT  OTLP HTTP endpoint (empty = no-op exporter)
 *   OTEL_SERVICE_NAME             Logical service name (default: vesting-backend)
 *   OTEL_SERVICE_VERSION          Service semver (default: 0.0.0)
 *   OTEL_SAMPLE_RATE              Tail-sampling fraction 0–1 (default: 0.1)
 *
 * When the endpoint is empty the SDK still starts but uses a no-op exporter,
 * so instrumentation is always active (useful in development / testing).
 *
 * Span helpers exported from this module
 * ──────────────────────────────────────
 *   sanitiseSql(sql)           Strip literals from SQL for safe span attributes.
 *   withDbQuerySpan(sql, fn)   Manual DB-query span with sanitised db.statement.
 *   withHorizonSpan(op, fn)    Manual Horizon RPC span.
 *   withCacheSpan(op, key, fn) Manual Redis cache span that records hit/miss.
 *   withIndexerSpan(op, fn)    Manual indexer polling-cycle span.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  NoopSpanExporter,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-node';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis-4';
import {
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  trace,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';

// ── Read configuration from environment ──────────────────────────────────────

const otlpEndpoint    = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '';
const serviceName     = process.env.OTEL_SERVICE_NAME            ?? 'vesting-backend';
const serviceVersion  = process.env.OTEL_SERVICE_VERSION         ?? '0.0.0';
const rawSampleRate   = parseFloat(process.env.OTEL_SAMPLE_RATE  ?? '0.1');
const sampleRate      = isNaN(rawSampleRate) ? 0.1 : Math.min(1, Math.max(0, rawSampleRate));
const isDev           = (process.env.NODE_ENV ?? 'development') === 'development';

// Enable SDK-internal diagnostics at debug level in development.
if (isDev) {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
}

// ── Resource ──────────────────────────────────────────────────────────────────

const resource = new Resource({
  [SEMRESATTRS_SERVICE_NAME]:    serviceName,
  [SEMRESATTRS_SERVICE_VERSION]: serviceVersion,
});

// ── Exporter ──────────────────────────────────────────────────────────────────

/**
 * Choose exporter based on configuration:
 *  - OTLP endpoint set → OTLPTraceExporter (production / staging)
 *  - Development + no endpoint → ConsoleSpanExporter (human-readable)
 *  - Otherwise → NoopSpanExporter (test / silent)
 */
function buildExporter() {
  if (otlpEndpoint) {
    return new OTLPTraceExporter({ url: otlpEndpoint });
  }
  if (isDev) {
    return new ConsoleSpanExporter();
  }
  return new NoopSpanExporter();
}

// ── Sampler ───────────────────────────────────────────────────────────────────

/**
 * ParentBasedSampler wraps TraceIdRatioBasedSampler so that:
 *  - If a parent span is sampled, the child is always sampled (propagation).
 *  - Root spans are sampled at `sampleRate`.
 */
const sampler = new ParentBasedSampler({
  root: new TraceIdRatioBasedSampler(sampleRate),
});

// ── Instrumentation libraries ─────────────────────────────────────────────────

const instrumentations = [
  // HTTP server (Express, Fastify, etc.) and outbound fetch/http calls.
  new HttpInstrumentation({
    // Propagate W3C TraceContext headers on all outbound requests.
    // This covers Horizon HTTP calls automatically.
    headersToSpanAttributes: {
      client: {
        requestHeaders:  ['traceparent', 'tracestate'],
        responseHeaders: ['traceparent'],
      },
    },
  }),

  // PostgreSQL query tracing via pg / pg-pool.
  // enhancedDatabaseReporting captures full query text which is then
  // sanitised by the dbStatementSerializer to remove literal values.
  new PgInstrumentation({
    addSqlCommenterCommentToQueries: false,
    enhancedDatabaseReporting: true,
    // Sanitise SQL before recording as a span attribute so no PII leaks.
    dbStatementSerializer: (sql: string) => sanitiseSql(sql),
  }),

  // Redis 4.x client tracing.
  new RedisInstrumentation({
    // Record the command name and the first argument (key) only;
    // never include the value payload which may contain cached PII.
    dbStatementSerializer: (cmdName: string, cmdArgs: string[]) =>
      `${cmdName} ${cmdArgs[0] ?? ''}`.trimEnd(),
  }),
];

// ── SDK initialisation ────────────────────────────────────────────────────────

const sdk = new NodeSDK({
  resource,
  sampler,
  spanProcessor: new BatchSpanProcessor(buildExporter()),
  textMapPropagator: new W3CTraceContextPropagator(),
  instrumentations,
});

sdk.start();

// Graceful shutdown: flush pending spans before the process exits.
process.on('SIGTERM', () => {
  sdk
    .shutdown()
    .then(() => {
      process.stdout.write('[tracing] SDK shut down gracefully.\n');
    })
    .catch((err: unknown) => {
      process.stderr.write(`[tracing] Error during shutdown: ${String(err)}\n`);
    })
    .finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  sdk
    .shutdown()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
});

// ── SQL sanitiser ─────────────────────────────────────────────────────────────

/**
 * Strip literal string and number values from a SQL statement so that
 * addresses, amounts, and other PII are never stored in span attributes.
 *
 * Examples:
 *   "SELECT * FROM t WHERE id = 'GABC...'" → "SELECT * FROM t WHERE id = ?"
 *   "INSERT INTO t VALUES (1, 'foo')"       → "INSERT INTO t VALUES (?, ?)"
 *
 * Positional $N parameters (pg-style) are normalised to ? for consistency.
 */
export function sanitiseSql(sql: string): string {
  return sql
    // Remove single-quoted string literals (handles escaped quotes '')
    .replace(/'(?:[^'\\]|\\.)*'/g, '?')
    // Remove double-quoted identifiers that look like values (e.g. "GABC...")
    .replace(/"[A-Z2-7]{10,}"/g, '?')
    // Replace numeric literals (integers and decimals)
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    // Normalise pg positional params ($1, $2, …) → ?
    .replace(/\$\d+/g, '?')
    // Collapse excess whitespace introduced by the above replacements
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Tracer instance ───────────────────────────────────────────────────────────

const _tracer = trace.getTracer('vesting-backend', serviceVersion);

// ── Manual span helpers ───────────────────────────────────────────────────────

/**
 * Wrap a database query in a manual span that records the sanitised SQL
 * statement as `db.statement` so no literal values (addresses, amounts) are
 * stored in trace backends.
 *
 * @param sql   Raw SQL string (will be sanitised before recording).
 * @param fn    Async factory that executes the query.
 */
export async function withDbQuerySpan<T>(
  sql: string,
  fn: () => Promise<T>,
): Promise<T> {
  return _tracer.startActiveSpan(
    'db.query',
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system':    'postgresql',
        'db.statement': sanitiseSql(sql),
      },
    },
    async (span) => {
      try {
        const result = await fn();
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Wrap a Horizon RPC call in a manual span.
 *
 * @param operation  Human-readable name of the RPC operation, e.g. "getEvents".
 * @param fn         Async factory that performs the call.
 */
export async function withHorizonSpan<T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  return _tracer.startActiveSpan(
    `horizon.${operation}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'rpc.system':  'horizon',
        'rpc.method':  operation,
      },
    },
    async (span) => {
      try {
        const result = await fn();
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Wrap a Redis cache operation and record whether it was a hit or miss.
 *
 * NOTE: The cache *key* is recorded but the cache *value* is never included
 * in span attributes because it may contain serialised PII.
 *
 * @param operation  'get' | 'set' | 'del' | 'invalidate'
 * @param key        Cache key (safe to record — scoped to recipient + ledger).
 * @param fn         Async factory.  For 'get' operations return the cached
 *                   value (or null/undefined for a miss).
 */
export async function withCacheSpan<T>(
  operation: string,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  return _tracer.startActiveSpan(
    `cache.${operation}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system':    'redis',
        'db.operation': operation,
        'cache.key':    key,
      },
    },
    async (span) => {
      try {
        const result = await fn();
        // Record hit/miss semantics for GET-style operations.
        if (operation === 'get') {
          const hit = result !== null && result !== undefined;
          span.setAttribute('cache.hit', hit);
        }
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Wrap a single indexer polling cycle in a span so that lag, event counts,
 * and errors are visible in the trace.
 *
 * @param operation  e.g. 'tick' | 'fetchEvents' | 'upsertEvents'
 * @param fn         Async factory.
 */
export async function withIndexerSpan<T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  return _tracer.startActiveSpan(
    `indexer.${operation}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        'indexer.operation': operation,
      },
    },
    async (span) => {
      try {
        const result = await fn();
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

export { sdk };
