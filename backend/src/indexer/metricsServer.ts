/**
 * backend/src/indexer/metricsServer.ts
 *
 * Lightweight HTTP server that exposes Prometheus metrics on GET /metrics
 * and a liveness probe on GET /health.
 *
 * Start this alongside the StreamIndexer to satisfy Kubernetes/Prometheus
 * scraping without adding a dependency on the main Express application.
 *
 * Usage:
 *   import { startMetricsServer } from './metricsServer.js';
 *   const server = startMetricsServer(9464);
 *   // later:
 *   server.close();
 */

import http from 'http';
import { getMetricsOutput, getContentType } from './metrics.js';

/**
 * Start the metrics HTTP server on the given port.
 *
 * Routes:
 *   GET /metrics  → Prometheus text-format exposition
 *   GET /health   → { status: "ok" } (liveness probe)
 *   *             → 404
 */
export function startMetricsServer(port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/metrics') {
      try {
        const output = await getMetricsOutput();
        res.writeHead(200, { 'Content-Type': getContentType() });
        res.end(output);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(String(err));
      }
    } else if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });

  server.listen(port, () => {
    console.log(`[indexer-metrics] Prometheus metrics listening on :${port}/metrics`);
  });

  return server;
}
