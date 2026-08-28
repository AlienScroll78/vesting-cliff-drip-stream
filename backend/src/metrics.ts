/**
 * Issue #570: Prometheus metrics for backend observability.
 *
 * Creates a dedicated Registry and exports all six instrumentation metrics:
 *   - http_requests_total            (Counter)
 *   - http_request_duration_seconds  (Histogram)
 *   - indexer_events_processed_total (Counter)
 *   - indexer_poll_lag_seconds       (Gauge)
 *   - db_query_duration_seconds      (Histogram)
 *   - websocket_connections_active   (Gauge)
 *
 * A dedicated Registry (not the global default) is used so that tests can
 * instantiate fresh registries without cross-contamination.
 */

import { Registry, Counter, Histogram, Gauge } from 'prom-client';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Dedicated Prometheus registry for this service. */
export const registry = new Registry();

registry.setDefaultLabels({ service: 'vesting-backend' });

// ---------------------------------------------------------------------------
// HTTP metrics
// ---------------------------------------------------------------------------

/** Total number of HTTP requests received, labelled by method, path, and status. */
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'] as const,
  registers: [registry],
});

/** Duration of HTTP request handling in seconds. */
export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'path'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Indexer metrics
// ---------------------------------------------------------------------------

/** Total number of Horizon events processed by the indexer. */
export const indexerEventsProcessedTotal = new Counter({
  name: 'indexer_events_processed_total',
  help: 'Total number of Horizon events processed by the indexer',
  labelNames: [] as const,
  registers: [registry],
});

/**
 * Current poll lag for the indexer in seconds — the difference between
 * the current wall-clock time and the timestamp of the most-recently
 * ingested ledger event.
 */
export const indexerPollLagSeconds = new Gauge({
  name: 'indexer_poll_lag_seconds',
  help: 'Lag between the current time and the last processed ledger event (seconds)',
  labelNames: [] as const,
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Database metrics
// ---------------------------------------------------------------------------

/** Duration of individual database queries in seconds, labelled by query name. */
export const dbQueryDurationSeconds = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['query'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

// ---------------------------------------------------------------------------
// WebSocket metrics
// ---------------------------------------------------------------------------

/** Number of currently active WebSocket connections. */
export const websocketConnectionsActive = new Gauge({
  name: 'websocket_connections_active',
  help: 'Number of currently active WebSocket connections',
  labelNames: [] as const,
  registers: [registry],
});
