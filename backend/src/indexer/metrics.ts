/**
 * backend/src/indexer/metrics.ts
 *
 * Prometheus metrics for the Horizon event indexer.
 *
 * Uses a DEDICATED Registry (not the shared application registry) so that:
 *   - Tests can instantiate the module without colliding with the main
 *     prom-client global registry.
 *   - The indexer can be deployed as a standalone process without carrying
 *     unrelated HTTP / WebSocket metrics.
 *
 * Exposed metrics (per acceptance criteria):
 *   events_indexed_total      Counter   — indexed events by type
 *   indexer_lag_seconds       Gauge     — seconds behind the chain tip
 *   horizon_errors_total      Counter   — Horizon API errors by HTTP status
 *   indexer_poll_duration_seconds  Histogram — time per poll cycle
 */

import { Registry, Counter, Gauge, Histogram } from 'prom-client';

// ── Registry ──────────────────────────────────────────────────────────────────

/** Dedicated Prometheus registry for the indexer service. */
export const indexerRegistry = new Registry();

indexerRegistry.setDefaultLabels({ service: 'vesting-indexer' });

// ── Counters ──────────────────────────────────────────────────────────────────

/**
 * Total number of on-chain stream events indexed, labelled by `event_type`.
 *
 * Increment once per successfully decoded and persisted event.
 * Label values: StreamCreated | TokensClaimed | StreamCancelled |
 *               StreamClawedBack | StreamDrained
 */
export const eventsIndexedTotal = new Counter({
  name:       'events_indexed_total',
  help:       'Total number of on-chain stream events indexed, by event type',
  labelNames: ['event_type'] as const,
  registers:  [indexerRegistry],
});

/**
 * Total number of Horizon API errors encountered, labelled by HTTP `status`.
 *
 * Increment on any non-2xx response or network failure.
 * Use status='unknown' for non-HTTP errors (e.g. DNS failure, timeout).
 */
export const horizonErrorsTotal = new Counter({
  name:       'horizon_errors_total',
  help:       'Total number of Horizon API errors, by HTTP status code',
  labelNames: ['status'] as const,
  registers:  [indexerRegistry],
});

// ── Gauges ────────────────────────────────────────────────────────────────────

/**
 * Current lag in seconds between the latest Horizon ledger close time and
 * the wall-clock time when the indexer processed it.
 *
 * A value near 0 means the indexer is at the chain tip.
 * A rising value indicates the indexer is falling behind (e.g. due to
 * backoff, a slow DB, or high Horizon latency).
 */
export const indexerLagSeconds = new Gauge({
  name:      'indexer_lag_seconds',
  help:      'Seconds between the latest Horizon ledger close time and now',
  registers: [indexerRegistry],
});

// ── Histograms ────────────────────────────────────────────────────────────────

/**
 * Duration of each complete indexer poll cycle (fetch + decode + persist).
 *
 * Useful for detecting slow cycles that may indicate DB contention or
 * unusually large pages.
 */
export const indexerPollDurationSeconds = new Histogram({
  name:      'indexer_poll_duration_seconds',
  help:      'Duration of each indexer poll cycle in seconds',
  buckets:   [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [indexerRegistry],
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return the Prometheus text-format metrics output. */
export async function getMetricsOutput(): Promise<string> {
  return indexerRegistry.metrics();
}

/** Return the Content-Type header value for the metrics response. */
export function getContentType(): string {
  return indexerRegistry.contentType;
}
