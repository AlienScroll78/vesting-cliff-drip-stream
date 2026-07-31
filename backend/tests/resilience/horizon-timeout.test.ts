/**
 * Resilience Test: Horizon Timeout → Exponential Backoff → Eventual Success
 *
 * Scenario:
 *   1. Toxiproxy adds a timeout toxic on the horizon proxy so the first two
 *      requests time out.
 *   2. The client's retry logic (exponential backoff) retries the request.
 *   3. The toxic is removed before the third attempt; the request succeeds.
 *
 * Requires docker-compose.toxiproxy.yml to be running.
 * Run via: npm run test:resilience
 */

import { ToxiproxyClient, sleep } from './toxiproxyClient';

// ── Config ────────────────────────────────────────────────────────────────────

const HORIZON_PROXY_URL = process.env.HORIZON_URL ?? 'http://localhost:18080';
const TOXIPROXY_HOST    = process.env.TOXIPROXY_HOST ?? 'localhost';
const TOXIPROXY_PORT    = parseInt(process.env.TOXIPROXY_PORT ?? '8474', 10);

// ── Minimal HTTP client with exponential backoff ──────────────────────────────

interface RetryOptions {
  maxAttempts:   number;
  baseDelayMs:   number;
  timeoutMs:     number;
}

async function fetchWithRetry(
  url: string,
  opts: RetryOptions,
): Promise<{ status: number; body: string }> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

    try {
      const res  = await fetch(url, { signal: controller.signal });
      const body = await res.text();
      clearTimeout(timer);
      return { status: res.status, body };
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < opts.maxAttempts) {
        const delay = opts.baseDelayMs * 2 ** (attempt - 1);
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error('All retry attempts exhausted');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const tp = new ToxiproxyClient(TOXIPROXY_HOST, TOXIPROXY_PORT);

describe('Resilience: Horizon timeout → exponential backoff → eventual success', () => {
  beforeAll(async () => {
    const healthy = await tp.isHealthy();
    if (!healthy) {
      throw new Error(
        'Toxiproxy is not reachable. Run: docker-compose -f docker-compose.toxiproxy.yml up -d',
      );
    }
  });

  afterEach(async () => {
    // Clean up toxics regardless of test outcome.
    try {
      const proxy = await tp.getProxy('horizon');
      await proxy.removeAllToxics();
    } catch {
      // Proxy may not exist yet; ignore.
    }
  });

  it('succeeds after retries when Horizon recovers', async () => {
    const proxy = await tp.getProxy('horizon');

    // Add a timeout toxic: all connections hang for 5 s (our client times out
    // at 500 ms so the first request fails immediately).
    const toxic = await proxy.addToxic({
      type:       'timeout',
      stream:     'downstream',
      toxicity:   1.0,
      attributes: { timeout: 5000 },
    });

    let attemptCount = 0;

    // Replace fetchWithRetry with a version that removes the toxic on the
    // second retry to simulate Horizon recovering mid-retry sequence.
    async function fetchAndHeal(url: string): Promise<{ status: number; body: string }> {
      let lastError: Error | undefined;

      for (let attempt = 1; attempt <= 4; attempt++) {
        attemptCount++;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 500); // 500 ms client timeout

        try {
          const res  = await fetch(url, { signal: controller.signal });
          const body = await res.text();
          clearTimeout(timer);
          return { status: res.status, body };
        } catch (err) {
          clearTimeout(timer);
          lastError = err instanceof Error ? err : new Error(String(err));

          // On the second failure, remove the toxic to simulate recovery.
          if (attempt === 2) {
            await proxy.removeToxic(toxic.name);
          }

          const delay = 100 * 2 ** (attempt - 1);
          await sleep(delay);
        }
      }

      throw lastError ?? new Error('exhausted');
    }

    const result = await fetchAndHeal(`${HORIZON_PROXY_URL}/__admin/health`);

    // Should have failed at least twice before succeeding.
    expect(attemptCount).toBeGreaterThanOrEqual(3);
    expect(result.status).toBe(200);
  }, 30_000);

  it('throws after all retry attempts when Horizon never recovers', async () => {
    const proxy = await tp.getProxy('horizon');

    // Permanent timeout toxic.
    await proxy.addToxic({
      type:       'timeout',
      stream:     'downstream',
      toxicity:   1.0,
      attributes: { timeout: 5000 },
    });

    await expect(
      fetchWithRetry(`${HORIZON_PROXY_URL}/__admin/health`, {
        maxAttempts: 3,
        baseDelayMs: 100,
        timeoutMs:   300,
      }),
    ).rejects.toThrow();
  }, 15_000);
});
