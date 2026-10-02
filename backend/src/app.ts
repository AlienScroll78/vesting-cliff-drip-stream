import express, { type Request, type Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { RecipientParamsSchema } from './validation.js';
import { createScheduleController } from './controllers/schedules.js';
import { validate } from './middleware/validate.js';
import { sponsorStreamsRouter } from './routes/streams.js';
import { adminRouter } from './admin/index.js';
// @ts-ignore — no type declarations for the JS logger module
import { requestLoggerMiddleware } from './requestLogger.js';
import { corsMiddleware } from './middleware/cors.js';

const app = express();

app.set('trust proxy', 1);

// Assign request_id / trace_id / correlation_id and propagate via
// AsyncLocalStorage so every log call during a request includes all three IDs.
app.use(requestLoggerMiddleware);
app.use(corsMiddleware);

app.use(express.json());
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: 'Too many requests' });
    },
  }),
);

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
