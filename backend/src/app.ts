import express, { type Request, type Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { validateAddress } from './validation.js';
import { createScheduleController } from './controllers/schedules.js';

const app = express();

app.set('trust proxy', 1);

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

app.get('/api/v1/schedules/:recipient', createScheduleController());

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof Error) {
    return res.status(400).json({ error: err.message });
  }
  return res.status(500).json({ error: 'Internal server error' });
});

export default app;
