/**
 * Resilience Test: Horizon unavailability → Circuit Breaker
 *
 * Scenarios covered:
 *   1. Circuit opens after 5 consecutive Horizon failures (Toxiproxy timeout)
 *   2. Open circuit short-circuits immediately with CircuitOpenError (no network call)
 *   3. After half-open window, probe succeeds → circuit closes
 *   4. GET /health exposes horizon_circuit state correctly
 *
 * Prerequisites:
 *   docker compose -f docker-compose.toxiproxy.yml up -d
 *
 * Run:
 *   HORIZON_URL=http://localhost:18080 npx vitest run \
 *     backend/tests/resilience/horizon-circuit-breaker.test.ts
 */

import { ToxiproxyClient, sleep } from './toxiproxyClient';
import { CircuitBreaker, CircuitOpenError } from '../../src/horizonCircuitBreaker';

// ── Config ────────────────────────────────────────────────────────────────────

const HORIZON_PROXY_URL = process.env.HORIZON_URL ?? 'http://localhost:18080';
const BACKEND_URL       = process.env.BACKEND_URL  ?? 'http://localhost:3000';
const TOXIPROXY_HOST    = process.env.TOXIPROXY_HOST ?? 'localhost';
const TOXIPROXY_PORT    = parseInt(process.env.TOXIPROXY_PORT ?? '8474', 10);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Simple fetch wrapper that throws on network errors or HTTP ≥ 500. */
async function horizonFetch(url: string): Promise<{ status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_500);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (res.status >= 500) {
      throw new Error(`Horizon responded HTTP ${res.status}`);
    }
    return { status: res.status };
  } catch (err) {
    clearTimeout(timer);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const tp = new ToxiproxyClient(TOXIPROXY_HOST, TOXIPROXY_PORT);

describe('Resilience: Horizon unavailability → circuit breaker', () => {
  beforeAll(async () => {
    const healthy = await tp.isHealthy();
    if (!healthy) {
      throw new Error(
        'Toxiproxy is not reachable. Start it with:\n' +
        '  docker compose -f docker-compose.toxiproxy.yml up -d',
      );
    }
  });

  afterEach(async () => {
    try {
      const proxy = await tp.getProxy('horizon');
      await proxy.removeAllToxics();
    } catch {
      // proxy may not exist; ignore
    }
  });

  // ── Scenario 1: circuit opens after threshold failures ──────────────────────

  it('opens after 5 consecutive Horizon failures', async () => {
    const proxy = await tp.getProxy('horizon');
    const url   = `${HORIZON_PROXY_URL}/__admin/health`;

    // Inject a timeout toxic — all connections hang indefinitely.
    await proxy.addToxic({
      type:       'timeout',
      stream:     'downstream',
      toxicity:   1.0,
      attributes: { timeout: 0 },
    });

    // Use a fresh CB with the required threshold (5) and a short half-open
    // window so later tests can cycle through states quickly.
    const cb = new CircuitBreaker({ threshold: 5, halfOpenAfterMs: 500 });

    let failCount = 0;
    for (let i = 0; i < 5; i++) {
      try {
        await cb.execute(() => horizonFetch(url));
      } catch {
        failCount++;
      }
    }

    expect(failCount).toBe(5);
    expect(cb.getState()).toBe('open');
  }, 30_000);

  // ── Scenario 2: open circuit short-circuits immediately ─────────────────────

  it('short-circuits immediately (no network call) when circuit is open', async () => {
    const cb  = new CircuitBreaker({ threshold: 5, halfOpenAfterMs: 30_000 });
    const url = `${HORIZON_PROXY_URL}/__admin/health`;

    // Force open the circuit.
    cb.forceOpen();
    expect(cb.getState()).toBe('open');

    let networkCallMade = false;
    const networkFn = async () => {
      networkCallMade = true;
      return horizonFetch(url);
    };

    // Should throw CircuitOpenError without ever reaching the network.
    await expect(cb.execute(networkFn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(networkCallMade).toBe(false);
  }, 5_000);

  // ── Scenario 3: half-open probe succeeds → circuit closes ───────────────────

  it('transitions to half-open after the timer and closes on probe success', async () => {
    const proxy = await tp.getProxy('horizon');
    const url   = `${HORIZON_PROXY_URL}/__admin/health`;

    // Add a fault so the first N calls fail.
    await proxy.addToxic({
      type:       'timeout',
      stream:     'downstream',
      toxicity:   1.0,
      attributes: { timeout: 0 },
    });

    const cb = new CircuitBreaker({ threshold: 5, halfOpenAfterMs: 600 });

    // Force the circuit open via 5 failures.
    for (let i = 0; i < 5; i++) {
      try {
        await cb.execute(() => horizonFetch(url));
      } catch { /* expected */ }
    }
    expect(cb.getState()).toBe('open');

    // Remove the toxic before the probe fires.
    await proxy.removeAllToxics();

    // Wait for half-open window.
    await sleep(700);

    // Next call is the probe — should succeed and close the circuit.
    const result = await cb.execute(() => horizonFetch(url));
    expect(result.status).toBe(200);
    expect(cb.getState()).toBe('closed');
  }, 30_000);

  // ── Scenario 4: half-open probe failure re-opens circuit ────────────────────

  it('re-opens immediately when the half-open probe fails', async () => {
    const proxy = await tp.getProxy('horizon');
    const url   = `${HORIZON_PROXY_URL}/__admin/health`;

    await proxy.addToxic({
      type:       'timeout',
      stream:     'downstream',
      toxicity:   1.0,
      attributes: { timeout: 0 },
    });

    const cb = new CircuitBreaker({ threshold: 5, halfOpenAfterMs: 400 });

    for (let i = 0; i < 5; i++) {
      try { await cb.execute(() => horizonFetch(url)); } catch { /* expected */ }
    }
    expect(cb.getState()).toBe('open');

    // Wait for half-open transition without removing the toxic.
    await sleep(500);
    expect(cb.getState()).toBe('half-open');

    // Probe fails — should re-open.
    try {
      await cb.execute(() => horizonFetch(url));
    } catch { /* expected */ }

    expect(cb.getState()).toBe('open');
  }, 20_000);

  // ── Scenario 5: GET /health reflects circuit state ─────────────────────────

  it('GET /health exposes horizon_circuit state', async () => {
    // This test queries the live backend's /health endpoint.
    // Skip if BACKEND_URL is not accessible (CI without a running server).
    let backendReachable = false;
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 1_000);
      const probe = await fetch(`${BACKEND_URL}/health`, { signal: ctrl.signal });
      backendReachable = probe.ok;
    } catch { /* not running */ }

    if (!backendReachable) {
      console.warn('[skip] Backend not reachable — skipping /health check');
      return;
    }

    const res  = await fetch(`${BACKEND_URL}/health`);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toHaveProperty('horizon_circuit');
    expect(['closed', 'open', 'half-open']).toContain(body.horizon_circuit);
  }, 10_000);
});

// ── Unit tests: CircuitBreaker state machine (no Toxiproxy needed) ────────────

describe('CircuitBreaker unit: state machine transitions', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ threshold: 5, halfOpenAfterMs: 200 });
  });

  it('starts in closed state', () => {
    expect(cb.getState()).toBe('closed');
  });

  it('stays closed while failure count is below threshold', async () => {
    for (let i = 0; i < 4; i++) {
      try {
        await cb.execute(() => Promise.reject(new Error('fail')));
      } catch { /* expected */ }
    }
    expect(cb.getState()).toBe('closed');
  });

  it('opens exactly at the threshold (5 failures)', async () => {
    for (let i = 0; i < 5; i++) {
      try {
        await cb.execute(() => Promise.reject(new Error('fail')));
      } catch { /* expected */ }
    }
    expect(cb.getState()).toBe('open');
  });

  it('throws CircuitOpenError without calling fn when open', async () => {
    cb.forceOpen();
    const fn = vi.fn();
    await expect(cb.execute(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('transitions to half-open after halfOpenAfterMs', async () => {
    cb.forceOpen();
    await sleep(250);
    expect(cb.getState()).toBe('half-open');
  });

  it('resets to closed on success in half-open state', async () => {
    cb.forceOpen();
    await sleep(250);
    expect(cb.getState()).toBe('half-open');
    await cb.execute(() => Promise.resolve(42));
    expect(cb.getState()).toBe('closed');
  });

  it('re-opens on failure in half-open state', async () => {
    cb.forceOpen();
    await sleep(250);
    expect(cb.getState()).toBe('half-open');
    try {
      await cb.execute(() => Promise.reject(new Error('probe fail')));
    } catch { /* expected */ }
    expect(cb.getState()).toBe('open');
  });

  it('resets to closed after explicit reset()', async () => {
    for (let i = 0; i < 5; i++) {
      try { await cb.execute(() => Promise.reject(new Error('fail'))); } catch {}
    }
    expect(cb.getState()).toBe('open');
    cb.reset();
    expect(cb.getState()).toBe('closed');
  });

  it('getStats() returns correct shape', () => {
    const stats = cb.getStats();
    expect(stats).toMatchObject({
      state: 'closed',
      consecutiveFailures: 0,
      threshold: 5,
      halfOpenAfterMs: 200,
    });
  });

  it('success after partial failures resets consecutive counter', async () => {
    // 4 failures — still closed
    for (let i = 0; i < 4; i++) {
      try { await cb.execute(() => Promise.reject(new Error('fail'))); } catch {}
    }
    expect(cb.getState()).toBe('closed');

    // One success — counter resets
    await cb.execute(() => Promise.resolve('ok'));
    expect(cb.getStats().consecutiveFailures).toBe(0);

    // Now it takes another 5 failures to open
    for (let i = 0; i < 4; i++) {
      try { await cb.execute(() => Promise.reject(new Error('fail'))); } catch {}
    }
    expect(cb.getState()).toBe('closed');
  });
});
