import express, { type Request, type Response, NextFunction } from 'express';
import { RecipientParamsSchema } from './validation.js';
import { validate } from './middleware/validate.js';
import { rateLimitMiddleware } from './middleware/tokenBucketRateLimit.js';
import { adminRouter } from './admin/index.js';
import { healthHandler, readyHandler } from './routes/health.js';
import { streamDetailsRouter } from './routes/streamDetails.js';
import { createScheduleController } from './controllers/schedules.js';
// @ts-ignore — no type declarations for the JS logger module
import { requestLoggerMiddleware } from './requestLogger.js';

const app = express();

app.set('trust proxy', 1);

// Assign request_id / trace_id / correlation_id and propagate via
// AsyncLocalStorage so every log call during a request includes all three IDs.
app.use(requestLoggerMiddleware);

app.use(express.json());

app.get('/health', healthHandler);
app.get('/ready', readyHandler);
app.use(rateLimitMiddleware);

app.use('/api/streams', streamDetailsRouter);

app.get(
  '/api/v1/schedules/:recipient',
  validate({ params: RecipientParamsSchema }),
  createScheduleController(),
);

// Admin API — all routes require Bearer token (ADMIN_API_KEY env var).
app.use('/admin', adminRouter);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof Error) {
    return res.status(400).json({ error: err.message });
  }
  return res.status(500).json({ error: 'Internal server error' });
});

export default app;
