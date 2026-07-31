export class ShutdownManager {
  constructor(options = {}) {
    this.isShuttingDown = false;
    this.inFlightCount = 0;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.teardownHandlers = new Map();
    this.processExit = options.processExit ?? process.exit;

    if (options.dbPool) {
      this.registerTeardown('dbPool', async () => {
        if (typeof options.dbPool.end === 'function') {
          await options.dbPool.end();
        } else if (typeof options.dbPool.drain === 'function') {
          await options.dbPool.drain();
        }
      });
    }

    if (options.redisClient) {
      this.registerTeardown('redisClient', async () => {
        if (typeof options.redisClient.quit === 'function') {
          await options.redisClient.quit();
        } else if (typeof options.redisClient.disconnect === 'function') {
          await options.redisClient.disconnect();
        }
      });
    }

    if (options.eventWorker) {
      this.registerTeardown('eventWorker', async () => {
        if (typeof options.eventWorker.stop === 'function') {
          await options.eventWorker.stop();
        }
      });
    }
  }

  getInFlightMiddleware() {
    return (req, res, next) => {
      if (this.isShuttingDown) {
        res.setHeader('Connection', 'close');
        return res.status(503).json({
          message: 'Server is shutting down. New requests are rejected.'
        });
      }

      this.inFlightCount++;

      const cleanup = () => {
        res.removeListener('finish', cleanup);
        res.removeListener('close', cleanup);
        this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      };

      res.on('finish', cleanup);
      res.on('close', cleanup);
      next();
    };
  }

  registerTeardown(name, handlerFn) {
    this.teardownHandlers.set(name, handlerFn);
  }

  async performShutdown(server, signal) {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    console.log(`Received ${signal}. Initiating graceful shutdown...`);

    let forceTimer = setTimeout(() => {
      console.error(`Graceful shutdown timed out after ${this.timeoutMs}ms. Forcing exit.`);
      this.processExit(1);
    }, this.timeoutMs);

    if (forceTimer.unref) {
      forceTimer.unref();
    }

    // 1. Stop server accepting new connections
    if (server && typeof server.close === 'function') {
      server.close();
    }

    // 2. Wait for in-flight requests to complete
    await this.waitForInFlightRequests();

    // 3. Execute teardown handlers (DB, Redis, Event worker)
    for (const [name, handler] of this.teardownHandlers.entries()) {
      try {
        console.log(`Executing teardown for: ${name}`);
        await handler();
      } catch (err) {
        console.error(`Error during teardown of ${name}:`, err);
      }
    }

    clearTimeout(forceTimer);
    console.log('Graceful shutdown completed successfully.');
    this.processExit(0);
  }

  waitForInFlightRequests() {
    return new Promise(resolve => {
      const check = () => {
        if (this.inFlightCount === 0) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  registerSignalHandlers(server) {
    const handleSignal = signal => {
      this.performShutdown(server, signal);
    };

    process.on('SIGTERM', () => handleSignal('SIGTERM'));
    process.on('SIGINT', () => handleSignal('SIGINT'));
  }
}
