# OpenTelemetry Distributed Tracing

The backend is instrumented with [OpenTelemetry](https://opentelemetry.io) to capture distributed traces across all layers:

- **HTTP server**: Express/Fastify inbound requests auto-instrumented
- **Database**: PostgreSQL queries traced via `pg` instrumentation
- **Redis**: Cache calls traced via Redis 4.x instrumentation
- **Horizon**: Outbound Horizon HTTP calls traced with manual spans + W3C propagation

All spans are enriched with semantic conventions and custom attributes for easy filtering in your observability backend (Jaeger, Honeycomb, Datadog, etc.).

---

## Quick Start

### 1. Configuration

Set the following environment variables:

```bash
# OTLP HTTP endpoint for exporting traces (required for production)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces

# Service identity
OTEL_SERVICE_NAME=vesting-backend
OTEL_SERVICE_VERSION=1.0.0

# Sampling rate (0–1): 0.1 = 10 %
OTEL_SAMPLE_RATE=0.1
```

If `OTEL_EXPORTER_OTLP_ENDPOINT` is empty, traces are not exported (development mode defaults to console output).

### 2. Initialise tracing **first**

In your entry point (`backend/src/index.ts`), import `tracing.ts` before any other module:

```typescript
// Must be first line
import './tracing';

// Now import everything else
import express from 'express';
import { horizonGet } from './horizonClient';
// …
```

This ensures instrumentation patches are applied before libraries are loaded.

### 3. Run your app

Traces will be automatically collected for:

- Every HTTP request/response
- Every `pg` query
- Every Redis command
- Every outbound HTTP call (including Horizon)

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  HTTP Request (Express)                                              │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ Span: GET /vesting/schedule/:recipient                         │ │
│  │ Auto-instrumented by @opentelemetry/instrumentation-http      │ │
│  │                                                                 │ │
│  │  ┌─────────────────────────────────────────────────────────┐  │ │
│  │  │ Span: pg.query                                           │  │ │
│  │  │ Auto-instrumented by @opentelemetry/instrumentation-pg  │  │ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  │                                                                 │ │
│  │  ┌─────────────────────────────────────────────────────────┐  │ │
│  │  │ Span: redis.get                                          │  │ │
│  │  │ Auto-instrumented by @opentelemetry/instrumentation-redis│ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  │                                                                 │ │
│  │  ┌─────────────────────────────────────────────────────────┐  │ │
│  │  │ Span: horizon.get /accounts/:id                          │  │ │
│  │  │ Manual span in horizonClient.ts                          │  │ │
│  │  │ W3C TraceContext propagated via traceparent header       │  │ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

All nested spans share the same `traceId` and are linked via `parentSpanId`.

---

## Trace propagation

Outbound HTTP calls (e.g., to Horizon) automatically receive the [W3C TraceContext](https://www.w3.org/TR/trace-context/) headers:

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

If the downstream service supports W3C TraceContext, the trace will continue seamlessly across service boundaries.

---

## Local development

To visualise traces locally, run Jaeger in a Docker container:

```bash
docker run -d --name jaeger \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 4318:4318 \
  -p 16686:16686 \
  jaegertracing/all-in-one:latest
```

Then set:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
```

Visit http://localhost:16686 to view traces.

---

## Testing

Unit tests for the tracing module are in `backend/tests/tracing.test.ts`.  They use an in-memory exporter to assert that spans are created correctly without hitting a real OTLP endpoint.

```bash
npm test
```

---

## Sampling

The `OTEL_SAMPLE_RATE` variable controls tail-based sampling:

- `1.0` = 100 % (capture everything; useful in development)
- `0.1` = 10 % (recommended for production)
- `0.01` = 1 % (high-throughput scenarios)

The sampler is a `ParentBasedSampler` wrapping `TraceIdRatioBasedSampler`, so:

- Root spans are sampled at the configured rate.
- Child spans inherit the parent's sampling decision.

---

## Further reading

- [OpenTelemetry Node.js SDK](https://opentelemetry.io/docs/instrumentation/js/getting-started/nodejs/)
- [W3C TraceContext](https://www.w3.org/TR/trace-context/)
- [Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)
