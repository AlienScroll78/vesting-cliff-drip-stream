import express, { type Request, type Response, NextFunction } from 'express';
import { RecipientParamsSchema } from './validation.js';
import { validate } from './middleware/validate.js';
import { rateLimitMiddleware } from './middleware/tokenBucketRateLimit.js';
import { corsMiddleware } from './middleware/cors.js';
import { adminRouter } from './admin/index.js';
import { healthHandler, readyHandler } from './routes/health.js';
import { streamDetailsRouter } from './routes/streamDetails.js';
import { sponsorDashboardRouter } from './routes/sponsorDashboard.js';
import { createScheduleController } from './controllers/schedules.js';
import { sponsorStreamsRouter } from './routes/streams.js';
import { claimableBatchRouter } from './routes/claimableBatch.js';
import { analyticsSummaryHandler } from './routes/analyticsSummary.js';
import { buildClaimTxRouter } from './routes/buildClaimTx.js';
// @ts-ignore — no type declarations for the JS logger module
import { requestLoggerMiddleware } from './requestLogger.js';
import { metricsMiddleware } from './middleware/metricsMiddleware.js';
import { prometheusMetricsHandler } from './routes/metrics.js';
import { corsMiddleware } from './middleware/cors.js';

const app = express();

app.set('trust proxy', 1);

// Prometheus metrics — collect timing for every request (before other middleware).
app.use(metricsMiddleware);

// Prometheus scrape endpoint — must NOT be behind auth or rate-limiting.
app.get('/metrics', prometheusMetricsHandler);

// Assign request_id / trace_id / correlation_id and propagate via
// AsyncLocalStorage so every log call during a request includes all three IDs.
app.use(requestLoggerMiddleware);
app.use(corsMiddleware);

app.use(express.json());

app.get('/health', healthHandler);
app.get('/ready', readyHandler);
app.use(rateLimitMiddleware);

app.use('/api/streams', streamDetailsRouter);
app.use('/streams', streamDetailsRouter);

// Batch claimable amounts (Issue #1062) — mirrors the on-chain
// `get_claimable_batch` view.
app.use('/api', claimableBatchRouter);
app.use('/', claimableBatchRouter);

// Sponsor stream list — GET /api/streams?sponsor=...
app.use('/api/streams', sponsorStreamsRouter);
app.use('/streams', sponsorStreamsRouter);

// Sponsor dashboard — GET /sponsors/:address/streams (Issue #1011)
app.use('/api', sponsorDashboardRouter);

// Stream balance — GET /api/streams/:recipient/balance (Issue #996)
app.use('/api/streams', streamBalanceRouter);

app.get(
  '/api/v1/schedules/:recipient',
  validate({ params: RecipientParamsSchema }),
  createScheduleController(),
);

// Analytics summary — aggregate protocol-wide statistics (Issue #745)
app.get('/api/analytics/summary', analyticsSummaryHandler);

// Admin API — all routes require Bearer token (ADMIN_API_KEY env var).
app.use('/admin', adminRouter);

// Claim transaction builder — POST /api/streams/:recipient/build-claim-tx
app.use('/api', buildClaimTxRouter);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof Error) {
    return res.status(400).json({ error: err.message });
  }
  return res.status(500).json({ error: 'Internal server error' });
});

export default app;
