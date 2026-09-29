import { createApp } from './app.js';
import { ShutdownManager } from './shutdown.js';
import { HorizonManager } from './horizon.js';
import { AdminDrainManager } from './drain.js';

const PORT = process.env.PORT || 3000;

export const shutdownManager = new ShutdownManager();
export const horizonManager = new HorizonManager();
export const drainManager = new AdminDrainManager();

const app = createApp({
  inFlightMiddleware: shutdownManager.getInFlightMiddleware(),
  getHorizonHealthHandler: horizonManager.getHorizonHealthHandler(),
  getCircuitBreakerHandler: horizonManager.getCircuitBreakerHandler(),
  drainHandler: drainManager.getDrainHandler(),
  getHealthHandler: (req, res) => {
    const horizonStatus = horizonManager.getHealthStatus();
    const isOk = horizonStatus.status !== 'unavailable';
    res.status(isOk ? 200 : 503).json({
      status: isOk ? 'ok' : 'degraded',
      uptime: process.uptime(),
      horizon: horizonStatus
    });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

shutdownManager.registerSignalHandlers(server);

export { server, app };
