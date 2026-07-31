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
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

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
  new PgInstrumentation({
    // Capture the full query text for easier debugging.
    // Disable in high-throughput production if sensitive data is a concern.
    addSqlCommenterCommentToQueries: false,
    enhancedDatabaseReporting: true,
  }),

  // Redis 4.x client tracing.
  new RedisInstrumentation({
    // Capture the db.statement attribute (the Redis command + key).
    dbStatementSerializer: (cmdName, cmdArgs) =>
      `${cmdName} ${cmdArgs.slice(0, 2).join(' ')}`,
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

export { sdk };
