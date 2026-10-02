/**
 * Resilience Test: Horizon 503 → Circuit Breaker Opens → Fallback Response
 *
 * Scenario:
 *   1. Toxiproxy injects a 503 status on all Horizon responses.
 *   2. A simple circuit-breaker opens after 3 consecutive failures.
 *   3. Further requests short-circuit immediately with a fallback value.
 *   4. After a half-open window, the circuit closes once a request succeeds.
 *
 * Requires docker-compose.toxiproxy.yml to be running.
 */

import { ToxiproxyClient, sleep } from './toxiproxyClient';

// ── Config ────────────────────────────────────────────────────────────────────

const HORIZON_PROXY_URL = process.env.HORIZON_URL ?? 'http://localhost:18080';
const TOXIPROXY_HOST    = process.env.TOXIPROXY_HOST ?? 'localhost';
const TOXIPROXY_PORT    = parseInt(process.env.TOXIPROXY_PORT ?? '8474', 10);

// ── Simple circuit-breaker implementation ─────────────────────────────────────

type CBState = 'closed' | 'open' | 'half-open';

class CircuitBreaker {
  private state: CBState = 'closed';
  private failures = 0;
  private openedAt = 0;

  constructor(
    private readonly threshold: number,   // failures before opening
    private readonly halfOpenAfterMs: number, // ms before trying half-open
  ) {}

  async execute<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt >= this.halfOpenAfterMs) {
        this.state = 'half-open';
      } else {
        return fallback;
      }
    }

    try {
      const result = await fn();
      if (this.state === 'half-open') {
        this.reset();
      }
      return result;
    } catch (err) {
      this.failures++;
      if (this.failures >= this.threshold) {
        this.state    = 'open';
        this.openedAt = Date.now();
      }
      if (this.state === 'half-open') {
        this.state    = 'open';
        this.openedAt = Date.now();
      }
      return fallback;
    }
  }

  getState(): CBState { return this.state; }

  reset(): void {
    this.state    = 'closed';
    this.failures = 0;
    this.openedAt = 0;
  }
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function horizonRequest(url: string): Promise<{ status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (res.status >= 500) throw new Error(`Horizon returned ${res.status}`);
    return { status: res.status };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const tp = new ToxiproxyClient(TOXIPROXY_HOST, TOXIPROXY_PORT);
const FALLBACK = { status: 503 };

describe('Resilience: Horizon 503 → circuit breaker opens → fallback', () => {
  let cb: CircuitBreaker;

  beforeAll(async () => {
    const healthy = await tp.isHealthy();
    if (!healthy) {
      throw new Error('Toxiproxy is not reachable.');
    }
  });

  beforeEach(() => {
    cb = new CircuitBreaker(3, 500 /* half-open after 500 ms */);
  });

  afterEach(async () => {
    try {
      const proxy = await tp.getProxy('horizon');
      await proxy.removeAllToxics();
    } catch { /* ignore */ }
  });

  it('opens the circuit after threshold consecutive 503 responses', async () => {
    const proxy = await tp.getProxy('horizon');

    // Inject a "reset_peer" toxic (closes connection abruptly, mimicking 503).
    // WireMock is set to return 503 for all requests when this stub is active.
    await proxy.addToxic({
      type:       'reset_peer',
      stream:     'downstream',
      toxicity:   1.0,
      attributes: { timeout: 100 },
    });

    const url = `${HORIZON_PROXY_URL}/accounts/test`;

    // First 3 calls fail → circuit opens.
    for (let i = 0; i < 3; i++) {
      const result = await cb.execute(() => horizonRequest(url), FALLBACK);
      expect(result.status).toBe(503);
    }

    expect(cb.getState()).toBe('open');

    // Further calls short-circuit immediately (no network request).
    const shortCircuited = await cb.execute(() => horizonRequest(url), FALLBACK);
    expect(shortCircuited).toEqual(FALLBACK);
  }, 20_000);

  it('transitions to half-open and closes after recovery', async () => {
    const proxy = await tp.getProxy('horizon');

    await proxy.addToxic({
      type:       'reset_peer',
      stream:     'downstream',
      toxicity:   1.0,
      attributes: { timeout: 100 },
    });

    const url = `${HORIZON_PROXY_URL}/__admin/health`;

    // Force the circuit open by making 3 failing calls.
    for (let i = 0; i < 3; i++) {
      await cb.execute(() => horizonRequest(url), FALLBACK);
    }
    expect(cb.getState()).toBe('open');

    // Remove the toxic to simulate Horizon recovery.
    await proxy.removeAllToxics();

    // Wait for the half-open window.
    await sleep(600);

    // Next call should succeed (half-open → closed).
    const result = await cb.execute(() => horizonRequest(url), FALLBACK);
    expect(result.status).toBe(200);
    expect(cb.getState()).toBe('closed');
  }, 20_000);
});
