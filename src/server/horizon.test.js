import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { HorizonManager } from './horizon.js';
import { createApp } from './app.js';

describe('Horizon Failover Support & Circuit Breaker (Issue #300)', () => {
  test('parses comma-separated HORIZON_ENDPOINTS (up to 3)', () => {
    const manager = new HorizonManager({
      endpoints: ['http://ep1.com', 'http://ep2.com', 'http://ep3.com', 'http://ep4.com']
    });
    assert.equal(manager.endpoints.length, 3);
    assert.equal(manager.endpoints[0].url, 'http://ep1.com');
    assert.equal(manager.endpoints[1].url, 'http://ep2.com');
    assert.equal(manager.endpoints[2].url, 'http://ep3.com');
  });

  test('round-robin load balances across healthy endpoints', async () => {
    const calledUrls = [];
    const mockFetch = async (url) => {
      calledUrls.push(url);
      return { ok: true, json: async () => ({ status: 'ok' }) };
    };

    const manager = new HorizonManager({
      endpoints: ['http://ep1.com', 'http://ep2.com'],
      fetchFn: mockFetch
    });

    await manager.executeRequest('/tx');
    await manager.executeRequest('/tx');

    assert.equal(calledUrls.length, 2);
    assert.equal(calledUrls[0], 'http://ep1.com/tx');
    assert.equal(calledUrls[1], 'http://ep2.com/tx');
  });

  test('transparent failover when primary endpoint fails', async () => {
    const calledUrls = [];
    const mockFetch = async (url) => {
      calledUrls.push(url);
      if (url.includes('ep1.com')) {
        throw new Error('Connection refused');
      }
      return { ok: true, json: async () => ({ status: 'ok' }) };
    };

    const manager = new HorizonManager({
      endpoints: ['http://ep1.com', 'http://ep2.com'],
      fetchFn: mockFetch
    });

    const res = await manager.executeRequest('/tx');
    assert.equal(res.ok, true);
    assert.equal(calledUrls.includes('http://ep1.com/tx'), true);
    assert.equal(calledUrls.includes('http://ep2.com/tx'), true);
  });

  test('marks endpoint unhealthy after 3 consecutive failures', async () => {
    const mockFetch = async () => {
      throw new Error('Service Unavailable');
    };

    const manager = new HorizonManager({
      endpoints: ['http://ep1.com'],
      maxFailures: 3,
      fetchFn: mockFetch
    });

    for (let i = 0; i < 3; i++) {
      try {
        await manager.executeRequest('/tx');
      } catch (e) {
        // Expected
      }
    }

    const health = manager.getHealthStatus();
    assert.equal(health.status, 'unavailable');
    assert.equal(manager.getCircuitBreakerStatus(), 'open');
  });

  test('/health/horizon returns 503 and circuit breaker returns open when endpoints fail', async () => {
    const manager = new HorizonManager({
      endpoints: ['http://ep1.com'],
      maxFailures: 1,
      fetchFn: async () => { throw new Error('Refused'); }
    });

    try { await manager.executeRequest('/'); } catch (e) {}

    const app = createApp({
      getHorizonHealthHandler: manager.getHorizonHealthHandler(),
      getCircuitBreakerHandler: manager.getCircuitBreakerHandler()
    });

    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res503 = await fetch(`http://127.0.0.1:${port}/health/horizon`);
      assert.equal(res503.status, 503);

      const resCb = await fetch(`http://127.0.0.1:${port}/health/horizon/circuit-breaker`);
      const cbText = await resCb.text();
      assert.equal(cbText, 'open');
    } finally {
      server.close();
    }
  });

  test('retries unhealthy endpoint after 60s cooldown', async () => {
    const manager = new HorizonManager({
      endpoints: ['http://ep1.com'],
      cooldownMs: 50,
      maxFailures: 1,
      fetchFn: async () => { throw new Error('Fail'); }
    });

    try { await manager.executeRequest('/'); } catch (e) {}
    assert.equal(manager.getHealthyEndpoints().length, 0);

    // Wait for cooldown
    await new Promise(r => setTimeout(r, 60));
    assert.equal(manager.getHealthyEndpoints().length, 1);
  });
});
