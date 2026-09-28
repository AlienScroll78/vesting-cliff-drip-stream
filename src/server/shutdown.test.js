import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ShutdownManager } from './shutdown.js';
import { createApp } from './app.js';

describe('Graceful Shutdown Handling (Issue #299)', () => {
  test('rejects new connections with 503 after shutdown is initiated', async () => {
    let exitCode = null;
    const shutdownManager = new ShutdownManager({
      processExit: code => { exitCode = code; }
    });

    const app = createApp({
      inFlightMiddleware: shutdownManager.getInFlightMiddleware()
    });

    const server = app.listen(0);
    const port = server.address().port;

    shutdownManager.isShuttingDown = true;

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 503);
    const json = await res.json();
    assert.match(json.message, /shutting down/i);

    server.close();
  });

  test('tracks in-flight requests and executes DB, Redis, and Worker teardowns', async () => {
    let dbClosed = false;
    let redisDisconnected = false;
    let workerStopped = false;
    let exitCode = null;

    const dbPool = { end: async () => { dbClosed = true; } };
    const redisClient = { quit: async () => { redisDisconnected = true; } };
    const eventWorker = { stop: async () => { workerStopped = true; } };

    const shutdownManager = new ShutdownManager({
      dbPool,
      redisClient,
      eventWorker,
      processExit: code => { exitCode = code; }
    });

    const app = createApp({
      inFlightMiddleware: shutdownManager.getInFlightMiddleware()
    });

    const server = app.listen(0);

    await shutdownManager.performShutdown(server, 'SIGTERM');

    assert.equal(dbClosed, true);
    assert.equal(redisDisconnected, true);
    assert.equal(workerStopped, true);
    assert.equal(exitCode, 0);
  });

  test('forces exit code 1 when shutdown times out', async () => {
    let exitCode = null;
    const shutdownManager = new ShutdownManager({
      timeoutMs: 50,
      processExit: code => { exitCode = code; }
    });

    shutdownManager.registerTeardown('stuckTask', () => new Promise(r => setTimeout(r, 2000)));

    const app = createApp({
      inFlightMiddleware: shutdownManager.getInFlightMiddleware()
    });
    const server = app.listen(0);

    const shutdownPromise = shutdownManager.performShutdown(server, 'SIGINT');
    await new Promise(r => setTimeout(r, 100));

    assert.equal(exitCode, 1);
  });
});
